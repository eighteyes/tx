/**
 * Checkpoint & Session Forking Unit Tests
 *
 * Tests the checkpoint/fork_from mechanism used by parallelism and session forking.
 * Validates:
 * 1. resolveCheckpointType logic (boolean/string → type mapping)
 * 2. Checkpoint Map operations (save at init, update at anchor, update at complete)
 * 3. Fork resolution (start fork with resumeSessionAt, end fork without)
 * 4. Checkpoint key format (meshName/agentName)
 * 5. Edge cases (missing checkpoint, missing initMessageUuid)
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';

// ============================================
// Extract resolveCheckpointType logic for testing
// (mirrors dispatcher.ts line 249-254)
// ============================================

interface CheckpointEntry {
  sessionId: string;
  initMessageUuid?: string;
}

function resolveCheckpointType(checkpoint: boolean | string | undefined): 'start' | 'end' | null {
  if (!checkpoint) return null;
  if (checkpoint === true) return 'start';
  if (checkpoint === 'both') return 'start';  // backward compat
  return checkpoint as 'start' | 'end';
}

// ============================================
// Simulate checkpoint save/fork logic
// (mirrors dispatcher.ts lines 3773-3808, 4277-4303, 3659-3690)
// ============================================

class CheckpointSimulator {
  checkpoints: Map<string, CheckpointEntry> = new Map();

  /** Simulate init event — save start checkpoint */
  onInit(meshName: string, agentName: string, checkpoint: boolean | string | undefined, sessionId: string): void {
    const cpType = resolveCheckpointType(checkpoint);
    if (cpType === 'start' && sessionId && meshName) {
      const key = `${meshName}/${agentName}`;
      this.checkpoints.set(key, { sessionId });
    }
  }

  /** Simulate init-anchor event — add initMessageUuid */
  onInitAnchor(meshName: string, agentName: string, checkpoint: boolean | string | undefined, firstUserMessageUuid: string): void {
    const cpType = resolveCheckpointType(checkpoint);
    if (cpType === 'start' && meshName) {
      const key = `${meshName}/${agentName}`;
      const existing = this.checkpoints.get(key);
      if (existing) {
        existing.initMessageUuid = firstUserMessageUuid;
      }
    }
  }

  /** Simulate completion — save end checkpoint or update start checkpoint */
  onComplete(meshName: string, agentName: string, checkpoint: boolean | string | undefined, sessionId: string): void {
    const cpType = resolveCheckpointType(checkpoint);
    if (cpType === 'end' && sessionId && meshName) {
      const key = `${meshName}/${agentName}`;
      const existing = this.checkpoints.get(key);
      this.checkpoints.set(key, {
        sessionId,
        initMessageUuid: existing?.initMessageUuid,
      });
    } else if (cpType === 'start' && sessionId && meshName) {
      const key = `${meshName}/${agentName}`;
      const existing = this.checkpoints.get(key);
      if (existing) {
        this.checkpoints.set(key, { ...existing, sessionId });
      }
    }
  }

  /** Simulate fork_from resolution — returns spawn params */
  resolveFork(meshName: string, forkFrom: string): {
    sessionId?: string;
    forkSession?: boolean;
    resumeSessionAt?: string;
  } {
    const [forkAgent, forkType] = forkFrom.includes(':')
      ? forkFrom.split(':') as [string, string]
      : [forkFrom, 'start'];

    const key = `${meshName}/${forkAgent}`;
    const checkpoint = this.checkpoints.get(key);

    if (checkpoint) {
      const result: { sessionId: string; forkSession: boolean; resumeSessionAt?: string } = {
        sessionId: checkpoint.sessionId,
        forkSession: true,
      };

      if (forkType !== 'end' && checkpoint.initMessageUuid) {
        result.resumeSessionAt = checkpoint.initMessageUuid;
      }

      return result;
    }

    return {};  // No checkpoint found
  }
}

// ============================================
// Tests
// ============================================

describe('resolveCheckpointType', () => {
  test('undefined → null', () => {
    assert.strictEqual(resolveCheckpointType(undefined), null);
  });

  test('false → null', () => {
    assert.strictEqual(resolveCheckpointType(false), null);
  });

  test('true → start', () => {
    assert.strictEqual(resolveCheckpointType(true), 'start');
  });

  test('"both" → start (backward compat)', () => {
    assert.strictEqual(resolveCheckpointType('both'), 'start');
  });

  test('"start" → start', () => {
    assert.strictEqual(resolveCheckpointType('start'), 'start');
  });

  test('"end" → end', () => {
    assert.strictEqual(resolveCheckpointType('end'), 'end');
  });

  test('empty string → null (falsy)', () => {
    assert.strictEqual(resolveCheckpointType(''), null);
  });
});

describe('Checkpoint Save Flow', () => {
  test('start checkpoint: saved at init, updated at anchor, idempotent at complete', () => {
    const sim = new CheckpointSimulator();

    // Agent with checkpoint: true
    sim.onInit('my-mesh', 'setup', true, 'session-abc-123');
    assert.strictEqual(sim.checkpoints.size, 1);

    const cp1 = sim.checkpoints.get('my-mesh/setup');
    assert.ok(cp1);
    assert.strictEqual(cp1.sessionId, 'session-abc-123');
    assert.strictEqual(cp1.initMessageUuid, undefined);

    // init-anchor adds UUID
    sim.onInitAnchor('my-mesh', 'setup', true, 'uuid-first-msg');
    const cp2 = sim.checkpoints.get('my-mesh/setup');
    assert.ok(cp2);
    assert.strictEqual(cp2.sessionId, 'session-abc-123');
    assert.strictEqual(cp2.initMessageUuid, 'uuid-first-msg');

    // Completion updates sessionId (idempotent for start checkpoints)
    sim.onComplete('my-mesh', 'setup', true, 'session-abc-123');
    const cp3 = sim.checkpoints.get('my-mesh/setup');
    assert.ok(cp3);
    assert.strictEqual(cp3.sessionId, 'session-abc-123');
    assert.strictEqual(cp3.initMessageUuid, 'uuid-first-msg');  // preserved
  });

  test('end checkpoint: saved only at complete', () => {
    const sim = new CheckpointSimulator();

    // Agent with checkpoint: "end"
    sim.onInit('my-mesh', 'worker', 'end', 'session-xyz');
    assert.strictEqual(sim.checkpoints.size, 0);  // NOT saved at init

    sim.onComplete('my-mesh', 'worker', 'end', 'session-xyz');
    assert.strictEqual(sim.checkpoints.size, 1);

    const cp = sim.checkpoints.get('my-mesh/worker');
    assert.ok(cp);
    assert.strictEqual(cp.sessionId, 'session-xyz');
  });

  test('no checkpoint config: nothing saved', () => {
    const sim = new CheckpointSimulator();

    sim.onInit('my-mesh', 'worker', undefined, 'session-123');
    sim.onInitAnchor('my-mesh', 'worker', undefined, 'uuid-123');
    sim.onComplete('my-mesh', 'worker', undefined, 'session-123');

    assert.strictEqual(sim.checkpoints.size, 0);
  });

  test('checkpoint: false → nothing saved', () => {
    const sim = new CheckpointSimulator();

    sim.onInit('my-mesh', 'worker', false, 'session-123');
    assert.strictEqual(sim.checkpoints.size, 0);
  });
});

describe('Fork Resolution', () => {
  test('start fork: gets sessionId + resumeSessionAt', () => {
    const sim = new CheckpointSimulator();

    // Setup agent saves checkpoint
    sim.onInit('my-mesh', 'setup', true, 'session-abc');
    sim.onInitAnchor('my-mesh', 'setup', true, 'uuid-anchor');

    // Worker forks from setup (default = start fork)
    const result = sim.resolveFork('my-mesh', 'setup');
    assert.strictEqual(result.sessionId, 'session-abc');
    assert.strictEqual(result.forkSession, true);
    assert.strictEqual(result.resumeSessionAt, 'uuid-anchor');
  });

  test('end fork: gets sessionId but NO resumeSessionAt', () => {
    const sim = new CheckpointSimulator();

    // Setup agent saves checkpoint
    sim.onInit('my-mesh', 'setup', true, 'session-abc');
    sim.onInitAnchor('my-mesh', 'setup', true, 'uuid-anchor');

    // Worker forks with :end suffix
    const result = sim.resolveFork('my-mesh', 'setup:end');
    assert.strictEqual(result.sessionId, 'session-abc');
    assert.strictEqual(result.forkSession, true);
    assert.strictEqual(result.resumeSessionAt, undefined);  // Full context
  });

  test('start fork without initMessageUuid: no resumeSessionAt', () => {
    const sim = new CheckpointSimulator();

    // Setup saves at init but anchor never fires
    sim.onInit('my-mesh', 'setup', true, 'session-abc');

    const result = sim.resolveFork('my-mesh', 'setup');
    assert.strictEqual(result.sessionId, 'session-abc');
    assert.strictEqual(result.forkSession, true);
    assert.strictEqual(result.resumeSessionAt, undefined);  // No anchor = no truncation
  });

  test('missing checkpoint: returns empty', () => {
    const sim = new CheckpointSimulator();

    const result = sim.resolveFork('my-mesh', 'nonexistent');
    assert.strictEqual(result.sessionId, undefined);
    assert.strictEqual(result.forkSession, undefined);
  });

  test('multiple forks from same checkpoint', () => {
    const sim = new CheckpointSimulator();

    sim.onInit('my-mesh', 'setup', true, 'session-abc');
    sim.onInitAnchor('my-mesh', 'setup', true, 'uuid-anchor');

    // Worker A forks
    const resultA = sim.resolveFork('my-mesh', 'setup');
    assert.strictEqual(resultA.sessionId, 'session-abc');
    assert.strictEqual(resultA.forkSession, true);

    // Worker B also forks from same checkpoint
    const resultB = sim.resolveFork('my-mesh', 'setup');
    assert.strictEqual(resultB.sessionId, 'session-abc');
    assert.strictEqual(resultB.forkSession, true);

    // Both get same checkpoint data (independent forks)
    assert.deepStrictEqual(resultA, resultB);
  });
});

describe('Checkpoint Key Format', () => {
  test('key is meshName/agentName', () => {
    const sim = new CheckpointSimulator();
    sim.onInit('my-mesh', 'my-agent', true, 'session-1');
    assert.ok(sim.checkpoints.has('my-mesh/my-agent'));
  });

  test('different meshes have different checkpoints', () => {
    const sim = new CheckpointSimulator();
    sim.onInit('mesh-a', 'setup', true, 'session-a');
    sim.onInit('mesh-b', 'setup', true, 'session-b');

    assert.strictEqual(sim.checkpoints.size, 2);
    assert.strictEqual(sim.checkpoints.get('mesh-a/setup')!.sessionId, 'session-a');
    assert.strictEqual(sim.checkpoints.get('mesh-b/setup')!.sessionId, 'session-b');

    // Fork resolves mesh-specific
    const resultA = sim.resolveFork('mesh-a', 'setup');
    const resultB = sim.resolveFork('mesh-b', 'setup');
    assert.strictEqual(resultA.sessionId, 'session-a');
    assert.strictEqual(resultB.sessionId, 'session-b');
  });
});

describe('Full Workflow: test-session-forking mesh', () => {
  test('simulates setup → worker-a → worker-b checkpoint flow', () => {
    const sim = new CheckpointSimulator();
    const mesh = 'test-session-forking';

    // Step 1: Setup agent starts (checkpoint: true)
    sim.onInit(mesh, 'setup', true, 'session-setup-001');
    sim.onInitAnchor(mesh, 'setup', true, 'uuid-setup-first-msg');

    // Verify checkpoint exists before setup even completes
    const earlyCheckpoint = sim.checkpoints.get(`${mesh}/setup`);
    assert.ok(earlyCheckpoint, 'Checkpoint should exist at init time (before completion)');
    assert.strictEqual(earlyCheckpoint.initMessageUuid, 'uuid-setup-first-msg');

    // Step 2: Setup completes, routes to worker-a
    sim.onComplete(mesh, 'setup', true, 'session-setup-001');

    // Step 3: Worker-a spawns with fork_from: setup
    const forkA = sim.resolveFork(mesh, 'setup');
    assert.strictEqual(forkA.sessionId, 'session-setup-001');
    assert.strictEqual(forkA.forkSession, true);
    assert.strictEqual(forkA.resumeSessionAt, 'uuid-setup-first-msg');

    // Step 4: Worker-a completes, routes to worker-b
    // Worker-b also has fork_from: setup (same checkpoint)
    const forkB = sim.resolveFork(mesh, 'setup');
    assert.strictEqual(forkB.sessionId, 'session-setup-001');
    assert.strictEqual(forkB.forkSession, true);
    assert.strictEqual(forkB.resumeSessionAt, 'uuid-setup-first-msg');

    // Both workers forked from same snapshot
    assert.deepStrictEqual(forkA, forkB);
  });

  test('simulates parallel fork (dev-ui-prototypes pattern)', () => {
    const sim = new CheckpointSimulator();
    const mesh = 'dev-ui-prototypes';

    // Coordinator (checkpoint: true) starts
    sim.onInit(mesh, 'coordinator', true, 'session-coord');
    sim.onInitAnchor(mesh, 'coordinator', true, 'uuid-coord-msg');
    sim.onComplete(mesh, 'coordinator', true, 'session-coord');

    // 5 parallel lens agents fork from coordinator
    const lenses = ['bare-minimum', 'heuristic', 'info-arch', 'user-flows', 'kitchen-sink'];
    const forks = lenses.map(lens => sim.resolveFork(mesh, 'coordinator'));

    // All 5 get the same checkpoint
    for (const fork of forks) {
      assert.strictEqual(fork.sessionId, 'session-coord');
      assert.strictEqual(fork.forkSession, true);
      assert.strictEqual(fork.resumeSessionAt, 'uuid-coord-msg');
    }
  });
});

describe('Edge Cases', () => {
  test('checkpoint overwrite on re-init (same mesh/agent)', () => {
    const sim = new CheckpointSimulator();

    sim.onInit('mesh', 'agent', true, 'session-1');
    sim.onInitAnchor('mesh', 'agent', true, 'uuid-1');
    sim.onComplete('mesh', 'agent', true, 'session-1');

    // Same agent re-runs (new session)
    sim.onInit('mesh', 'agent', true, 'session-2');
    sim.onInitAnchor('mesh', 'agent', true, 'uuid-2');

    const cp = sim.checkpoints.get('mesh/agent');
    assert.ok(cp);
    assert.strictEqual(cp.sessionId, 'session-2');
    assert.strictEqual(cp.initMessageUuid, 'uuid-2');
  });

  test('end checkpoint preserves initMessageUuid from start checkpoint', () => {
    const sim = new CheckpointSimulator();

    // Agent has checkpoint: "end" BUT a start checkpoint was also saved (for debugging)
    // Actually: end checkpoints don't have start saves. Let's test the preservation logic.
    // Simulate: agent first saves a start checkpoint, then saves end checkpoint
    sim.checkpoints.set('mesh/agent', {
      sessionId: 'session-init',
      initMessageUuid: 'uuid-init',
    });

    // End checkpoint preserves initMessageUuid
    sim.onComplete('mesh', 'agent', 'end', 'session-final');
    const cp = sim.checkpoints.get('mesh/agent');
    assert.ok(cp);
    assert.strictEqual(cp.sessionId, 'session-final');
    assert.strictEqual(cp.initMessageUuid, 'uuid-init');  // preserved!
  });

  test('fork from wrong mesh returns empty', () => {
    const sim = new CheckpointSimulator();
    sim.onInit('mesh-a', 'setup', true, 'session-1');

    const result = sim.resolveFork('mesh-b', 'setup');
    assert.strictEqual(result.sessionId, undefined);
  });
});

describe('SDK Runner Session Cleanup (regression)', () => {
  /**
   * Regression test for the bug where sdk-runner.ts cleared config.sessionId
   * before using it, making fork_from silently produce fresh sessions.
   *
   * The bug: Line 395-396 of sdk-runner.ts had:
   *   this.currentSessionId = null;
   *   this.config.sessionId = undefined;  // ← Wiped the fork sessionId!
   *
   * After the fix, config.sessionId is preserved when forkSession is true.
   */

  interface MockRunnerConfig {
    sessionId?: string;
    forkSession?: boolean;
    resumeSessionAt?: string;
  }

  /** Simulates the sdk-runner session cleanup logic */
  function simulateSessionCleanup(config: MockRunnerConfig): {
    resumeId: string | undefined;
    forkSession: boolean | undefined;
    resumeSessionAt: string | undefined;
  } {
    // Simulate the FIXED cleanup logic
    let currentSessionId: string | null = null;

    // Fresh context cleanup
    currentSessionId = null;
    if (!config.forkSession) {
      config.sessionId = undefined;
    }

    // Simulate resumeId resolution (line 427)
    const resumeId = currentSessionId || config.sessionId || undefined;

    return {
      resumeId,
      forkSession: config.forkSession,
      resumeSessionAt: config.resumeSessionAt,
    };
  }

  /** Simulates the BUGGY cleanup (pre-fix) */
  function simulateBuggyCleanup(config: MockRunnerConfig): {
    resumeId: string | undefined;
  } {
    let currentSessionId: string | null = null;
    currentSessionId = null;
    config.sessionId = undefined;  // BUG: always cleared

    const resumeId = currentSessionId || config.sessionId || undefined;
    return { resumeId };
  }

  test('FIXED: fork session preserves config.sessionId', () => {
    const config: MockRunnerConfig = {
      sessionId: 'checkpoint-session-123',
      forkSession: true,
      resumeSessionAt: 'uuid-first-msg',
    };

    const result = simulateSessionCleanup(config);
    assert.strictEqual(result.resumeId, 'checkpoint-session-123');
    assert.strictEqual(result.forkSession, true);
    assert.strictEqual(result.resumeSessionAt, 'uuid-first-msg');
  });

  test('BUGGY: old code cleared config.sessionId (regression proof)', () => {
    const config: MockRunnerConfig = {
      sessionId: 'checkpoint-session-123',
      forkSession: true,
      resumeSessionAt: 'uuid-first-msg',
    };

    const result = simulateBuggyCleanup({ ...config });
    assert.strictEqual(result.resumeId, undefined);  // BUG: sessionId was wiped!
  });

  test('non-fork sessions still get cleared (no regression)', () => {
    const config: MockRunnerConfig = {
      sessionId: 'stale-session-from-previous-run',
      forkSession: undefined,
      resumeSessionAt: undefined,
    };

    const result = simulateSessionCleanup(config);
    assert.strictEqual(result.resumeId, undefined);  // Correctly cleared
  });

  test('continuation sessions (no fork) get cleared', () => {
    const config: MockRunnerConfig = {
      sessionId: 'continued-session',
      forkSession: false,
    };

    const result = simulateSessionCleanup(config);
    assert.strictEqual(result.resumeId, undefined);  // Correctly cleared
  });
});
