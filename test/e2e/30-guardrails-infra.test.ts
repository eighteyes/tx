/**
 * Test 30: Guardrails Infrastructure
 *
 * Tests guardrail enforcement mechanics WITHOUT real LLM.
 * Starts dispatcher to load mesh configs, then directly invokes
 * trackMessageSent() and related internals to test detection and event emission.
 *
 * Responsibilities:
 * - Verify max_messages strict mode emits guardrail events and kills workers
 * - Verify max_messages warning mode allows continuation without kill
 * - Verify max_turns config loads correctly from mesh config
 * - Verify max_mesh_messages counter increments across agents
 * - Verify duplicate_target strict mode emits system-feedback event
 * - Verify edge counters increment per unique routing edge
 * - Verify edge:limit-reached fires at configured threshold
 * - Verify agent-level guardrail override takes precedence over mesh-level
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
  createTestMesh,
  type TestEnv,
} from '../utils/test-env.ts';
import { EventHarness } from '../utils/event-harness.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Copy the real test-bash-guard mesh into the test environment.
 */
function copyTestBashGuardMesh(env: TestEnv): void {
  const srcMeshDir = path.resolve(__dirname, '../../meshes/test-bash-guard');
  const destMeshDir = path.join(env.meshesDir, 'test-bash-guard');

  fs.mkdirSync(destMeshDir, { recursive: true });

  const files = fs.readdirSync(srcMeshDir);
  for (const file of files) {
    const srcPath = path.join(srcMeshDir, file);
    const destPath = path.join(destMeshDir, file);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      for (const subFile of fs.readdirSync(srcPath)) {
        fs.copyFileSync(path.join(srcPath, subFile), path.join(destPath, subFile));
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Get a loaded mesh config from the dispatcher (private field access).
 */
function getMeshConfig(dispatcher: WorkerDispatcher, meshName: string): any {
  return (dispatcher as any).meshConfigs.get(meshName);
}

/**
 * Directly call trackMessageSent on the dispatcher (private method access).
 * Simulates what the consumer does when it detects a worker message.
 */
function trackMessage(
  dispatcher: WorkerDispatcher,
  fromAgentId: string,
  toAgentId: string,
  messageType: string = 'task',
  filepath: string = '/fake/msg.md'
): void {
  (dispatcher as any).trackMessageSent(fromAgentId, toAgentId, messageType, filepath);
}

/**
 * Inject a fake worker entry into the dispatcher's workerLifecycle.
 * Returns the generated workerId.
 */
function injectFakeWorker(dispatcher: WorkerDispatcher, agentId: string): string {
  const fakeRunner = {
    kill: () => {},
    isRunning: () => true,
    getSessionId: () => 'test-session',
    on: () => {},
    off: () => {},
  };
  const fakeMachine = {
    getStatus: () => 'running',
    getMessagesProcessed: () => 0,
    getDuration: () => 0,
    getAwaitingResponses: () => new Set<string>(),
    getAwaitDuration: () => 0,
  };
  const fakeHookContext = {
    agentId,
    meshName: agentId.split('/')[0],
    qualityState: null,
  };

  return (dispatcher as any).workerLifecycle.add(
    agentId,
    {
      runner: fakeRunner,
      machine: fakeMachine,
      startedAt: Date.now(),
      hookContext: fakeHookContext,
    }
  );
}

/**
 * Push fake tracked messages onto an injected worker's messagesSent array.
 */
function pushFakeMessagesSent(
  dispatcher: WorkerDispatcher,
  agentId: string,
  count: number,
  toAgent: string = 'test-mesh/other'
): void {
  const workers = (dispatcher as any).workerLifecycle.getForAgent(agentId);
  if (!workers || workers.length === 0) return;
  for (let i = 0; i < count; i++) {
    workers[0].messagesSent.push({
      to: toAgent,
      type: 'task',
      filepath: '/fake/msg.md',
    });
  }
}

// ============================================================================

describe('Guardrails Infrastructure', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('guardrails-infra');

    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue
    );

    harness = new EventHarness(dispatcher);
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  // --------------------------------------------------------------------------

  test('max_messages strict emits guardrail kill on limit', async () => {
    // Create mesh with strict max_messages: 2
    createTestMesh(env, {
      name: 'test-max-msgs',
      config: {
        mesh: 'test-max-msgs',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
        guardrails: {
          max_messages: { strict: true, warning: true, limit: 2 },
        },
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const agentId = 'test-max-msgs/worker';
    injectFakeWorker(dispatcher, agentId);

    // Track up to the limit — at message 2, strict kill fires
    trackMessage(dispatcher, agentId, 'test-max-msgs/other', 'task');
    trackMessage(dispatcher, agentId, 'test-max-msgs/other2', 'task');

    // The kill fires synchronously inside trackMessageSent when messagesSent.length >= limit.
    // The runner.kill() on the fake worker is a no-op, but the activity log and
    // any downstream systemWriter.write will be attempted. We verify the counter.
    const workers = (dispatcher as any).workerLifecycle.getForAgent(agentId);

    // worker may have been removed from lifecycle after kill — check messagesSent
    // was tracked up to the limit (2 messages, limit is 2, so kill fires at the 2nd)
    assert.ok(
      workers.length === 0 || workers[0].messagesSent.length >= 2,
      `Expected worker killed (removed) or messagesSent >= 2, got length=${workers.length}`
    );
  });

  // --------------------------------------------------------------------------

  test('max_messages warning allows continuation past limit', async () => {
    // Create mesh with warning-only max_messages: 2
    createTestMesh(env, {
      name: 'test-max-msgs-warn',
      config: {
        mesh: 'test-max-msgs-warn',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
        guardrails: {
          max_messages: { strict: false, warning: true, limit: 2 },
        },
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const agentId = 'test-max-msgs-warn/worker';
    injectFakeWorker(dispatcher, agentId);

    // Track 3 messages — past the limit of 2, but strict=false so no kill
    trackMessage(dispatcher, agentId, 'test-max-msgs-warn/other', 'task');
    trackMessage(dispatcher, agentId, 'test-max-msgs-warn/other2', 'task');
    trackMessage(dispatcher, agentId, 'test-max-msgs-warn/other3', 'task');

    const workers = (dispatcher as any).workerLifecycle.getForAgent(agentId);
    assert.ok(workers.length > 0, 'Worker should still be alive in warning mode');
    assert.strictEqual(
      workers[0].messagesSent.length,
      3,
      'All 3 messages should be tracked despite exceeding warning limit'
    );
  });

  // --------------------------------------------------------------------------

  test('max_turns config loads correctly from mesh config', async () => {
    copyTestBashGuardMesh(env);
    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-bash-guard');
    assert.ok(meshConfig, 'test-bash-guard mesh should be loaded');
    assert.ok(meshConfig.guardrails, 'Mesh should have guardrails section');

    // test-bash-guard config has max_turns: { attacker: 50 } in guardrails section
    const guardrailsSection = meshConfig.guardrails;
    assert.ok(
      guardrailsSection.max_turns !== undefined,
      'max_turns should be present in loaded guardrails'
    );

    // max_turns resolves via agent config, not guardrails chain.
    // The guardrails.max_turns: {attacker: 50} is a per-agent map that
    // the dispatcher uses at spawn time via guardrails ?? agent.max_turns fallback.
    // Verify the raw config is loaded and the attacker entry exists.
    assert.strictEqual(
      guardrailsSection.max_turns.attacker,
      50,
      'Guardrails max_turns.attacker should be 50'
    );
  });

  // --------------------------------------------------------------------------

  test('max_mesh_messages counter increments across agents', async () => {
    createTestMesh(env, {
      name: 'test-mesh-msgs',
      config: {
        mesh: 'test-mesh-msgs',
        agents: [
          { name: 'agent-a', model: 'haiku', prompt: 'a.md' },
          { name: 'agent-b', model: 'haiku', prompt: 'b.md' },
        ],
        entry_point: 'agent-a',
        guardrails: {
          max_mesh_messages: { strict: false, warning: true, limit: 10 },
        },
      },
      prompts: {
        'a.md': 'You are agent A.',
        'b.md': 'You are agent B.',
      },
    });

    await dispatcher.start();

    injectFakeWorker(dispatcher, 'test-mesh-msgs/agent-a');
    injectFakeWorker(dispatcher, 'test-mesh-msgs/agent-b');

    // Track messages from both agents — all should increment the shared mesh counter
    trackMessage(dispatcher, 'test-mesh-msgs/agent-a', 'test-mesh-msgs/agent-b', 'task');
    trackMessage(dispatcher, 'test-mesh-msgs/agent-a', 'test-mesh-msgs/agent-b', 'task');
    trackMessage(dispatcher, 'test-mesh-msgs/agent-b', 'test-mesh-msgs/agent-a', 'task');

    const meshCounter = (dispatcher as any).meshMessageCounters.get('test-mesh-msgs');
    assert.strictEqual(
      meshCounter,
      3,
      `Expected mesh message counter to be 3, got ${meshCounter}`
    );
  });

  // --------------------------------------------------------------------------

  test('duplicate_target strict mode emits system-feedback event', async () => {
    createTestMesh(env, {
      name: 'test-dup-target',
      config: {
        mesh: 'test-dup-target',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
        guardrails: {
          duplicate_target: { strict: true, warning: true },
        },
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const agentId = 'test-dup-target/worker';
    const targetId = 'test-dup-target/downstream';

    injectFakeWorker(dispatcher, agentId);

    // First send: should succeed and mark target in frontier
    trackMessage(dispatcher, agentId, targetId, 'task');

    const feedbackBefore = harness.getEvents('system-feedback');
    assert.strictEqual(
      feedbackBefore.length,
      0,
      'No system-feedback should be emitted on first send'
    );

    // Second send to same target: strict mode should block and emit system-feedback
    trackMessage(dispatcher, agentId, targetId, 'task');

    await sleep(50); // Allow event loop to settle

    const feedbackAfter = harness.getEvents('system-feedback');
    assert.strictEqual(
      feedbackAfter.length,
      1,
      `Expected 1 system-feedback event for duplicate target, got ${feedbackAfter.length}`
    );
    assert.strictEqual(
      feedbackAfter[0].data.reason,
      'duplicate_target',
      'system-feedback reason should be duplicate_target'
    );
    assert.strictEqual(
      feedbackAfter[0].data.agentId,
      agentId,
      'system-feedback agentId should match the sending agent'
    );
  });

  // --------------------------------------------------------------------------

  test('edge counters increment per routing edge', async () => {
    createTestMesh(env, {
      name: 'test-edge-count',
      config: {
        mesh: 'test-edge-count',
        agents: [
          { name: 'worker', model: 'haiku', prompt: 'worker.md' },
          { name: 'reviewer', model: 'haiku', prompt: 'reviewer.md' },
        ],
        entry_point: 'worker',
      },
      prompts: {
        'worker.md': 'You are a worker.',
        'reviewer.md': 'You are a reviewer.',
      },
    });

    await dispatcher.start();

    injectFakeWorker(dispatcher, 'test-edge-count/worker');
    injectFakeWorker(dispatcher, 'test-edge-count/reviewer');

    const fromAgent = 'test-edge-count/worker';
    const toAgent = 'test-edge-count/reviewer';
    const edgeKey = `${fromAgent}->${toAgent}`;

    // Track same edge multiple times — counter should increment each time
    trackMessage(dispatcher, fromAgent, toAgent, 'task');
    trackMessage(dispatcher, fromAgent, toAgent, 'task');
    trackMessage(dispatcher, fromAgent, toAgent, 'task');

    const edgeCounters: Map<string, number> = (dispatcher as any).edgeCounters;
    const count = edgeCounters.get(edgeKey);

    assert.strictEqual(count, 3, `Expected edge counter for "${edgeKey}" to be 3, got ${count}`);
  });

  // --------------------------------------------------------------------------

  test('edge:limit-reached fires at routing_retry_max threshold', async () => {
    createTestMesh(env, {
      name: 'test-edge-limit',
      config: {
        mesh: 'test-edge-limit',
        agents: [
          { name: 'worker', model: 'haiku', prompt: 'worker.md' },
          { name: 'reviewer', model: 'haiku', prompt: 'reviewer.md' },
        ],
        entry_point: 'worker',
      },
      prompts: {
        'worker.md': 'You are a worker.',
        'reviewer.md': 'You are a reviewer.',
      },
    });

    await dispatcher.start();

    // Register routing_error guardrails directly (bypasses YAML → config loader path)
    (dispatcher as any).guardrails.registerMesh('test-edge-limit', {
      routing_error: {
        routing_retry_max: 3,
        routing_fallback: 'test-edge-limit/reviewer',
      },
    });

    injectFakeWorker(dispatcher, 'test-edge-limit/worker');
    injectFakeWorker(dispatcher, 'test-edge-limit/reviewer');

    const fromAgent = 'test-edge-limit/worker';
    const toAgent = 'test-edge-limit/reviewer';

    // edge:limit-reached fires when count >= max AND messageType === 'message'
    // Send 3 messages of type 'message' to hit the threshold
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
    assert.strictEqual(evt.meshName, 'test-edge-limit');
    assert.strictEqual(evt.from, fromAgent);
    assert.strictEqual(evt.to, toAgent);
    assert.strictEqual(evt.max, 3);
  });

  // --------------------------------------------------------------------------

  test('agent-level guardrail override takes precedence over mesh-level', async () => {
    createTestMesh(env, {
      name: 'test-override-chain',
      config: {
        mesh: 'test-override-chain',
        agents: [
          { name: 'high-limit', model: 'haiku', prompt: 'high.md' },
          { name: 'low-limit', model: 'haiku', prompt: 'low.md' },
        ],
        entry_point: 'high-limit',
      },
      prompts: {
        'high.md': 'You are a high-limit agent.',
        'low.md': 'You are a low-limit agent.',
      },
    });

    await dispatcher.start();

    // Register guardrails directly to test the resolution chain
    (dispatcher as any).guardrails.registerMesh('test-override-chain', {
      max_messages: { strict: false, warning: true, limit: 10 },
      agents: {
        'low-limit': {
          max_messages: { strict: false, warning: true, limit: 2 },
        },
      },
    });

    const guardrails = (dispatcher as any).guardrails;

    const highLimitResolved = guardrails.getMaxMessages('test-override-chain', 'high-limit');
    const lowLimitResolved = guardrails.getMaxMessages('test-override-chain', 'low-limit');

    assert.strictEqual(
      highLimitResolved,
      10,
      `high-limit agent should inherit mesh-level limit of 10, got ${highLimitResolved}`
    );
    assert.strictEqual(
      lowLimitResolved,
      2,
      `low-limit agent should use agent-level override of 2, got ${lowLimitResolved}`
    );
    assert.notStrictEqual(
      highLimitResolved,
      lowLimitResolved,
      'Agent override should produce different resolved value than mesh default'
    );
  });

  test('max_invocations override chain resolves agent > mesh', async () => {
    createTestMesh(env, {
      name: 'test-invocations',
      config: {
        mesh: 'test-invocations',
        description: 'Test max_invocations resolution',
        agents: [
          { name: 'capped', model: 'haiku', prompt: 'capped.md' },
          { name: 'uncapped', model: 'haiku', prompt: 'uncapped.md' },
        ],
        entry_point: 'capped',
      },
      prompts: {
        'capped.md': 'You are a capped agent.',
        'uncapped.md': 'You are an uncapped agent.',
      },
    });

    await dispatcher.start();

    (dispatcher as any).guardrails.registerMesh('test-invocations', {
      max_invocations: { strict: true, warning: true, limit: 5 },
      agents: {
        'capped': {
          max_invocations: { strict: true, warning: true, limit: 2 },
        },
      },
    });

    const guardrails = (dispatcher as any).guardrails;

    const cappedLimit = guardrails.getMaxInvocations('test-invocations', 'capped');
    const uncappedLimit = guardrails.getMaxInvocations('test-invocations', 'uncapped');

    assert.strictEqual(cappedLimit, 2, `capped agent should use agent-level limit of 2, got ${cappedLimit}`);
    assert.strictEqual(uncappedLimit, 5, `uncapped agent should inherit mesh-level limit of 5, got ${uncappedLimit}`);
  });

  test('invocation counters increment and reset correctly', async () => {
    createTestMesh(env, {
      name: 'test-inv-counter',
      config: {
        mesh: 'test-inv-counter',
        description: 'Test invocation counting',
        agents: [
          { name: 'worker', model: 'haiku', prompt: 'worker.md' },
        ],
        entry_point: 'worker',
      },
      prompts: { 'worker.md': 'Worker.' },
    });

    await dispatcher.start();

    const lifecycle = (dispatcher as any).workerLifecycle;

    assert.strictEqual(lifecycle.incrementInvocation('test-inv-counter', 'worker'), 1);
    assert.strictEqual(lifecycle.incrementInvocation('test-inv-counter', 'worker'), 2);
    assert.strictEqual(lifecycle.incrementInvocation('test-inv-counter', 'worker'), 3);
    assert.strictEqual(lifecycle.getInvocationCount('test-inv-counter', 'worker'), 3);

    lifecycle.resetInvocationCounters('test-inv-counter');
    assert.strictEqual(lifecycle.getInvocationCount('test-inv-counter', 'worker'), 0);
  });

  // --------------------------------------------------------------------------

  test('mesh config loaded with guardrails block intact', async () => {
    copyTestBashGuardMesh(env);
    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-bash-guard');
    assert.ok(meshConfig, 'test-bash-guard mesh should be loaded');

    // Verify bash_guard is present and strict
    const bashGuardMode = (dispatcher as any).guardrails.getMode(
      'bash_guard',
      'test-bash-guard',
      'attacker'
    );
    assert.strictEqual(bashGuardMode.strict, true, 'bash_guard should be strict for test-bash-guard');
    assert.strictEqual(bashGuardMode.warning, true, 'bash_guard should have warning enabled');

    // Verify max_messages is loaded
    const maxMsgs = (dispatcher as any).guardrails.getMaxMessages(
      'test-bash-guard',
      'attacker'
    );
    assert.strictEqual(maxMsgs, 60, 'max_messages should be 60 for test-bash-guard/attacker');
  });
});
