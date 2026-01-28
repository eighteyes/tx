/**
 * Queue Await Tracking Test
 * Phase 2: Terminal-by-Default Messaging
 *
 * Tests the await state tracking system that enables suspend/resume semantics.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MessageQueue } from '../../src/queue/index.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('Queue Await Tracking', () => {
  let env: TestEnv;
  let queue: MessageQueue;

  before(async () => {
    env = createTestEnv('queue-await-tracking');
    queue = new MessageQueue(env.dbPath);
  });

  after(async () => {
    if (queue) queue.close();
    env.cleanup();
  });

  describe('setAwaiting()', () => {
    it('should set await state for single target', () => {
      queue.setAwaiting('mesh/worker', 'session-1', ['mesh/reviewer']);

      const state = queue.getAwaitState('mesh/worker');
      assert.ok(state, 'Await state should exist');
      assert.strictEqual(state.agent_id, 'mesh/worker');
      assert.strictEqual(state.session_id, 'session-1');

      const targets = JSON.parse(state.target_agents);
      assert.deepStrictEqual(targets, ['mesh/reviewer']);

      const receivedFrom = JSON.parse(state.received_from);
      assert.strictEqual(receivedFrom.length, 0);
    });

    it('should set await state for multiple targets', () => {
      queue.setAwaiting('mesh/coordinator', 'session-2', ['mesh/worker1', 'mesh/worker2', 'mesh/worker3']);

      const state = queue.getAwaitState('mesh/coordinator');
      assert.ok(state, 'Await state should exist');

      const targets = JSON.parse(state.target_agents);
      assert.strictEqual(targets.length, 3);
      assert.ok(targets.includes('mesh/worker1'));
      assert.ok(targets.includes('mesh/worker2'));
      assert.ok(targets.includes('mesh/worker3'));
    });

    it('should replace existing await state', () => {
      queue.setAwaiting('mesh/agent', 'session-3a', ['target1']);
      queue.setAwaiting('mesh/agent', 'session-3b', ['target2', 'target3']);

      const state = queue.getAwaitState('mesh/agent');
      assert.ok(state);
      const targets = JSON.parse(state.target_agents);
      assert.strictEqual(targets.length, 2);
      assert.ok(!targets.includes('target1'));
      assert.ok(targets.includes('target2'));
      assert.strictEqual(state.session_id, 'session-3b');
    });

    it('should handle empty targets array', () => {
      queue.setAwaiting('mesh/empty', 'session-4', []);

      const state = queue.getAwaitState('mesh/empty');
      assert.ok(state);
      const targets = JSON.parse(state.target_agents);
      assert.strictEqual(targets.length, 0);
    });
  });

  describe('receiveAwaitResponse()', () => {
    it('should receive response for single target', () => {
      queue.setAwaiting('mesh/worker', 'session-6', ['mesh/reviewer']);

      const result = queue.receiveAwaitResponse('mesh/worker', 'mesh/reviewer');

      assert.strictEqual(result.allReceived, true);
      assert.strictEqual(result.remaining.length, 0);
      assert.strictEqual(result.receivedFrom.length, 1);
      assert.ok(result.receivedFrom.includes('mesh/reviewer'));

      // Should be cleared after all received
      const state = queue.getAwaitState('mesh/worker');
      assert.strictEqual(state, null);
    });

    it('should partially resolve multi-target await', () => {
      queue.setAwaiting('mesh/coordinator', 'session-7', ['worker1', 'worker2', 'worker3']);

      const result1 = queue.receiveAwaitResponse('mesh/coordinator', 'worker1');

      assert.strictEqual(result1.allReceived, false);
      assert.strictEqual(result1.remaining.length, 2);
      assert.ok(result1.remaining.includes('worker2'));
      assert.ok(result1.remaining.includes('worker3'));
      assert.strictEqual(result1.receivedFrom.length, 1);
    });

    it('should complete multi-target await when all respond', () => {
      queue.setAwaiting('mesh/coordinator', 'session-8', ['worker1', 'worker2']);

      const result1 = queue.receiveAwaitResponse('mesh/coordinator', 'worker1');
      assert.strictEqual(result1.allReceived, false);

      const result2 = queue.receiveAwaitResponse('mesh/coordinator', 'worker2');
      assert.strictEqual(result2.allReceived, true);
      assert.strictEqual(result2.remaining.length, 0);
      assert.strictEqual(result2.receivedFrom.length, 2);
    });

    it('should handle response for non-existent await state', () => {
      const result = queue.receiveAwaitResponse('mesh/nonexistent', 'unknown');

      assert.strictEqual(result.allReceived, false);
      assert.strictEqual(result.remaining.length, 0);
      assert.strictEqual(result.receivedFrom.length, 0);
    });

    it('should handle response from unexpected responder', () => {
      queue.setAwaiting('mesh/worker', 'session-9', ['expected']);

      const result = queue.receiveAwaitResponse('mesh/worker', 'unexpected');

      // Still records the response even if unexpected
      assert.strictEqual(result.receivedFrom.includes('unexpected'), true);
    });

    it('should track responses from all targets', () => {
      queue.setAwaiting('mesh/coordinator', 'session-10', ['reviewer', 'tester']);

      queue.receiveAwaitResponse('mesh/coordinator', 'reviewer');
      const result = queue.receiveAwaitResponse('mesh/coordinator', 'tester');

      assert.strictEqual(result.allReceived, true);
      assert.ok(result.receivedFrom.includes('reviewer'));
      assert.ok(result.receivedFrom.includes('tester'));
    });

    it('should not record duplicate responses', () => {
      queue.setAwaiting('mesh/worker', 'session-11', ['reviewer']);

      queue.receiveAwaitResponse('mesh/worker', 'reviewer');
      const state = queue.getAwaitState('mesh/worker');
      // State should be cleared after all responses received
      assert.strictEqual(state, null);

      // Second attempt should return empty since state is cleared
      const result2 = queue.receiveAwaitResponse('mesh/worker', 'reviewer');
      assert.strictEqual(result2.allReceived, false);
      assert.strictEqual(result2.receivedFrom.length, 0);
    });
  });

  describe('getAwaitState()', () => {
    it('should return null for non-existent await state', () => {
      const state = queue.getAwaitState('mesh/nothere');
      assert.strictEqual(state, null);
    });

    it('should return current await state', () => {
      queue.setAwaiting('mesh/agent', 'session-12', ['target1', 'target2']);

      const state = queue.getAwaitState('mesh/agent');
      assert.ok(state);
      assert.strictEqual(state.agent_id, 'mesh/agent');
      const targets = JSON.parse(state.target_agents);
      assert.strictEqual(targets.length, 2);
    });

    it('should reflect partial resolution', () => {
      queue.setAwaiting('mesh/agent', 'session-13', ['t1', 't2', 't3']);

      queue.receiveAwaitResponse('mesh/agent', 't1');

      const state = queue.getAwaitState('mesh/agent');
      assert.ok(state);
      const targets = JSON.parse(state.target_agents);
      assert.strictEqual(targets.length, 3); // Original list unchanged
      const receivedFrom = JSON.parse(state.received_from);
      assert.strictEqual(receivedFrom.length, 1); // One response received
    });
  });

  describe('clearAwaitState()', () => {
    it('should clear await state', () => {
      queue.setAwaiting('mesh/worker', 'session-14', ['target']);

      queue.clearAwaitState('mesh/worker');

      const state = queue.getAwaitState('mesh/worker');
      assert.strictEqual(state, null);
    });

    it('should handle clearing non-existent state', () => {
      // Should not throw
      queue.clearAwaitState('mesh/nonexistent');
      assert.ok(true);
    });
  });

  describe('getAllAwaitStates()', () => {
    it('should return all await states', () => {
      // Clear all first
      const allStates = queue.getAllAwaitStates();
      allStates.forEach(s => queue.clearAwaitState(s.agent_id));

      queue.setAwaiting('mesh/agent1', 'session-15', ['t1']);
      queue.setAwaiting('mesh/agent2', 'session-16', ['t2']);

      const states = queue.getAllAwaitStates();
      assert.strictEqual(states.length >= 2, true);
      const agentIds = states.map(s => s.agent_id);
      assert.ok(agentIds.includes('mesh/agent1'));
      assert.ok(agentIds.includes('mesh/agent2'));
    });
  });

  describe('clearAwaitStatesForMesh()', () => {
    it('should clear all await states for a mesh', () => {
      queue.setAwaiting('test-mesh/agent1', 'session-17', ['t1']);
      queue.setAwaiting('test-mesh/agent2', 'session-18', ['t2']);
      queue.setAwaiting('other-mesh/agent3', 'session-19', ['t3']);

      const cleared = queue.clearAwaitStatesForMesh('test-mesh');
      assert.strictEqual(cleared >= 2, true);

      const state1 = queue.getAwaitState('test-mesh/agent1');
      const state2 = queue.getAwaitState('test-mesh/agent2');
      const state3 = queue.getAwaitState('other-mesh/agent3');

      assert.strictEqual(state1, null);
      assert.strictEqual(state2, null);
      assert.ok(state3); // Other mesh not affected
    });
  });

  describe('Edge Cases', () => {
    it('should persist await state across queries', () => {
      queue.setAwaiting('mesh/persistent', 'session-20', ['t1', 't2']);

      const state1 = queue.getAwaitState('mesh/persistent');
      const state2 = queue.getAwaitState('mesh/persistent');

      assert.strictEqual(state1?.agent_id, state2?.agent_id);
      assert.strictEqual(state1?.session_id, state2?.session_id);
    });

    it('should handle await state with special characters in agent names', () => {
      queue.setAwaiting('mesh/agent-with-dashes', 'session-21', ['target/with/slashes']);

      const state = queue.getAwaitState('mesh/agent-with-dashes');
      assert.ok(state);
      const targets = JSON.parse(state.target_agents);
      assert.strictEqual(targets[0], 'target/with/slashes');
    });

    it('should track timestamps', () => {
      const before = Date.now();
      queue.setAwaiting('mesh/timed', 'session-22', ['t1']);
      const after = Date.now();

      const state = queue.getAwaitState('mesh/timed');
      assert.ok(state);
      assert.ok(state.created_at >= before && state.created_at <= after);
      assert.ok(state.updated_at >= before && state.updated_at <= after);
    });

    it('should update timestamp on response', async () => {
      queue.setAwaiting('mesh/update-test', 'session-23', ['t1', 't2']);

      const state1 = queue.getAwaitState('mesh/update-test');
      const initialUpdate = state1?.updated_at;

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      queue.receiveAwaitResponse('mesh/update-test', 't1');

      const state2 = queue.getAwaitState('mesh/update-test');
      assert.ok(state2);
      assert.ok(state2.updated_at > initialUpdate!);
    });
  });

  describe('Schema Validation', () => {
    it('should have await_state table', () => {
      const tables = queue.listTables();
      assert.ok(tables.includes('await_state'), 'Should have await_state table');
    });
  });
});
