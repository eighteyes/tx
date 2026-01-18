/**
 * FSMPersistence - SQLite persistence layer for mesh FSM state
 *
 * Provides:
 * - State save/load with backup before update
 * - State restore from backup on corruption
 * - Transaction support for atomicity
 *
 * Follows existing MessageQueue patterns:
 * - WAL mode for concurrency
 * - Prepared statements for performance
 * - Transactions for atomicity
 */

import type Database from 'better-sqlite3';
import { log } from '../shared/logger.ts';

/**
 * FSM state data stored in SQLite
 */
export interface FSMStateData {
  meshName: string;
  currentState: string;
  context: Record<string, unknown>;
  gateRetries: Record<string, number>;  // state -> retry count
  lastTransitionAt: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Backup record for state recovery
 */
export interface FSMStateBackup {
  id: number;
  meshName: string;
  stateData: FSMStateData;
  reason: string;
  createdAt: number;
}

export class FSMPersistence {
  private db: Database.Database;
  private initialized = false;

  // Prepared statements (cached for performance)
  private getStateStmt: Database.Statement | null = null;
  private upsertStateStmt: Database.Statement | null = null;
  private deleteStateStmt: Database.Statement | null = null;
  private insertBackupStmt: Database.Statement | null = null;
  private getLatestBackupStmt: Database.Statement | null = null;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Initialize the FSM state tables
   * Safe to call multiple times (uses IF NOT EXISTS)
   */
  initialize(): void {
    if (this.initialized) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mesh_state (
        mesh_name TEXT PRIMARY KEY,
        current_state TEXT NOT NULL,
        context JSON NOT NULL DEFAULT '{}',
        gate_retries JSON NOT NULL DEFAULT '{}',
        last_transition_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mesh_state_backup (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mesh_name TEXT NOT NULL,
        state_data JSON NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_backup_mesh ON mesh_state_backup(mesh_name, created_at DESC);
    `);

    // Prepare statements for performance
    this.getStateStmt = this.db.prepare(`
      SELECT mesh_name, current_state, context, gate_retries, last_transition_at, created_at, updated_at
      FROM mesh_state
      WHERE mesh_name = ?
    `);

    this.upsertStateStmt = this.db.prepare(`
      INSERT INTO mesh_state (mesh_name, current_state, context, gate_retries, last_transition_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mesh_name) DO UPDATE SET
        current_state = excluded.current_state,
        context = excluded.context,
        gate_retries = excluded.gate_retries,
        last_transition_at = excluded.last_transition_at,
        updated_at = excluded.updated_at
    `);

    this.deleteStateStmt = this.db.prepare(`
      DELETE FROM mesh_state WHERE mesh_name = ?
    `);

    this.insertBackupStmt = this.db.prepare(`
      INSERT INTO mesh_state_backup (mesh_name, state_data, reason, created_at)
      VALUES (?, ?, ?, ?)
    `);

    this.getLatestBackupStmt = this.db.prepare(`
      SELECT id, mesh_name, state_data, reason, created_at
      FROM mesh_state_backup
      WHERE mesh_name = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    this.initialized = true;
    log.debug('fsm-persistence', 'Initialized mesh_state tables');
  }

  /**
   * Get current FSM state for a mesh
   * Returns null if no state exists
   */
  getState(meshName: string): FSMStateData | null {
    this.ensureInitialized();

    const row = this.getStateStmt!.get(meshName) as {
      mesh_name: string;
      current_state: string;
      context: string;
      gate_retries: string;
      last_transition_at: number;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) return null;

    try {
      return {
        meshName: row.mesh_name,
        currentState: row.current_state,
        context: JSON.parse(row.context),
        gateRetries: JSON.parse(row.gate_retries),
        lastTransitionAt: row.last_transition_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      log.error('fsm-persistence', 'Failed to parse state data, attempting restore', {
        meshName,
        error: (error as Error).message,
      });
      // State corrupted, try to restore from backup
      return this.restoreFromBackup(meshName);
    }
  }

  /**
   * Save FSM state with automatic backup
   * Creates backup of previous state before update
   */
  saveState(state: FSMStateData): void {
    this.ensureInitialized();

    const now = Date.now();

    // Run in transaction for atomicity
    const transaction = this.db.transaction(() => {
      // Get existing state for backup
      const existing = this.getState(state.meshName);
      if (existing) {
        // Create backup before update
        this.insertBackupStmt!.run(
          state.meshName,
          JSON.stringify(existing),
          'pre-update',
          now
        );
      }

      // Upsert the new state
      this.upsertStateStmt!.run(
        state.meshName,
        state.currentState,
        JSON.stringify(state.context),
        JSON.stringify(state.gateRetries),
        state.lastTransitionAt || now,
        existing?.createdAt || now,
        now
      );
    });

    try {
      transaction();
      log.debug('fsm-persistence', 'Saved FSM state', {
        meshName: state.meshName,
        currentState: state.currentState,
      });
    } catch (error) {
      log.error('fsm-persistence', 'Failed to save FSM state', {
        meshName: state.meshName,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Delete FSM state for a mesh (with final backup)
   */
  deleteState(meshName: string): void {
    this.ensureInitialized();

    const transaction = this.db.transaction(() => {
      // Create final backup before delete
      const existing = this.getState(meshName);
      if (existing) {
        this.insertBackupStmt!.run(
          meshName,
          JSON.stringify(existing),
          'pre-delete',
          Date.now()
        );
      }

      this.deleteStateStmt!.run(meshName);
    });

    try {
      transaction();
      log.info('fsm-persistence', 'Deleted FSM state', { meshName });
    } catch (error) {
      log.error('fsm-persistence', 'Failed to delete FSM state', {
        meshName,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create explicit backup of current state
   * Used before risky operations
   */
  createBackup(meshName: string, reason: string): void {
    this.ensureInitialized();

    const existing = this.getState(meshName);
    if (!existing) {
      log.warn('fsm-persistence', 'Cannot backup non-existent state', { meshName });
      return;
    }

    try {
      this.insertBackupStmt!.run(
        meshName,
        JSON.stringify(existing),
        reason,
        Date.now()
      );
      log.info('fsm-persistence', 'Created state backup', { meshName, reason });
    } catch (error) {
      log.error('fsm-persistence', 'Failed to create backup', {
        meshName,
        reason,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Restore state from latest backup
   * Returns restored state or null if no backup exists
   */
  restoreFromBackup(meshName: string): FSMStateData | null {
    this.ensureInitialized();

    const row = this.getLatestBackupStmt!.get(meshName) as {
      id: number;
      mesh_name: string;
      state_data: string;
      reason: string;
      created_at: number;
    } | undefined;

    if (!row) {
      log.warn('fsm-persistence', 'No backup found for restore', { meshName });
      return null;
    }

    try {
      const stateData = JSON.parse(row.state_data) as FSMStateData;

      // Restore the backup as current state
      this.upsertStateStmt!.run(
        stateData.meshName,
        stateData.currentState,
        JSON.stringify(stateData.context),
        JSON.stringify(stateData.gateRetries),
        stateData.lastTransitionAt,
        stateData.createdAt,
        Date.now()
      );

      log.info('fsm-persistence', 'Restored state from backup', {
        meshName,
        backupId: row.id,
        backupReason: row.reason,
        backupCreatedAt: new Date(row.created_at).toISOString(),
      });

      return stateData;
    } catch (error) {
      log.error('fsm-persistence', 'Failed to restore from backup', {
        meshName,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Get all backups for a mesh (for debugging)
   */
  getBackups(meshName: string, limit = 10): FSMStateBackup[] {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      SELECT id, mesh_name, state_data, reason, created_at
      FROM mesh_state_backup
      WHERE mesh_name = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(meshName, limit) as Array<{
      id: number;
      mesh_name: string;
      state_data: string;
      reason: string;
      created_at: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      meshName: row.mesh_name,
      stateData: JSON.parse(row.state_data),
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  /**
   * Clean up old backups (keep last N per mesh)
   */
  cleanupBackups(meshName: string, keepCount = 5): number {
    this.ensureInitialized();

    const stmt = this.db.prepare(`
      DELETE FROM mesh_state_backup
      WHERE mesh_name = ? AND id NOT IN (
        SELECT id FROM mesh_state_backup
        WHERE mesh_name = ?
        ORDER BY created_at DESC
        LIMIT ?
      )
    `);

    const result = stmt.run(meshName, meshName, keepCount);

    if (result.changes > 0) {
      log.debug('fsm-persistence', 'Cleaned up old backups', {
        meshName,
        deleted: result.changes,
        kept: keepCount,
      });
    }

    return result.changes;
  }

  /**
   * Update gate retry count for a state
   */
  updateGateRetries(meshName: string, stateName: string, retryCount: number): void {
    this.ensureInitialized();

    const existing = this.getState(meshName);
    if (!existing) {
      log.warn('fsm-persistence', 'Cannot update retries for non-existent state', { meshName });
      return;
    }

    existing.gateRetries[stateName] = retryCount;
    existing.updatedAt = Date.now();

    // Direct update without full backup (retry count is low-risk)
    this.db.prepare(`
      UPDATE mesh_state
      SET gate_retries = ?, updated_at = ?
      WHERE mesh_name = ?
    `).run(
      JSON.stringify(existing.gateRetries),
      existing.updatedAt,
      meshName
    );

    log.debug('fsm-persistence', 'Updated gate retries', {
      meshName,
      stateName,
      retryCount,
    });
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }
}
