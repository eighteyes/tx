/**
 * AgentCheckpointStore - SQLite persistence for agent checkpoints
 *
 * Provides CRUD operations for checkpoint tree management with branching support.
 * Checkpoints are append-only and immutable once written.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../shared/logger.ts';
import type { CheckpointRecord, CheckpointNode } from '../types.ts';

const COMPONENT = 'checkpoint-store';

/**
 * Internal row type for agent_checkpoints table
 */
interface CheckpointRow {
  id: string;
  mesh_instance: string;
  agent_id: string;
  conversation_id: string;
  parent_checkpoint_id: string | null;
  label: string | null;
  snapshot_path: string | null;
  summary: string | null;
  created_at: number;
}

export class AgentCheckpointStore {
  private db: Database.Database;

  // Prepared statements for frequent operations
  private insertCheckpointStmt: Database.Statement;
  private getCheckpointStmt: Database.Statement;
  private listByMeshStmt: Database.Statement;
  private listByAgentStmt: Database.Statement;
  private getChildrenStmt: Database.Statement;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createSchema();

    // Prepare frequently used statements
    this.insertCheckpointStmt = this.db.prepare(`
      INSERT OR REPLACE INTO agent_checkpoints (
        id, mesh_instance, agent_id, conversation_id, parent_checkpoint_id,
        label, snapshot_path, summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getCheckpointStmt = this.db.prepare(`
      SELECT * FROM agent_checkpoints WHERE id = ?
    `);

    this.listByMeshStmt = this.db.prepare(`
      SELECT * FROM agent_checkpoints
      WHERE mesh_instance = ?
      ORDER BY created_at DESC
    `);

    this.listByAgentStmt = this.db.prepare(`
      SELECT * FROM agent_checkpoints
      WHERE agent_id = ?
      ORDER BY created_at DESC
    `);

    this.getChildrenStmt = this.db.prepare(`
      SELECT * FROM agent_checkpoints
      WHERE parent_checkpoint_id = ?
      ORDER BY created_at ASC
    `);

    log.debug(COMPONENT, 'AgentCheckpointStore initialized', { dbPath });
  }

  /**
   * Create database schema
   */
  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        id TEXT PRIMARY KEY,
        mesh_instance TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        label TEXT,
        snapshot_path TEXT,
        summary TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_mesh ON agent_checkpoints(mesh_instance, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_agent ON agent_checkpoints(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_parent ON agent_checkpoints(parent_checkpoint_id);
    `);

    log.debug(COMPONENT, 'Schema created/verified');
  }

  // ============================================
  // CRUD Operations
  // ============================================

  /**
   * Save a checkpoint (idempotent)
   * Returns the checkpoint ID
   */
  save(checkpoint: Omit<CheckpointRecord, 'id'> & { id?: string }): string {
    try {
      const id = checkpoint.id || this.generateId();
      const now = Date.now();

      this.insertCheckpointStmt.run(
        id,
        checkpoint.mesh_instance,
        checkpoint.agent_id,
        checkpoint.conversation_id,
        checkpoint.parent_checkpoint_id ?? null,
        checkpoint.label ?? null,
        checkpoint.snapshot_path ?? null,
        checkpoint.summary ?? null,
        checkpoint.created_at || now
      );

      log.debug(COMPONENT, 'Checkpoint saved', {
        checkpointId: id,
        agentId: checkpoint.agent_id,
        meshInstance: checkpoint.mesh_instance
      });

      return id;
    } catch (err) {
      log.error(COMPONENT, 'Failed to save checkpoint', {
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  /**
   * Get a checkpoint by ID
   */
  get(id: string): CheckpointRecord | null {
    const row = this.getCheckpointStmt.get(id) as CheckpointRow | undefined;
    if (!row) return null;
    return this.rowToCheckpoint(row);
  }

  /**
   * List checkpoints for a mesh instance
   */
  listForMesh(meshInstance: string): CheckpointRecord[] {
    const rows = this.listByMeshStmt.all(meshInstance) as CheckpointRow[];
    return rows.map(row => this.rowToCheckpoint(row));
  }

  /**
   * List checkpoints for an agent
   */
  listForAgent(agentId: string): CheckpointRecord[] {
    const rows = this.listByAgentStmt.all(agentId) as CheckpointRow[];
    return rows.map(row => this.rowToCheckpoint(row));
  }

  /**
   * Get immediate children of a checkpoint
   */
  children(parentId: string): CheckpointRecord[] {
    const rows = this.getChildrenStmt.all(parentId) as CheckpointRow[];
    return rows.map(row => this.rowToCheckpoint(row));
  }

  /**
   * Build full tree structure from a root checkpoint
   */
  tree(rootId: string): CheckpointNode | null {
    const root = this.get(rootId);
    if (!root) return null;

    return this.buildNode(root);
  }

  /**
   * Count total forks (descendants) from a checkpoint
   */
  totalForks(fromId: string): number {
    const node = this.tree(fromId);
    if (!node) return 0;

    return this.countDescendants(node);
  }

  /**
   * Garbage collect checkpoints based on retention policy
   * Removes checkpoints older than specified days and their orphaned snapshots
   */
  gc(olderThanDays: number): void {
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    try {
      // Get checkpoints to delete with snapshot paths
      const toDelete = this.db.prepare(
        'SELECT id, snapshot_path FROM agent_checkpoints WHERE created_at < ?'
      ).all(cutoff) as Array<{ id: string; snapshot_path: string | null }>;

      if (toDelete.length === 0) {
        log.debug(COMPONENT, 'GC: No checkpoints to remove', { olderThanDays });
        return;
      }

      // Delete checkpoints from database
      const placeholders = toDelete.map(() => '?').join(',');
      const ids = toDelete.map(c => c.id);

      const result = this.db.prepare(
        `DELETE FROM agent_checkpoints WHERE id IN (${placeholders})`
      ).run(...ids);

      // Remove orphaned snapshot files
      let snapshotsRemoved = 0;
      for (const { snapshot_path } of toDelete) {
        if (snapshot_path && fs.existsSync(snapshot_path)) {
          try {
            fs.unlinkSync(snapshot_path);
            snapshotsRemoved++;
          } catch (err) {
            log.warn(COMPONENT, 'Failed to remove snapshot file', {
              snapshotPath: snapshot_path,
              error: err instanceof Error ? err.message : String(err)
            });
          }
        }
      }

      log.info(COMPONENT, 'GC complete', {
        olderThanDays,
        checkpointsRemoved: result.changes,
        snapshotsRemoved
      });
    } catch (err) {
      log.error(COMPONENT, 'GC failed', {
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Generate unique checkpoint ID
   */
  private generateId(): string {
    return `ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Convert database row to CheckpointRecord
   */
  private rowToCheckpoint(row: CheckpointRow): CheckpointRecord {
    return {
      id: row.id,
      mesh_instance: row.mesh_instance,
      agent_id: row.agent_id,
      conversation_id: row.conversation_id,
      parent_checkpoint_id: row.parent_checkpoint_id,
      label: row.label,
      snapshot_path: row.snapshot_path,
      summary: row.summary,
      created_at: row.created_at
    };
  }

  /**
   * Build a tree node with all descendants
   */
  private buildNode(checkpoint: CheckpointRecord): CheckpointNode {
    const children = this.children(checkpoint.id);
    return {
      checkpoint,
      children: children.map(child => this.buildNode(child))
    };
  }

  /**
   * Count descendants recursively
   */
  private countDescendants(node: CheckpointNode): number {
    let count = node.children.length;
    for (const child of node.children) {
      count += this.countDescendants(child);
    }
    return count;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
    log.debug(COMPONENT, 'AgentCheckpointStore closed');
  }

  /**
   * Get underlying database instance (for testing)
   */
  getDb(): Database.Database {
    return this.db;
  }
}
