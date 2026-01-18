/**
 * Test 17: FSM Entry Gates
 *
 * Integration tests verifying entry gate validation BEFORE state transitions.
 * Entry gates ensure prerequisites are met before entering a state.
 *
 * Flow:
 * 1. State has entry_gates configured
 * 2. On transition attempt, gates are validated BEFORE onExit of current state
 * 3. If gates fail, stay in current state
 * 4. If gates pass, execute transition normally
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MeshFSM, type FSMEntryGateEvent } from '../../src/mesh/fsm.ts';
import type { FSMConfig } from '../../src/shared/types.ts';

describe('FSM Entry Gates', () => {
  let testDir: string;
  let scriptsDir: string;
  let db: Database.Database;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-fsm-entry-gates-'));
    scriptsDir = path.join(testDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  /**
   * Create a gate script that passes (exit 0)
   */
  function createPassingGate(name: string): string {
    const scriptPath = path.join(scriptsDir, `${name}.sh`);
    fs.writeFileSync(scriptPath, '#!/bin/bash\nexit 0\n', { mode: 0o755 });
    return scriptPath;
  }

  /**
   * Create a gate script that fails (exit 1)
   */
  function createFailingGate(name: string, message = 'Gate check failed'): string {
    const scriptPath = path.join(scriptsDir, `${name}.sh`);
    fs.writeFileSync(scriptPath, `#!/bin/bash\necho "${message}" >&2\nexit 1\n`, { mode: 0o755 });
    return scriptPath;
  }

  test('entry gates pass - transition proceeds normally', async () => {
    const passScript = createPassingGate('check-workspace');
    const depScript = createPassingGate('check-dependencies');

    const config: FSMConfig = {
      initialState: 'planning',
      states: [
        {
          name: 'planning',
          coordinator: 'planner',
          exit: {
            default: 'implementation',
          },
        },
        {
          name: 'implementation',
          coordinator: 'developer',
          entry_gates: ['check-workspace', 'check-dependencies'],
        },
      ],
      transitions: [],
      scripts: {
        'check-workspace': passScript,
        'check-dependencies': depScript,
      },
    };

    const fsm = new MeshFSM('entry-gates-test', config, db, testDir);
    await fsm.initialize();

    // Track transition events
    const events: string[] = [];
    fsm.on('fsm:transition', (e) => events.push(`transition:${e.from}->${e.to}`));
    fsm.on('fsm:gate-check', (e) => events.push(`gate:${e.gateName}:${e.passed ? 'pass' : 'fail'}`));

    // Verify initial state
    assert.strictEqual(fsm.getCurrentState(), 'planning');

    // Simulate message handling that triggers transition
    const result = await fsm.handleMessage(
      'entry-gates-test/planner',
      'entry-gates-test/developer',
      'task-complete',
      { headline: 'Planning done' },
      {}
    );

    assert.strictEqual(result, true, 'Transition should succeed');
    assert.strictEqual(fsm.getCurrentState(), 'implementation');

    // Verify events: gates checked before transition
    assert.ok(events.includes('gate:check-workspace:pass'), 'Workspace gate should pass');
    assert.ok(events.includes('gate:check-dependencies:pass'), 'Dependencies gate should pass');
    assert.ok(events.includes('transition:planning->implementation'), 'Transition should fire');
  });

  test('entry gate fails - stay in current state', async () => {
    const passScript = createPassingGate('check-workspace');
    const failScript = createFailingGate('check-dependencies', 'Missing dependency: typescript');

    const config: FSMConfig = {
      initialState: 'planning',
      states: [
        {
          name: 'planning',
          coordinator: 'planner',
          exit: {
            default: 'implementation',
          },
        },
        {
          name: 'implementation',
          coordinator: 'developer',
          entry_gates: ['check-workspace', 'check-dependencies'],
        },
      ],
      transitions: [],
      scripts: {
        'check-workspace': passScript,
        'check-dependencies': failScript,
      },
    };

    const fsm = new MeshFSM('entry-gates-fail', config, db, testDir);
    await fsm.initialize();

    // Track events
    const gateEvents: FSMEntryGateEvent[] = [];
    fsm.on('fsm:gate-check', (e) => gateEvents.push(e));

    // Verify initial state
    assert.strictEqual(fsm.getCurrentState(), 'planning');

    // Attempt transition - should fail
    const result = await fsm.handleMessage(
      'entry-gates-fail/planner',
      'entry-gates-fail/developer',
      'task-complete',
      { headline: 'Planning done' },
      {}
    );

    assert.strictEqual(result, false, 'Transition should fail');
    assert.strictEqual(fsm.getCurrentState(), 'planning', 'Should stay in planning state');

    // Verify gate failure event
    const failEvent = gateEvents.find(e => e.gateName === 'check-dependencies' && !e.passed);
    assert.ok(failEvent, 'Should have gate failure event');
    assert.strictEqual(failEvent?.fromState, 'planning');
    assert.strictEqual(failEvent?.toState, 'implementation');
    assert.ok(failEvent?.error, 'Error should be set on failure');
  });

  test('entry gate file existence check - file exists', async () => {
    // Create the file that needs to exist
    const requiredFile = path.join(testDir, 'workspace.json');
    fs.writeFileSync(requiredFile, JSON.stringify({ initialized: true }));

    const config: FSMConfig = {
      initialState: 'setup',
      states: [
        {
          name: 'setup',
          coordinator: 'setup-agent',
          exit: {
            default: 'work',
          },
        },
        {
          name: 'work',
          coordinator: 'worker',
          entry_gates: [requiredFile],  // File path as gate
        },
      ],
      transitions: [],
    };

    const fsm = new MeshFSM('file-gate-test', config, db, testDir);
    await fsm.initialize();

    // Track events
    let gatePassed = false;
    fsm.on('fsm:gate-check', (e) => {
      if (e.gateName === requiredFile) {
        gatePassed = e.passed;
      }
    });

    // Attempt transition - should succeed
    const result = await fsm.handleMessage(
      'file-gate-test/setup-agent',
      'file-gate-test/worker',
      'task-complete',
      { headline: 'Setup complete' },
      {}
    );

    assert.strictEqual(result, true, 'Transition should succeed');
    assert.strictEqual(fsm.getCurrentState(), 'work');
    assert.strictEqual(gatePassed, true, 'File gate should pass');
  });

  test('entry gate file existence check - file missing', async () => {
    const missingFile = path.join(testDir, 'missing-config.json');

    const config: FSMConfig = {
      initialState: 'setup',
      states: [
        {
          name: 'setup',
          coordinator: 'setup-agent',
          exit: {
            default: 'work',
          },
        },
        {
          name: 'work',
          coordinator: 'worker',
          entry_gates: [missingFile],  // File doesn't exist
        },
      ],
      transitions: [],
    };

    const fsm = new MeshFSM('file-gate-fail', config, db, testDir);
    await fsm.initialize();

    // Track events
    const gateEvents: FSMEntryGateEvent[] = [];
    fsm.on('fsm:gate-check', (e) => gateEvents.push(e));

    // Attempt transition - should fail
    const result = await fsm.handleMessage(
      'file-gate-fail/setup-agent',
      'file-gate-fail/worker',
      'task-complete',
      { headline: 'Setup complete' },
      {}
    );

    assert.strictEqual(result, false, 'Transition should fail');
    assert.strictEqual(fsm.getCurrentState(), 'setup', 'Should stay in setup state');

    // Verify gate event
    const failEvent = gateEvents.find(e => !e.passed);
    assert.ok(failEvent, 'Should have gate failure event');
    assert.strictEqual(failEvent?.gateType, 'file-exists');
    assert.ok(failEvent?.error?.includes('File not found'), 'Error should indicate file not found');
  });

  test('entry gate retry tracking', async () => {
    let callCount = 0;
    const scriptPath = path.join(scriptsDir, 'flaky-gate.sh');

    // Create a script that fails first, then succeeds
    // Note: This won't actually change behavior between calls,
    // but we can test retry counting
    fs.writeFileSync(scriptPath, '#!/bin/bash\nexit 1\n', { mode: 0o755 });

    const config: FSMConfig = {
      initialState: 'waiting',
      states: [
        {
          name: 'waiting',
          coordinator: 'waiter',
          exit: {
            default: 'ready',
          },
        },
        {
          name: 'ready',
          coordinator: 'worker',
          entry_gates: ['flaky-check'],
        },
      ],
      transitions: [],
      scripts: {
        'flaky-check': scriptPath,
      },
    };

    const fsm = new MeshFSM('retry-test', config, db, testDir);
    await fsm.initialize();

    // First attempt - should fail
    const result1 = await fsm.handleMessage(
      'retry-test/waiter',
      'retry-test/worker',
      'task-complete',
      { headline: 'Attempt 1' },
      {}
    );
    assert.strictEqual(result1, false);

    // Check retry count
    const status = fsm.getStatus();
    const retryKey = 'entry:ready:flaky-check';
    assert.strictEqual(status.gateRetries[retryKey], 1, 'Should have 1 retry');

    // Second attempt - should still fail
    const result2 = await fsm.handleMessage(
      'retry-test/waiter',
      'retry-test/worker',
      'task-complete',
      { headline: 'Attempt 2' },
      {}
    );
    assert.strictEqual(result2, false);

    // Check retry count incremented
    const status2 = fsm.getStatus();
    assert.strictEqual(status2.gateRetries[retryKey], 2, 'Should have 2 retries');
  });

  test('entry gate retries reset on successful transition', async () => {
    // Start with a failing gate
    const gateScript = path.join(scriptsDir, 'conditional-gate.sh');
    fs.writeFileSync(gateScript, '#!/bin/bash\nexit 1\n', { mode: 0o755 });

    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'starter',
          exit: {
            default: 'gated',
          },
        },
        {
          name: 'gated',
          coordinator: 'gated-worker',
          entry_gates: ['conditional-check'],
        },
      ],
      transitions: [],
      scripts: {
        'conditional-check': gateScript,
      },
    };

    const fsm = new MeshFSM('reset-test', config, db, testDir);
    await fsm.initialize();

    // First attempt - fails
    await fsm.handleMessage(
      'reset-test/starter',
      'reset-test/gated-worker',
      'task-complete',
      {},
      {}
    );

    const retryKey = 'entry:gated:conditional-check';
    assert.strictEqual(fsm.getStatus().gateRetries[retryKey], 1);

    // Update script to pass
    fs.writeFileSync(gateScript, '#!/bin/bash\nexit 0\n', { mode: 0o755 });

    // Second attempt - succeeds
    const result = await fsm.handleMessage(
      'reset-test/starter',
      'reset-test/gated-worker',
      'task-complete',
      {},
      {}
    );

    assert.strictEqual(result, true, 'Should succeed now');
    assert.strictEqual(fsm.getCurrentState(), 'gated');

    // Retry count should be cleared
    const finalStatus = fsm.getStatus();
    assert.strictEqual(finalStatus.gateRetries[retryKey], undefined, 'Retry count should be cleared');
  });

  test('undefined entry gate script is skipped (non-blocking)', async () => {
    // Only define one of two gates
    const passScript = createPassingGate('defined-gate');

    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'starter',
          exit: {
            default: 'end',
          },
        },
        {
          name: 'end',
          coordinator: 'ender',
          entry_gates: ['defined-gate', 'undefined-gate'],  // undefined-gate not in scripts
        },
      ],
      transitions: [],
      scripts: {
        'defined-gate': passScript,
        // 'undefined-gate' intentionally missing
      },
    };

    const fsm = new MeshFSM('skip-undefined', config, db, testDir);
    await fsm.initialize();

    // Should succeed - undefined gate is skipped
    const result = await fsm.handleMessage(
      'skip-undefined/starter',
      'skip-undefined/ender',
      'task-complete',
      {},
      {}
    );

    assert.strictEqual(result, true, 'Transition should succeed');
    assert.strictEqual(fsm.getCurrentState(), 'end');
  });

  test('onExit not executed when entry gate fails', async () => {
    const failGate = createFailingGate('block-gate');

    // Create onExit script that creates a marker file
    const markerFile = path.join(testDir, 'onexit-marker.txt');
    const onExitScript = path.join(scriptsDir, 'onexit.sh');
    fs.writeFileSync(onExitScript, `#!/bin/bash\necho "executed" > ${markerFile}\n`, { mode: 0o755 });

    const config: FSMConfig = {
      initialState: 'first',
      states: [
        {
          name: 'first',
          coordinator: 'first-agent',
          onExit: onExitScript,
          exit: {
            default: 'second',
          },
        },
        {
          name: 'second',
          coordinator: 'second-agent',
          entry_gates: ['block-gate'],
        },
      ],
      transitions: [],
      scripts: {
        'block-gate': failGate,
      },
    };

    const fsm = new MeshFSM('onexit-test', config, db, testDir);
    await fsm.initialize();

    // Attempt transition - should fail at entry gate
    const result = await fsm.handleMessage(
      'onexit-test/first-agent',
      'onexit-test/second-agent',
      'task-complete',
      {},
      {}
    );

    assert.strictEqual(result, false, 'Transition should fail');
    assert.strictEqual(fs.existsSync(markerFile), false, 'onExit should NOT be executed when entry gate fails');
  });

  test('multiple entry gates - stops on first failure', async () => {
    const gate1 = createPassingGate('gate-1');
    const gate2 = createFailingGate('gate-2', 'Gate 2 failed');
    const gate3 = createPassingGate('gate-3');

    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'starter',
          exit: {
            default: 'end',
          },
        },
        {
          name: 'end',
          coordinator: 'ender',
          entry_gates: ['gate-1', 'gate-2', 'gate-3'],  // gate-2 fails
        },
      ],
      transitions: [],
      scripts: {
        'gate-1': gate1,
        'gate-2': gate2,
        'gate-3': gate3,
      },
    };

    const fsm = new MeshFSM('multi-gate', config, db, testDir);
    await fsm.initialize();

    // Track which gates were checked
    const checkedGates: string[] = [];
    fsm.on('fsm:gate-check', (e: FSMEntryGateEvent) => {
      checkedGates.push(e.gateName);
    });

    // Attempt transition
    const result = await fsm.handleMessage(
      'multi-gate/starter',
      'multi-gate/ender',
      'task-complete',
      {},
      {}
    );

    assert.strictEqual(result, false, 'Transition should fail');
    assert.ok(checkedGates.includes('gate-1'), 'Gate 1 should be checked');
    assert.ok(checkedGates.includes('gate-2'), 'Gate 2 should be checked');
    assert.ok(!checkedGates.includes('gate-3'), 'Gate 3 should NOT be checked (short-circuit)');
  });
});
