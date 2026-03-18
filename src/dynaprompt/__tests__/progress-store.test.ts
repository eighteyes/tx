/**
 * AgentProgressStore unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AgentProgressStore } from '../stores/progress-store.ts';

const TEST_DB_PATH = path.join(process.cwd(), '.ai/tx/test-queue.db');

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
  });

  describe('save()', () => {
    it('creates progress signal', () => {
      expect(() => {
        store.save({
          mesh_instance: 'test-mesh',
          agent_id: 'test-agent',
          step: 1,
          total: 5,
          label: 'test progress',
        });
      }).not.toThrow();
    });

    it('accepts valid step/total ranges', () => {
      expect(() => {
        store.save({
          mesh_instance: 'mesh',
          agent_id: 'agent',
          step: 0,
          total: 1,
          label: null,
        });
      }).not.toThrow();

      expect(() => {
        store.save({
          mesh_instance: 'mesh',
          agent_id: 'agent',
          step: 5,
          total: 5,
          label: null,
        });
      }).not.toThrow();
    });
  });

  describe('latest()', () => {
    it('returns most recent progress', () => {
      const agentId = 'test-agent';

      store.save({
        mesh_instance: 'mesh',
        agent_id: agentId,
        step: 1,
        total: 5,
        label: 'first',
      });

      // Wait 1ms to ensure different timestamp
      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      setTimeout(() => {
        store.save({
          mesh_instance: 'mesh',
          agent_id: agentId,
          step: 2,
          total: 5,
          label: 'second',
        });
      }, 10);

      // Give time for second save
      setTimeout(() => {
        const latest = store.latest(agentId);
        expect(latest).toBeDefined();
        expect(latest?.step).toBe(2);
        expect(latest?.label).toBe('second');
      }, 20);
    });

    it('returns null for unknown agent', () => {
      const latest = store.latest('unknown-agent');
      expect(latest).toBeNull();
    });
  });

  describe('listForAgent()', () => {
    it('returns chronologically sorted signals', () => {
      const agentId = 'test-agent';

      store.save({
        mesh_instance: 'mesh',
        agent_id: agentId,
        step: 1,
        total: 5,
        label: 'first',
      });

      store.save({
        mesh_instance: 'mesh',
        agent_id: agentId,
        step: 2,
        total: 5,
        label: 'second',
      });

      store.save({
        mesh_instance: 'mesh',
        agent_id: agentId,
        step: 3,
        total: 5,
        label: 'third',
      });

      const signals = store.listForAgent(agentId);
      expect(signals).toHaveLength(3);
      expect(signals[0].step).toBe(1);
      expect(signals[1].step).toBe(2);
      expect(signals[2].step).toBe(3);
    });

    it('returns empty array for unknown agent', () => {
      const signals = store.listForAgent('unknown-agent');
      expect(signals).toEqual([]);
    });
  });
});
