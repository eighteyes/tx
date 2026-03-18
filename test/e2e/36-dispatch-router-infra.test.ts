/**
 * Test 36: Dispatch Router Infrastructure
 *
 * Tests the DispatchRouter class directly WITHOUT real LLM or full dispatcher.
 * Instantiates DispatchRouter with mesh routing configs and exercises every
 * resolution path: linear, branch, fan-out, fan-out member, terminal,
 * escalation, and route_to override.
 *
 * Responsibilities:
 * - Verify linear routing resolves string entries to qualified targets
 * - Verify branch routing matches outcomes to targets with default fallback
 * - Verify fan-out routing returns multiple targets from array config
 * - Verify fan-out member implicit routing (complete → join agent, discuss)
 * - Verify terminal agents resolve to core/core
 * - Verify escalation always routes to core/core
 * - Verify route_to override bypasses normal resolution
 * - Verify getValidOutcomes, isTerminal, getParallelGroup, getInjectionContext
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { DispatchRouter } from '../../src/worker/dispatch-router.ts';

// ============================================================================
// Test routing config matching test-dispatch mesh shape
// ============================================================================

const MESH_NAME = 'test-dispatch';
const AGENT_NAMES = ['planner', 'analyst-a', 'analyst-b', 'worker', 'reviewer'];

// Matches meshes/test-dispatch/config.yaml routing section
const ROUTING = {
  planner: ['analyst-a', 'analyst-b', { discuss: true, complete: 'worker', fan_in: 'batch' }],
  worker: 'reviewer',
  reviewer: {
    approved: 'core',
    needs_work: 'worker',
    default: 'core',
  },
};

function createRouter(): DispatchRouter {
  return new DispatchRouter(MESH_NAME, ROUTING as any, AGENT_NAMES);
}

// ============================================================================
// Tests
// ============================================================================

describe('Dispatch Router Infrastructure', () => {

  // --------------------------------------------------------------------------
  // Linear routing
  // --------------------------------------------------------------------------

  test('linear routing resolves string entry to qualified target', () => {
    const router = createRouter();
    const result = router.resolve('worker');

    assert.ok(result, 'Should resolve linear routing');
    assert.strictEqual(result.target, 'test-dispatch/reviewer');
    assert.strictEqual(result.source, 'linear');
  });

  test('linear routing with outcome passes outcome through', () => {
    const router = createRouter();
    const result = router.resolve('worker', 'complete');

    assert.ok(result);
    assert.strictEqual(result.target, 'test-dispatch/reviewer');
    assert.strictEqual(result.source, 'linear');
    assert.strictEqual(result.outcome, 'complete');
  });

  // --------------------------------------------------------------------------
  // Branch routing
  // --------------------------------------------------------------------------

  test('branch routing matches outcome to target', () => {
    const router = createRouter();

    const approved = router.resolve('reviewer', 'approved');
    assert.ok(approved);
    assert.strictEqual(approved.target, 'core/core', 'approved → core');
    assert.strictEqual(approved.source, 'branch');
    assert.strictEqual(approved.outcome, 'approved');

    const needsWork = router.resolve('reviewer', 'needs_work');
    assert.ok(needsWork);
    assert.strictEqual(needsWork.target, 'test-dispatch/worker', 'needs_work → worker');
    assert.strictEqual(needsWork.source, 'branch');
  });

  test('branch routing falls back to default on unknown outcome', () => {
    const router = createRouter();
    const result = router.resolve('reviewer', 'unknown_outcome');

    assert.ok(result);
    assert.strictEqual(result.target, 'core/core', 'default → core');
    assert.strictEqual(result.source, 'branch');
    assert.strictEqual(result.usedDefault, true);
  });

  test('branch routing returns null when no outcome and no default', () => {
    const router = new DispatchRouter('mesh', { agent: { yes: 'a', no: 'b' } } as any, ['a', 'b', 'agent']);
    const result = router.resolve('agent');

    // No outcome provided and no default key → null
    assert.strictEqual(result, null);
  });

  // --------------------------------------------------------------------------
  // Fan-out routing
  // --------------------------------------------------------------------------

  test('fan-out source resolves to multiple targets', () => {
    const router = createRouter();
    const result = router.resolve('planner');

    assert.ok(result);
    assert.strictEqual(result.source, 'fan-out');
    assert.ok(result.targets, 'Should have targets array');
    assert.strictEqual(result.targets!.length, 2);
    assert.deepStrictEqual(
      result.targets!.sort(),
      ['test-dispatch/analyst-a', 'test-dispatch/analyst-b']
    );
  });

  test('fan-out member complete routes to join agent', () => {
    const router = createRouter();

    // analyst-a is a fan-out member with complete: worker
    const result = router.resolve('analyst-a', 'complete');
    assert.ok(result);
    assert.strictEqual(result.target, 'test-dispatch/worker');
    assert.strictEqual(result.source, 'branch');
    assert.strictEqual(result.outcome, 'complete');
  });

  test('fan-out member discuss without route_to returns null', () => {
    const router = createRouter();
    // discuss enabled but no route_to → can't determine peer
    const result = router.resolve('analyst-a', 'discuss');
    assert.strictEqual(result, null);
  });

  // --------------------------------------------------------------------------
  // Escalation
  // --------------------------------------------------------------------------

  test('escalation always routes to core/core regardless of config', () => {
    const router = createRouter();

    // Escalation from any agent should go to core
    for (const agent of ['planner', 'worker', 'reviewer', 'analyst-a']) {
      const result = router.resolve(agent, 'escalate');
      assert.ok(result, `Escalation should resolve for ${agent}`);
      assert.strictEqual(result.target, 'core/core');
      assert.strictEqual(result.source, 'escalate');
    }
  });

  // --------------------------------------------------------------------------
  // route_to override
  // --------------------------------------------------------------------------

  test('route_to override bypasses normal resolution', () => {
    const router = createRouter();
    const result = router.resolve('analyst-a', 'discuss', 'analyst-b');

    assert.ok(result);
    assert.strictEqual(result.target, 'test-dispatch/analyst-b');
    assert.strictEqual(result.source, 'override');
  });

  test('route_to with invalid target returns null', () => {
    const router = createRouter();
    const result = router.resolve('analyst-a', 'discuss', 'nonexistent');
    assert.strictEqual(result, null);
  });

  // --------------------------------------------------------------------------
  // Terminal agents
  // --------------------------------------------------------------------------

  test('terminal agent routes to core/core', () => {
    // Create router with an agent that has no routing entry and is not in fan-out
    const router = new DispatchRouter('mesh', { entry: 'worker' } as any, ['entry', 'worker', 'terminal-agent']);

    const result = router.resolve('terminal-agent', 'complete');
    assert.ok(result);
    assert.strictEqual(result.target, 'core/core');
    assert.strictEqual(result.source, 'terminal');
  });

  // --------------------------------------------------------------------------
  // isTerminal
  // --------------------------------------------------------------------------

  test('isTerminal correctly identifies terminal and non-terminal agents', () => {
    const router = createRouter();

    // planner has routing entry (fan-out) → not terminal
    assert.strictEqual(router.isTerminal('planner'), false);
    // worker has routing entry (linear) → not terminal
    assert.strictEqual(router.isTerminal('worker'), false);
    // reviewer has routing entry (branch) → not terminal
    assert.strictEqual(router.isTerminal('reviewer'), false);
    // analyst-a is a fan-out member → not terminal
    assert.strictEqual(router.isTerminal('analyst-a'), false);
    // analyst-b is a fan-out member → not terminal
    assert.strictEqual(router.isTerminal('analyst-b'), false);
  });

  // --------------------------------------------------------------------------
  // getValidOutcomes
  // --------------------------------------------------------------------------

  test('getValidOutcomes returns correct outcome types per agent type', () => {
    const router = createRouter();

    // Linear agent → null (any outcome accepted)
    assert.strictEqual(router.getValidOutcomes('worker'), null);

    // Fan-out source → null (any outcome)
    assert.strictEqual(router.getValidOutcomes('planner'), null);

    // Branch agent → list of outcome keys (excluding 'default')
    const reviewerOutcomes = router.getValidOutcomes('reviewer');
    assert.ok(Array.isArray(reviewerOutcomes));
    assert.deepStrictEqual(reviewerOutcomes!.sort(), ['approved', 'needs_work']);

    // Fan-out member → outcomes from group options
    const analystOutcomes = router.getValidOutcomes('analyst-a');
    assert.ok(Array.isArray(analystOutcomes));
    assert.deepStrictEqual(analystOutcomes!.sort(), ['complete', 'discuss']);
  });

  // --------------------------------------------------------------------------
  // getParallelGroup
  // --------------------------------------------------------------------------

  test('getParallelGroup returns fan-out group info', () => {
    const router = createRouter();
    const group = router.getParallelGroup('planner');

    assert.ok(group);
    assert.deepStrictEqual(group.agents.sort(), ['analyst-a', 'analyst-b']);
    assert.strictEqual(group.joinAgent, 'worker');
    assert.strictEqual(group.fanIn, 'batch');
  });

  test('getParallelGroup returns null for non-fan-out agents', () => {
    const router = createRouter();

    assert.strictEqual(router.getParallelGroup('worker'), null);
    assert.strictEqual(router.getParallelGroup('reviewer'), null);
    assert.strictEqual(router.getParallelGroup('analyst-a'), null);
  });

  // --------------------------------------------------------------------------
  // getInjectionContext
  // --------------------------------------------------------------------------

  test('getInjectionContext builds correct prompt context', () => {
    const router = createRouter();

    // Fan-out member with discuss enabled gets peers + join agent only
    const analystCtx = router.getInjectionContext('analyst-a');
    assert.strictEqual(analystCtx.sentinel, 'test-dispatch/dispatch');
    assert.strictEqual(analystCtx.isTerminal, false);
    assert.deepStrictEqual(analystCtx.peers, ['analyst-b']);
    assert.deepStrictEqual(analystCtx.availableAgents.sort(), ['analyst-b', 'worker']);

    // Linear agent — only its target, no peers
    const workerCtx = router.getInjectionContext('worker');
    assert.strictEqual(workerCtx.isTerminal, false);
    assert.strictEqual(workerCtx.peers, undefined);
    assert.strictEqual(workerCtx.validOutcomes, null); // linear = any outcome
    assert.deepStrictEqual(workerCtx.availableAgents, ['reviewer']);

    // Branch agent — valid outcomes listed, reachable agents from outcome map
    const reviewerCtx = router.getInjectionContext('reviewer');
    assert.deepStrictEqual(reviewerCtx.validOutcomes!.sort(), ['approved', 'needs_work']);
    assert.deepStrictEqual(reviewerCtx.availableAgents, ['worker']); // core filtered out

    // Fan-out source — reachable agents are the fan-out targets
    const plannerCtx = router.getInjectionContext('planner');
    assert.deepStrictEqual(plannerCtx.availableAgents.sort(), ['analyst-a', 'analyst-b']);
  });
});
