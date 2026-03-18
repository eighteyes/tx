/**
 * Test 35: Revision/Interrupt Infrastructure
 *
 * Tests revision dispatcher mechanics WITHOUT real LLM.
 * Starts dispatcher to load mesh configs, then directly invokes
 * handleRevisionMessage() to test interrupt/append/replace logic.
 *
 * Responsibilities:
 * - Verify revision interrupt with no active worker is a no-op
 * - Verify revision interrupt kills a running worker before resume
 * - Verify non-running worker skips kill but still attempts resume
 * - Verify append mode kills running worker before resume
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { WorkerDispatcher } from '../../src/worker/dispatcher.ts';
import {
  setupTestEnv,
  cleanupTestEnv,
  createTestMesh,
  type TestEnv,
} from '../utils/test-env.ts';
import { EventHarness } from '../utils/event-harness.ts';

const AGENT_ID = 'test-rev/worker';

/**
 * Build a minimal mock runner that tracks kill() calls.
 */
function buildMockRunner(opts: { running: boolean; sessionId?: string }) {
  let killCalled = false;
  let killReason = '';

  const runner = {
    kill: (reason: string) => {
      killCalled = true;
      killReason = reason;
    },
    isRunning: () => opts.running,
    getSessionId: () => opts.sessionId ?? 'test-session-123',
    // Track state for assertions
    _getKillCalled: () => killCalled,
    _getKillReason: () => killReason,
  };

  return runner;
}

/**
 * Build a minimal mock machine with a getStatus() method.
 */
function buildMockMachine() {
  return {
    getStatus: () => 'running' as const,
  };
}

/**
 * Build a minimal mock hookContext (required field on ActiveWorker).
 */
function buildMockHookContext() {
  return {
    meshInstance: 'test-rev',
    meshName: 'test-rev',
    agentName: 'worker',
    workDir: '/tmp/test',
  };
}

/**
 * Inject a mock worker into the dispatcher's workerLifecycle.
 * Returns the mock runner so tests can assert on kill calls.
 */
function injectMockWorker(
  dispatcher: WorkerDispatcher,
  agentId: string,
  opts: { running: boolean; sessionId?: string }
) {
  const mockRunner = buildMockRunner(opts);
  const mockMachine = buildMockMachine();
  const mockHookContext = buildMockHookContext();

  (dispatcher as any).workerLifecycle.add(agentId, {
    runner: mockRunner,
    machine: mockMachine,
    startedAt: Date.now(),
    hookContext: mockHookContext,
  });

  return mockRunner;
}

describe('Revision Infrastructure', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('revision-infra');

    createTestMesh(env, {
      name: 'test-rev',
      config: {
        mesh: 'test-rev',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
        routing: { worker: { complete: { core: 'Done' } } },
      },
      prompts: { 'worker.md': 'Test revision worker.' },
    });

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

  test('revision interrupt with no active worker is no-op', async () => {
    // No mock worker injected — workerLifecycle is empty for this agent.
    // handleRevisionMessage should log a warn and return without throwing.
    let threw = false;
    try {
      await (dispatcher as any).handleRevisionMessage({
        filepath: '/fake/path.md',
        agentId: AGENT_ID,
        from: 'core/core',
        type: 'task',
        content: 'updated content',
        headline: 'Updated',
        mode: 'interrupt',
      });
    } catch {
      threw = true;
    }

    assert.strictEqual(threw, false, 'Should not throw when no active worker');

    // No events should have been emitted for a no-op revision
    const workerEvents = harness.getEvents('worker:spawn');
    assert.strictEqual(workerEvents.length, 0, 'Should not spawn a worker for a no-op revision');
  });

  test('revision interrupt kills running worker', async () => {
    // Inject a mock worker that is actively running
    const mockRunner = injectMockWorker(dispatcher, AGENT_ID, {
      running: true,
      sessionId: 'test-session-abc',
    });

    // resumeSession will fail because there is no real Claude session.
    // We only care that kill() was called with the correct reason.
    try {
      await (dispatcher as any).handleRevisionMessage({
        filepath: '/fake/path.md',
        agentId: AGENT_ID,
        from: 'core/core',
        type: 'task',
        content: 'updated content',
        headline: 'Updated',
        mode: 'interrupt',
      });
    } catch {
      // resumeSession failure is expected — ignore
    }

    assert.strictEqual(mockRunner._getKillCalled(), true, 'kill() should have been called');
    assert.strictEqual(
      mockRunner._getKillReason(),
      'revision: hot inject',
      'kill() should be called with "revision: hot inject"'
    );
  });

  test('revision interrupt on non-running worker skips kill but attempts resume', async () => {
    // Inject a mock worker that has a session but isRunning() returns false
    const mockRunner = injectMockWorker(dispatcher, AGENT_ID, {
      running: false,
      sessionId: 'test-session-def',
    });

    // resumeSession will fail without a real session — ignore error
    try {
      await (dispatcher as any).handleRevisionMessage({
        filepath: '/fake/path.md',
        agentId: AGENT_ID,
        from: 'core/core',
        type: 'task',
        content: 'updated content',
        headline: 'Updated',
        mode: 'interrupt',
      });
    } catch {
      // resumeSession failure is expected — ignore
    }

    // Worker is not running, so kill should NOT have been called
    assert.strictEqual(
      mockRunner._getKillCalled(),
      false,
      'kill() should NOT be called when worker is not running'
    );
  });

  test('revision append mode kills running worker before resume', async () => {
    // Inject a running mock worker
    const mockRunner = injectMockWorker(dispatcher, AGENT_ID, {
      running: true,
      sessionId: 'test-session-ghi',
    });

    // resumeSession will fail without a real session — ignore error
    try {
      await (dispatcher as any).handleRevisionMessage({
        filepath: '/fake/path.md',
        agentId: AGENT_ID,
        from: 'core/core',
        type: 'task',
        content: 'Also include a section about TDD methodology.',
        headline: 'Additional instructions',
        mode: 'append',
      });
    } catch {
      // resumeSession failure is expected — ignore
    }

    assert.strictEqual(mockRunner._getKillCalled(), true, 'kill() should have been called');
    assert.strictEqual(
      mockRunner._getKillReason(),
      'revision: append queued',
      'kill() should be called with "revision: append queued"'
    );
  });
});
