/**
 * Test 33: Routing Errors Infrastructure
 *
 * Tests routing error and escalation mechanics WITHOUT real LLM.
 * Starts dispatcher to load mesh configs, then directly invokes
 * handleRoutingError() and trackMessageSent() to test routing enforcement.
 *
 * Responsibilities:
 * - Verify routing-error event fires with correct payload on first violation
 * - Verify routing-escalation fires after maxRetries in strict mode
 * - Verify routing_fallback redirects trigger edge:limit-reached event
 * - Verify edge counters increment per routing call
 * - Verify edge:limit-reached fires at configured threshold with correct payload
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { WorkerDispatcher } from '../../src/worker/dispatcher.ts';
import {
  setupTestEnv,
  cleanupTestEnv,
  sleep,
  type TestEnv,
} from '../utils/test-env.ts';
import { EventHarness } from '../utils/event-harness.ts';
import { copyTestMesh } from '../utils/copy-mesh.ts';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Call handleRoutingError on the dispatcher (private method access).
 */
function callHandleRoutingError(
  dispatcher: WorkerDispatcher,
  senderAgentId: string,
  targetAgentId: string,
  targetMeshName: string,
  errorType: 'mesh-not-found' | 'agent-not-found'
): void {
  (dispatcher as any).handleRoutingError(senderAgentId, targetAgentId, targetMeshName, errorType);
}

/**
 * Directly call trackMessageSent on the dispatcher (private method access).
 */
function trackMessage(
  dispatcher: WorkerDispatcher,
  fromAgentId: string,
  toAgentId: string,
  messageType: string = 'message',
  filepath: string = '/fake/msg.md'
): void {
  (dispatcher as any).trackMessageSent(fromAgentId, toAgentId, messageType, filepath);
}

// ============================================================================

describe('Routing Errors Infrastructure', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('routing-errors-infra');

    // Copy the test-routing-enforcement mesh into test env
    copyTestMesh(env, 'test-routing-enforcement');

    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue
    );

    harness = new EventHarness(dispatcher);

    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  // --------------------------------------------------------------------------

  test('first routing error emits routing-error with correct payload', async () => {
    const senderAgentId = 'test-routing-enforcement/coordinator';
    const targetAgentId = 'test-routing-enforcement/nonexistent';
    const meshName = 'test-routing-enforcement';

    callHandleRoutingError(dispatcher, senderAgentId, targetAgentId, meshName, 'agent-not-found');

    const errorEvents = harness.getEvents('routing-error');
    assert.strictEqual(
      errorEvents.length,
      1,
      `Expected 1 routing-error event, got ${errorEvents.length}. ` +
      `Events: [${harness.getEvents().map(e => e.name).join(', ')}]`
    );

    const data = errorEvents[0].data;
    assert.strictEqual(data.from, 'system/router', 'routing-error should come from system/router');
    assert.strictEqual(data.to, senderAgentId, 'routing-error should be addressed to the sender');
    assert.ok(
      typeof data.content === 'string' && data.content.length > 0,
      'routing-error should include non-empty content'
    );
    assert.ok(
      data.content.includes(targetAgentId) || data.content.includes('agent not found') || data.content.includes('not found'),
      `routing-error content should mention the failed target. Content: ${data.content}`
    );
  });

  // --------------------------------------------------------------------------

  test('repeated violations emit routing-escalation in strict mode', async () => {
    const meshName = 'test-routing-strict';

    // Directly register mesh-local guardrail with strict routing_error mode.
    // This bypasses file I/O and avoids ESM/CJS require issues in createTestMesh.
    (dispatcher as any).guardrails.registerMesh(meshName, {
      routing_error: {
        strict: true,
        warning: true,
        max_retries: 3,
      },
    });

    const senderAgentId = `${meshName}/coordinator`;
    const targetAgentId = `${meshName}/nonexistent`;

    // 3 calls — escalation fires on the 3rd (retryCount >= maxRetries = 3)
    callHandleRoutingError(dispatcher, senderAgentId, targetAgentId, meshName, 'agent-not-found');
    callHandleRoutingError(dispatcher, senderAgentId, targetAgentId, meshName, 'agent-not-found');
    callHandleRoutingError(dispatcher, senderAgentId, targetAgentId, meshName, 'agent-not-found');

    const escalationEvents = harness.getEvents('routing-escalation');
    assert.strictEqual(
      escalationEvents.length,
      1,
      `Expected 1 routing-escalation event after 3 retries, got ${escalationEvents.length}. ` +
      `Events: [${harness.getEvents().map(e => e.name).join(', ')}]`
    );

    const data = escalationEvents[0].data;
    assert.strictEqual(data.to, 'core/core', 'routing-escalation should be addressed to core/core');
    assert.ok(
      typeof data.content === 'string' && data.content.length > 0,
      'routing-escalation should include non-empty content'
    );
  });

  // --------------------------------------------------------------------------

  test('routing_fallback config triggers edge:limit-reached at threshold', async () => {
    const meshName = 'test-routing-fallback';

    // Directly register mesh-local routing fallback config via guardrails.
    // routing_retry_max: 2 means edge:limit-reached fires when count >= 2.
    (dispatcher as any).guardrails.registerMesh(meshName, {
      routing_error: {
        routing_retry_max: 2,
        routing_fallback: 'coordinator',
      },
    });

    const fromAgent = `${meshName}/coordinator`;
    const toAgent = `${meshName}/specialist`;

    // Send 2 messages of type 'message' on same edge — fires at count >= max
    trackMessage(dispatcher, fromAgent, toAgent, 'message');
    trackMessage(dispatcher, fromAgent, toAgent, 'message');

    await sleep(50);

    const limitEvents = harness.getEvents('edge:limit-reached');
    assert.ok(
      limitEvents.length >= 1,
      `Expected at least 1 edge:limit-reached event, got ${limitEvents.length}. ` +
      `Events: [${harness.getEvents().map(e => e.name).join(', ')}]`
    );

    const evt = limitEvents[0].data;
    assert.strictEqual(evt.meshName, meshName, 'meshName should match');
    assert.strictEqual(evt.from, fromAgent, 'from should be the sending agent');
    assert.strictEqual(evt.to, toAgent, 'to should be the target agent');
    assert.strictEqual(evt.max, 2, 'max should match configured routing_retry_max');
    assert.strictEqual(evt.fallback, 'coordinator', 'fallback should match configured routing_fallback');
  });

  // --------------------------------------------------------------------------

  test('edge counting increments per trackMessageSent call', async () => {
    const fromAgent = 'test-routing-enforcement/coordinator';
    const toAgent = 'test-routing-enforcement/specialist-a';
    const edgeKey = `${fromAgent}->${toAgent}`;

    // Call twice — edge counter should reach 2
    trackMessage(dispatcher, fromAgent, toAgent, 'task');
    trackMessage(dispatcher, fromAgent, toAgent, 'task');

    const edgeCounters: Map<string, number> = (dispatcher as any).edgeCounters;
    const count = edgeCounters.get(edgeKey);

    assert.strictEqual(
      count,
      2,
      `Expected edge counter for "${edgeKey}" to be 2, got ${count}`
    );
  });

  // --------------------------------------------------------------------------

  test('edge:limit-reached fires at threshold with correct payload', async () => {
    const meshName = 'test-edge-threshold';

    // Directly register mesh-local routing fallback config.
    // routing_retry_max: 3 means edge:limit-reached fires at count >= 3.
    (dispatcher as any).guardrails.registerMesh(meshName, {
      routing_error: {
        routing_retry_max: 3,
        routing_fallback: 'coordinator',
      },
    });

    const fromAgent = `${meshName}/coordinator`;
    const toAgent = `${meshName}/worker`;

    // Send 3 messages of type 'message' — fires at count >= 3
    trackMessage(dispatcher, fromAgent, toAgent, 'message');
    trackMessage(dispatcher, fromAgent, toAgent, 'message');
    trackMessage(dispatcher, fromAgent, toAgent, 'message');

    await sleep(50);

    const limitEvents = harness.getEvents('edge:limit-reached');
    assert.ok(
      limitEvents.length >= 1,
      `Expected at least 1 edge:limit-reached event, got ${limitEvents.length}. ` +
      `Events: [${harness.getEvents().map(e => e.name).join(', ')}]`
    );

    const evt = limitEvents[0].data;
    assert.strictEqual(evt.meshName, meshName, 'meshName should match');
    assert.strictEqual(evt.from, fromAgent, 'from should be the sending agent');
    assert.strictEqual(evt.to, toAgent, 'to should be the target agent');
    assert.strictEqual(evt.count, 3, 'count should be 3 at threshold');
    assert.strictEqual(evt.max, 3, 'max should match configured routing_retry_max');
    assert.strictEqual(evt.fallback, 'coordinator', 'fallback should match configured routing_fallback');
  });
});
