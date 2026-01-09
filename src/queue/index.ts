/**
 * MessageQueue - V4 SQLite message queue
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export interface Message {
  id?: number;
  from_agent: string;
  to_agent: string;
  type: string;
  status?: 'pending' | 'delivered';
  payload: Record<string, unknown>;
  source_file?: string;
  created_at?: number;
  delivered_at?: number;
}

interface MessageRow {
  id: number;
  from_agent: string;
  to_agent: string;
  type: string;
  status: string;
  payload: string;
  created_at: number;
  delivered_at: number | null;
}

export interface MessageFilter {
  type?: string;
  from_agent?: string;
  to_agent?: string;
  status?: string;
  since_id?: number;
  limit?: number;
}

export interface PendingAsk {
  id?: number;
  from_agent: string;
  to_agent: string;
  msg_id: string;
  created_at?: number;
}

export class MessageQueue {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private selectPendingStmt: Database.Statement;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createSchema();
    this.migrate();

    // Cache prepared statements
    this.insertStmt = this.db.prepare(`
      INSERT INTO messages (from_agent, to_agent, type, payload, source_file, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.selectPendingStmt = this.db.prepare(`
      SELECT id, from_agent, to_agent, type, status, payload, created_at, delivered_at
      FROM messages
      WHERE to_agent = ? AND status = 'pending'
      ORDER BY created_at ASC
    `);
  }

  private createSchema(): void {
    // Create tables (source_file index created in migrate() to handle existing DBs)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        payload JSON NOT NULL,
        source_file TEXT,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_to_status ON messages(to_agent, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_type ON messages(type, created_at);

      CREATE TABLE IF NOT EXISTS sessions (
        agent_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_asks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        msg_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_from ON pending_asks(from_agent);
      CREATE INDEX IF NOT EXISTS idx_pending_to ON pending_asks(to_agent);
      CREATE INDEX IF NOT EXISTS idx_pending_msgid ON pending_asks(msg_id);
    `);
  }

  private migrate(): void {
    // Check if source_file column exists
    const columns = this.db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
    const hasSourceFile = columns.some(col => col.name === 'source_file');

    if (!hasSourceFile) {
      // Add source_file column to existing database
      this.db.exec(`ALTER TABLE messages ADD COLUMN source_file TEXT`);
    }

    // Always ensure the index exists (safe for new and migrated DBs)
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_source_file ON messages(source_file) WHERE source_file IS NOT NULL`);
  }

  insert(msg: Message): number {
    try {
      const result = this.insertStmt.run(
        msg.from_agent,
        msg.to_agent,
        msg.type,
        JSON.stringify(msg.payload),
        msg.source_file || null,
        Date.now()
      );
      return result.lastInsertRowid as number;
    } catch (err) {
      // Check for UNIQUE constraint violation on source_file
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        // File was updated - delete old record and insert fresh
        if (msg.source_file) {
          this.db.prepare(`DELETE FROM messages WHERE source_file = ?`).run(msg.source_file);
          const result = this.insertStmt.run(
            msg.from_agent,
            msg.to_agent,
            msg.type,
            JSON.stringify(msg.payload),
            msg.source_file,
            Date.now()
          );
          return result.lastInsertRowid as number;
        }
        return -1;
      }
      throw err;
    }
  }

  /**
   * Check if a message from a specific filepath already exists
   */
  hasMessageFromFile(filepath: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM messages WHERE json_extract(payload, '$.filepath') = ? LIMIT 1
    `).get(filepath);
    return !!row;
  }

  poll(recipient: string): Message[] {
    const rows = this.selectPendingStmt.all(recipient) as MessageRow[];

    if (rows.length === 0) {
      return [];
    }

    // Mark as delivered atomically
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE messages SET status = 'delivered', delivered_at = ?
      WHERE id IN (${placeholders})
    `).run(Date.now(), ...ids);

    return rows.map(row => ({
      id: row.id,
      from_agent: row.from_agent,
      to_agent: row.to_agent,
      type: row.type,
      status: row.status as 'pending' | 'delivered',
      payload: JSON.parse(row.payload),
      created_at: row.created_at,
      delivered_at: row.delivered_at ?? undefined
    }));
  }

  /**
   * Poll a single message (oldest first) - for sequential task processing
   */
  pollOne(recipient: string): Message | null {
    const row = this.db.prepare(`
      SELECT id, from_agent, to_agent, type, status, payload, created_at, delivered_at
      FROM messages
      WHERE to_agent = ? AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `).get(recipient) as MessageRow | undefined;

    if (!row) return null;

    // Mark as delivered
    this.db.prepare(`
      UPDATE messages SET status = 'delivered', delivered_at = ?
      WHERE id = ?
    `).run(Date.now(), row.id);

    return {
      id: row.id,
      from_agent: row.from_agent,
      to_agent: row.to_agent,
      type: row.type,
      status: 'delivered',
      payload: JSON.parse(row.payload),
      created_at: row.created_at,
      delivered_at: Date.now()
    };
  }

  /**
   * Peek at pending messages without consuming them
   */
  peek(recipient: string): Message[] {
    const rows = this.selectPendingStmt.all(recipient) as MessageRow[];
    return rows.map(row => ({
      id: row.id,
      from_agent: row.from_agent,
      to_agent: row.to_agent,
      type: row.type,
      status: row.status as 'pending' | 'delivered',
      payload: JSON.parse(row.payload),
      created_at: row.created_at,
      delivered_at: row.delivered_at ?? undefined
    }));
  }

  /**
   * Peek at the next pending message without consuming it
   */
  peekOne(recipient: string): Message | null {
    const row = this.db.prepare(`
      SELECT id, from_agent, to_agent, type, status, payload, created_at, delivered_at
      FROM messages
      WHERE to_agent = ? AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `).get(recipient) as MessageRow | undefined;

    if (!row) return null;

    return {
      id: row.id,
      from_agent: row.from_agent,
      to_agent: row.to_agent,
      type: row.type,
      status: row.status as 'pending' | 'delivered',
      payload: JSON.parse(row.payload),
      created_at: row.created_at,
      delivered_at: row.delivered_at ?? undefined
    };
  }

  listTables(): string[] {
    const rows = this.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all() as Array<{ name: string }>;
    return rows.map(r => r.name);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Get stored conversation ID for an agent (for --resume)
   */
  getConversationId(agentId: string): string | null {
    const row = this.db.prepare(
      `SELECT conversation_id FROM sessions WHERE agent_id = ?`
    ).get(agentId) as { conversation_id: string } | undefined;
    return row?.conversation_id ?? null;
  }

  /**
   * Store conversation ID for an agent
   */
  setConversationId(agentId: string, conversationId: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO sessions (agent_id, conversation_id, updated_at)
      VALUES (?, ?, ?)
    `).run(agentId, conversationId, Date.now());
  }

  /**
   * Clear conversation ID for an agent (start fresh)
   */
  clearConversationId(agentId: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE agent_id = ?`).run(agentId);
  }

  /**
   * Clear all sessions (for --fresh start)
   */
  clearAllSessions(): void {
    this.db.prepare(`DELETE FROM sessions`).run();
  }

  /**
   * Query messages with optional filters (for tx spy, tx msg, tx tasks)
   */
  queryMessages(filter: MessageFilter = {}): Message[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter.from_agent) {
      conditions.push('from_agent = ?');
      params.push(filter.from_agent);
    }
    if (filter.to_agent) {
      conditions.push('to_agent = ?');
      params.push(filter.to_agent);
    }
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.since_id) {
      conditions.push('id > ?');
      params.push(filter.since_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = filter.limit ? `LIMIT ${filter.limit}` : '';

    const rows = this.db.prepare(`
      SELECT id, from_agent, to_agent, type, status, payload, created_at, delivered_at
      FROM messages
      ${whereClause}
      ORDER BY created_at DESC
      ${limitClause}
    `).all(...params) as MessageRow[];

    return rows.map(row => ({
      id: row.id,
      from_agent: row.from_agent,
      to_agent: row.to_agent,
      type: row.type,
      status: row.status as 'pending' | 'delivered',
      payload: JSON.parse(row.payload),
      created_at: row.created_at,
      delivered_at: row.delivered_at ?? undefined
    }));
  }

  /**
   * Get the latest message ID (for streaming)
   */
  getLatestMessageId(): number {
    const row = this.db.prepare('SELECT MAX(id) as max_id FROM messages').get() as { max_id: number | null };
    return row?.max_id ?? 0;
  }

  /**
   * Get queue stats
   */
  getStats(): { pending: number; delivered: number; total: number; byAgent: Record<string, number> } {
    const pending = (this.db.prepare('SELECT COUNT(*) as c FROM messages WHERE status = ?').get('pending') as { c: number }).c;
    const delivered = (this.db.prepare('SELECT COUNT(*) as c FROM messages WHERE status = ?').get('delivered') as { c: number }).c;

    const byAgentRows = this.db.prepare(`
      SELECT to_agent, COUNT(*) as c FROM messages WHERE status = 'pending' GROUP BY to_agent
    `).all() as Array<{ to_agent: string; c: number }>;

    const byAgent: Record<string, number> = {};
    for (const row of byAgentRows) {
      byAgent[row.to_agent] = row.c;
    }

    return { pending, delivered, total: pending + delivered, byAgent };
  }

  /**
   * Get active sessions (agents with stored conversation IDs)
   */
  getActiveSessions(): Array<{ agentId: string; sessionId: string }> {
    const rows = this.db.prepare('SELECT agent_id, conversation_id FROM sessions').all() as Array<{ agent_id: string; conversation_id: string }>;
    return rows.map(r => ({ agentId: r.agent_id, sessionId: r.conversation_id }));
  }

  /**
   * Clear all messages (fresh start)
   */
  clearAllMessages(): void {
    this.db.prepare('DELETE FROM messages').run();
  }

  /**
   * Clear only pending messages (keeps delivered for deduplication)
   */
  clearPendingMessages(): void {
    this.db.prepare('DELETE FROM messages WHERE status = ?').run('pending');
  }

  /**
   * Mark a message as processed (delivered) by ID
   * Used by event-driven injector after successful injection
   */
  markProcessed(id: number): void {
    this.db.prepare(`
      UPDATE messages SET status = 'delivered', delivered_at = ?
      WHERE id = ?
    `).run(Date.now(), id);
  }

  /**
   * Mark all pending messages as failed (stale from previous run)
   * Called on startup - pending messages from crashed sessions are undeliverable
   */
  markPendingAsFailed(): number {
    const result = this.db.prepare(`
      UPDATE messages SET status = 'failed', delivered_at = ?
      WHERE status = 'pending'
    `).run(Date.now());
    return result.changes;
  }

  // ============================================
  // Parity Gate: Pending Ask Tracking
  // ============================================

  /**
   * Track a pending ask (persisted to SQLite)
   */
  trackPendingAsk(fromAgent: string, toAgent: string, msgId: string): number {
    const result = this.db.prepare(`
      INSERT INTO pending_asks (from_agent, to_agent, msg_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(fromAgent, toAgent, msgId, Date.now());
    return result.lastInsertRowid as number;
  }

  /**
   * Resolve a pending ask - progressive matching
   * 1. Try exact msg-id match
   * 2. Fall back to from/to agent match
   * Returns: { resolved: boolean, matchType: 'msg-id' | 'agent' | 'none', ask?: PendingAsk }
   */
  resolvePendingAsk(
    respondingAgent: string,
    targetAgent: string,
    msgId?: string
  ): { resolved: boolean; matchType: 'msg-id' | 'agent' | 'none'; ask?: PendingAsk } {
    // 1. Try exact msg-id match first
    if (msgId) {
      const byMsgId = this.db.prepare(`
        SELECT id, from_agent, to_agent, msg_id, created_at
        FROM pending_asks
        WHERE from_agent = ? AND msg_id = ?
        LIMIT 1
      `).get(targetAgent, msgId) as PendingAsk | undefined;

      if (byMsgId) {
        this.db.prepare('DELETE FROM pending_asks WHERE id = ?').run(byMsgId.id);
        return { resolved: true, matchType: 'msg-id', ask: byMsgId };
      }
    }

    // 2. Fall back to agent match (oldest first)
    const byAgent = this.db.prepare(`
      SELECT id, from_agent, to_agent, msg_id, created_at
      FROM pending_asks
      WHERE from_agent = ? AND to_agent = ?
      ORDER BY created_at ASC
      LIMIT 1
    `).get(targetAgent, respondingAgent) as PendingAsk | undefined;

    if (byAgent) {
      this.db.prepare('DELETE FROM pending_asks WHERE id = ?').run(byAgent.id);
      return { resolved: true, matchType: 'agent', ask: byAgent };
    }

    return { resolved: false, matchType: 'none' };
  }

  /**
   * Get all pending asks for an agent
   */
  getPendingAsks(fromAgent: string): PendingAsk[] {
    return this.db.prepare(`
      SELECT id, from_agent, to_agent, msg_id, created_at
      FROM pending_asks
      WHERE from_agent = ?
      ORDER BY created_at ASC
    `).all(fromAgent) as PendingAsk[];
  }

  /**
   * Get count of pending asks by target agent
   */
  getPendingAskCounts(fromAgent: string): Map<string, number> {
    const rows = this.db.prepare(`
      SELECT to_agent, COUNT(*) as count
      FROM pending_asks
      WHERE from_agent = ?
      GROUP BY to_agent
    `).all(fromAgent) as Array<{ to_agent: string; count: number }>;

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.to_agent, row.count);
    }
    return counts;
  }

  /**
   * Clear all pending asks for an agent
   */
  clearPendingAsks(fromAgent: string): number {
    const result = this.db.prepare('DELETE FROM pending_asks WHERE from_agent = ?').run(fromAgent);
    return result.changes;
  }

  /**
   * Clear all pending asks (fresh start)
   */
  clearAllPendingAsks(): number {
    const result = this.db.prepare('DELETE FROM pending_asks').run();
    return result.changes;
  }

  /**
   * Get database instance (for stale cleaner and deadlock detector)
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  /**
   * Get all pending asks (for deadlock detection)
   */
  getAllPendingAsks(): PendingAsk[] {
    return this.db.prepare(`
      SELECT id, from_agent, to_agent, msg_id, created_at
      FROM pending_asks
      ORDER BY created_at ASC
    `).all() as PendingAsk[];
  }

  /**
   * Get a pending ask by msg_id (for deadlock detection)
   */
  getPendingAskByMsgId(msgId: string): PendingAsk | undefined {
    return this.db.prepare(`
      SELECT id, from_agent, to_agent, msg_id, created_at
      FROM pending_asks
      WHERE msg_id = ?
    `).get(msgId) as PendingAsk | undefined;
  }

  /**
   * Clear a specific pending ask by ID
   */
  clearPendingAsk(id: number): void {
    this.db.prepare('DELETE FROM pending_asks WHERE id = ?').run(id);
  }
}

// Export stale message cleaner
export {
  StaleMessageCleaner,
  type StaleMessageConfig,
  type StaleMessage,
  DEFAULT_STALE_CONFIG
} from './stale-cleaner.ts';

// Export deadlock detector
export {
  DeadlockDetector,
  type DeadlockConfig,
  type CycleInfo,
  DEFAULT_DEADLOCK_CONFIG
} from './deadlock-detector.ts';
