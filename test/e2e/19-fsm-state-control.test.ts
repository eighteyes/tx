/**
 * Test 19: FSM State Control E2E Test
 *
 * Validates that FSM actually manages state and controls flow:
 * - State persists in SQLite between worker invocations
 * - Context variables update and persist
 * - When clauses route based on context
 * - Entry gates validate before state changes
 *
 * Uses the test-fsm-validation mesh patterns.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MeshFSM } from '../../src/mesh/fsm.ts';
import type { FSMConfig } from '../../src/shared/types.ts';
import { MessageQueue } from '../../src/queue/index.ts';

describe('FSM State Control E2E Tests', () => {
  let testDir: string;
  let db: Database.Database;
  let queue: MessageQueue;
  let outputDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-fsm-state-'));
    outputDir = path.join(testDir, '.ai', 'output');
    fs.mkdirSync(outputDir, { recursive: true });

    const dataDir = path.join(testDir, '.ai', 'tx', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'queue.db');
    queue = new MessageQueue(dbPath);
    db = queue.getDb();
  });

  afterEach(() => {
    queue.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('FSM state persists in SQLite between worker invocations', async () => {
    // Create a simple FSM config with when clauses
    const config: FSMConfig = {
      initialState: 'planning',
      states: [
        {
          name: 'planning',
          coordinator: 'planner',
          exit: {
            set: { iteration: '$iteration + 1' },
            when: [
              { condition: 'iteration == "1"', target: 'implementation' },
            ],
            default: 'planning',
          },
        },
        {
          name: 'implementation',
          coordinator: 'implementer',
          exit: {
            set: { iteration: '$iteration + 1' },
            when: [
              { condition: 'iteration == "2"', target: 'review' },
            ],
            default: 'implementation',
          },
        },
        {
          name: 'review',
          coordinator: 'reviewer',
        },
      ],
      transitions: [],
      context: {
        iteration: 0,
        checkpoints: '',
      },
    };

    // Create first FSM instance
    const fsm1 = new MeshFSM('test-persist', config, db, testDir);
    await fsm1.initialize();

    // Verify initial state
    assert.strictEqual(fsm1.getCurrentState(), 'planning');
    assert.strictEqual(fsm1.getContext().iteration, 0);

    // Simulate message completion - route to core/core triggers transition
    await fsm1.handleMessage(
      'test-persist/planner',
      'core/core',
      'task-complete',
      {},
      {}
    );

    // Verify state changed and persisted
    assert.strictEqual(fsm1.getCurrentState(), 'implementation');
    assert.strictEqual(fsm1.getContext().iteration, '1');

    // Create NEW FSM instance (simulates worker restart)
    const fsm2 = new MeshFSM('test-persist', config, db, testDir);
    await fsm2.initialize();

    // Verify state was restored from SQLite
    assert.strictEqual(fsm2.getCurrentState(), 'implementation');
    assert.strictEqual(fsm2.getContext().iteration, '1');
  });

  test('State coordinator controls which agent can transition', async () => {
    const config: FSMConfig = {
      initialState: 'planning',
      states: [
        {
          name: 'planning',
          coordinator: 'planner',
          exit: {
            set: { step: '$step + 1' },
            when: [
              { condition: 'step == "1"', target: 'implementation' },
            ],
            default: 'planning',
          },
        },
        {
          name: 'implementation',
          coordinator: 'implementer',
          exit: {
            set: { step: '$step + 1' },
            when: [
              { condition: 'step == "2"', target: 'review' },
            ],
            default: 'implementation',
          },
        },
        {
          name: 'review',
          coordinator: 'reviewer',
        },
      ],
      transitions: [],
      context: {
        step: 0,
      },
    };

    const fsm = new MeshFSM('test-coord', config, db, testDir);
    await fsm.initialize();

    // Should be in planning state
    assert.strictEqual(fsm.getCurrentState(), 'planning');

    // Get current state config and verify coordinator
    const stateConfig = fsm.getCurrentStateConfig();
    assert.strictEqual(stateConfig?.coordinator, 'planner');

    // Send message as correct agent - routing to core/core triggers transition
    await fsm.handleMessage(
      'test-coord/planner',
      'core/core',
      'task-complete',
      {},
      {}
    );

    // State should have changed
    assert.strictEqual(fsm.getCurrentState(), 'implementation');
    assert.strictEqual(fsm.getContext().step, '1');

    // Verify new coordinator
    const newConfig = fsm.getCurrentStateConfig();
    assert.strictEqual(newConfig?.coordinator, 'implementer');
  });

  test('Context variables update and persist across transitions', async () => {
    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'worker',
          exit: {
            set: {
              iteration: '$iteration + 1',
              total: '$total + 10',
            },
            when: [
              { condition: 'iteration == "1"', target: 'middle' },
            ],
            default: 'start',
          },
        },
        {
          name: 'middle',
          coordinator: 'worker',
          exit: {
            set: {
              iteration: '$iteration + 1',
              total: '$total + 10',
            },
            when: [
              { condition: 'iteration == "2"', target: 'end' },
            ],
            default: 'middle',
          },
        },
        {
          name: 'end',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        iteration: 0,
        total: 0,
      },
    };

    const fsm = new MeshFSM('test-context', config, db, testDir);
    await fsm.initialize();

    // Initial context
    assert.strictEqual(fsm.getContext().iteration, 0);
    assert.strictEqual(fsm.getContext().total, 0);

    // First transition - route to core/core
    await fsm.handleMessage('test-context/worker', 'core/core', 'task-complete', {}, {});

    assert.strictEqual(fsm.getCurrentState(), 'middle');
    assert.strictEqual(fsm.getContext().iteration, '1');
    assert.strictEqual(fsm.getContext().total, '10');

    // Second transition - route to core/core
    await fsm.handleMessage('test-context/worker', 'core/core', 'task-complete', {}, {});

    assert.strictEqual(fsm.getCurrentState(), 'end');
    assert.strictEqual(fsm.getContext().iteration, '2');
    assert.strictEqual(fsm.getContext().total, '20');

    // Verify persistence - create new instance
    const fsm2 = new MeshFSM('test-context', config, db, testDir);
    await fsm2.initialize();

    assert.strictEqual(fsm2.getCurrentState(), 'end');
    assert.strictEqual(fsm2.getContext().iteration, '2');
    assert.strictEqual(fsm2.getContext().total, '20');
  });

  test('Entry gates validate BEFORE entering state', async () => {
    // Use file-exists gate (simpler than scripts)
    const prereqPath = path.join(outputDir, 'prerequisite.md');

    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'worker',
          exit: { run: 'guarded' },
        },
        {
          name: 'guarded',
          coordinator: 'worker',
          // File-exists entry gate - uses absolute path with /
          entry_gates: [prereqPath],
        },
      ],
      transitions: [],
      context: {},
    };

    const fsm = new MeshFSM('test-entry-gates', config, db, testDir);
    await fsm.initialize();

    // Try to transition without prerequisite (entry gate should fail)
    const result1 = await fsm.handleMessage(
      'test-entry-gates/worker',
      'core/core',
      'task-complete',
      {},
      {}
    );

    // Transition should have been blocked (entry gate failed)
    assert.strictEqual(result1, false, 'Should return false when entry gate fails');
    assert.strictEqual(fsm.getCurrentState(), 'start', 'Should stay in start state');

    // Create the prerequisite file
    fs.writeFileSync(prereqPath, '# Prerequisite met');

    // Try again - entry gate should pass
    const result2 = await fsm.handleMessage(
      'test-entry-gates/worker',
      'core/core',
      'task-complete',
      {},
      {}
    );

    // Should now be in guarded state
    assert.strictEqual(result2, true, 'Should return true when entry gate passes');
    assert.strictEqual(fsm.getCurrentState(), 'guarded');
  });

  test('FSM when clauses route based on context', async () => {
    const config: FSMConfig = {
      initialState: 'decide',
      states: [
        {
          name: 'decide',
          coordinator: 'worker',
          exit: {
            when: [
              { condition: 'signal == "PASS"', target: 'success' },
              { condition: 'signal == "FAIL"', target: 'failure' },
            ],
            default: 'retry',
          },
        },
        { name: 'success', coordinator: 'worker' },
        { name: 'failure', coordinator: 'worker' },
        { name: 'retry', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        signal: 'PASS',
      },
    };

    const fsm = new MeshFSM('test-when', config, db, testDir);
    await fsm.initialize();

    // Test PASS -> success (route to core/core)
    await fsm.handleMessage('test-when/worker', 'core/core', 'task-complete', {}, {});
    assert.strictEqual(fsm.getCurrentState(), 'success');

    // Reset and test FAIL
    const fsm2 = new MeshFSM('test-when-fail', {
      ...config,
      context: { signal: 'FAIL' },
    }, db, testDir);
    await fsm2.initialize();

    await fsm2.handleMessage('test-when-fail/worker', 'core/core', 'task-complete', {}, {});
    assert.strictEqual(fsm2.getCurrentState(), 'failure');

    // Reset and test default
    const fsm3 = new MeshFSM('test-when-default', {
      ...config,
      context: { signal: 'UNKNOWN' },
    }, db, testDir);
    await fsm3.initialize();

    await fsm3.handleMessage('test-when-default/worker', 'core/core', 'task-complete', {}, {});
    assert.strictEqual(fsm3.getCurrentState(), 'retry');
  });

  test('FSM iteration counter with loop and exit', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        {
          name: 'working',
          coordinator: 'worker',
          exit: {
            set: {
              iteration: '$iteration + 1',
            },
            when: [
              { condition: 'iteration == "3"', target: 'complete' },
            ],
            default: 'working',  // Loop back
          },
        },
        {
          name: 'complete',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        iteration: 0,
      },
    };

    const fsm = new MeshFSM('test-loop', config, db, testDir);
    await fsm.initialize();

    // Verify initial state
    assert.strictEqual(fsm.getCurrentState(), 'working');
    assert.strictEqual(fsm.getContext().iteration, 0);

    // First iteration - route to core/core
    await fsm.handleMessage('test-loop/worker', 'core/core', 'task-complete', {}, {});
    assert.strictEqual(fsm.getContext().iteration, '1');
    assert.strictEqual(fsm.getCurrentState(), 'working');

    // Second iteration
    await fsm.handleMessage('test-loop/worker', 'core/core', 'task-complete', {}, {});
    assert.strictEqual(fsm.getContext().iteration, '2');
    assert.strictEqual(fsm.getCurrentState(), 'working');

    // Third iteration - should exit to complete
    await fsm.handleMessage('test-loop/worker', 'core/core', 'task-complete', {}, {});
    assert.strictEqual(fsm.getContext().iteration, '3');
    assert.strictEqual(fsm.getCurrentState(), 'complete');
  });

  test('FSM context descriptions are stored and retrievable', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        { name: 'working', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        iteration: 0,
        workspace: '/test/path',
      },
      context_descriptions: {
        iteration: 'Current iteration number',
        workspace: 'Isolated workspace path',
      },
    };

    const fsm = new MeshFSM('test-desc', config, db, testDir);
    await fsm.initialize();

    // Get descriptions
    const descriptions = fsm.getContextDescriptions();

    assert.strictEqual(descriptions.iteration, 'Current iteration number');
    assert.strictEqual(descriptions.workspace, 'Isolated workspace path');
  });

  test('FSM state list is accessible', async () => {
    const config: FSMConfig = {
      initialState: 'state1',
      states: [
        { name: 'state1', coordinator: 'worker1' },
        { name: 'state2', coordinator: 'worker2' },
        { name: 'state3', coordinator: 'worker3' },
      ],
      transitions: [],
      context: {},
    };

    const fsm = new MeshFSM('test-states', config, db, testDir);
    await fsm.initialize();

    // Get all states
    const states = fsm.getStates();

    assert.strictEqual(states.length, 3);
    assert.ok(states.some(s => s.name === 'state1'));
    assert.ok(states.some(s => s.name === 'state2'));
    assert.ok(states.some(s => s.name === 'state3'));
  });

  test('FSM status provides current information', async () => {
    const config: FSMConfig = {
      initialState: 'active',
      states: [
        { name: 'active', coordinator: 'worker' },
        { name: 'complete', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        count: 5,
      },
    };

    const fsm = new MeshFSM('test-status', config, db, testDir);
    await fsm.initialize();

    // Get status
    const status = fsm.getStatus();

    assert.strictEqual(status.meshName, 'test-status');
    assert.strictEqual(status.currentState, 'active');
    assert.strictEqual(status.context.count, 5);
    // Verify the FSM has necessary properties
    assert.ok(status.hasOwnProperty('gateRetries'));
    assert.ok(status.hasOwnProperty('lastTransitionAt'));
  });
});
