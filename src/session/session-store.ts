/**
 * SessionStore - SQLite persistence with FTS5 search for session awareness
 *
 * Provides CRUD operations for session metadata, full-text search via FTS5,
 * and caching for session summaries.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';
import type { SessionMetadata, SessionSearchResult, SummaryType, FileChangeSummary } from './types.ts';

const COMPONENT = 'session-store';

/**
 * Internal row type for sessions table
 */
interface SessionRow {
  id: string;
  agent_id: string;
  mesh_id: string;
  started_at: number;
  ended_at: number | null;
  duration_seconds: number | null;
  transcript_path: string;
  message_count: number | null;
  tool_calls: number | null;
  final_status: string | null;
  headline: string | null;
  tags: string | null;
  files_changed: string | null;
  created_at: number;
}

/**
 * Internal row type for FTS search results
 */
interface FTSSearchRow extends SessionRow {
  snippet: string;
  rank: number;
}

/**
 * Internal row type for summary cache
 */
interface SummaryRow {
  session_id: string;
  summary_type: string;
  content: string;
  generated_at: number;
}

export class SessionStore {
  private db: Database.Database;

  // Prepared statements for frequent operations
  private insertSessionStmt: Database.Statement;
  private getSessionStmt: Database.Statement;
  private listSessionsStmt: Database.Statement;
  private insertFTSStmt: Database.Statement;
  private getSummaryStmt: Database.Statement;
  private insertSummaryStmt: Database.Statement;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createSchema();

    // Prepare frequently used statements
    this.insertSessionStmt = this.db.prepare(`
      INSERT INTO sessions (
        id, agent_id, mesh_id, started_at, ended_at, duration_seconds,
        transcript_path, message_count, tool_calls, final_status,
        headline, tags, files_changed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getSessionStmt = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `);

    this.listSessionsStmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE agent_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `);

    this.insertFTSStmt = this.db.prepare(`
      INSERT INTO sessions_fts (session_id, content, headline, tags)
      VALUES (?, ?, ?, ?)
    `);

    this.getSummaryStmt = this.db.prepare(`
      SELECT * FROM session_summaries
      WHERE session_id = ? AND summary_type = ?
    `);

    this.insertSummaryStmt = this.db.prepare(`
      INSERT OR REPLACE INTO session_summaries (session_id, summary_type, content, generated_at)
      VALUES (?, ?, ?, ?)
    `);

    log.debug(COMPONENT, 'SessionStore initialized', { dbPath });
  }

  /**
   * Create database schema including FTS5 virtual table
   */
  private createSchema(): void {
    // Sessions table - core metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        mesh_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        duration_seconds INTEGER,
        transcript_path TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        tool_calls INTEGER DEFAULT 0,
        final_status TEXT,
        headline TEXT,
        tags TEXT,
        files_changed TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_mesh ON sessions(mesh_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(final_status);
    `);

    // Migration: add files_changed column to existing tables
    this.migrateFilesChanged();

    // FTS5 for full-text search with porter stemming
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        session_id, content, headline, tags,
        tokenize='porter unicode61'
      );
    `);

    // Summary cache table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_summaries (
        session_id TEXT NOT NULL,
        summary_type TEXT NOT NULL,
        content TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, summary_type)
      );
    `);

    log.debug(COMPONENT, 'Schema created/verified');
  }

  /**
   * Migrate existing sessions table to add files_changed column
   * SQLite doesn't have IF NOT EXISTS for columns, so we check first
   */
  private migrateFilesChanged(): void {
    try {
      // Check if column exists
      const tableInfo = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
      const hasFilesChanged = tableInfo.some(col => col.name === 'files_changed');

      if (!hasFilesChanged) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN files_changed TEXT');
        log.info(COMPONENT, 'Migrated sessions table: added files_changed column');
      }
    } catch (err) {
      // Table might not exist yet on first run - that's fine
      log.debug(COMPONENT, 'Migration check skipped', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // ============================================
  // CRUD Operations
  // ============================================

  /**
   * Record a new session
   */
  recordSession(session: SessionMetadata): void {
    try {
      this.insertSessionStmt.run(
        session.id,
        session.agentId,
        session.meshId,
        session.startedAt,
        session.endedAt ?? null,
        session.durationSeconds ?? null,
        session.transcriptPath,
        session.messageCount ?? 0,
        session.toolCalls ?? 0,
        session.finalStatus ?? null,
        session.headline ?? null,
        session.tags ? JSON.stringify(session.tags) : null,
        session.filesChanged ? JSON.stringify(session.filesChanged) : null,
        session.createdAt
      );
      log.debug(COMPONENT, 'Session recorded', { sessionId: session.id, agentId: session.agentId });
    } catch (err) {
      log.error(COMPONENT, 'Failed to record session', {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): SessionMetadata | null {
    const row = this.getSessionStmt.get(id) as SessionRow | undefined;
    if (!row) return null;
    return this.rowToSession(row);
  }

  /**
   * List sessions for an agent, ordered by most recent first
   */
  listSessions(agentId: string, limit: number = 50): SessionMetadata[] {
    const rows = this.listSessionsStmt.all(agentId, limit) as SessionRow[];
    return rows.map(row => this.rowToSession(row));
  }

  /**
   * Update session with final data (endedAt, status, counts)
   */
  updateSession(id: string, updates: Partial<SessionMetadata>): void {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.endedAt !== undefined) {
      setClauses.push('ended_at = ?');
      params.push(updates.endedAt);
    }
    if (updates.durationSeconds !== undefined) {
      setClauses.push('duration_seconds = ?');
      params.push(updates.durationSeconds);
    }
    if (updates.messageCount !== undefined) {
      setClauses.push('message_count = ?');
      params.push(updates.messageCount);
    }
    if (updates.toolCalls !== undefined) {
      setClauses.push('tool_calls = ?');
      params.push(updates.toolCalls);
    }
    if (updates.finalStatus !== undefined) {
      setClauses.push('final_status = ?');
      params.push(updates.finalStatus);
    }
    if (updates.headline !== undefined) {
      setClauses.push('headline = ?');
      params.push(updates.headline);
    }
    if (updates.tags !== undefined) {
      setClauses.push('tags = ?');
      params.push(updates.tags ? JSON.stringify(updates.tags) : null);
    }
    if (updates.filesChanged !== undefined) {
      setClauses.push('files_changed = ?');
      params.push(updates.filesChanged ? JSON.stringify(updates.filesChanged) : null);
    }

    if (setClauses.length === 0) return;

    params.push(id);
    this.db.prepare(`
      UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?
    `).run(...params);

    log.debug(COMPONENT, 'Session updated', { sessionId: id, fields: Object.keys(updates) });
  }

  // ============================================
  // Search Operations
  // ============================================

  /**
   * Full-text search across sessions
   * Uses FTS5 for efficient text search with ranking
   */
  search(query: string, agentId?: string, limit: number = 20): SessionSearchResult[] {
    try {
      // Escape and format query for FTS5
      const ftsQuery = this.formatFTSQuery(query);

      let sql = `
        SELECT
          s.*,
          snippet(sessions_fts, 1, '<mark>', '</mark>', '...', 32) as snippet,
          rank
        FROM sessions_fts fts
        JOIN sessions s ON fts.session_id = s.id
        WHERE sessions_fts MATCH ?
      `;
      const params: unknown[] = [ftsQuery];

      if (agentId) {
        sql += ' AND s.agent_id = ?';
        params.push(agentId);
      }

      sql += ' ORDER BY rank LIMIT ?';
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params) as FTSSearchRow[];

      return rows.map(row => ({
        ...this.rowToSession(row),
        snippet: row.snippet,
        score: Math.abs(row.rank) // FTS5 rank is negative, lower is better
      }));
    } catch (err) {
      log.error(COMPONENT, 'Search failed', {
        query,
        error: err instanceof Error ? err.message : String(err)
      });
      return [];
    }
  }

  /**
   * Format a user query for FTS5
   * Handles phrases and basic operators
   */
  private formatFTSQuery(query: string): string {
    // Escape special FTS5 characters and add wildcards for partial matches
    return query
      .replace(/"/g, '""') // Escape quotes
      .split(/\s+/)
      .filter(term => term.length > 0)
      .map(term => `"${term}"*`) // Add wildcards for prefix matching
      .join(' ');
  }

  // ============================================
  // FTS Indexing
  // ============================================

  /**
   * Index session content for full-text search
   * Call this after recording a session with its full transcript
   */
  indexSessionContent(sessionId: string, content: string, headline?: string, tags?: string[]): void {
    try {
      // First delete any existing FTS entry for this session
      this.db.prepare('DELETE FROM sessions_fts WHERE session_id = ?').run(sessionId);

      // Insert new FTS entry
      this.insertFTSStmt.run(
        sessionId,
        content,
        headline ?? '',
        tags ? tags.join(' ') : ''
      );

      log.debug(COMPONENT, 'Session content indexed', {
        sessionId,
        contentLength: content.length,
        hasTags: !!tags?.length
      });
    } catch (err) {
      log.error(COMPONENT, 'Failed to index session content', {
        sessionId,
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  // ============================================
  // Summary Cache
  // ============================================

  /**
   * Get a cached summary if available
   */
  getCachedSummary(sessionId: string, type: SummaryType): string | null {
    const row = this.getSummaryStmt.get(sessionId, type) as SummaryRow | undefined;
    return row?.content ?? null;
  }

  /**
   * Cache a session summary
   */
  cacheSummary(sessionId: string, type: SummaryType, content: string): void {
    this.insertSummaryStmt.run(sessionId, type, content, Date.now());
    log.debug(COMPONENT, 'Summary cached', { sessionId, type, contentLength: content.length });
  }

  // ============================================
  // Retention / Cleanup
  // ============================================

  /**
   * Remove sessions older than specified days
   * Returns count of sessions pruned
   */
  pruneOldSessions(olderThanDays: number): number {
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    // Get sessions to prune for FTS cleanup
    const sessionsToDelete = this.db.prepare(
      'SELECT id FROM sessions WHERE created_at < ?'
    ).all(cutoff) as Array<{ id: string }>;

    if (sessionsToDelete.length === 0) return 0;

    const sessionIds = sessionsToDelete.map(s => s.id);
    const placeholders = sessionIds.map(() => '?').join(',');

    // Delete from FTS first (referential)
    this.db.prepare(
      `DELETE FROM sessions_fts WHERE session_id IN (${placeholders})`
    ).run(...sessionIds);

    // Delete summaries
    this.db.prepare(
      `DELETE FROM session_summaries WHERE session_id IN (${placeholders})`
    ).run(...sessionIds);

    // Delete sessions
    const result = this.db.prepare(
      `DELETE FROM sessions WHERE id IN (${placeholders})`
    ).run(...sessionIds);

    log.info(COMPONENT, 'Pruned old sessions', {
      olderThanDays,
      prunedCount: result.changes
    });

    return result.changes;
  }

  // ============================================
  // Headline / Update Operations
  // ============================================

  /**
   * Update headline for a session
   * Called asynchronously after headline generation completes
   */
  updateHeadline(sessionId: string, headline: string): void {
    try {
      this.db.prepare(`
        UPDATE sessions SET headline = ? WHERE id = ?
      `).run(headline, sessionId);

      // Also update FTS if entry exists
      this.db.prepare(`
        UPDATE sessions_fts SET headline = ? WHERE session_id = ?
      `).run(headline, sessionId);

      log.debug(COMPONENT, 'Updated session headline', { sessionId, headline });
    } catch (err) {
      log.error(COMPONENT, 'Failed to update headline', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Update tags for a session
   */
  updateTags(sessionId: string, tags: string[]): void {
    try {
      this.db.prepare(`
        UPDATE sessions SET tags = ? WHERE id = ?
      `).run(JSON.stringify(tags), sessionId);

      // Also update FTS if entry exists
      this.db.prepare(`
        UPDATE sessions_fts SET tags = ? WHERE session_id = ?
      `).run(tags.join(' '), sessionId);

      log.debug(COMPONENT, 'Updated session tags', { sessionId, tags });
    } catch (err) {
      log.error(COMPONENT, 'Failed to update tags', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ============================================
  // Backfill Operations
  // ============================================

  /**
   * Backfill session records from existing filesystem transcripts
   * Scans the sessions directory and creates records for any sessions
   * not already in the database.
   *
   * @param sessionsDir - Path to .ai/tx/sessions directory
   * @returns Number of sessions backfilled
   */
  async backfillFromFilesystem(sessionsDir: string): Promise<number> {
    const fs = await import('node:fs');
    const path = await import('node:path');

    if (!fs.existsSync(sessionsDir)) {
      log.debug(COMPONENT, 'Sessions directory does not exist, nothing to backfill', { sessionsDir });
      return 0;
    }

    let backfilledCount = 0;

    try {
      // List agent directories (format: meshName-agentName)
      const agentDirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const agentDir of agentDirs) {
        const agentPath = path.join(sessionsDir, agentDir);

        // Parse agentId from directory name (format: meshName-agentName -> meshName/agentName)
        const agentId = agentDir.replace('-', '/');
        const [meshId] = agentDir.split('-');

        // List transcript files (format: YYYY-MM-DDTHH-MM-SS-sssZ.md)
        const transcripts = fs.readdirSync(agentPath, { withFileTypes: true })
          .filter(f => f.isFile() && f.name.endsWith('.md'))
          .map(f => f.name);

        for (const transcript of transcripts) {
          const transcriptPath = path.join(agentPath, transcript);

          // Extract timestamp from filename
          // Format: 2024-01-15T10-30-45-123Z.md -> 2024-01-15T10:30:45.123Z
          const timestampStr = transcript
            .replace('.md', '')
            .replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z');

          const startedAt = new Date(timestampStr).getTime();
          if (isNaN(startedAt)) {
            log.warn(COMPONENT, 'Could not parse timestamp from transcript filename', {
              transcript,
              agentDir,
            });
            continue;
          }

          // Generate a deterministic session ID from path
          const sessionId = `backfill-${agentDir}-${transcript.replace('.md', '')}`;

          // Check if session already exists
          const existing = this.getSession(sessionId);
          if (existing) {
            continue; // Already backfilled
          }

          // Get file stats for approximate end time
          const stats = fs.statSync(transcriptPath);
          const endedAt = stats.mtimeMs;
          const durationSeconds = Math.floor((endedAt - startedAt) / 1000);

          // Record the session
          this.recordSession({
            id: sessionId,
            agentId,
            meshId: meshId || 'unknown',
            startedAt,
            endedAt,
            durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
            transcriptPath,
            finalStatus: 'success', // Assume success for existing transcripts
            createdAt: startedAt,
          });

          // Index content for FTS
          try {
            const content = fs.readFileSync(transcriptPath, 'utf-8');
            this.indexSessionContent(sessionId, content);
          } catch (readErr) {
            log.warn(COMPONENT, 'Failed to read transcript for FTS indexing', {
              sessionId,
              transcriptPath,
              error: readErr instanceof Error ? readErr.message : String(readErr),
            });
          }

          backfilledCount++;
        }
      }

      if (backfilledCount > 0) {
        log.info(COMPONENT, 'Backfilled sessions from filesystem', {
          sessionsDir,
          backfilledCount,
        });
      }
    } catch (err) {
      log.error(COMPONENT, 'Failed to backfill sessions', {
        sessionsDir,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return backfilledCount;
  }

  /**
   * Check if a session exists by ID
   */
  hasSession(sessionId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM sessions WHERE id = ? LIMIT 1').get(sessionId);
    return !!row;
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Convert a database row to SessionMetadata
   */
  private rowToSession(row: SessionRow): SessionMetadata {
    return {
      id: row.id,
      agentId: row.agent_id,
      meshId: row.mesh_id,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      durationSeconds: row.duration_seconds ?? undefined,
      transcriptPath: row.transcript_path,
      messageCount: row.message_count ?? undefined,
      toolCalls: row.tool_calls ?? undefined,
      finalStatus: row.final_status as SessionMetadata['finalStatus'],
      headline: row.headline ?? undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      filesChanged: row.files_changed ? JSON.parse(row.files_changed) as FileChangeSummary : undefined,
      createdAt: row.created_at
    };
  }

  /**
   * Get database stats for diagnostics
   */
  getStats(): { sessionCount: number; ftsEntries: number; summaryCount: number } {
    const sessionCount = (this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c;
    const ftsEntries = (this.db.prepare('SELECT COUNT(*) as c FROM sessions_fts').get() as { c: number }).c;
    const summaryCount = (this.db.prepare('SELECT COUNT(*) as c FROM session_summaries').get() as { c: number }).c;
    return { sessionCount, ftsEntries, summaryCount };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    log.debug(COMPONENT, 'SessionStore closed');
  }

  /**
   * Get underlying database instance (for advanced queries or testing)
   */
  getDb(): Database.Database {
    return this.db;
  }
}
