/**
 * Test 31: Ensemble Coordinator Infrastructure
 *
 * Tests ensemble coordinator mechanics WITHOUT real LLM.
 * Starts dispatcher to load mesh configs, then directly tests
 * EnsembleCoordinator behavior and FSM ensemble state handling.
 *
 * Responsibilities:
 * - Verify FSM config loads with ensemble state recognized
 * - Verify EnsembleCoordinator starts tracking and returns ID
 * - Verify aggregation triggers on all-agent completion
 * - Verify fault tolerance allows partial completion by min_success_count
 * - Verify FSM context can store ENSEMBLE_OUTPUT after aggregation
 * - Verify ensemble coordinator lifecycle events follow expected order
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerDispatcher } from '../../src/worker/dispatcher.ts';
import {
  setupTestEnv,
  cleanupTestEnv,
  sleep,
  type TestEnv,
} from '../utils/test-env.ts';
import { EventHarness } from '../utils/event-harness.ts';
import { copyTestMesh } from '../utils/copy-mesh.ts';
import type { EnsembleConfig } from '../../src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Build a mock Message for use as ensemble task input.
 */
function createMockTask(body: string = 'Ensemble test task') {
  return {
    id: 1,
    to_agent: 'test-fsm-full/worker-1',
    from_agent: 'core/core',
    type: 'task' as const,
    content: body,
    status: 'pending' as const,
    created_at: Date.now(),
    updated_at: Date.now(),
    payload: {
      headline: 'Ensemble test',
      body,
    },
  };
}

describe('Ensemble Coordinator Infrastructure', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('ensemble-infra');

    // Copy real test-fsm-full mesh (contains ensemble state fan_out)
    copyTestMesh(env, 'test-fsm-full');

    // Create workspace directories that FSM expects
    fs.mkdirSync(path.join(env.rootDir, '.ai', 'test-fsm-full', 'workspace'), { recursive: true });
    fs.mkdirSync(path.join(env.rootDir, '.ai', 'tx', 'test-fsm-full'), { recursive: true });

    // Initialize dispatcher (no consumer needed — we call methods directly)
    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue
    );

    harness = new EventHarness(dispatcher);

    // Start dispatcher to load mesh configs
    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  test('FSM config loads with ensemble state', async () => {
    const fsm = (dispatcher as any).meshFSMs.get('test-fsm-full');

    assert.ok(fsm, 'test-fsm-full FSM should be loaded');

    const states = fsm.getStates();
    assert.ok(Array.isArray(states), 'getStates() should return an array');

    const fanOutState = states.find((s: any) => s.name === 'fan_out');
    assert.ok(fanOutState, 'FSM should have a fan_out state');
    assert.ok(fanOutState.ensemble, 'fan_out state should have an ensemble config');

    const ensemble = fanOutState.ensemble;
    assert.strictEqual(ensemble.type, 'parallel', 'Ensemble type should be parallel');
    assert.deepStrictEqual(
      [...ensemble.agents].sort(),
      ['worker-1', 'worker-2', 'worker-3'],
      'Ensemble agents should be worker-1, worker-2, worker-3'
    );
    assert.strictEqual(ensemble.aggregation, 'concat', 'Aggregation strategy should be concat');
    assert.strictEqual(ensemble.timeout_ms, 30000, 'Timeout should be 30000ms');
    assert.ok(ensemble.fault_tolerance, 'fault_tolerance should be present');
    assert.strictEqual(ensemble.fault_tolerance.min_success_count, 2, 'min_success_count should be 2');
    assert.strictEqual(ensemble.fault_tolerance.retry_failed, false, 'retry_failed should be false');
  });

  test('ensemble coordinator starts tracking', async () => {
    const coordinator = (dispatcher as any).ensembleCoordinator;
    assert.ok(coordinator, 'EnsembleCoordinator should be accessible on dispatcher');

    const config: EnsembleConfig = {
      agents: ['w1', 'w2', 'w3'],
      aggregation_strategy: 'concat',
      timeout_ms: 30000,
    };
    const task = createMockTask();

    const id = coordinator.startEnsemble('test-fsm-full', config, task);

    assert.ok(id, 'startEnsemble should return a non-empty ensemble ID');
    assert.ok(typeof id === 'string', 'Ensemble ID should be a string');
    assert.ok(id.startsWith('test-fsm-full-'), 'Ensemble ID should be prefixed with mesh name');
    assert.strictEqual(coordinator.isComplete(id), false, 'Ensemble should not be complete immediately after start');
    assert.strictEqual(coordinator.getActiveEnsembleCount(), 1, 'Active ensemble count should be 1');
  });

  test('ensemble coordinator aggregates on all complete', async () => {
    const coordinator = (dispatcher as any).ensembleCoordinator;

    const config: EnsembleConfig = {
      agents: ['w1', 'w2', 'w3'],
      aggregation_strategy: 'concat',
      timeout_ms: 30000,
    };
    const task = createMockTask();
    const id = coordinator.startEnsemble('test-fsm-full', config, task);

    // Record results for all three agents
    coordinator.recordAgentResult(id, 'w1', 'output1');
    assert.strictEqual(coordinator.isComplete(id), false, 'Should not be complete after 1/3 results');

    coordinator.recordAgentResult(id, 'w2', 'output2');
    assert.strictEqual(coordinator.isComplete(id), false, 'Should not be complete after 2/3 results');

    coordinator.recordAgentResult(id, 'w3', 'output3');
    assert.strictEqual(coordinator.isComplete(id), true, 'Should be complete after all 3 results');

    const result = await coordinator.getAggregatedResult(id);
    assert.ok(result, 'getAggregatedResult should return a result');
    assert.ok(typeof result.output === 'string', 'Aggregated output should be a string');
    assert.ok(result.output.includes('output1'), 'Aggregated output should include w1 content');
    assert.ok(result.output.includes('output2'), 'Aggregated output should include w2 content');
    assert.ok(result.output.includes('output3'), 'Aggregated output should include w3 content');
  });

  test('ensemble fault tolerance allows partial completion', async () => {
    const coordinator = (dispatcher as any).ensembleCoordinator;

    const ftConfig: EnsembleConfig = {
      agents: ['w1', 'w2', 'w3'],
      aggregation_strategy: 'concat',
      fault_tolerance: {
        min_success_count: 2,
        retry_failed: false,
      },
    };
    const task = createMockTask();
    const ftId = coordinator.startEnsemble('test-ft', ftConfig, task);

    // Record 2 successes
    coordinator.recordAgentResult(ftId, 'w1', 'ok1');
    assert.strictEqual(coordinator.isComplete(ftId), false, 'Not complete with 1 success (need 2)');

    coordinator.recordAgentResult(ftId, 'w2', 'ok2');
    assert.strictEqual(coordinator.isComplete(ftId), true, 'Complete with 2 successes (min_success_count met)');

    // Record a failure for w3 — should not affect completion
    coordinator.recordAgentResult(ftId, 'w3', '', 'Agent failed');
    assert.strictEqual(coordinator.isComplete(ftId), true, 'Still complete after failure recorded');

    // Aggregated result should include the two successes
    const result = await coordinator.getAggregatedResult(ftId);
    assert.ok(result, 'Should produce aggregated result');
    assert.ok(result.output.includes('ok1'), 'Output should contain ok1');
    assert.ok(result.output.includes('ok2'), 'Output should contain ok2');
  });

  test('ensemble result injected into FSM context', async () => {
    const fsm = (dispatcher as any).meshFSMs.get('test-fsm-full');
    assert.ok(fsm, 'FSM should be loaded');

    // Verify baseline: ENSEMBLE_OUTPUT starts null per config.yaml
    const initialCtx = fsm.getContext();
    assert.strictEqual(initialCtx.ensemble_output, null, 'ENSEMBLE_OUTPUT should start null');

    // Simulate the updateContext call the dispatcher makes after aggregation
    fsm.updateContext({ ENSEMBLE_OUTPUT: 'test-aggregated-output' });

    const updatedCtx = fsm.getContext();
    assert.strictEqual(
      updatedCtx.ENSEMBLE_OUTPUT,
      'test-aggregated-output',
      'FSM context should reflect injected ENSEMBLE_OUTPUT'
    );
  });

  test('ensemble event sequence expectations', async () => {
    const coordinator = (dispatcher as any).ensembleCoordinator;

    // Verify ensemble coordinator lifecycle: start → record → complete → aggregate → cleanup
    const config: EnsembleConfig = {
      agents: ['w1', 'w2', 'w3'],
      aggregation_strategy: 'concat',
    };
    const task = createMockTask();

    // Phase 1: start
    const id = coordinator.startEnsemble('test-seq', config, task);
    assert.strictEqual(coordinator.isComplete(id), false, 'Not complete after start');
    assert.strictEqual(coordinator.getActiveEnsembleCount(), 1, '1 active ensemble');

    // Phase 2: record — check shouldAggregate flag on final result
    coordinator.recordAgentResult(id, 'w1', 'r1');
    coordinator.recordAgentResult(id, 'w2', 'r2');
    const { isComplete, shouldAggregate } = coordinator.recordAgentResult(id, 'w3', 'r3');

    assert.strictEqual(isComplete, true, 'isComplete true on final record');
    assert.strictEqual(shouldAggregate, true, 'shouldAggregate true on first aggregation claim');

    // Phase 3: aggregate — calling again should not re-claim
    const { shouldAggregate: secondClaim } = coordinator.recordAgentResult(id, 'w3', 'r3-dup');
    assert.strictEqual(secondClaim, false, 'Second aggregation claim denied (idempotent)');

    // Phase 4: cleanup
    coordinator.completeEnsemble(id);
    assert.strictEqual(coordinator.getActiveEnsembleCount(), 0, '0 active ensembles after cleanup');
    assert.strictEqual(coordinator.isComplete(id), false, 'isComplete false after cleanup (ensemble removed)');
  });
});
