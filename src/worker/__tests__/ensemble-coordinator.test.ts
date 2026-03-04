/**
 * EnsembleCoordinator tests
 *
 * Tests ensemble orchestration including the Phase 2 extracted methods.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { EnsembleCoordinator } from '../ensemble-coordinator.ts';
import type { EnsembleConfig } from '../../shared/types.ts';

// Test fixture directory
const TEST_DIR = path.join(process.cwd(), '.ai', 'tmp', 'ensemble-test');
const TEST_MSGS_DIR = path.join(TEST_DIR, 'msgs');

function setup(): void {
  fs.mkdirSync(TEST_MSGS_DIR, { recursive: true });
}

function teardown(): void {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Mock Message type
const createMockMessage = (content: string = 'Test task') => ({
  id: 1,
  to_agent: 'test/agent',
  from_agent: 'core/core',
  type: 'task' as const,
  content,
  status: 'pending' as const,
  created_at: Date.now(),
  updated_at: Date.now(),
  payload: {
    headline: 'Test task',
    body: content,
  },
});

describe('EnsembleCoordinator', () => {
  let coordinator: EnsembleCoordinator;

  beforeEach(() => {
    setup();
    coordinator = new EnsembleCoordinator();
  });

  afterEach(() => {
    teardown();
  });

  describe('startEnsemble()', () => {
    it('should start an ensemble and return an ID', () => {
      const config: EnsembleConfig = {
        agents: ['agent1', 'agent2'],
        aggregation_strategy: 'concat',
      };

      const ensembleId = coordinator.startEnsemble('test-mesh', config, createMockMessage());

      assert.ok(ensembleId);
      assert.ok(ensembleId.includes('test-mesh'));
    });

    it('should track ensemble state', () => {
      const config: EnsembleConfig = {
        agents: ['agent1', 'agent2'],
        aggregation_strategy: 'concat',
      };

      const ensembleId = coordinator.startEnsemble('test-mesh', config, createMockMessage());
      const state = coordinator.getEnsembleState(ensembleId);

      assert.ok(state);
      assert.strictEqual(state.meshName, 'test-mesh');
      assert.strictEqual(state.config.agents.length, 2);
    });
  });

  describe('recordAgentResult()', () => {
    it('should record agent results', () => {
      const config: EnsembleConfig = {
        agents: ['agent1', 'agent2'],
        aggregation_strategy: 'concat',
      };

      const ensembleId = coordinator.startEnsemble('test-mesh', config, createMockMessage());
      coordinator.registerAgentStart(ensembleId, 'agent1');

      const result = coordinator.recordAgentResult(ensembleId, 'agent1', 'Result content');

      assert.strictEqual(result.isComplete, false);  // Only 1 of 2 agents complete
    });

    it('should indicate completion when all agents finish', () => {
      const config: EnsembleConfig = {
        agents: ['agent1', 'agent2'],
        aggregation_strategy: 'concat',
      };

      const ensembleId = coordinator.startEnsemble('test-mesh', config, createMockMessage());

      coordinator.recordAgentResult(ensembleId, 'agent1', 'Result 1');
      const result = coordinator.recordAgentResult(ensembleId, 'agent2', 'Result 2');

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.shouldAggregate, true);
    });

    it('should handle N-same pattern (same agent spawned N times) with ensembleIndex', () => {
      // N-same: 4 runners all named "runner"
      const config: EnsembleConfig = {
        agents: ['runner', 'runner', 'runner', 'runner'],
        aggregation_strategy: 'concat',
      };

      const ensembleId = coordinator.startEnsemble('test-mesh', config, createMockMessage());

      // Each call uses ensembleIndex to create unique keys
      coordinator.recordAgentResult(ensembleId, 'runner', 'Result 0', undefined, 0);
      assert.strictEqual(coordinator.isComplete(ensembleId), false);

      coordinator.recordAgentResult(ensembleId, 'runner', 'Result 1', undefined, 1);
      assert.strictEqual(coordinator.isComplete(ensembleId), false);

      coordinator.recordAgentResult(ensembleId, 'runner', 'Result 2', undefined, 2);
      assert.strictEqual(coordinator.isComplete(ensembleId), false);

      const result = coordinator.recordAgentResult(ensembleId, 'runner', 'Result 3', undefined, 3);
      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.shouldAggregate, true);

      // Verify all 4 results are tracked (not overwritten)
      const state = coordinator.getEnsembleState(ensembleId);
      assert.ok(state);
      assert.strictEqual(state.agentResults.size, 4);
    });

    it('should fail N-same without ensembleIndex (Map key collision)', () => {
      // Demonstrates the old bug: without ensembleIndex, all results overwrite
      const config: EnsembleConfig = {
        agents: ['runner', 'runner', 'runner', 'runner'],
        aggregation_strategy: 'concat',
      };

      const ensembleId = coordinator.startEnsemble('test-mesh', config, createMockMessage());

      // Without ensembleIndex, agent name is the key — all overwrite
      coordinator.recordAgentResult(ensembleId, 'runner', 'Result 0');
      coordinator.recordAgentResult(ensembleId, 'runner', 'Result 1');
      coordinator.recordAgentResult(ensembleId, 'runner', 'Result 2');
      const result = coordinator.recordAgentResult(ensembleId, 'runner', 'Result 3');

      // Only 1 entry in the map — N-same without index doesn't complete
      const state = coordinator.getEnsembleState(ensembleId);
      assert.ok(state);
      assert.strictEqual(state.agentResults.size, 1);
      assert.strictEqual(result.isComplete, false);
    });
  });

  describe('isComplete()', () => {
    it('should return false when not all agents complete', () => {
      const config: EnsembleConfig = {
        agents: ['agent1', 'agent2'],
        aggregation_strategy: 'concat',
      };

      const ensembleId = coordinator.startEnsemble('test-mesh', config, createMockMessage());
      coordinator.recordAgentResult(ensembleId, 'agent1', 'Result 1');

      assert.strictEqual(coordinator.isComplete(ensembleId), false);
    });

    it('should return true when all agents complete', () => {
      const config: EnsembleConfig = {
        agents: ['agent1', 'agent2'],
        aggregation_strategy: 'concat',
      };

      const ensembleId = coordinator.startEnsemble('test-mesh', config, createMockMessage());
      coordinator.recordAgentResult(ensembleId, 'agent1', 'Result 1');
      coordinator.recordAgentResult(ensembleId, 'agent2', 'Result 2');

      assert.strictEqual(coordinator.isComplete(ensembleId), true);
    });
  });

  describe('completeEnsemble()', () => {
    it('should clean up ensemble state', () => {
      const config: EnsembleConfig = {
        agents: ['agent1'],
        aggregation_strategy: 'concat',
      };

      const ensembleId = coordinator.startEnsemble('test-mesh', config, createMockMessage());
      assert.ok(coordinator.getEnsembleState(ensembleId));

      coordinator.completeEnsemble(ensembleId);

      assert.strictEqual(coordinator.getEnsembleState(ensembleId), undefined);
    });
  });

  describe('getActiveEnsembleCount()', () => {
    it('should return count of active ensembles', () => {
      const config: EnsembleConfig = {
        agents: ['agent1'],
        aggregation_strategy: 'concat',
      };

      assert.strictEqual(coordinator.getActiveEnsembleCount(), 0);

      const id1 = coordinator.startEnsemble('mesh1', config, createMockMessage());
      assert.strictEqual(coordinator.getActiveEnsembleCount(), 1);

      const id2 = coordinator.startEnsemble('mesh2', config, createMockMessage());
      assert.strictEqual(coordinator.getActiveEnsembleCount(), 2);

      coordinator.completeEnsemble(id1);
      assert.strictEqual(coordinator.getActiveEnsembleCount(), 1);
    });
  });

  // Phase 2 extraction tests

  describe('resolveEnsembleCount()', () => {
    it('should return literal number', () => {
      // Mock FSM
      const mockFsm = { getContext: () => ({}) } as any;

      assert.strictEqual(coordinator.resolveEnsembleCount(5, mockFsm), 5);
    });

    it('should resolve from FSM context with $ prefix', () => {
      const mockFsm = {
        getContext: () => ({ subtask_count: 3 }),
      } as any;

      assert.strictEqual(coordinator.resolveEnsembleCount('$subtask_count', mockFsm), 3);
    });

    it('should resolve from FSM context without $ prefix', () => {
      const mockFsm = {
        getContext: () => ({ count: 4 }),
      } as any;

      assert.strictEqual(coordinator.resolveEnsembleCount('count', mockFsm), 4);
    });

    it('should return default 3 when undefined', () => {
      const mockFsm = { getContext: () => ({}) } as any;

      assert.strictEqual(coordinator.resolveEnsembleCount(undefined, mockFsm), 3);
    });
  });

  describe('writeTriggerMessage()', () => {
    it('should write trigger message file', () => {
      const result = coordinator.writeTriggerMessage({
        meshName: 'test-mesh',
        nextState: 'review',
        targetAgent: 'reviewer',
        ensembleOutput: 'Aggregated content here',
        ensembleMetadata: { strategy: 'merge', success: true },
        msgsDir: TEST_MSGS_DIR,
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.filepath);
      assert.ok(fs.existsSync(result.filepath));
    });

    it('should include proper message content', () => {
      const result = coordinator.writeTriggerMessage({
        meshName: 'test-mesh',
        nextState: 'review',
        targetAgent: 'reviewer',
        ensembleOutput: 'Test output content',
        ensembleMetadata: { strategy: 'vote', success: true },
        msgsDir: TEST_MSGS_DIR,
      });

      assert.ok(result.filepath);
      const content = fs.readFileSync(result.filepath, 'utf-8');

      assert.ok(content.includes('to: test-mesh/reviewer'));
      assert.ok(content.includes('from: dispatcher/ensemble'));
      assert.ok(content.includes('type: task'));
      assert.ok(content.includes('Test output content'));
      assert.ok(content.includes('Strategy: vote'));
    });
  });

  describe('buildEnsembleConfig()', () => {
    it('should build config from state config with agents array', () => {
      const stateConfig = {
        name: 'parallel-review',
        coordinator: 'synthesizer',
        ensemble: {
          agents: ['reviewer1', 'reviewer2', 'reviewer3'],
          aggregation: 'merge',
        },
      };

      const mockFsm = { getContext: () => ({}) } as any;
      const config = coordinator.buildEnsembleConfig(stateConfig as any, mockFsm);

      assert.ok(config);
      assert.strictEqual(config.agents.length, 3);
      assert.strictEqual(config.aggregation_strategy, 'merge');
    });

    it('should return null when no ensemble config', () => {
      const stateConfig = {
        name: 'normal-state',
        coordinator: 'agent1',
      };

      const mockFsm = { getContext: () => ({}) } as any;
      const config = coordinator.buildEnsembleConfig(stateConfig as any, mockFsm);

      assert.strictEqual(config, null);
    });
  });
});
