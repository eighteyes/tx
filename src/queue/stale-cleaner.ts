/**
 * StaleMessageCleaner - TTL-based garbage collection for unprocessed queue entries
 *
 * Detects and handles messages that sit in the queue without being processed:
 * - Target mesh doesn't exist (typo in `to:` field)
 * - Worker crashed mid-processing and never ACKed
 * - Dispatcher was stopped while messages were pending
 * - Agent was removed from mesh config
 *
 * Actions: warn, archive, or delete stale messages
 */

import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import { log } from '../shared/logger.ts';
import { formatDuration } from '../shared/time.ts';

/**
 * Configuration for stale message cleanup
 */
export interface StaleMessageConfig {
  /** Time before a message is considered stale (default: 30 minutes) */
  ttlMs: number;
  /** How often to scan for stale messages (default: 5 minutes) */
  scanIntervalMs: number;
  /** Action to take on stale messages */
  action: 'warn' | 'archive' | 'delete';
}

/**
 * Stale message info
 */
export interface StaleMessage {
  id: number;
  from_agent: string;
  to_agent: string;
  type: string;
  payload: Record<string, unknown>;
  source_file?: string;
  created_at: number;
  age: number;
  reason: 'ttl_expired' | 'no_target_mesh' | 'manual';
}

/**
 * Default configuration
 */
export const DEFAULT_STALE_CONFIG: StaleMessageConfig = {
  ttlMs: 1800000,      // 30 minutes
  scanIntervalMs: 300000, // 5 minutes
  action: 'archive',
};

/**
 * StaleMessageCleaner - Periodic cleanup of stale messages
 */
export class StaleMessageCleaner extends EventEmitter {
  private config: StaleMessageConfig;
  private db: Database.Database;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private knownMeshes: Set<string> = new Set();

  constructor(db: Database.Database, config: Partial<StaleMessageConfig> = {}) {
    super();
    this.db = db;
    this.config = { ...DEFAULT_STALE_CONFIG, ...config };

    // Ensure stale_messages table exists
    this.createSchema();
  }

  /**
   * Create archive table schema
   */
  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stale_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_id INTEGER NOT NULL,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        type TEXT NOT NULL,
        payload JSON NOT NULL,
        source_file TEXT,
        created_at INTEGER NOT NULL,
        archived_at INTEGER NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stale_reason ON stale_messages(reason);
      CREATE INDEX IF NOT EXISTS idx_stale_archived ON stale_messages(archived_at);
    `);
  }

  /**
   * Update known meshes list (call when meshes are loaded)
   */
  setKnownMeshes(meshes: string[]): void {
    this.knownMeshes = new Set(meshes);
  }

  /**
   * Start the cleaner interval
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.checkInterval = setInterval(() => {
      this.scanAndClean();
    }, this.config.scanIntervalMs);

    log.info('stale-cleaner', 'Started stale message cleaner', {
      ttlMs: this.config.ttlMs,
      scanIntervalMs: this.config.scanIntervalMs,
      action: this.config.action,
    });
  }

  /**
   * Stop the cleaner
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.running = false;
  }

  /**
   * Scan for stale messages and handle them
   */
  scanAndClean(): void {
    const staleMessages = this.detectStaleMessages();

    if (staleMessages.length === 0) {
      return;
    }

    log.info('stale-cleaner', `Found ${staleMessages.length} stale messages`, {
      action: this.config.action,
      messages: staleMessages.map(m => ({
        id: m.id,
        to: m.to_agent,
        type: m.type,
        age: formatDuration(m.age),
        reason: m.reason,
      })),
    });

    for (const msg of staleMessages) {
      this.handleStaleMessage(msg);
    }
  }

  /**
   * Detect stale messages based on TTL and other criteria
   */
  detectStaleMessages(): StaleMessage[] {
    const now = Date.now();
    const cutoff = now - this.config.ttlMs;

    // Get pending messages older than TTL
    const rows = this.db.prepare(`
      SELECT id, from_agent, to_agent, type, payload, source_file, created_at
      FROM messages
      WHERE status = 'pending'
      AND created_at < ?
      ORDER BY created_at ASC
    `).all(cutoff) as Array<{
      id: number;
      from_agent: string;
      to_agent: string;
      type: string;
      payload: string;
      source_file: string | null;
      created_at: number;
    }>;

    return rows.map(row => {
      // Determine reason
      let reason: 'ttl_expired' | 'no_target_mesh' = 'ttl_expired';
      const [meshName] = row.to_agent.split('/');
      if (this.knownMeshes.size > 0 && !this.knownMeshes.has(meshName)) {
        reason = 'no_target_mesh';
      }

      return {
        id: row.id,
        from_agent: row.from_agent,
        to_agent: row.to_agent,
        type: row.type,
        payload: JSON.parse(row.payload),
        source_file: row.source_file || undefined,
        created_at: row.created_at,
        age: now - row.created_at,
        reason,
      };
    });
  }

  /**
   * Handle a stale message based on configured action
   */
  private handleStaleMessage(msg: StaleMessage): void {
    switch (this.config.action) {
      case 'warn':
        log.warn('stale-cleaner', `Stale message detected (warn only)`, {
          id: msg.id,
          to: msg.to_agent,
          from: msg.from_agent,
          type: msg.type,
          age: formatDuration(msg.age),
          reason: msg.reason,
        });
        this.emit('stale:detected', msg);
        break;

      case 'archive':
        this.archiveMessage(msg);
        this.emit('stale:archived', msg);
        break;

      case 'delete':
        this.deleteMessage(msg);
        this.emit('stale:deleted', msg);
        break;
    }
  }

  /**
   * Archive a stale message
   */
  private archiveMessage(msg: StaleMessage): void {
    const now = Date.now();

    try {
      // Begin transaction
      this.db.transaction(() => {
        // Insert into archive
        this.db.prepare(`
          INSERT INTO stale_messages (original_id, from_agent, to_agent, type, payload, source_file, created_at, archived_at, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          msg.id,
          msg.from_agent,
          msg.to_agent,
          msg.type,
          JSON.stringify(msg.payload),
          msg.source_file || null,
          msg.created_at,
          now,
          msg.reason
        );

        // Delete from main queue
        this.db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);
      })();

      log.info('stale-cleaner', `Archived stale message`, {
        id: msg.id,
        to: msg.to_agent,
        age: formatDuration(msg.age),
        reason: msg.reason,
      });
    } catch (error) {
      log.error('stale-cleaner', `Failed to archive message`, {
        id: msg.id,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Delete a stale message
   */
  private deleteMessage(msg: StaleMessage): void {
    try {
      this.db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);
      log.info('stale-cleaner', `Deleted stale message`, {
        id: msg.id,
        to: msg.to_agent,
        age: formatDuration(msg.age),
        reason: msg.reason,
      });
    } catch (error) {
      log.error('stale-cleaner', `Failed to delete message`, {
        id: msg.id,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Manually archive a message by ID
   */
  manualArchive(messageId: number, reason: string = 'manual'): boolean {
    const row = this.db.prepare(`
      SELECT id, from_agent, to_agent, type, payload, source_file, created_at
      FROM messages
      WHERE id = ?
    `).get(messageId) as {
      id: number;
      from_agent: string;
      to_agent: string;
      type: string;
      payload: string;
      source_file: string | null;
      created_at: number;
    } | undefined;

    if (!row) {
      log.warn('stale-cleaner', `Message not found for manual archive`, { messageId });
      return false;
    }

    const msg: StaleMessage = {
      id: row.id,
      from_agent: row.from_agent,
      to_agent: row.to_agent,
      type: row.type,
      payload: JSON.parse(row.payload),
      source_file: row.source_file || undefined,
      created_at: row.created_at,
      age: Date.now() - row.created_at,
      reason: reason as 'manual',
    };

    this.archiveMessage(msg);
    return true;
  }

  /**
   * Replay a stale message (re-queue it)
   */
  replayStaleMessage(staleId: number): boolean {
    const row = this.db.prepare(`
      SELECT original_id, from_agent, to_agent, type, payload, source_file, created_at
      FROM stale_messages
      WHERE id = ?
    `).get(staleId) as {
      original_id: number;
      from_agent: string;
      to_agent: string;
      type: string;
      payload: string;
      source_file: string | null;
      created_at: number;
    } | undefined;

    if (!row) {
      log.warn('stale-cleaner', `Stale message not found for replay`, { staleId });
      return false;
    }

    try {
      this.db.transaction(() => {
        // Re-insert into main queue with fresh timestamp
        this.db.prepare(`
          INSERT INTO messages (from_agent, to_agent, type, payload, source_file, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          row.from_agent,
          row.to_agent,
          row.type,
          row.payload,
          row.source_file,
          Date.now()
        );

        // Remove from stale archive
        this.db.prepare('DELETE FROM stale_messages WHERE id = ?').run(staleId);
      })();

      log.info('stale-cleaner', `Replayed stale message`, {
        staleId,
        originalId: row.original_id,
        to: row.to_agent,
      });

      this.emit('stale:replayed', { staleId, to_agent: row.to_agent });
      return true;
    } catch (error) {
      log.error('stale-cleaner', `Failed to replay stale message`, {
        staleId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Get stats about stale messages
   */
  getStats(): { archived: number; byReason: Record<string, number>; oldest?: number } {
    const archived = (this.db.prepare('SELECT COUNT(*) as c FROM stale_messages').get() as { c: number }).c;

    const byReasonRows = this.db.prepare(`
      SELECT reason, COUNT(*) as c FROM stale_messages GROUP BY reason
    `).all() as Array<{ reason: string; c: number }>;

    const byReason: Record<string, number> = {};
    for (const row of byReasonRows) {
      byReason[row.reason] = row.c;
    }

    const oldestRow = this.db.prepare(`
      SELECT MIN(created_at) as oldest FROM stale_messages
    `).get() as { oldest: number | null };

    return {
      archived,
      byReason,
      oldest: oldestRow.oldest || undefined,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): StaleMessageConfig {
    return { ...this.config };
  }

  /**
   * Check if cleaner is running
   */
  isRunning(): boolean {
    return this.running;
  }
}
