/**
 * FSM Persistence Test
 *
 * Tests the SQLite persistence layer for FSM state management.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { FSMPersistence, type FSMStateData } from '../../../src/mesh/fsm-persistence.ts';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.ts';

describe('FSMPersistence', () => {
  let env: TestEnv;
  let db: Database.Database;
  let persistence: FSMPersistence;

  before(async () => {
    env = createTestEnv('tx-fsm-persistence');
    db = new Database(env.dbPath);
    db.pragma('journal_mode = WAL');
    persistence = new FSMPersistence(db);
  });

  after(async () => {
    if (db) db.close();
    env.cleanup();
  });

  describe('initialization', () => {
    it('should initialize mesh_state tables', () => {
      persistence.initialize();

      // Check that tables exist
      const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mesh_state', 'mesh_state_backup')`
      ).all() as Array<{ name: string }>;

      assert.ok(tables.some(t => t.name === 'mesh_state'), 'mesh_state table should exist');
      assert.ok(tables.some(t => t.name === 'mesh_state_backup'), 'mesh_state_backup table should exist');
    });

    it('should be idempotent', () => {
      // Should not throw when called multiple times
      persistence.initialize();
      persistence.initialize();
    });
  });

  describe('state management', () => {
    const testMesh = 'test-mesh-1';

    it('should return null for non-existent state', () => {
      const state = persistence.getState('non-existent-mesh');
      assert.strictEqual(state, null);
    });

    it('should save and retrieve state', () => {
      const state: FSMStateData = {
        meshName: testMesh,
        currentState: 'planning',
        context: { feature: 'test-feature', priority: 'high' },
        gateRetries: {},
        lastTransitionAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      persistence.saveState(state);
      const retrieved = persistence.getState(testMesh);

      assert.ok(retrieved, 'State should be retrieved');
      assert.strictEqual(retrieved.meshName, testMesh);
      assert.strictEqual(retrieved.currentState, 'planning');
      assert.deepStrictEqual(retrieved.context, { feature: 'test-feature', priority: 'high' });
    });

    it('should update existing state', () => {
      const updatedState: FSMStateData = {
        meshName: testMesh,
        currentState: 'implementation',
        context: { feature: 'test-feature', priority: 'high', phase: 2 },
        gateRetries: { implementation: 1 },
        lastTransitionAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      persistence.saveState(updatedState);
      const retrieved = persistence.getState(testMesh);

      assert.ok(retrieved);
      assert.strictEqual(retrieved.currentState, 'implementation');
      assert.deepStrictEqual(retrieved.gateRetries, { implementation: 1 });
    });

    it('should create backup before update', () => {
      // The previous update should have created a backup
      const backups = persistence.getBackups(testMesh);
      assert.ok(backups.length > 0, 'Should have at least one backup');
      assert.strictEqual(backups[0].reason, 'pre-update');
    });

    it('should delete state with final backup', () => {
      persistence.deleteState(testMesh);

      const state = persistence.getState(testMesh);
      assert.strictEqual(state, null, 'State should be deleted');

      const backups = persistence.getBackups(testMesh);
      assert.ok(backups.some(b => b.reason === 'pre-delete'), 'Should have pre-delete backup');
    });
  });

  describe('backup and restore', () => {
    const testMesh = 'test-mesh-backup';

    it('should create explicit backup', () => {
      const state: FSMStateData = {
        meshName: testMesh,
        currentState: 'initial',
        context: {},
        gateRetries: {},
        lastTransitionAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      persistence.saveState(state);
      persistence.createBackup(testMesh, 'manual-backup');

      const backups = persistence.getBackups(testMesh);
      assert.ok(backups.some(b => b.reason === 'manual-backup'), 'Should have manual backup');
    });

    it('should restore from backup', () => {
      // Update state to something different
      const state: FSMStateData = {
        meshName: testMesh,
        currentState: 'corrupted',
        context: { error: true },
        gateRetries: {},
        lastTransitionAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      persistence.saveState(state);

      // Restore from backup
      const restored = persistence.restoreFromBackup(testMesh);

      assert.ok(restored, 'Should restore from backup');
      // Note: restored state should be from before the 'corrupted' state
      assert.notStrictEqual(restored.currentState, 'corrupted');
    });

    it('should cleanup old backups', () => {
      // Create multiple updates to generate backups
      for (let i = 0; i < 10; i++) {
        const state: FSMStateData = {
          meshName: testMesh,
          currentState: `state-${i}`,
          context: {},
          gateRetries: {},
          lastTransitionAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        persistence.saveState(state);
      }

      const deleted = persistence.cleanupBackups(testMesh, 3);
      assert.ok(deleted > 0, 'Should delete some backups');

      const remaining = persistence.getBackups(testMesh);
      assert.ok(remaining.length <= 3, 'Should keep at most 3 backups');
    });
  });

  describe('gate retries', () => {
    const testMesh = 'test-mesh-retries';

    it('should update gate retry count', () => {
      const state: FSMStateData = {
        meshName: testMesh,
        currentState: 'implementing',
        context: {},
        gateRetries: {},
        lastTransitionAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      persistence.saveState(state);
      persistence.updateGateRetries(testMesh, 'implementing', 2);

      const retrieved = persistence.getState(testMesh);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.gateRetries['implementing'], 2);
    });
  });
});
