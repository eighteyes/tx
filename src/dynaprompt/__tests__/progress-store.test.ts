/**
 * AgentProgressStore unit tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { AgentProgressStore } from '../stores/progress-store.ts';

const TEST_DB_PATH = path.join(process.cwd(), '.ai/tx/test-progress-store.db');

describe('AgentProgressStore', () => {
  let store: AgentProgressStore;

  beforeEach(() => {
    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-shm`);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    }

    store = new AgentProgressStore(TEST_DB_PATH);
  });

  afterEach(() => {
    store.close();

    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-shm`);
    }
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) {
      fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    }
  });

  describe('save()', () => {
    it('creates progress signal', () => {
      assert.doesNotThrow(() => {
        store.save({
          mesh_instance: 'test-mesh',
          agent_id: 'test-agent',
          step: 1,
          total: 5,
          label: 'test progress',
        });
      });
    });

    it('accepts valid step/total ranges', () => {
      assert.doesNotThrow(() => {
        store.save({
          mesh_instance: 'mesh',
          agent_id: 'agent',
          step: 0,
          total: 1,
          label: null,
        });
      });

      assert.doesNotThrow(() => {
        store.save({
          mesh_instance: 'mesh',
          agent_id: 'agent',
          step: 5,
          total: 5,
          label: null,
        });
      });
    });
  });

  describe('latest()', () => {
    it('returns most recent progress', async () => {
      const agentId = 'test-agent';

      store.save({
        mesh_instance: 'mesh',
        agent_id: agentId,
        step: 1,
        total: 5,
        label: 'first',
      });

      // Wait 1ms to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      store.save({
        mesh_instance: 'mesh',
        agent_id: agentId,
        step: 2,
        total: 5,
        label: 'second',
      });

      const latest = store.latest(agentId);
      assert.ok(latest);
      assert.strictEqual(latest?.step, 2);
      assert.strictEqual(latest?.label, 'second');
    });

    it('returns null for unknown agent', () => {
      const latest = store.latest('unknown-agent');
      assert.strictEqual(latest, null);
    });
  });

  describe('listForAgent()', () => {
    it('returns chronologically sorted signals', async () => {
      const agentId = 'test-agent-list';

      store.save({
        mesh_instance: 'mesh',
        agent_id: agentId,
        step: 1,
        total: 5,
        label: 'first',
      });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 5));

      store.save({
        mesh_instance: 'mesh',
        agent_id: agentId,
        step: 2,
        total: 5,
        label: 'second',
      });

      await new Promise(resolve => setTimeout(resolve, 5));

      store.save({
        mesh_instance: 'mesh',
        agent_id: agentId,
        step: 3,
        total: 5,
        label: 'third',
      });

      const signals = store.listForAgent(agentId);
      assert.strictEqual(signals.length, 3);
      assert.strictEqual(signals[0].step, 1);
      assert.strictEqual(signals[1].step, 2);
      assert.strictEqual(signals[2].step, 3);
    });

    it('returns empty array for unknown agent', () => {
      const signals = store.listForAgent('unknown-agent');
      assert.deepStrictEqual(signals, []);
    });
  });
});
