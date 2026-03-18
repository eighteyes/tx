/**
 * Test 34: Crash Recovery Infrastructure
 *
 * Tests crash-recovery dispatcher mechanics WITHOUT real LLM.
 * Directly exercises restoreSuspendedSessions, killMeshWorkers,
 * and clearMeshState to verify infrastructure-level correctness.
 *
 * Responsibilities:
 * - Verify restoreSuspendedSessions restores SQLite sessions into memory on startup
 * - Verify killMeshWorkers returns 0 when no workers are running
 * - Verify killMeshWorkers emits mesh:killed event with expected payload
 * - Verify clearMeshState removes edge counters and mesh message counters
 * - Verify clearMeshState handles nonexistent mesh without throwing
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

// ============================================================
// Helpers
// ============================================================

const MESH_NAME = 'test-recovery';

function buildDispatcher(env: TestEnv): WorkerDispatcher {
  return new WorkerDispatcher(
    {
      workDir: env.rootDir,
      msgsDir: env.msgsDir,
      meshesDir: env.meshesDir,
    },
    env.queue
  );
}

function setupRecoveryMesh(env: TestEnv): void {
  createTestMesh(env, {
    name: MESH_NAME,
    config: {
      mesh: MESH_NAME,
      agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
      entry_point: 'worker',
      routing: { worker: { complete: { core: 'Done' } } },
    },
    prompts: { 'worker.md': 'Test worker.' },
  });
}

// ============================================================
// Tests
// ============================================================

describe('Crash Recovery Infrastructure', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('crash-recovery');
    setupRecoveryMesh(env);

    dispatcher = buildDispatcher(env);
    harness = new EventHarness(dispatcher);

    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  test('restoreSuspendedSessions recovers sessions on restart', async () => {
    // Persist a suspended session to SQLite before the new dispatcher starts
    env.queue.suspendSession(`${MESH_NAME}/worker`, {
      sessionId: 'session-abc',
      reason: 'await-response',
      suspendedAt: Date.now(),
      meshName: MESH_NAME,
      pendingCount: 1,
    });

    // Create a fresh dispatcher — start() calls restoreSuspendedSessions internally
    const freshDispatcher = buildDispatcher(env);
    await freshDispatcher.start();

    try {
      const restored = (freshDispatcher as any).sessionManager.get(`${MESH_NAME}/worker`);
      assert.ok(
        restored != null,
        `Expected suspended session to be restored in memory, got: ${JSON.stringify(restored)}`
      );
      assert.strictEqual(restored.sessionId, 'session-abc');
      assert.strictEqual(restored.reason, 'await-response');
    } finally {
      await freshDispatcher.stop();
    }
  });

  test('killMeshWorkers returns 0 for empty mesh', async () => {
    // No workers running — killMeshWorkers should find nothing and return 0
    const killed = dispatcher.killMeshWorkers(MESH_NAME);
    assert.strictEqual(killed, 0, `Expected 0 workers killed, got ${killed}`);
  });

  test('killMeshWorkers emits mesh:killed event', async () => {
    dispatcher.killMeshWorkers(MESH_NAME);

    const killedEvents = harness.getEvents('mesh:killed');
    assert.strictEqual(killedEvents.length, 1, 'Should emit exactly 1 mesh:killed event');

    const data = killedEvents[0].data;
    assert.strictEqual(data.meshName, MESH_NAME);
    assert.strictEqual(data.killed, 0);
    assert.deepStrictEqual(data.agents, []);
  });

  test('clearMeshState clears routing error counts and fan-out groups', async () => {
    // Manually prime internal state that clearMeshState should purge.
    // clearMeshState clears routingErrorCounts (by mesh prefix) and fanOutGroups (by mesh prefix).
    // It does NOT clear edgeCounters/meshMessageCounters — those belong to resetEdgeCounters().
    (dispatcher as any).routingErrorCounts.set(`${MESH_NAME}/worker`, 3);
    (dispatcher as any).fanOutGroups.set(`${MESH_NAME}:fan-1`, { agents: ['a', 'b'], completed: [] });

    dispatcher.clearMeshState(MESH_NAME);

    assert.strictEqual(
      (dispatcher as any).routingErrorCounts.get(`${MESH_NAME}/worker`),
      undefined,
      'Routing error count should be cleared after clearMeshState'
    );
    assert.strictEqual(
      (dispatcher as any).fanOutGroups.get(`${MESH_NAME}:fan-1`),
      undefined,
      'Fan-out group should be cleared after clearMeshState'
    );
  });

  test('clearMeshState handles nonexistent mesh gracefully', async () => {
    // Should not throw and should not emit spurious events
    const eventsBefore = harness.getEvents().length;

    assert.doesNotThrow(
      () => dispatcher.clearMeshState('nonexistent-mesh'),
      'clearMeshState should not throw for an unknown mesh'
    );

    // No new events should have been emitted as a side effect
    const eventsAfter = harness.getEvents().length;
    assert.strictEqual(
      eventsAfter,
      eventsBefore,
      `No events should be emitted for nonexistent mesh (before=${eventsBefore}, after=${eventsAfter})`
    );
  });
});
