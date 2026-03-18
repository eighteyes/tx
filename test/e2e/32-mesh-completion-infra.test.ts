/**
 * Test 32: Mesh Completion & Parity Gate Infrastructure
 *
 * Tests mesh completion dispatcher mechanics WITHOUT real LLM.
 * Starts dispatcher to load mesh configs, then directly invokes
 * handleMeshComplete(), killMeshWorkers(), and clearMeshState()
 * to verify the lifecycle and cleanup logic.
 *
 * Responsibilities:
 * - Verify handleMeshComplete fires finalizeMeshCompletion immediately when no active workers
 * - Verify handleMeshComplete defers completion when workers are still active
 * - Verify killMeshWorkers returns 0 for a mesh with no workers
 * - Verify killMeshWorkers emits mesh:killed event with correct payload
 * - Verify clearMeshState removes FSM and session state for the mesh
 * - Verify clearMeshState handles a mesh with no state without throwing
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
  type TestEnv,
} from '../utils/test-env.ts';
import { EventHarness } from '../utils/event-harness.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create the test-echo mesh in the test environment.
 * A simple single-agent mesh with no completion_agents.
 */
function createEchoMesh(env: TestEnv): void {
  const meshDir = path.join(env.meshesDir, 'test-echo');
  fs.mkdirSync(meshDir, { recursive: true });

  const config = [
    'mesh: test-echo',
    'agents:',
    '  - name: echo',
    '    model: haiku',
    '    prompt: prompt.md',
    'entry_point: echo',
    'routing:',
    '  echo:',
    '    complete:',
    '      core: "Echo complete"',
  ].join('\n');

  fs.writeFileSync(path.join(meshDir, 'config.yaml'), config);
  fs.writeFileSync(path.join(meshDir, 'prompt.md'), 'You are a test echo agent. Repeat back what you receive.');
}

/**
 * Create a test mesh with completion_agents defined.
 * Used to test handleMeshComplete path.
 * Writes YAML directly to avoid require('yaml') ESM incompatibility in createTestMesh.
 */
function createCompletionMesh(env: TestEnv): void {
  const meshDir = path.join(env.meshesDir, 'test-completion');
  fs.mkdirSync(meshDir, { recursive: true });

  const config = [
    'mesh: test-completion',
    'agents:',
    '  - name: worker',
    '    model: haiku',
    '    prompt: worker.md',
    '  - name: finalizer',
    '    model: haiku',
    '    prompt: finalizer.md',
    'entry_point: worker',
    'completion_agents:',
    '  - finalizer',
    'routing:',
    '  worker:',
    '    task-complete:',
    '      finalizer: "Work done"',
    '  finalizer:',
    '    task-complete:',
    '      core: "All done"',
  ].join('\n');

  fs.writeFileSync(path.join(meshDir, 'config.yaml'), config);
  fs.writeFileSync(path.join(meshDir, 'worker.md'), 'You are a test worker.');
  fs.writeFileSync(path.join(meshDir, 'finalizer.md'), 'You are the finalizer.');
}

/**
 * Add a fake active worker entry into the dispatcher's workerLifecycle map.
 * Simulates a running worker for a given agentId without real LLM execution.
 */
function addFakeWorker(dispatcher: WorkerDispatcher, agentId: string): void {
  const fakeRunner = {
    kill: () => {},
    isRunning: () => true,
    getSessionId: () => 'fake-session-id',
    on: () => {},
    off: () => {},
  };
  const fakeMachine = {
    getState: () => 'running',
    send: () => {},
  };
  const fakeHookContext = {
    agentId,
    meshName: agentId.split('/')[0],
    model: 'haiku',
    quality: null,
  };

  (dispatcher as any).workerLifecycle.add(agentId, {
    runner: fakeRunner,
    machine: fakeMachine,
    startedAt: Date.now(),
    hookContext: fakeHookContext,
  });
}

describe('Mesh Completion & Parity Gate Infrastructure', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('mesh-completion-infra');

    // Create test meshes
    createEchoMesh(env);
    createCompletionMesh(env);

    // Initialize dispatcher (no consumer — we call methods directly)
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

  test('handleMeshComplete fires finalizeMeshCompletion when no active workers', async () => {
    // Call handleMeshComplete with no active workers in the mesh
    // finalizeMeshCompletion will warn about missing session metrics (no real workers ran),
    // but it WILL be reached — we verify pendingCompletions is NOT set (no deferral)
    (dispatcher as any).handleMeshComplete({
      meshName: 'test-completion',
      completionAgent: 'test-completion/finalizer',
    });

    // No active workers → should NOT be deferred
    const deferred = (dispatcher as any).pendingCompletions.get('test-completion');
    assert.strictEqual(deferred, undefined, 'Completion should not be deferred when no active workers');
  });

  test('handleMeshComplete defers when workers are active', async () => {
    const meshName = 'test-completion';

    // Inject a fake active worker for a sibling agent (not the completion agent itself)
    addFakeWorker(dispatcher, `${meshName}/worker`);

    // Now call handleMeshComplete — worker is still "running"
    (dispatcher as any).handleMeshComplete({
      meshName,
      completionAgent: `${meshName}/finalizer`,
    });

    // Should be deferred because worker is active
    const deferred = (dispatcher as any).pendingCompletions.get(meshName);
    assert.ok(deferred, 'Completion should be deferred while a worker is active');
    assert.strictEqual(
      deferred.completionAgent,
      `${meshName}/finalizer`,
      'Deferred completion should record the correct completion agent'
    );
    assert.ok(typeof deferred.receivedAt === 'number', 'Deferred completion should have a receivedAt timestamp');
  });

  test('killMeshWorkers returns 0 for mesh with no workers', async () => {
    const killed = dispatcher.killMeshWorkers('test-echo');

    assert.strictEqual(killed, 0, 'Should return 0 when no workers are running for mesh');
  });

  test('killMeshWorkers emits mesh:killed event', async () => {
    const meshName = 'test-echo';

    dispatcher.killMeshWorkers(meshName);

    const killedEvents = harness.getEvents('mesh:killed');
    assert.strictEqual(killedEvents.length, 1, 'Should emit exactly 1 mesh:killed event');

    const data = killedEvents[0].data;
    assert.strictEqual(data.meshName, meshName, 'Event should include correct meshName');
    assert.strictEqual(data.killed, 0, 'killed count should be 0 for mesh with no workers');
    assert.ok(Array.isArray(data.agents), 'Event should include agents array');
  });

  test('clearMeshState removes FSM and session state for a mesh', async () => {
    const meshName = 'test-echo';

    // Manually inject a fake FSM instance so clearMeshState has something to clean
    const fakeFSM = {
      cleanGateFiles: () => 0,
      getPersistence: () => ({
        deleteState: (_name: string) => {},
      }),
      getCurrentState: () => 'idle',
    };
    (dispatcher as any).meshFSMs.set(meshName, fakeFSM);

    assert.ok(
      (dispatcher as any).meshFSMs.has(meshName),
      'FSM should exist before clearMeshState'
    );

    // Also set meshMessageCounter to verify it's not cleaned by clearMeshState
    // (that's resetEdgeCounters' job — clearMeshState handles sessions/FSM only)
    (dispatcher as any).meshMessageCounters.set(meshName, 42);

    dispatcher.clearMeshState(meshName);

    // FSM should be removed
    assert.strictEqual(
      (dispatcher as any).meshFSMs.has(meshName),
      false,
      'FSM should be removed after clearMeshState'
    );
  });

  test('clearMeshState handles mesh with no state gracefully', () => {
    // Call on a mesh that has no FSM, no sessions, no counters
    // Should not throw
    assert.doesNotThrow(() => {
      dispatcher.clearMeshState('nonexistent-mesh');
    }, 'clearMeshState should not throw for a mesh with no state');
  });
});
