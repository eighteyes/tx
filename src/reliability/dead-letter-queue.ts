/**
 * DeadLetterQueue - Messages that failed delivery after max retries
 *
 * Nine 2 pattern: Instead of silently dropping failed messages,
 * route them to a DLQ for inspection and manual replay.
 *
 * Features:
 * - Automatic retry with exponential backoff (up to maxRetries)
 * - DLQ storage in SQLite for persistence across restarts
 * - Replay via SystemMessageWriter (re-injects into live system)
 * - Failure reason tracking for taxonomy
 */

import type Database from 'better-sqlite3';
import { log } from '../shared/logger.ts';
import type { SystemMessageWriter } from '../core/system-message-writer.ts';

export interface DLQEntry {
  id: number;
  from_agent: string;
  to_agent: string;
  type: string;
  payload: string;
  source_file: string | null;
  failure_reason: string;
  retry_count: number;
  max_retries: number;
  first_failed_at: number;
  last_failed_at: number;
  replayed_at: number | null;
}

export interface DLQStats {
  total: number;
  pending: number;     // Not yet replayed
  replayed: number;    // Successfully replayed
  byReason: Record<string, number>;
  byAgent: Record<string, number>;
}

export interface ReplayResult {
  id: number;
  success: boolean;
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
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        source_file TEXT,
        failure_reason TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER NOT NULL,
        first_failed_at INTEGER NOT NULL,
        last_failed_at INTEGER NOT NULL,
        replayed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_dlq_agent ON dead_letter_queue(to_agent, replayed_at);
      CREATE INDEX IF NOT EXISTS idx_dlq_reason ON dead_letter_queue(failure_reason);
    `);
  }

  /**
   * Add a failed message to the DLQ
   */
  add(entry: {
    from_agent: string;
    to_agent: string;
    type: string;
    payload: Record<string, unknown>;
    source_file?: string;
    failure_reason: string;
    retry_count?: number;
  }): number {
    const now = Date.now();
    const result = this.db.prepare(`
      INSERT INTO dead_letter_queue
        (from_agent, to_agent, type, payload, source_file, failure_reason,
         retry_count, max_retries, first_failed_at, last_failed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.from_agent,
      entry.to_agent,
      entry.type,
      JSON.stringify(entry.payload),
      entry.source_file || null,
      entry.failure_reason,
      entry.retry_count || 0,
      this.maxRetries,
      now,
      now
    );

    log.warn('dlq', 'Message added to dead letter queue', {
      id: result.lastInsertRowid,
      from: entry.from_agent,
      to: entry.to_agent,
      reason: entry.failure_reason,
      retries: entry.retry_count || 0,
    });

    return result.lastInsertRowid as number;
  }

  /**
   * Get all unreplayed DLQ entries
   */
  getPending(): DLQEntry[] {
    return this.db.prepare(`
      SELECT * FROM dead_letter_queue
      WHERE replayed_at IS NULL
      ORDER BY last_failed_at DESC
    `).all() as DLQEntry[];
  }

  /**
   * Get DLQ entries for a specific agent
   */
  getForAgent(agentId: string): DLQEntry[] {
    return this.db.prepare(`
      SELECT * FROM dead_letter_queue
      WHERE to_agent = ? AND replayed_at IS NULL
      ORDER BY last_failed_at DESC
    `).all(agentId) as DLQEntry[];
  }

  /**
   * Mark a DLQ entry as replayed
   */
  markReplayed(id: number): void {
    this.db.prepare(`
      UPDATE dead_letter_queue SET replayed_at = ? WHERE id = ?
    `).run(Date.now(), id);

    log.info('dlq', 'DLQ entry replayed', { id });
  }

  /**
   * Replay a single DLQ entry via SystemMessageWriter.
   * Re-injects the message into the live system with a [DLQ REPLAY] prefix.
   */
  replayOne(id: number, writer: SystemMessageWriter): ReplayResult {
    const entry = this.db.prepare(
      'SELECT * FROM dead_letter_queue WHERE id = ? AND replayed_at IS NULL'
    ).get(id) as DLQEntry | undefined;

    if (!entry) {
      return { id, success: false, error: 'Entry not found or already replayed' };
    }

    try {
      const payload = JSON.parse(entry.payload) as Record<string, unknown>;
      const headline = (payload.headline as string) || 'DLQ Replay';
      const body = (payload.body as string) || JSON.stringify(payload, null, 2);

      writer.write({
        to: entry.to_agent,
        from: entry.from_agent,
        type: entry.type,
        headline: `[DLQ REPLAY] ${headline}`,
        body: `> Replayed from dead letter queue (DLQ #${entry.id})\n> Original failure: ${entry.failure_reason}\n> Failed at: ${new Date(entry.first_failed_at).toISOString()}\n> Retries: ${entry.retry_count}/${entry.max_retries}\n\n${body}`,
        msgId: `dlq-replay-${entry.id}-${Date.now()}`,
      });

      this.markReplayed(id);

      log.info('dlq', 'Message replayed via SystemMessageWriter', {
        id,
        to: entry.to_agent,
        from: entry.from_agent,
        originalReason: entry.failure_reason,
      });

      return { id, success: true };
    } catch (err) {
      const error = (err as Error).message;
      log.error('dlq', 'Replay failed', { id, error });
      return { id, success: false, error };
    }
  }

  /**
   * Replay all pending DLQ entries via SystemMessageWriter.
   * Returns results for each entry.
   */
  replayAll(writer: SystemMessageWriter): ReplayResult[] {
    const pending = this.getPending();
    const results: ReplayResult[] = [];

    for (const entry of pending) {
      results.push(this.replayOne(entry.id, writer));
    }

    log.info('dlq', 'Bulk replay complete', {
      total: pending.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });

    return results;
  }

  /**
   * Replay all pending DLQ entries for a specific agent.
   */
  replayForAgent(agentId: string, writer: SystemMessageWriter): ReplayResult[] {
    const entries = this.getForAgent(agentId);
    const results: ReplayResult[] = [];

    for (const entry of entries) {
      results.push(this.replayOne(entry.id, writer));
    }

    return results;
  }

  /**
   * Get DLQ statistics
   */
  getStats(): DLQStats {
    const total = (this.db.prepare(
      'SELECT COUNT(*) as c FROM dead_letter_queue'
    ).get() as { c: number }).c;

    const pending = (this.db.prepare(
      'SELECT COUNT(*) as c FROM dead_letter_queue WHERE replayed_at IS NULL'
    ).get() as { c: number }).c;

    const byReasonRows = this.db.prepare(`
      SELECT failure_reason, COUNT(*) as c FROM dead_letter_queue
      WHERE replayed_at IS NULL GROUP BY failure_reason
    `).all() as Array<{ failure_reason: string; c: number }>;

    const byAgentRows = this.db.prepare(`
      SELECT to_agent, COUNT(*) as c FROM dead_letter_queue
      WHERE replayed_at IS NULL GROUP BY to_agent
    `).all() as Array<{ to_agent: string; c: number }>;

    const byReason: Record<string, number> = {};
    for (const row of byReasonRows) byReason[row.failure_reason] = row.c;

    const byAgent: Record<string, number> = {};
    for (const row of byAgentRows) byAgent[row.to_agent] = row.c;

    return { total, pending, replayed: total - pending, byReason, byAgent };
  }

  /**
   * Clear old replayed entries (garbage collection)
   */
  clearReplayed(olderThanMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db.prepare(`
      DELETE FROM dead_letter_queue
      WHERE replayed_at IS NOT NULL AND replayed_at < ?
    `).run(cutoff);
    return result.changes;
  }
}
