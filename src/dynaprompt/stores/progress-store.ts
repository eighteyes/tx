/**
 * AgentProgressStore - SQLite persistence for agent progress signals
 *
 * Provides CRUD operations for tracking agent execution progress (step counters).
 * Used for displaying progress in frontend and monitoring long-running tasks.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../shared/logger.ts';
import type { ProgressSignal } from '../types.ts';

const COMPONENT = 'progress-store';

/**
 * Internal row type for agent_progress table
 */
interface ProgressRow {
  id: string;
  mesh_instance: string;
  agent_id: string;
  step: number;
  total: number;
  label: string | null;
  created_at: number;
}

export class AgentProgressStore {
  private db: Database.Database;

  // Prepared statements for frequent operations
  private insertProgressStmt: Database.Statement;
  private getLatestStmt: Database.Statement;
  private listByAgentStmt: Database.Statement;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createSchema();

    // Prepare frequently used statements
    this.insertProgressStmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_progress (
        id, mesh_instance, agent_id, step, total, label, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.getLatestStmt = this.db.prepare(`
      SELECT * FROM agent_progress
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    this.listByAgentStmt = this.db.prepare(`
      SELECT * FROM agent_progress
      WHERE agent_id = ?
      ORDER BY created_at ASC
    `);

    log.debug(COMPONENT, 'AgentProgressStore initialized', { dbPath });
  }

  /**
   * Create database schema
   */
  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_progress (
        id TEXT PRIMARY KEY,
        mesh_instance TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        step INTEGER NOT NULL,
        total INTEGER NOT NULL,
        label TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_progress_agent ON agent_progress(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_progress_mesh ON agent_progress(mesh_instance, created_at DESC);
    `);

    log.debug(COMPONENT, 'Schema created/verified');
  }

  // ============================================
  // CRUD Operations
  // ============================================

  /**
   * Save a progress signal (idempotent if same ID provided)
   */
  save(progress: Omit<ProgressSignal, 'id' | 'created_at'> & { id?: string }): void {
    try {
      const id = progress.id || this.generateId();
      const now = Date.now();

      this.insertProgressStmt.run(
        id,
        progress.mesh_instance,
        progress.agent_id,
        progress.step,
        progress.total,
        progress.label ?? null,
        now
      );

      log.debug(COMPONENT, 'Progress saved', {
        progressId: id,
        agentId: progress.agent_id,
        step: progress.step,
        total: progress.total
      });
    } catch (err) {
      log.error(COMPONENT, 'Failed to save progress', {
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  /**
   * Get latest progress signal for an agent
   */
  latest(agentId: string): ProgressSignal | null {
    const row = this.getLatestStmt.get(agentId) as ProgressRow | undefined;
    if (!row) return null;
    return this.rowToProgress(row);
  }

  /**
   * List all progress signals for an agent (chronological order)
   */
  listForAgent(agentId: string): ProgressSignal[] {
    const rows = this.listByAgentStmt.all(agentId) as ProgressRow[];
    return rows.map(row => this.rowToProgress(row));
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Generate unique progress ID
   */
  private generateId(): string {
    return `prog-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Convert database row to ProgressSignal
   */
  private rowToProgress(row: ProgressRow): ProgressSignal {
    return {
      id: row.id,
      mesh_instance: row.mesh_instance,
      agent_id: row.agent_id,
      step: row.step,
      total: row.total,
      label: row.label,
      created_at: row.created_at
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    log.debug(COMPONENT, 'AgentProgressStore closed');
  }

  /**
   * Get underlying database instance (for testing)
   */
  getDb(): Database.Database {
    return this.db;
  }
}
