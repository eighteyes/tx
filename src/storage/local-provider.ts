/**
 * LocalStorageProvider - File-based storage for development
 *
 * Implements StorageProvider using:
 * - Filesystem for messages (.md files in msgs directory)
 * - SQLite for queue operations
 * - SQLite for session state
 *
 * Responsibilities:
 * - Maintain backward compatibility with tx dev workflow
 * - Provide file-based message watching via chokidar
 * - Session-scoped directories for multi-session dev testing
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  StorageProvider,
  StorageConfig,
  AgentMessage,
  QueueEntry,
  SessionState,
  MessageFilter,
  MessageEvent,
} from './interface.ts';

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;
  private db: DatabaseType | null = null;
  private watchers: Map<string, FSWatcher> = new Map();
  private emitters: Map<string, EventEmitter> = new Map();

  constructor(config: StorageConfig) {
    this.baseDir = config.baseDir || process.cwd();
  }

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    const dbPath = path.join(this.baseDir, '.ai', 'tx', 'queue.db');
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createSchema();
  }

  async close(): Promise<void> {
    // Close all watchers
    for (const watcher of Array.from(this.watchers.values())) {
      await watcher.close();
    }
    this.watchers.clear();
    this.emitters.clear();

    // Close database
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private createSchema(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      -- Messages queue
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        payload JSON NOT NULL,
        source_file TEXT,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_session_to_status ON messages(session_id, to_agent, status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_source_file ON messages(source_file) WHERE source_file IS NOT NULL;

      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        mesh_id TEXT NOT NULL,
        tenant_id TEXT,
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        metadata JSON
      );
      CREATE INDEX IF NOT EXISTS idx_tenant ON sessions(tenant_id);

      -- Conversations (Claude SDK resume support)
      CREATE TABLE IF NOT EXISTS conversations (
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, agent_id)
      );
    `);
  }

  // ─────────────────────────────────────────────────────────────
  // Path Helpers
  // ─────────────────────────────────────────────────────────────

  private sessionDir(sessionId: string): string {
    return path.join(this.baseDir, '.ai', 'tx', 'sessions', sessionId);
  }

  private msgsDir(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), 'msgs');
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Message Operations
  // ─────────────────────────────────────────────────────────────

  async writeMessage(sessionId: string, message: AgentMessage): Promise<string> {
    const msgDir = this.msgsDir(sessionId);
    this.ensureDir(msgDir);

    const msgId = message.msgId || randomUUID();
    const timestamp = message.timestamp || Date.now();
    const safeFrom = message.from.replace(/\//g, '-');
    const safeTo = message.to.replace(/\//g, '-');
    const filename = `${timestamp}-${message.type}-${safeFrom}--${safeTo}-${msgId}.md`;
    const filepath = path.join(msgDir, filename);

    // Build frontmatter
    const frontmatter: Record<string, string> = {
      to: message.to,
      from: message.from,
      type: message.type,
      'msg-id': msgId,
      timestamp: new Date(timestamp).toISOString(),
    };

    if (message.headline) frontmatter.headline = message.headline;
    if (message.refMsgId) frontmatter['ref-msg-id'] = message.refMsgId;
    if (message.metadata) {
      for (const [key, value] of Object.entries(message.metadata)) {
        if (typeof value === 'string') {
          frontmatter[key] = value;
        }
      }
    }

    const yamlLines = Object.entries(frontmatter)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const content = `---\n${yamlLines}\n---\n\n${message.body}\n`;

    fs.writeFileSync(filepath, content);
    return msgId;
  }

  subscribeMessages(sessionId: string): AsyncIterable<MessageEvent> & { close(): void } {
    const msgDir = this.msgsDir(sessionId);
    this.ensureDir(msgDir);

    // Each subscription is independent — no shared maps.
    // Multiple WS connections to the same session each get their own watcher.
    const emitter = new EventEmitter();

    const watcher = watch(msgDir, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });

    watcher.on('add', (filepath: string) => {
      if (filepath.endsWith('.md')) {
        const message = this.parseMessageFile(filepath);
        if (message) {
          emitter.emit('message', { type: 'new', message, filepath });
        }
      }
    });

    watcher.on('change', (filepath: string) => {
      if (filepath.endsWith('.md')) {
        const message = this.parseMessageFile(filepath);
        if (message) {
          emitter.emit('message', { type: 'revision', message, filepath });
        }
      }
    });

    const close = () => {
      emitter.emit('close');
      watcher.close();
    };

    async function* iterate(): AsyncGenerator<MessageEvent> {
      try {
        while (true) {
          const event = await new Promise<MessageEvent | null>((resolve) => {
            const handler = (event: MessageEvent) => {
              emitter.removeListener('message', handler);
              emitter.removeListener('close', closeHandler);
              resolve(event);
            };
            const closeHandler = () => {
              emitter.removeListener('message', handler);
              resolve(null);
            };
            emitter.once('message', handler);
            emitter.once('close', closeHandler);
          });

          if (event === null) break;
          yield event;
        }
      } finally {
        watcher.close();
      }
    }

    const iter = iterate();
    return Object.assign(iter, { close });
  }

  unsubscribeMessages(_sessionId: string): void {
    // No-op: subscriptions are now independent per-connection.
    // Use the .close() method on the subscription handle instead.
  }

  private parseMessageFile(filepath: string): AgentMessage | null {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const parts = content.split(/^---$/m);
      if (parts.length < 3) return null;

      const frontmatter = this.parseFrontmatter(parts[1].trim());
      if (!frontmatter.to || !frontmatter.from) return null;

      const body = parts.slice(2).join('---').trim();

      return {
        from: frontmatter.from,
        to: frontmatter.to,
        type: frontmatter.type || 'message',
        body,
        headline: frontmatter.headline,
        msgId: frontmatter['msg-id'],
        refMsgId: frontmatter['ref-msg-id'],
        timestamp: frontmatter.timestamp
          ? new Date(frontmatter.timestamp).getTime()
          : Date.now(),
      };
    } catch {
      return null;
    }
  }

  private parseFrontmatter(yaml: string): Record<string, string> {
    const data: Record<string, string> = {};
    for (const line of yaml.split('\n')) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        data[key] = value;
      }
    }
    return data;
  }

  async getMessage(sessionId: string, messageId: string): Promise<AgentMessage | null> {
    const msgDir = this.msgsDir(sessionId);
    if (!fs.existsSync(msgDir)) return null;

    const files = fs.readdirSync(msgDir);
    const file = files.find((f) => f.includes(messageId) && f.endsWith('.md'));
    if (!file) return null;

    return this.parseMessageFile(path.join(msgDir, file));
  }

  async listMessages(sessionId: string, filter?: MessageFilter): Promise<AgentMessage[]> {
    const msgDir = this.msgsDir(sessionId);
    if (!fs.existsSync(msgDir)) return [];

    const files = fs.readdirSync(msgDir).filter((f) => f.endsWith('.md'));
    const messages: AgentMessage[] = [];

    for (const file of files) {
      const message = this.parseMessageFile(path.join(msgDir, file));
      if (!message) continue;

      // Apply filters
      if (filter?.type && message.type !== filter.type) continue;
      if (filter?.from && message.from !== filter.from) continue;
      if (filter?.to && message.to !== filter.to) continue;

      messages.push(message);
    }

    // Sort by timestamp descending
    messages.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit
    if (filter?.limit) {
      return messages.slice(0, filter.limit);
    }

    return messages;
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<boolean> {
    const msgDir = this.msgsDir(sessionId);
    if (!fs.existsSync(msgDir)) return false;

    const files = fs.readdirSync(msgDir);
    const file = files.find((f) => f.includes(messageId) && f.endsWith('.md'));
    if (!file) return false;

    fs.unlinkSync(path.join(msgDir, file));
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // Queue Operations
  // ─────────────────────────────────────────────────────────────

  async queueInsert(
    sessionId: string,
    message: AgentMessage,
    sourceFile?: string
  ): Promise<string | null> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const result = this.db
        .prepare(
          `INSERT INTO messages (session_id, from_agent, to_agent, type, payload, source_file, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sessionId,
          message.from,
          message.to,
          message.type,
          JSON.stringify(message),
          sourceFile || null,
          Date.now()
        );
      return String(result.lastInsertRowid);
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return null; // Duplicate
      }
      throw err;
    }
  }

  async queuePoll(sessionId: string, recipient: string): Promise<QueueEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db
      .prepare(
        `SELECT id, from_agent, to_agent, type, status, payload, source_file, created_at, delivered_at
         FROM messages
         WHERE session_id = ? AND to_agent = ? AND status = 'pending'
         ORDER BY created_at ASC`
      )
      .all(sessionId, recipient) as Array<{
      id: number;
      from_agent: string;
      to_agent: string;
      type: string;
      status: string;
      payload: string;
      source_file: string | null;
      created_at: number;
      delivered_at: number | null;
    }>;

    if (rows.length === 0) return [];

    // Mark as delivered
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db
      .prepare(
        `UPDATE messages SET status = 'delivered', delivered_at = ?
         WHERE id IN (${placeholders})`
      )
      .run(Date.now(), ...ids);

    return rows.map((row) => ({
      id: row.id,
      message: JSON.parse(row.payload) as AgentMessage,
      status: 'delivered' as const,
      sourceFile: row.source_file || undefined,
      createdAt: row.created_at,
      deliveredAt: Date.now(),
    }));
  }

  async queuePollOne(sessionId: string, recipient: string): Promise<QueueEntry | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db
      .prepare(
        `SELECT id, from_agent, to_agent, type, status, payload, source_file, created_at, delivered_at
         FROM messages
         WHERE session_id = ? AND to_agent = ? AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(sessionId, recipient) as
      | {
          id: number;
          payload: string;
          source_file: string | null;
          created_at: number;
        }
      | undefined;

    if (!row) return null;

    this.db
      .prepare(`UPDATE messages SET status = 'delivered', delivered_at = ? WHERE id = ?`)
      .run(Date.now(), row.id);

    return {
      id: row.id,
      message: JSON.parse(row.payload) as AgentMessage,
      status: 'delivered',
      sourceFile: row.source_file || undefined,
      createdAt: row.created_at,
      deliveredAt: Date.now(),
    };
  }

  async queuePeek(sessionId: string, recipient: string): Promise<QueueEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db
      .prepare(
        `SELECT id, payload, source_file, created_at, delivered_at, status
         FROM messages
         WHERE session_id = ? AND to_agent = ? AND status = 'pending'
         ORDER BY created_at ASC`
      )
      .all(sessionId, recipient) as Array<{
      id: number;
      payload: string;
      source_file: string | null;
      created_at: number;
      delivered_at: number | null;
      status: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      message: JSON.parse(row.payload) as AgentMessage,
      status: row.status as 'pending' | 'delivered',
      sourceFile: row.source_file || undefined,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at || undefined,
    }));
  }

  async queueQuery(sessionId: string, filter?: MessageFilter): Promise<QueueEntry[]> {
    if (!this.db) throw new Error('Database not initialized');

    const conditions: string[] = ['session_id = ?'];
    const params: unknown[] = [sessionId];

    if (filter?.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter?.from) {
      conditions.push('from_agent = ?');
      params.push(filter.from);
    }
    if (filter?.to) {
      conditions.push('to_agent = ?');
      params.push(filter.to);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.sinceId) {
      conditions.push('id > ?');
      params.push(filter.sinceId);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limitClause = filter?.limit ? `LIMIT ${filter.limit}` : '';

    const rows = this.db
      .prepare(
        `SELECT id, payload, source_file, created_at, delivered_at, status
         FROM messages
         ${whereClause}
         ORDER BY created_at DESC
         ${limitClause}`
      )
      .all(...params) as Array<{
      id: number;
      payload: string;
      source_file: string | null;
      created_at: number;
      delivered_at: number | null;
      status: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      message: JSON.parse(row.payload) as AgentMessage,
      status: row.status as 'pending' | 'delivered' | 'failed',
      sourceFile: row.source_file || undefined,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at || undefined,
    }));
  }

  async queueMarkProcessed(sessionId: string, entryId: string | number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db
      .prepare(`UPDATE messages SET status = 'delivered', delivered_at = ? WHERE id = ?`)
      .run(Date.now(), entryId);
  }

  async queueStats(
    sessionId: string
  ): Promise<{ pending: number; delivered: number; total: number; byAgent: Record<string, number> }> {
    if (!this.db) throw new Error('Database not initialized');

    const pending = (
      this.db
        .prepare(`SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND status = 'pending'`)
        .get(sessionId) as { c: number }
    ).c;

    const delivered = (
      this.db
        .prepare(`SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND status = 'delivered'`)
        .get(sessionId) as { c: number }
    ).c;

    const byAgentRows = this.db
      .prepare(
        `SELECT to_agent, COUNT(*) as c FROM messages
         WHERE session_id = ? AND status = 'pending'
         GROUP BY to_agent`
      )
      .all(sessionId) as Array<{ to_agent: string; c: number }>;

    const byAgent: Record<string, number> = {};
    for (const row of byAgentRows) {
      byAgent[row.to_agent] = row.c;
    }

    return { pending, delivered, total: pending + delivered, byAgent };
  }

  // ─────────────────────────────────────────────────────────────
  // Session Operations
  // ─────────────────────────────────────────────────────────────

  async createSession(meshId: string, tenantId?: string): Promise<SessionState> {
    if (!this.db) throw new Error('Database not initialized');

    const sessionId = randomUUID();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO sessions (session_id, mesh_id, tenant_id, status, created_at, last_activity_at)
         VALUES (?, ?, ?, 'active', ?, ?)`
      )
      .run(sessionId, meshId, tenantId || null, now, now);

    // Create session directory
    this.ensureDir(this.msgsDir(sessionId));

    // Write meta.json for session discovery
    const metaPath = path.join(this.sessionDir(sessionId), 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      meshId,
      tenantId: tenantId || null,
      status: 'active',
      createdAt: new Date(now).toISOString(),
      lastActivityAt: new Date(now).toISOString(),
    }));

    return {
      sessionId,
      agentId: '', // Will be set when agent connects
      meshId,
      tenantId,
      status: 'active',
      createdAt: now,
      lastActivityAt: now,
    };
  }

  async getSession(sessionId: string): Promise<SessionState | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE session_id = ?`)
      .get(sessionId) as
      | {
          session_id: string;
          mesh_id: string;
          tenant_id: string | null;
          status: string;
          created_at: number;
          last_activity_at: number;
          metadata: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      sessionId: row.session_id,
      agentId: '',
      meshId: row.mesh_id,
      tenantId: row.tenant_id || undefined,
      status: row.status as 'active' | 'hibernated' | 'destroyed',
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  async updateSession(sessionId: string, updates: Partial<SessionState>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const sets: string[] = ['last_activity_at = ?'];
    const params: unknown[] = [Date.now()];

    if (updates.status) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.metadata) {
      sets.push('metadata = ?');
      params.push(JSON.stringify(updates.metadata));
    }

    params.push(sessionId);

    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE session_id = ?`).run(...params);

    // Update meta.json for session discovery
    const metaPath = path.join(this.sessionDir(sessionId), 'meta.json');
    try {
      const existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      existing.lastActivityAt = new Date().toISOString();
      if (updates.status) existing.status = updates.status;
      if (updates.metadata?.workspace_resolved) existing.workspace = updates.metadata.workspace_resolved;
      fs.writeFileSync(metaPath, JSON.stringify(existing));
    } catch {
      // meta.json may not exist for older sessions
    }
  }

  async hibernateSession(sessionId: string): Promise<void> {
    await this.updateSession(sessionId, { status: 'hibernated' });

    // Close watcher if exists
    const watcher = this.watchers.get(sessionId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(sessionId);
    }

    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      emitter.emit('close');
      this.emitters.delete(sessionId);
    }
  }

  async resumeSession(sessionId: string): Promise<SessionState> {
    await this.updateSession(sessionId, { status: 'active' });
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session;
  }

  async destroySession(sessionId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Close watcher
    const watcher = this.watchers.get(sessionId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(sessionId);
    }

    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      emitter.emit('close');
      this.emitters.delete(sessionId);
    }

    // Delete from database
    this.db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
    this.db.prepare(`DELETE FROM conversations WHERE session_id = ?`).run(sessionId);
    this.db.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId);

    // Optionally delete session directory (leave for debugging)
    // const sessionDir = this.sessionDir(sessionId);
    // if (fs.existsSync(sessionDir)) {
    //   fs.rmSync(sessionDir, { recursive: true });
    // }
  }

  async listSessions(tenantId: string): Promise<SessionState[]> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db
      .prepare(`SELECT * FROM sessions WHERE tenant_id = ? ORDER BY last_activity_at DESC`)
      .all(tenantId) as Array<{
      session_id: string;
      mesh_id: string;
      tenant_id: string | null;
      status: string;
      created_at: number;
      last_activity_at: number;
      metadata: string | null;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      agentId: '',
      meshId: row.mesh_id,
      tenantId: row.tenant_id || undefined,
      status: row.status as 'active' | 'hibernated' | 'destroyed',
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Conversation State
  // ─────────────────────────────────────────────────────────────

  async getConversationId(sessionId: string, agentId: string): Promise<string | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db
      .prepare(`SELECT conversation_id FROM conversations WHERE session_id = ? AND agent_id = ?`)
      .get(sessionId, agentId) as { conversation_id: string } | undefined;

    return row?.conversation_id || null;
  }

  async setConversationId(sessionId: string, agentId: string, conversationId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db
      .prepare(
        `INSERT OR REPLACE INTO conversations (session_id, agent_id, conversation_id, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(sessionId, agentId, conversationId, Date.now());
  }

  async clearConversationId(sessionId: string, agentId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db
      .prepare(`DELETE FROM conversations WHERE session_id = ? AND agent_id = ?`)
      .run(sessionId, agentId);
  }
}
