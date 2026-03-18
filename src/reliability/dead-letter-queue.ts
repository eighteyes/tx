/**
 * DeadLetterQueue - Session-aware failure recovery
 *
 * Nine 2 pattern: Instead of silently dropping failed work,
 * capture the session context at failure time and enable recovery
 * via session resume (not raw message replay).
 *
 * Two recovery modes:
 * 1. Session resume: Agent crashed mid-work → resume with sessionId
 *    (preserves full conversation history + tool state)
 * 2. Message re-queue: Message undeliverable → re-queue to dispatcher
 *    (for circuit-open or routing failures where no session exists)
 *
 * The key insight: replaying a raw message loses all conversation context.
 * Session resume picks up exactly where the agent left off.
 */

import type Database from 'better-sqlite3';
import { log } from '../shared/logger.ts';

/**
 * Recovery mode determines how to restore failed work
 */
export type RecoveryMode =
  | 'session_resume'   // Crashed mid-work: resume via sessionId
  | 'requeue'          // Undeliverable: re-insert into message queue
  | 'manual';          // Needs human intervention

export interface DLQEntry {
  id: number;
  agent_id: string;           // The agent that failed (mesh/agent)
  mesh_name: string;
  recovery_mode: RecoveryMode;
  session_id: string | null;  // For session_resume: SDK session to resume
  /** Original message context (for requeue mode) */
  from_agent: string;
  to_agent: string;
  type: string;
  payload: string;            // JSON-serialized original payload
  source_file: string | null;
  /** Failure context */
  failure_reason: string;
  failure_category: string;   // SLI failure category
  retry_count: number;
  max_retries: number;
  /** Worker state at failure time */
  messages_sent: number;      // How many messages worker sent before failing
  output_snapshot: string | null;  // Last output (truncated) for diagnostics
  /** Timestamps */
  first_failed_at: number;
  last_failed_at: number;
  recovered_at: number | null;
}

export interface DLQStats {
  total: number;
  pending: number;        // Not yet recovered
  recovered: number;      // Successfully recovered
  byReason: Record<string, number>;
  byAgent: Record<string, number>;
  byMode: Record<RecoveryMode, number>;
}

export interface RecoveryResult {
  id: number;
  success: boolean;
  mode: RecoveryMode;
  sessionId?: string;
  error?: string;
}

export class DeadLetterQueue {
  private db: Database.Database;
  private maxRetries: number;

  constructor(db: Database.Database, maxRetries = 3) {
    this.db = db;
    this.maxRetries = maxRetries;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dead_letter_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        mesh_name TEXT NOT NULL,
        recovery_mode TEXT NOT NULL DEFAULT 'requeue',
        session_id TEXT,
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        source_file TEXT,
        failure_reason TEXT NOT NULL,
        failure_category TEXT NOT NULL DEFAULT 'unknown',
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER NOT NULL,
        messages_sent INTEGER DEFAULT 0,
        output_snapshot TEXT,
        first_failed_at INTEGER NOT NULL,
        last_failed_at INTEGER NOT NULL,
        recovered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_dlq_agent ON dead_letter_queue(agent_id, recovered_at);
      CREATE INDEX IF NOT EXISTS idx_dlq_mesh ON dead_letter_queue(mesh_name, recovered_at);
      CREATE INDEX IF NOT EXISTS idx_dlq_mode ON dead_letter_queue(recovery_mode, recovered_at);
    `);
  }

  /**
   * Add a failed operation to the DLQ with full session context.
   *
   * The recovery_mode is determined by what state existed at failure:
   * - session_resume: Agent had an active sessionId → can resume
   * - requeue: No session (e.g., failed before starting, or routing error)
   * - manual: Repeated failures, needs human decision
   */
  add(entry: {
    agent_id: string;
    mesh_name: string;
    session_id?: string;
    from_agent: string;
    to_agent: string;
    type: string;
    payload: Record<string, unknown>;
    source_file?: string;
    failure_reason: string;
    failure_category: string;
    retry_count?: number;
    messages_sent?: number;
    output_snapshot?: string;
  }): number {
    const now = Date.now();
    const retryCount = entry.retry_count || 0;

    // Determine recovery mode from context
    let mode: RecoveryMode;
    if (retryCount >= this.maxRetries) {
      mode = 'manual';  // Exhausted retries
    } else if (entry.session_id) {
      mode = 'session_resume';  // Has session → can resume
    } else {
      mode = 'requeue';  // No session → re-inject message
    }

    const result = this.db.prepare(`
      INSERT INTO dead_letter_queue
        (agent_id, mesh_name, recovery_mode, session_id,
         from_agent, to_agent, type, payload, source_file,
         failure_reason, failure_category, retry_count, max_retries,
         messages_sent, output_snapshot,
         first_failed_at, last_failed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.agent_id,
      entry.mesh_name,
      mode,
      entry.session_id || null,
      entry.from_agent,
      entry.to_agent,
      entry.type,
      JSON.stringify(entry.payload),
      entry.source_file || null,
      entry.failure_reason,
      entry.failure_category,
      retryCount,
      this.maxRetries,
      entry.messages_sent || 0,
      entry.output_snapshot?.slice(0, 2000) || null,  // Truncate snapshot
      now,
      now
    );

    log.warn('dlq', 'Added to dead letter queue', {
      id: result.lastInsertRowid,
      agent: entry.agent_id,
      mode,
      sessionId: entry.session_id?.slice(0, 8),
      reason: entry.failure_reason,
      category: entry.failure_category,
      retries: retryCount,
    });

    return result.lastInsertRowid as number;
  }

  /**
   * Get all unrecovered DLQ entries
   */
  getPending(): DLQEntry[] {
    return this.db.prepare(`
      SELECT * FROM dead_letter_queue
      WHERE recovered_at IS NULL
      ORDER BY last_failed_at DESC
    `).all() as DLQEntry[];
  }

  /**
   * Get DLQ entries that can be auto-recovered (session_resume or requeue)
   */
  getRecoverable(): DLQEntry[] {
    return this.db.prepare(`
      SELECT * FROM dead_letter_queue
      WHERE recovered_at IS NULL AND recovery_mode != 'manual'
      ORDER BY last_failed_at ASC
    `).all() as DLQEntry[];
  }

  /**
   * Get entries requiring manual intervention
   */
  getManual(): DLQEntry[] {
    return this.db.prepare(`
      SELECT * FROM dead_letter_queue
      WHERE recovered_at IS NULL AND recovery_mode = 'manual'
      ORDER BY last_failed_at DESC
    `).all() as DLQEntry[];
  }

  /**
   * Get DLQ entries for a specific agent
   */
  getForAgent(agentId: string): DLQEntry[] {
    return this.db.prepare(`
      SELECT * FROM dead_letter_queue
      WHERE agent_id = ? AND recovered_at IS NULL
      ORDER BY last_failed_at DESC
    `).all(agentId) as DLQEntry[];
  }

  /**
   * Get DLQ entries for a specific mesh
   */
  getForMesh(meshName: string): DLQEntry[] {
    return this.db.prepare(`
      SELECT * FROM dead_letter_queue
      WHERE mesh_name = ? AND recovered_at IS NULL
      ORDER BY last_failed_at DESC
    `).all(meshName) as DLQEntry[];
  }

  /**
   * Get a single entry by ID
   */
  getById(id: number): DLQEntry | undefined {
    return this.db.prepare(
      'SELECT * FROM dead_letter_queue WHERE id = ?'
    ).get(id) as DLQEntry | undefined;
  }

  /**
   * Mark a DLQ entry as recovered
   */
  markRecovered(id: number): void {
    this.db.prepare(`
      UPDATE dead_letter_queue SET recovered_at = ? WHERE id = ?
    `).run(Date.now(), id);

    log.info('dlq', 'Entry recovered', { id });
  }

  /**
   * Escalate a requeue entry to manual (e.g., after failed recovery attempt)
   */
  escalateToManual(id: number, reason: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE dead_letter_queue
      SET recovery_mode = 'manual', failure_reason = ?, last_failed_at = ?,
          retry_count = retry_count + 1
      WHERE id = ?
    `).run(`${reason} (escalated from auto-recovery)`, now, id);

    log.warn('dlq', 'Entry escalated to manual recovery', { id, reason });
  }

  /**
   * Get DLQ statistics
   */
  getStats(): DLQStats {
    const total = (this.db.prepare(
      'SELECT COUNT(*) as c FROM dead_letter_queue'
    ).get() as { c: number }).c;

    const pending = (this.db.prepare(
      'SELECT COUNT(*) as c FROM dead_letter_queue WHERE recovered_at IS NULL'
    ).get() as { c: number }).c;

    const byReasonRows = this.db.prepare(`
      SELECT failure_reason, COUNT(*) as c FROM dead_letter_queue
      WHERE recovered_at IS NULL GROUP BY failure_reason
    `).all() as Array<{ failure_reason: string; c: number }>;

    const byAgentRows = this.db.prepare(`
      SELECT agent_id, COUNT(*) as c FROM dead_letter_queue
      WHERE recovered_at IS NULL GROUP BY agent_id
    `).all() as Array<{ agent_id: string; c: number }>;

    const byModeRows = this.db.prepare(`
      SELECT recovery_mode, COUNT(*) as c FROM dead_letter_queue
      WHERE recovered_at IS NULL GROUP BY recovery_mode
    `).all() as Array<{ recovery_mode: RecoveryMode; c: number }>;

    const byReason: Record<string, number> = {};
    for (const row of byReasonRows) byReason[row.failure_reason] = row.c;

    const byAgent: Record<string, number> = {};
    for (const row of byAgentRows) byAgent[row.agent_id] = row.c;

    const byMode: Record<RecoveryMode, number> = { session_resume: 0, requeue: 0, manual: 0 };
    for (const row of byModeRows) byMode[row.recovery_mode] = row.c;

    return { total, pending, recovered: total - pending, byReason, byAgent, byMode };
  }

  /**
   * Clear old recovered entries (garbage collection)
   */
  clearRecovered(olderThanMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db.prepare(`
      DELETE FROM dead_letter_queue
      WHERE recovered_at IS NOT NULL AND recovered_at < ?
    `).run(cutoff);
    if (result.changes > 0) {
      log.info('dlq', 'GC cleared recovered entries', { deleted: result.changes });
    }
    return result.changes;
  }
}
