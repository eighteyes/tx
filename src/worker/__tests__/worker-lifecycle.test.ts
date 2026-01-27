/**
 * WorkerLifecycleManager tests
 *
 * Tests active worker tracking and lifecycle management.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { WorkerLifecycleManager } from '../worker-lifecycle.ts';
import { WorkerStateMachine } from '../../state-machine/index.ts';
import type { WorkerConfig } from '../../shared/types.ts';
import type { HookContext } from '../hooks.ts';

// Mock SdkRunner since we don't want to test actual SDK interaction
class MockSdkRunner {
  private killed = false;

  kill(reason: string): void {
    this.killed = reason !== '';
  }

  isKilled(): boolean {
    return this.killed;
  }
}

describe('WorkerLifecycleManager', () => {
  const testDir = path.join(process.cwd(), '.test-worker-lifecycle');
  const stateFile = path.join(testDir, 'workers.json');
  let manager: WorkerLifecycleManager;

  beforeEach(() => {
    // Create test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    manager = new WorkerLifecycleManager(stateFile);
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Helper to create mock worker data
  function createMockWorkerData(agentId: string) {
    const workerConfig: WorkerConfig = {
      id: agentId,
      model: 'sonnet',
      prompt: 'test prompt',
      workDir: testDir,
    };
    const machine = new WorkerStateMachine(agentId, workerConfig, 'test', 'agent', 60000, false);
    const hookContext: HookContext = {
      meshInstance: 'test-1',
      meshName: 'test',
      agentName: 'agent',
      workDir: testDir,
      agentId,
      agentConfig: { name: 'agent', model: 'sonnet', prompt: 'test' },
      taskId: 'task-1',
      taskBody: 'test task',
      msgsDir: testDir,
    };

    return {
      runner: new MockSdkRunner() as unknown as import('../sdk-runner.ts').SdkRunner,
      machine,
      startedAt: Date.now(),
      hookContext,
    };
  }

  describe('add()', () => {
    it('should add a worker and return workerId', () => {
      const workerId = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      assert.ok(workerId.startsWith('mesh/agent-'));
      assert.strictEqual(manager.hasWorkers('mesh/agent'), true);
    });

    it('should track taskFrom', () => {
      const workerId = manager.add('mesh/agent', createMockWorkerData('mesh/agent'), 'core/core');

      const result = manager.getByWorkerId(workerId);
      assert.strictEqual(result?.worker.taskFrom, 'core/core');
    });

    it('should support multiple workers for same agent', () => {
      const workerId1 = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));
      const workerId2 = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      assert.notStrictEqual(workerId1, workerId2);
      assert.strictEqual(manager.getForAgent('mesh/agent').length, 2);
    });
  });

  describe('remove()', () => {
    it('should remove a worker by workerId', () => {
      const workerId = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      const removed = manager.remove('mesh/agent', workerId);

      assert.strictEqual(removed, true);
      assert.strictEqual(manager.hasWorkers('mesh/agent'), false);
    });

    it('should return false if worker not found', () => {
      manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      const removed = manager.remove('mesh/agent', 'nonexistent-id');

      assert.strictEqual(removed, false);
    });

    it('should keep other workers when one is removed', () => {
      const workerId1 = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));
      const workerId2 = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      manager.remove('mesh/agent', workerId1);

      assert.strictEqual(manager.getForAgent('mesh/agent').length, 1);
      assert.strictEqual(manager.getForAgent('mesh/agent')[0].workerId, workerId2);
    });
  });

  describe('getByWorkerId()', () => {
    it('should find worker by workerId', () => {
      const workerId = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      const result = manager.getByWorkerId(workerId);

      assert.ok(result);
      assert.strictEqual(result.agentId, 'mesh/agent');
      assert.strictEqual(result.worker.workerId, workerId);
    });

    it('should return undefined if not found', () => {
      const result = manager.getByWorkerId('nonexistent');
      assert.strictEqual(result, undefined);
    });
  });

  describe('getFirst()', () => {
    it('should return first worker for agent', () => {
      const workerId1 = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));
      manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      const first = manager.getFirst('mesh/agent');

      assert.ok(first);
      assert.strictEqual(first.workerId, workerId1);
    });

    it('should return undefined if no workers', () => {
      const first = manager.getFirst('mesh/agent');
      assert.strictEqual(first, undefined);
    });
  });

  describe('trackMessage()', () => {
    it('should track messages sent by workers', () => {
      const workerId = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      manager.trackMessage('mesh/agent', 'mesh/other', 'task', '/path/to/msg.md');

      const worker = manager.getByWorkerId(workerId)?.worker;
      assert.strictEqual(worker?.messagesSent.length, 1);
      assert.deepStrictEqual(worker?.messagesSent[0], {
        to: 'mesh/other',
        type: 'task',
        filepath: '/path/to/msg.md',
      });
    });

    it('should not throw if no active worker', () => {
      // Should not throw
      manager.trackMessage('mesh/agent', 'mesh/other', 'task');
    });
  });

  describe('getCount()', () => {
    it('should return total worker count', () => {
      assert.strictEqual(manager.getCount(), 0);

      manager.add('mesh/agent1', createMockWorkerData('mesh/agent1'));
      assert.strictEqual(manager.getCount(), 1);

      manager.add('mesh/agent1', createMockWorkerData('mesh/agent1'));
      assert.strictEqual(manager.getCount(), 2);

      manager.add('mesh/agent2', createMockWorkerData('mesh/agent2'));
      assert.strictEqual(manager.getCount(), 3);
    });
  });

  describe('getAgentIds()', () => {
    it('should return agent IDs with workers', () => {
      manager.add('mesh/agent1', createMockWorkerData('mesh/agent1'));
      manager.add('mesh/agent2', createMockWorkerData('mesh/agent2'));

      const ids = manager.getAgentIds();

      assert.deepStrictEqual(ids.sort(), ['mesh/agent1', 'mesh/agent2']);
    });
  });

  describe('getAllWorkerIds()', () => {
    it('should return all worker IDs', () => {
      const w1 = manager.add('mesh/agent1', createMockWorkerData('mesh/agent1'));
      const w2 = manager.add('mesh/agent1', createMockWorkerData('mesh/agent1'));
      const w3 = manager.add('mesh/agent2', createMockWorkerData('mesh/agent2'));

      const ids = manager.getAllWorkerIds();

      assert.deepStrictEqual(ids.sort(), [w1, w2, w3].sort());
    });
  });

  describe('killForAgent()', () => {
    it('should kill all workers for agent', () => {
      manager.add('mesh/agent', createMockWorkerData('mesh/agent'));
      manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      const killed = manager.killForAgent('mesh/agent', 'test reason');

      assert.strictEqual(killed, 2);
      assert.strictEqual(manager.hasWorkers('mesh/agent'), false);
    });
  });

  describe('killAll()', () => {
    it('should kill all workers', () => {
      manager.add('mesh/agent1', createMockWorkerData('mesh/agent1'));
      manager.add('mesh/agent2', createMockWorkerData('mesh/agent2'));

      manager.killAll('shutdown');

      assert.strictEqual(manager.getCount(), 0);
    });
  });

  describe('writeState()', () => {
    it('should write state to file', async () => {
      const workerId = manager.add('mesh/agent', createMockWorkerData('mesh/agent'));

      manager.writeState();

      assert.ok(fs.existsSync(stateFile));
      const content = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      assert.ok(content.workers);
      assert.ok(content.updatedAt);
      assert.strictEqual(content.workers[0].id, workerId);
    });
  });
});
