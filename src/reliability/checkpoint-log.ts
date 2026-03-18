/**
 * CheckpointLog - Persisted session state at FSM boundaries
 *
 * Saves session IDs at every FSM state transition so recovery can
 * rewind to any named state, not just the crash point.
 *
 * Core agent uses `rewind-to: <state>` front-matter to specify which
 * checkpoint to recover from. The system looks up the most recent
 * session ID for that mesh+state.
 */

import type Database from 'better-sqlite3';
import { log } from '../shared/logger.ts';

export interface Checkpoint {
  id: number;
  mesh_name: string;
  state_name: string;
  agent_id: string;
  session_id: string;
  from_state: string;
  context_snapshot: string;  // JSON: FSM context at transition time
  created_at: string;
}

export class CheckpointLog {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mesh_name TEXT NOT NULL,
        state_name TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        from_state TEXT NOT NULL,
        context_snapshot TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoint_mesh_state
        ON checkpoint_log(mesh_name, state_name, created_at DESC);
    `);
  }

  /**
   * Save a checkpoint at an FSM state transition.
   * Called by the dispatcher when fsm:transition fires.
   */
  save(opts: {
    meshName: string;
    stateName: string;
    agentId: string;
    sessionId: string;
    fromState: string;
    context?: Record<string, unknown>;
  }): void {
    this.db.prepare(`
      INSERT INTO checkpoint_log (mesh_name, state_name, agent_id, session_id, from_state, context_snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      opts.meshName,
      opts.stateName,
      opts.agentId,
      opts.sessionId,
      opts.fromState,
      JSON.stringify(opts.context || {}),
    );

    log.debug('checkpoint', 'Saved', {
      mesh: opts.meshName,
      state: opts.stateName,
      agent: opts.agentId,
      session: opts.sessionId.slice(0, 8),
    });
  }

  /**
   * Look up the most recent checkpoint for a mesh+state.
   * This is what `rewind-to: <state>` resolves against.
   */
  lookup(meshName: string, stateName: string): Checkpoint | null {
    const result = this.db.prepare(`
      SELECT * FROM checkpoint_log
      WHERE mesh_name = ? AND state_name = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(meshName, stateName) as Checkpoint | null;

    if (result) {
      log.info('checkpoint', 'Lookup hit', {
        mesh: meshName, state: stateName,
        session: result.session_id.slice(0, 8),
        agent: result.agent_id,
      });
    } else {
      log.warn('checkpoint', 'Lookup miss', { mesh: meshName, state: stateName });
    }

    return result;
  }

  /**
   * Get all checkpoints for a mesh (most recent first).
   * Used by `tx mesh health` and core agent to see available rewind points.
   */
  listForMesh(meshName: string): Checkpoint[] {
    return this.db.prepare(`
      SELECT * FROM checkpoint_log
      WHERE mesh_name = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(meshName) as Checkpoint[];
  }

  /**
   * Get the latest checkpoint per state for a mesh.
   * Compact view: one row per state, most recent only.
   */
  latestPerState(meshName: string): Checkpoint[] {
    return this.db.prepare(`
      SELECT c.* FROM checkpoint_log c
      INNER JOIN (
        SELECT mesh_name, state_name, MAX(created_at) as max_created
        FROM checkpoint_log
        WHERE mesh_name = ?
        GROUP BY mesh_name, state_name
      ) latest ON c.mesh_name = latest.mesh_name
        AND c.state_name = latest.state_name
        AND c.created_at = latest.max_created
      ORDER BY c.created_at DESC
    `).all(meshName) as Checkpoint[];
  }

  /**
   * Clear checkpoints for a mesh (on mesh completion or clear).
   */
  clearForMesh(meshName: string): number {
    const result = this.db.prepare(
      `DELETE FROM checkpoint_log WHERE mesh_name = ?`
    ).run(meshName);
    if (result.changes > 0) {
      log.info('checkpoint', 'Cleared for mesh', { mesh: meshName, deleted: result.changes });
    }
    return result.changes;
  }

  /**
   * GC old checkpoints (keep last N per mesh).
   */
  gc(keepPerMesh = 50): number {
    // Find meshes with more than `keepPerMesh` entries
    const meshes = this.db.prepare(`
      SELECT mesh_name, COUNT(*) as cnt FROM checkpoint_log
      GROUP BY mesh_name HAVING cnt > ?
    `).all(keepPerMesh) as Array<{ mesh_name: string; cnt: number }>;

    let total = 0;
    for (const { mesh_name } of meshes) {
      const result = this.db.prepare(`
        DELETE FROM checkpoint_log WHERE mesh_name = ? AND id NOT IN (
          SELECT id FROM checkpoint_log WHERE mesh_name = ?
          ORDER BY created_at DESC LIMIT ?
        )
      `).run(mesh_name, mesh_name, keepPerMesh);
      total += result.changes;
    }
    if (total > 0) {
      log.info('checkpoint', 'GC pruned old entries', { deleted: total });
    }
    return total;
  }
}
