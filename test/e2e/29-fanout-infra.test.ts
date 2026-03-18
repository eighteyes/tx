/**
 * Test 29: Fan-Out Infrastructure
 *
 * Tests fan-out/fan-in dispatcher mechanics WITHOUT real LLM.
 * Starts dispatcher to load mesh configs, then directly invokes
 * registerFanOutGroup(), trackFanOutCompletion(), and handleFanOutReEngagement()
 * to test the fan-out routing logic.
 *
 * Responsibilities:
 * - Verify fan-out mesh config loads with correct routing structure
 * - Verify registerFanOutGroup creates tracking state in fanOutGroups map
 * - Verify isFanOutGated returns true for join agent before all completions
 * - Verify partial completion keeps gate active
 * - Verify all completions ungate join agent and emit fan-out:complete
 * - Verify re-engagement removes agent from completed set
 * - Verify full event sequence: registration → completions → fan-out:complete
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the loaded mesh config from the dispatcher (private field access).
 */
function getMeshConfig(dispatcher: WorkerDispatcher, meshName: string): any {
  return (dispatcher as any).meshConfigs.get(meshName);
}

describe('Fan-Out Infrastructure', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('fanout-infra');

    // Copy real test-fan-out mesh
    copyTestMesh(env, 'test-fan-out');

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

    // Start dispatcher to load mesh configs (no consumer = no message processing)
    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  test('mesh config loads with fan-out routing', async () => {
    const meshConfig = getMeshConfig(dispatcher, 'test-fan-out');

    assert.ok(meshConfig, 'test-fan-out mesh should be loaded');
    assert.ok(meshConfig.routing, 'Config should have routing block');
    assert.ok(meshConfig.routing.planner, 'Planner should have routing defined');

    // Fan-out routing: planner routes to an array with agents + options object
    const plannerRouting = meshConfig.routing.planner;
    assert.ok(Array.isArray(plannerRouting), 'Planner routing should be an array (fan-out style)');

    // Array should contain the 3 reviewer agents
    assert.ok(plannerRouting.includes('reviewer-a'), 'Should include reviewer-a');
    assert.ok(plannerRouting.includes('reviewer-b'), 'Should include reviewer-b');
    assert.ok(plannerRouting.includes('reviewer-c'), 'Should include reviewer-c');

    // Array should contain an options object with complete: synthesizer
    const optionsObj = plannerRouting.find(
      (item: any) => typeof item === 'object' && item !== null
    );
    assert.ok(optionsObj, 'Planner routing should have an options object');
    assert.strictEqual(optionsObj.complete, 'synthesizer', 'Options should name synthesizer as join agent');
  });

  test('registerFanOutGroup creates tracking state', async () => {
    // Directly call private method
    (dispatcher as any).registerFanOutGroup(
      'test-fan-out',
      ['reviewer-a', 'reviewer-b', 'reviewer-c'],
      'synthesizer'
    );

    // Access private fanOutGroups map
    const fanOutGroups = (dispatcher as any).fanOutGroups;
    const groupKey = 'test-fan-out:synthesizer';

    assert.ok(fanOutGroups.has(groupKey), `fanOutGroups should have key "${groupKey}"`);

    const group = fanOutGroups.get(groupKey);
    assert.ok(group, 'Group state should be present');
    assert.ok(group.agents instanceof Set, 'agents should be a Set');
    assert.strictEqual(group.agents.size, 3, 'Should track 3 agents');
    assert.ok(group.agents.has('reviewer-a'), 'Should include reviewer-a');
    assert.ok(group.agents.has('reviewer-b'), 'Should include reviewer-b');
    assert.ok(group.agents.has('reviewer-c'), 'Should include reviewer-c');
    assert.ok(group.completed instanceof Set, 'completed should be a Set');
    assert.strictEqual(group.completed.size, 0, 'No completions yet');
    assert.strictEqual(group.joinAgent, 'synthesizer', 'Join agent should be synthesizer');
  });

  test('isFanOutGated returns true for join agent before completions', async () => {
    // Register group — synthesizer is now the join agent
    (dispatcher as any).registerFanOutGroup(
      'test-fan-out',
      ['reviewer-a', 'reviewer-b', 'reviewer-c'],
      'synthesizer'
    );

    assert.strictEqual(
      dispatcher.isFanOutGated('test-fan-out', 'synthesizer'),
      true,
      'Synthesizer should be gated before any reviewers complete'
    );
  });

  test('single completion updates state, still gated', async () => {
    (dispatcher as any).registerFanOutGroup(
      'test-fan-out',
      ['reviewer-a', 'reviewer-b', 'reviewer-c'],
      'synthesizer'
    );

    // Complete reviewer-a (1 of 3)
    (dispatcher as any).trackFanOutCompletion('test-fan-out', 'reviewer-a');

    // Verify state: 1 completed, still gated
    const group = (dispatcher as any).fanOutGroups.get('test-fan-out:synthesizer');
    assert.ok(group, 'Group should still exist after first completion');
    assert.strictEqual(group.completed.size, 1, 'One agent should be marked complete');
    assert.ok(group.completed.has('reviewer-a'), 'reviewer-a should be in completed');

    assert.strictEqual(
      dispatcher.isFanOutGated('test-fan-out', 'synthesizer'),
      true,
      'Synthesizer should still be gated (1/3 complete)'
    );
  });

  test('all completions ungate join, fan-out:complete fires', async () => {
    (dispatcher as any).registerFanOutGroup(
      'test-fan-out',
      ['reviewer-a', 'reviewer-b', 'reviewer-c'],
      'synthesizer'
    );

    // Complete all 3 reviewers
    (dispatcher as any).trackFanOutCompletion('test-fan-out', 'reviewer-a');
    (dispatcher as any).trackFanOutCompletion('test-fan-out', 'reviewer-b');
    (dispatcher as any).trackFanOutCompletion('test-fan-out', 'reviewer-c');

    // Group should be cleaned up after all completions
    assert.strictEqual(
      dispatcher.isFanOutGated('test-fan-out', 'synthesizer'),
      false,
      'Synthesizer should be ungated after all reviewers complete'
    );

    // fan-out:complete should have fired
    const completeEvents = harness.getEvents('fan-out:complete');
    assert.strictEqual(completeEvents.length, 1, 'Should emit exactly 1 fan-out:complete');

    const data = completeEvents[0].data;
    assert.strictEqual(data.meshName, 'test-fan-out', 'Event meshName should match');
    assert.strictEqual(data.joinAgent, 'synthesizer', 'Event joinAgent should be synthesizer');
    assert.ok(Array.isArray(data.completedAgents), 'completedAgents should be an array');
    assert.deepStrictEqual(
      data.completedAgents.sort(),
      ['reviewer-a', 'reviewer-b', 'reviewer-c'],
      'All 3 reviewers should appear in completedAgents'
    );
  });

  test('re-engagement removes agent from completed set', async () => {
    (dispatcher as any).registerFanOutGroup(
      'test-fan-out',
      ['reviewer-a', 'reviewer-b', 'reviewer-c'],
      'synthesizer'
    );

    // Complete reviewer-a
    (dispatcher as any).trackFanOutCompletion('test-fan-out', 'reviewer-a');

    const group = (dispatcher as any).fanOutGroups.get('test-fan-out:synthesizer');
    assert.strictEqual(group.completed.size, 1, 'reviewer-a should be in completed');

    // Re-engage reviewer-a (receives a peer message after completing)
    (dispatcher as any).handleFanOutReEngagement('test-fan-out', 'reviewer-a');

    assert.strictEqual(
      group.completed.has('reviewer-a'),
      false,
      'reviewer-a should be removed from completed after re-engagement'
    );
    assert.strictEqual(group.completed.size, 0, 'Completed set should be empty again');

    // Gate should be active again
    assert.strictEqual(
      dispatcher.isFanOutGated('test-fan-out', 'synthesizer'),
      true,
      'Synthesizer should be re-gated after reviewer-a re-engages'
    );
  });

  test('event sequence: registration → completions → fan-out:complete', async () => {
    (dispatcher as any).registerFanOutGroup(
      'test-fan-out',
      ['reviewer-a', 'reviewer-b', 'reviewer-c'],
      'synthesizer'
    );

    // Complete all reviewers — triggers fan-out:complete
    (dispatcher as any).trackFanOutCompletion('test-fan-out', 'reviewer-a');
    (dispatcher as any).trackFanOutCompletion('test-fan-out', 'reviewer-b');
    (dispatcher as any).trackFanOutCompletion('test-fan-out', 'reviewer-c');

    // fan-out:complete must appear in captured events
    harness.assertEventSequence([
      'fan-out:complete',
    ]);

    // Verify completedAgents is the full set
    const events = harness.getEvents('fan-out:complete');
    assert.strictEqual(events.length, 1, 'Exactly one fan-out:complete event');

    const completedAgents: string[] = events[0].data.completedAgents;
    assert.deepStrictEqual(
      completedAgents.sort(),
      ['reviewer-a', 'reviewer-b', 'reviewer-c'],
      'All three reviewers should be in the final completedAgents list'
    );
  });
});
