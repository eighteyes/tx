import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EnsembleCoordinator } from '../../src/worker/ensemble-coordinator.ts';
import type { EnsembleConfig, Message } from '../../src/shared/types.ts';

describe('EnsembleCoordinator', () => {
  let coordinator: EnsembleCoordinator;
  let mockTask: Message;
  let mockConfig: EnsembleConfig;

  beforeEach(() => {
    coordinator = new EnsembleCoordinator();
    mockConfig = {
      agents: ['agent-1', 'agent-2', 'agent-3'],
      aggregation_strategy: 'concat',
      timeout_ms: 5000,
    };
    mockTask = {
      from_agent: 'core/core',
      to_agent: 'test-mesh/agent-1',
      type: 'task',
      payload: {
        'msg-id': 'task-1',
        body: 'Test task',
      },
    };
  });

  describe('Ensemble Lifecycle', () => {
    it('starts ensemble and returns ID', () => {
      const id = coordinator.startEnsemble('test-mesh', mockConfig, mockTask);
      assert.match(id, /test-mesh-\d+-[a-z0-9]+/);
    });

    it('records agent results', () => {
      const id = coordinator.startEnsemble('test-mesh', mockConfig, mockTask);

      coordinator.recordAgentResult(id, 'agent-1', 'Result from agent 1');
      coordinator.recordAgentResult(id, 'agent-2', 'Result from agent 2');

      // Should not be complete yet (3 agents expected, only 2 done)
      assert.strictEqual(coordinator.isComplete(id), false);
    });

    it('detects completion when all agents done', () => {
      const id = coordinator.startEnsemble('test-mesh', mockConfig, mockTask);

      coordinator.recordAgentResult(id, 'agent-1', 'Result 1');
      coordinator.recordAgentResult(id, 'agent-2', 'Result 2');
      coordinator.recordAgentResult(id, 'agent-3', 'Result 3');

      assert.strictEqual(coordinator.isComplete(id), true);
    });

    it('detects completion with fault tolerance', () => {
      const configWith2Min: EnsembleConfig = {
        ...mockConfig,
        fault_tolerance: { min_success_count: 2 },
      };

      const id = coordinator.startEnsemble('test-mesh', configWith2Min, mockTask);

      coordinator.recordAgentResult(id, 'agent-1', 'Result 1');
      coordinator.recordAgentResult(id, 'agent-2', 'Result 2');

      // Should be complete (2 agents succeeded, need 2)
      assert.strictEqual(coordinator.isComplete(id), true);
    });

    it('records agent errors', async () => {
      const id = coordinator.startEnsemble('test-mesh', mockConfig, mockTask);

      coordinator.recordAgentResult(id, 'agent-1', '', 'Agent timeout');
      coordinator.recordAgentResult(id, 'agent-2', 'Result 2');
      coordinator.recordAgentResult(id, 'agent-3', 'Result 3');

      const result = await coordinator.getAggregatedResult(id);
      assert.ok(result?.metadata.failed_agents.includes('agent-1'));
    });

    it('cleans up ensemble', async () => {
      const id = coordinator.startEnsemble('test-mesh', mockConfig, mockTask);
      coordinator.completeEnsemble(id);

      // Should handle gracefully (not throw)
      const result = await coordinator.getAggregatedResult(id);
      assert.strictEqual(result, null);
    });

    it('tracks active ensemble count', () => {
      assert.strictEqual(coordinator.getActiveEnsembleCount(), 0);

      const id1 = coordinator.startEnsemble('test-mesh', mockConfig, mockTask);
      assert.strictEqual(coordinator.getActiveEnsembleCount(), 1);

      const id2 = coordinator.startEnsemble('test-mesh-2', mockConfig, mockTask);
      assert.strictEqual(coordinator.getActiveEnsembleCount(), 2);

      coordinator.completeEnsemble(id1);
      assert.strictEqual(coordinator.getActiveEnsembleCount(), 1);

      coordinator.completeEnsemble(id2);
      assert.strictEqual(coordinator.getActiveEnsembleCount(), 0);
    });
  });

  describe('Aggregation', () => {
    it('aggregates concat results', async () => {
      const id = coordinator.startEnsemble('test-mesh', mockConfig, mockTask);

      coordinator.recordAgentResult(id, 'agent-1', 'Finding A');
      coordinator.recordAgentResult(id, 'agent-2', 'Finding B');
      coordinator.recordAgentResult(id, 'agent-3', 'Finding C');

      const result = await coordinator.getAggregatedResult(id);

      assert.ok(result?.output.includes('Finding A'));
      assert.ok(result?.output.includes('Finding B'));
      assert.ok(result?.output.includes('Finding C'));
      assert.strictEqual(result?.metadata.strategy, 'concat');
    });

    it('handles partial failure with fault tolerance', async () => {
      const id = coordinator.startEnsemble(
        'test-mesh',
        {
          ...mockConfig,
          fault_tolerance: { min_success_count: 2 },
        },
        mockTask
      );

      coordinator.recordAgentResult(id, 'agent-1', 'Result 1');
      coordinator.recordAgentResult(id, 'agent-2', 'Result 2');
      coordinator.recordAgentResult(id, 'agent-3', '', 'Timeout');

      const result = await coordinator.getAggregatedResult(id);

      assert.strictEqual(result?.metadata.success, true);
      assert.deepStrictEqual(result?.metadata.failed_agents, ['agent-3']);
      assert.strictEqual(result?.metadata.successful_agents.length, 2);
    });

    it('fails if insufficient agents succeeded', async () => {
      const id = coordinator.startEnsemble('test-mesh', mockConfig, mockTask);

      coordinator.recordAgentResult(id, 'agent-1', 'Result 1');
      coordinator.recordAgentResult(id, 'agent-2', '', 'Error');
      coordinator.recordAgentResult(id, 'agent-3', '', 'Error');

      const result = await coordinator.getAggregatedResult(id);

      assert.strictEqual(result?.metadata.success, false);
      assert.ok(result?.output.includes('failed'));
    });

    it('aggregates deduplicate results', async () => {
      const dedupeConfig: EnsembleConfig = {
        ...mockConfig,
        aggregation_strategy: 'deduplicate',
      };

      const id = coordinator.startEnsemble('test-mesh', dedupeConfig, mockTask);

      coordinator.recordAgentResult(id, 'agent-1', 'Finding A\nFinding B');
      coordinator.recordAgentResult(id, 'agent-2', 'Finding B\nFinding C');
      coordinator.recordAgentResult(id, 'agent-3', 'Finding A\nFinding C');

      const result = await coordinator.getAggregatedResult(id);

      assert.strictEqual(result?.metadata.strategy, 'deduplicate');
      // Should have 3 unique findings
      const lines = result?.output.split('\n').filter(l => l.trim());
      assert.strictEqual(lines?.length, 3);
    });
  });

  describe('Custom Aggregation', () => {
    it('supports custom aggregation prompt in message', async () => {
      const taskWithCustom: Message = {
        ...mockTask,
        payload: {
          'msg-id': 'task-1',
          body: 'Test task',
          custom_aggregation_prompt: 'Please synthesize these findings',
        },
      };

      const id = coordinator.startEnsemble('test-mesh', mockConfig, taskWithCustom);

      coordinator.recordAgentResult(id, 'agent-1', 'Finding A');
      coordinator.recordAgentResult(id, 'agent-2', 'Finding B');
      coordinator.recordAgentResult(id, 'agent-3', 'Finding C');

      const result = await coordinator.getAggregatedResult(id);

      // Custom aggregation prompt is noted but execution deferred to Phase 3
      assert.ok(result);
    });
  });

  describe('Error Handling', () => {
    it('handles non-existent ensemble gracefully', async () => {
      const result = await coordinator.getAggregatedResult('non-existent-id');
      assert.strictEqual(result, null);
    });

    it('handles recording result for non-existent ensemble', () => {
      // Should not throw
      coordinator.recordAgentResult('non-existent-id', 'agent-1', 'result');
    });

    it('handles completion check for non-existent ensemble', () => {
      const isComplete = coordinator.isComplete('non-existent-id');
      assert.strictEqual(isComplete, false);
    });

    it('handles empty results gracefully', async () => {
      const id = coordinator.startEnsemble('test-mesh', mockConfig, mockTask);

      coordinator.recordAgentResult(id, 'agent-1', '');
      coordinator.recordAgentResult(id, 'agent-2', '');
      coordinator.recordAgentResult(id, 'agent-3', '');

      const result = await coordinator.getAggregatedResult(id);

      // All agents returned empty results - should fail
      assert.strictEqual(result?.metadata.success, false);
    });
  });

  describe('Ensemble State', () => {
    it('exposes ensemble state for testing', () => {
      const id = coordinator.startEnsemble('test-mesh', mockConfig, mockTask);

      const state = coordinator.getEnsembleState(id);
      assert.ok(state);
      assert.strictEqual(state.meshName, 'test-mesh');
      assert.strictEqual(state.config.agents.length, 3);
    });

    it('returns undefined for non-existent ensemble state', () => {
      const state = coordinator.getEnsembleState('non-existent');
      assert.strictEqual(state, undefined);
    });
  });
});
