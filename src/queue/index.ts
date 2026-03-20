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
  status?: 'pending' | 'delivered' | 'interrupted' | 'failed';
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

export interface SuspendedSessionData {
  agentId: string;
  sessionId: string;
  reason: 'ask-human' | 'await-response' | 'crash';
  suspendedAt: number;
  meshName: string;
  targetAgents?: string[];
  hookContext?: string;  // JSON serialized
  pendingCount: number;
}

export interface AwaitState {
  agent_id: string;
  session_id: string;
  target_agents: string;  // JSON array
  received_from: string;  // JSON array
  created_at: number;
  updated_at: number;
}

export interface ParallelInstance {
  base_mesh: string;
  mesh_id: string;
  status: 'running' | 'completed';
  spawned_at: number;
  completed_at?: number;
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

      CREATE TABLE IF NOT EXISTS suspended_sessions (
        agent_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        suspended_at INTEGER NOT NULL,
        mesh_name TEXT NOT NULL,
        target_agents TEXT,
        hook_context TEXT,
        pending_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS await_state (
        agent_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        target_agents TEXT NOT NULL,
        received_from TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_await_agent ON await_state(agent_id);

      CREATE TABLE IF NOT EXISTS named_conversations (
        agent_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, conversation_id)
      );

      CREATE TABLE IF NOT EXISTS parallel_instances (
        base_mesh TEXT NOT NULL,
        mesh_id TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        spawned_at INTEGER NOT NULL,
        completed_at INTEGER,
        PRIMARY KEY (base_mesh, mesh_id)
      );
      CREATE INDEX IF NOT EXISTS idx_base_mesh_status ON parallel_instances(base_mesh, status);

      CREATE TABLE IF NOT EXISTS mesh_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mesh_name TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        completion_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mesh_runs_name_status ON mesh_runs(mesh_name, status);

      CREATE TABLE IF NOT EXISTS instant_exit_failures (
        agent_id TEXT PRIMARY KEY,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_failure_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_instant_exit_failures_updated ON instant_exit_failures(updated_at);
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

    // Ensure mesh_runs table exists (for existing databases created before this feature)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mesh_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mesh_name TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        completion_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mesh_runs_name_status ON mesh_runs(mesh_name, status);
    `);

    // Ensure instant_exit_failures table exists (for existing databases)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS instant_exit_failures (
        agent_id TEXT PRIMARY KEY,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_failure_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_instant_exit_failures_updated ON instant_exit_failures(updated_at);
    `);
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
   * Get the underlying database instance
   * Used by FSM persistence layer to share database connection
   */
  getDb(): Database.Database {
    return this.db;
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
   * Clear conversation sessions for a mesh (on mesh completion when persistence is off)
   */
  clearConversationsForMesh(meshName: string): number {
    const result = this.db.prepare(
      `DELETE FROM sessions WHERE agent_id LIKE ?`
    ).run(`${meshName}/%`);
    return result.changes;
  }

  // ============================================
  // Named Conversations (conversation-id mapping)
  // ============================================

  /**
   * Look up the SDK session ID for a named conversation
   */
  getNamedConversationSessionId(agentId: string, conversationId: string): string | null {
    const row = this.db.prepare(
      `SELECT session_id FROM named_conversations WHERE agent_id = ? AND conversation_id = ?`
    ).get(agentId, conversationId) as { session_id: string } | undefined;
    return row?.session_id ?? null;
  }

  /**
   * Store or update the SDK session ID for a named conversation
   */
  setNamedConversationSessionId(agentId: string, conversationId: string, sessionId: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO named_conversations (agent_id, conversation_id, session_id, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(agentId, conversationId, sessionId, Date.now());
  }

  /**
   * Clear named conversations for a mesh (on mesh completion when persistence is off)
   */
  clearNamedConversationsForMesh(meshName: string): number {
    const result = this.db.prepare(
      `DELETE FROM named_conversations WHERE agent_id LIKE ?`
    ).run(`${meshName}/%`);
    return result.changes;
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
   * Count pending messages for a specific agent
   * Used by OAOM (One-Agent-One-Message) enforcement to check queue depth
   */
  countPending(agentId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as c FROM messages WHERE to_agent = ? AND status = 'pending'
    `).get(agentId) as { c: number };
    return row.c;
  }

  /**
   * Get recent messages sent FROM an agent within a time window.
   * Used by nudge-detector to check if routing happened after worker completion.
   */
  getRecentMessagesFrom(agentId: string, windowMs: number): Array<{ to_agent: string; type: string }> {
    const cutoff = Date.now() - windowMs;
    return this.db.prepare(`
      SELECT to_agent, type FROM messages
      WHERE from_agent = ? AND created_at > ?
      ORDER BY created_at DESC
    `).all(agentId, cutoff) as Array<{ to_agent: string; type: string }>;
  }

  /**
   * Count pending messages for all agents in a mesh
   */
  countPendingForMesh(meshName: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as c FROM messages WHERE to_agent LIKE ? AND status = 'pending'
    `).get(`${meshName}/%`) as { c: number };
    return row.c;
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
   * Clear pending messages for a specific mesh (both to and from)
   * Called on new mesh run at entry_point to purge stale messages from previous runs
   */
  clearPendingMessagesForMesh(meshName: string): number {
    const result = this.db.prepare(
      'DELETE FROM messages WHERE status = ? AND (to_agent LIKE ? OR from_agent LIKE ?)'
    ).run('pending', `${meshName}/%`, `${meshName}/%`);
    return result.changes;
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
   * @deprecated Use markPendingAsInterrupted() for crash recovery
   */
  markPendingAsFailed(): number {
    const result = this.db.prepare(`
      UPDATE messages SET status = 'failed', delivered_at = ?
      WHERE status = 'pending'
    `).run(Date.now());
    return result.changes;
  }

  /**
   * Mark all pending messages as interrupted (from unclean shutdown)
   * Called on startup when a crash is detected - these messages can be recovered
   */
  markPendingAsInterrupted(): number {
    const result = this.db.prepare(`
      UPDATE messages SET status = 'interrupted', delivered_at = ?
      WHERE status = 'pending'
    `).run(Date.now());
    return result.changes;
  }

  /**
   * Get all interrupted messages (for recovery)
   */
  getInterruptedMessages(): Message[] {
    const rows = this.db.prepare(`
      SELECT id, from_agent, to_agent, type, status, payload, source_file, created_at, delivered_at
      FROM messages WHERE status = 'interrupted'
      ORDER BY created_at DESC
    `).all() as MessageRow[];

    return rows.map(row => ({
      id: row.id,
      from_agent: row.from_agent,
      to_agent: row.to_agent,
      type: row.type,
      status: row.status as 'interrupted',
      payload: JSON.parse(row.payload),
      created_at: row.created_at,
      delivered_at: row.delivered_at ?? undefined
    }));
  }

  /**
   * Mark interrupted messages as failed (user chose to discard)
   */
  markInterruptedAsFailed(): number {
    const result = this.db.prepare(`
      UPDATE messages SET status = 'failed', delivered_at = ?
      WHERE status = 'interrupted'
    `).run(Date.now());
    return result.changes;
  }

  /**
   * Re-queue interrupted messages as pending (user chose to resume)
   */
  requeueInterruptedMessages(): number {
    const result = this.db.prepare(`
      UPDATE messages SET status = 'pending', delivered_at = NULL
      WHERE status = 'interrupted'
    `).run();
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
   * Find a pending ask without deleting - for validation/logging
   * Same matching logic as resolvePendingAsk but read-only
   */
  findPendingAsk(
    respondingAgent: string,
    targetAgent: string,
    msgId?: string
  ): { found: boolean; matchType: 'msg-id' | 'agent' | 'none'; ask?: PendingAsk } {
    // 1. Try exact msg-id match first
    if (msgId) {
      const byMsgId = this.db.prepare(`
        SELECT id, from_agent, to_agent, msg_id, created_at
        FROM pending_asks
        WHERE from_agent = ? AND msg_id = ?
        LIMIT 1
      `).get(targetAgent, msgId) as PendingAsk | undefined;

      if (byMsgId) {
        return { found: true, matchType: 'msg-id', ask: byMsgId };
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
      return { found: true, matchType: 'agent', ask: byAgent };
    }

    return { found: false, matchType: 'none' };
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
   * Clear all pending asks for a mesh (on mesh completion)
   */
  clearPendingAsksForMesh(meshName: string): number {
    const result = this.db.prepare(
      'DELETE FROM pending_asks WHERE from_agent LIKE ? OR to_agent LIKE ?'
    ).run(`${meshName}/%`, `${meshName}/%`);
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
   * Get incoming asks (asks TO this agent that need response)
   * Returns asks where this agent is the target and must respond
   */
  getIncomingAsks(toAgent: string): PendingAsk[] {
    return this.db.prepare(`
      SELECT id, from_agent, to_agent, msg_id, created_at
      FROM pending_asks
      WHERE to_agent = ?
      ORDER BY created_at ASC
    `).all(toAgent) as PendingAsk[];
  }

  /**
   * Get pending tasks for an agent (messages queued for processing)
   * Returns pending messages addressed to this agent
   */
  getPendingTasks(toAgent: string): Message[] {
    const rows = this.db.prepare(`
      SELECT id, from_agent, to_agent, type, status, payload, created_at, delivered_at
      FROM messages
      WHERE to_agent = ? AND status = 'pending'
      ORDER BY created_at ASC
    `).all(toAgent) as MessageRow[];

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
   * Clear a specific pending ask by ID
   */
  clearPendingAsk(id: number): void {
    this.db.prepare('DELETE FROM pending_asks WHERE id = ?').run(id);
  }

  // ============================================
  // Await State Tracking (Terminal-by-Default)
  // ============================================

  /**
   * Set an agent to awaiting state for multiple target agents
   * @param agentId - The agent entering await state
   * @param sessionId - The current session ID
   * @param targetAgents - Array of agent IDs to await responses from
   */
  setAwaiting(agentId: string, sessionId: string, targetAgents: string[]): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO await_state
        (agent_id, session_id, target_agents, received_from, created_at, updated_at)
      VALUES (?, ?, ?, '[]', ?, ?)
    `).run(
      agentId,
      sessionId,
      JSON.stringify(targetAgents),
      now,
      now
    );
  }

  /**
   * Record that a response was received from a target agent
   * @param agentId - The agent awaiting responses
   * @param fromAgent - The agent that sent a response
   * @returns Object with:
   *  - allReceived: true if all awaited responses have arrived
   *  - remaining: array of agents still pending
   *  - receivedFrom: array of agents that have responded
   */
  receiveAwaitResponse(
    agentId: string,
    fromAgent: string
  ): { allReceived: boolean; remaining: string[]; receivedFrom: string[] } {
    const state = this.getAwaitState(agentId);
    if (!state) {
      return { allReceived: false, remaining: [], receivedFrom: [] };
    }

    const targetAgents = JSON.parse(state.target_agents) as string[];
    const receivedFrom = JSON.parse(state.received_from) as string[];

    // Add this response if not already recorded
    if (!receivedFrom.includes(fromAgent)) {
      receivedFrom.push(fromAgent);

      this.db.prepare(`
        UPDATE await_state
        SET received_from = ?, updated_at = ?
        WHERE agent_id = ?
      `).run(
        JSON.stringify(receivedFrom),
        Date.now(),
        agentId
      );
    }

    const remaining = targetAgents.filter(t => !receivedFrom.includes(t));
    const allReceived = remaining.length === 0;

    // If all received, clear the await state
    if (allReceived) {
      this.clearAwaitState(agentId);
    }

    return { allReceived, remaining, receivedFrom };
  }

  /**
   * Get the current await state for an agent
   * @param agentId - The agent ID to query
   * @returns AwaitState or null if not awaiting
   */
  getAwaitState(agentId: string): AwaitState | null {
    const row = this.db.prepare(`
      SELECT agent_id, session_id, target_agents, received_from, created_at, updated_at
      FROM await_state WHERE agent_id = ?
    `).get(agentId) as AwaitState | undefined;

    return row || null;
  }

  /**
   * Clear await state for an agent
   * @param agentId - The agent ID to clear
   */
  clearAwaitState(agentId: string): void {
    this.db.prepare('DELETE FROM await_state WHERE agent_id = ?').run(agentId);
  }

  /**
   * Get all agents currently in await state
   */
  getAllAwaitStates(): AwaitState[] {
    return this.db.prepare(`
      SELECT agent_id, session_id, target_agents, received_from, created_at, updated_at
      FROM await_state ORDER BY created_at ASC
    `).all() as AwaitState[];
  }

  /**
   * Clear await states for a mesh
   */
  clearAwaitStatesForMesh(meshName: string): number {
    const result = this.db.prepare(
      'DELETE FROM await_state WHERE agent_id LIKE ?'
    ).run(`${meshName}/%`);
    return result.changes;
  }

  // ============================================
  // Crash Recovery: Response Re-buffering
  // ============================================

  /**
   * Find delivered ask-response messages sent by specific agents
   * Used during crash recovery to re-buffer responses for suspended sessions
   */
  getDeliveredResponses(fromAgents: string[]): Message[] {
    if (fromAgents.length === 0) return [];

    const placeholders = fromAgents.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT id, from_agent, to_agent, type, status, payload, created_at, delivered_at
      FROM messages
      WHERE from_agent IN (${placeholders})
        AND type = 'ask-response'
        AND status = 'delivered'
      ORDER BY created_at ASC
    `).all(...fromAgents) as MessageRow[];

    return rows.map(row => ({
      id: row.id,
      from_agent: row.from_agent,
      to_agent: row.to_agent,
      type: row.type,
      status: row.status as 'delivered',
      payload: JSON.parse(row.payload),
      created_at: row.created_at,
      delivered_at: row.delivered_at ?? undefined,
    }));
  }

  // ============================================
  // Crash Recovery: Suspended Sessions
  // ============================================

  /**
   * Suspend a session (persist to SQLite for crash recovery)
   */
  suspendSession(agentId: string, data: Omit<SuspendedSessionData, 'agentId'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO suspended_sessions
        (agent_id, session_id, reason, suspended_at, mesh_name, target_agents, hook_context, pending_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agentId,
      data.sessionId,
      data.reason,
      data.suspendedAt,
      data.meshName,
      data.targetAgents ? JSON.stringify(data.targetAgents) : null,
      data.hookContext || null,
      data.pendingCount
    );
  }

  /**
   * Get a suspended session by agent ID
   */
  getSuspendedSession(agentId: string): SuspendedSessionData | null {
    const row = this.db.prepare(`
      SELECT agent_id, session_id, reason, suspended_at, mesh_name, target_agents, hook_context, pending_count
      FROM suspended_sessions WHERE agent_id = ?
    `).get(agentId) as {
      agent_id: string;
      session_id: string;
      reason: string;
      suspended_at: number;
      mesh_name: string;
      target_agents: string | null;
      hook_context: string | null;
      pending_count: number;
    } | undefined;

    if (!row) return null;

    return {
      agentId: row.agent_id,
      sessionId: row.session_id,
      reason: row.reason as SuspendedSessionData['reason'],
      suspendedAt: row.suspended_at,
      meshName: row.mesh_name,
      targetAgents: row.target_agents ? JSON.parse(row.target_agents) : undefined,
      hookContext: row.hook_context || undefined,
      pendingCount: row.pending_count,
    };
  }

  /**
   * Resume (delete) a suspended session
   */
  resumeSession(agentId: string): void {
    this.db.prepare('DELETE FROM suspended_sessions WHERE agent_id = ?').run(agentId);
  }

  /**
   * List all suspended sessions
   */
  listSuspendedSessions(): SuspendedSessionData[] {
    const rows = this.db.prepare(`
      SELECT agent_id, session_id, reason, suspended_at, mesh_name, target_agents, hook_context, pending_count
      FROM suspended_sessions ORDER BY suspended_at DESC
    `).all() as Array<{
      agent_id: string;
      session_id: string;
      reason: string;
      suspended_at: number;
      mesh_name: string;
      target_agents: string | null;
      hook_context: string | null;
      pending_count: number;
    }>;

    return rows.map(row => ({
      agentId: row.agent_id,
      sessionId: row.session_id,
      reason: row.reason as SuspendedSessionData['reason'],
      suspendedAt: row.suspended_at,
      meshName: row.mesh_name,
      targetAgents: row.target_agents ? JSON.parse(row.target_agents) : undefined,
      hookContext: row.hook_context || undefined,
      pendingCount: row.pending_count,
    }));
  }

  /**
   * Clear suspended sessions for a mesh (on mesh completion or new run)
   */
  clearSuspendedSessionsForMesh(meshName: string): number {
    const result = this.db.prepare(
      'DELETE FROM suspended_sessions WHERE agent_id LIKE ? OR mesh_name = ?'
    ).run(`${meshName}/%`, meshName);
    return result.changes;
  }

  /**
   * Clear all suspended sessions
   */
  clearAllSuspendedSessions(): number {
    const result = this.db.prepare('DELETE FROM suspended_sessions').run();
    return result.changes;
  }

  // ============================================
  // Parallel Mesh Instances
  // ============================================

  /**
   * Insert a new parallel mesh instance
   * @param baseMesh - The base mesh name (e.g., "dev")
   * @param meshId - Unique identifier for this instance within the base mesh (e.g., "auth")
   * @throws Error if (baseMesh, meshId) already exists (PRIMARY KEY constraint)
   */
  insertInstance(baseMesh: string, meshId: string): void {
    this.db.prepare(`
      INSERT INTO parallel_instances (base_mesh, mesh_id, status, spawned_at)
      VALUES (?, ?, 'running', ?)
    `).run(baseMesh, meshId, Date.now());
  }

  /**
   * Get a parallel instance by composite key
   * @param baseMesh - The base mesh name
   * @param meshId - The mesh identifier
   * @returns The instance if found, null otherwise
   */
  getInstance(baseMesh: string, meshId: string): ParallelInstance | null {
    const row = this.db.prepare(`
      SELECT base_mesh, mesh_id, status, spawned_at, completed_at
      FROM parallel_instances
      WHERE base_mesh = ? AND mesh_id = ?
    `).get(baseMesh, meshId) as ParallelInstance | undefined;

    return row || null;
  }

  /**
   * Mark a parallel instance as completed
   * @param baseMesh - The base mesh name
   * @param meshId - The mesh identifier
   */
  completeInstance(baseMesh: string, meshId: string): void {
    this.db.prepare(`
      UPDATE parallel_instances
      SET status = 'completed', completed_at = ?
      WHERE base_mesh = ? AND mesh_id = ? AND status = 'running'
    `).run(Date.now(), baseMesh, meshId);
  }

  // ─── Mesh Runs ──────────────────────────────────────────────────────

  /**
   * Record that a mesh has started running
   * @param meshName - The mesh name
   * @returns The row id of the new mesh run
   */
  startMeshRun(meshName: string): number {
    const result = this.db.prepare(`
      INSERT INTO mesh_runs (mesh_name, status, started_at)
      VALUES (?, 'running', ?)
    `).run(meshName, Date.now());
    return Number(result.lastInsertRowid);
  }

  /**
   * Mark a mesh run as completed
   * @param meshName - The mesh name
   * @param completionAgent - Optional agent that triggered completion
   */
  completeMeshRun(meshName: string, completionAgent?: string): void {
    this.db.prepare(`
      UPDATE mesh_runs
      SET status = 'completed', completed_at = ?, completion_agent = ?
      WHERE mesh_name = ? AND status = 'running'
    `).run(Date.now(), completionAgent || null, meshName);
  }

  /**
   * Get the current running mesh run, if any
   * @param meshName - The mesh name
   */
  getRunningMeshRun(meshName: string): { id: number; mesh_name: string; status: string; started_at: number } | null {
    const row = this.db.prepare(`
      SELECT id, mesh_name, status, started_at
      FROM mesh_runs
      WHERE mesh_name = ? AND status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `).get(meshName) as { id: number; mesh_name: string; status: string; started_at: number } | undefined;
    return row || null;
  }

  /**
   * List mesh runs, optionally filtered by mesh name and/or status
   */
  listMeshRuns(meshName?: string, status?: 'running' | 'completed'): Array<{ id: number; mesh_name: string; status: string; started_at: number; completed_at: number | null; completion_agent: string | null }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (meshName) { conditions.push('mesh_name = ?'); params.push(meshName); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db.prepare(`
      SELECT id, mesh_name, status, started_at, completed_at, completion_agent
      FROM mesh_runs ${whereClause}
      ORDER BY started_at DESC
    `).all(...params) as Array<{ id: number; mesh_name: string; status: string; started_at: number; completed_at: number | null; completion_agent: string | null }>;
  }

  /**
   * List parallel instances, optionally filtered by base mesh and/or status
   * @param baseMesh - Optional filter by base mesh name
   * @param status - Optional filter by status ('running' or 'completed')
   * @returns Array of instance info
   */
  listInstances(baseMesh?: string, status?: 'running' | 'completed'): ParallelInstance[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (baseMesh) {
      conditions.push('base_mesh = ?');
      params.push(baseMesh);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT base_mesh, mesh_id, status, spawned_at, completed_at
      FROM parallel_instances
      ${whereClause}
      ORDER BY spawned_at DESC
    `).all(...params) as ParallelInstance[];

    return rows;
  }

  /**
   * Count running instances for a base mesh
   * @param baseMesh - The base mesh name to count
   * @returns Number of running instances
   */
  countRunningInstances(baseMesh: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as c FROM parallel_instances
      WHERE base_mesh = ? AND status = 'running'
    `).get(baseMesh) as { c: number };
    return row.c;
  }

  /**
   * Mark all running instances as completed (for restart recovery)
   * On system restart, stale running instances should be marked completed
   */
  markStaleInstances(): number {
    const result = this.db.prepare(`
      UPDATE parallel_instances
      SET status = 'completed', completed_at = ?
      WHERE status = 'running'
    `).run(Date.now());
    return result.changes;
  }

  // ============================================
  // Instant-Exit Failure Tracking
  // ============================================

  /**
   * Increment the instant-exit failure count for an agent
   * @param agentId - The agent ID that instant-exited
   * @returns The new failure count
   */
  incrementInstantExitFailure(agentId: string): number {
    const now = Date.now();
    const existing = this.getInstantExitFailureCount(agentId);
    const newCount = existing + 1;

    this.db.prepare(`
      INSERT OR REPLACE INTO instant_exit_failures
        (agent_id, consecutive_failures, last_failure_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(agentId, newCount, now, now);

    return newCount;
  }

  /**
   * Get the current instant-exit failure count for an agent
   * @param agentId - The agent ID to query
   * @returns The consecutive failure count (0 if not found or expired)
   */
  getInstantExitFailureCount(agentId: string): number {
    const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
    const cutoff = Date.now() - COOLDOWN_MS;

    const row = this.db.prepare(`
      SELECT consecutive_failures, last_failure_at
      FROM instant_exit_failures
      WHERE agent_id = ?
    `).get(agentId) as { consecutive_failures: number; last_failure_at: number } | undefined;

    if (!row) return 0;

    // Reset if cooldown period has elapsed
    if (row.last_failure_at < cutoff) {
      this.clearInstantExitFailure(agentId);
      return 0;
    }

    return row.consecutive_failures;
  }

  /**
   * Reset the instant-exit failure count for an agent
   * @param agentId - The agent ID to reset
   */
  clearInstantExitFailure(agentId: string): void {
    this.db.prepare('DELETE FROM instant_exit_failures WHERE agent_id = ?').run(agentId);
  }

  /**
   * Clear instant-exit failures for a mesh (on mesh completion or new run)
   * @param meshName - The mesh name
   */
  clearInstantExitFailuresForMesh(meshName: string): number {
    const result = this.db.prepare(
      'DELETE FROM instant_exit_failures WHERE agent_id LIKE ?'
    ).run(`${meshName}/%`);
    return result.changes;
  }

  /**
   * Clean up expired instant-exit failure records (older than 30 minutes)
   * Called periodically or on startup
   * @returns Number of records cleaned up
   */
  cleanupExpiredInstantExitFailures(): number {
    const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
    const cutoff = Date.now() - COOLDOWN_MS;

    const result = this.db.prepare(`
      DELETE FROM instant_exit_failures
      WHERE last_failure_at < ?
    `).run(cutoff);

    return result.changes;
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

// Re-export FSM persistence for convenience
export { FSMPersistence, type FSMStateData, type FSMStateBackup } from '../mesh/fsm-persistence.ts';
