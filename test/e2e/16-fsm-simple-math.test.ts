/**
 * Test 16: FSM Simple Math Expression Evaluation
 *
 * E2E test verifying that FSM exit.set operations can use simple
 * arithmetic expressions like "$iteration + 1" without shell execution.
 *
 * This tests Phase 0.1 from the quality pass plan.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MeshFSM } from '../../src/mesh/fsm.ts';
import type { FSMConfig } from '../../src/shared/types.ts';

describe('FSM Simple Math Expression Evaluation', () => {
  let testDir: string;
  let db: Database.Database;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-fsm-math-'));
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('iteration counter increments with simple math expression', async () => {
    // Config that uses simple math for iteration counting
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        {
          name: 'working',
          coordinator: 'worker',
          exit: {
            // This is the key test: $iteration + 1 without echo
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

    const fsm = new MeshFSM('iteration-test', config, db, testDir);
    await fsm.initialize();

    // Verify initial state
    assert.strictEqual(fsm.getCurrentState(), 'working');
    assert.strictEqual(fsm.getContext().iteration, 0);

    // Simulate first message - should increment iteration to 1
    const result1 = await fsm.handleMessage(
      'iteration-test/worker',
      'iteration-test/worker',
      'task-complete',
      {},
      {}
    );
    assert.strictEqual(result1, true);
    assert.strictEqual(fsm.getContext().iteration, '1');
    assert.strictEqual(fsm.getCurrentState(), 'working');  // Still looping

    // Second iteration - should be 2
    const result2 = await fsm.handleMessage(
      'iteration-test/worker',
      'iteration-test/worker',
      'task-complete',
      {},
      {}
    );
    assert.strictEqual(result2, true);
    assert.strictEqual(fsm.getContext().iteration, '2');
    assert.strictEqual(fsm.getCurrentState(), 'working');  // Still looping

    // Third iteration - should be 3 and transition to complete
    const result3 = await fsm.handleMessage(
      'iteration-test/worker',
      'iteration-test/worker',
      'task-complete',
      {},
      {}
    );
    assert.strictEqual(result3, true);
    assert.strictEqual(fsm.getContext().iteration, '3');
    assert.strictEqual(fsm.getCurrentState(), 'complete');  // Transitioned!
  });

  test('string concatenation with variables', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        {
          name: 'working',
          coordinator: 'worker',
          exit: {
            set: {
              label: 'attempt-$iteration',  // String concat without echo
              iteration: '$iteration + 1',
            },
            when: [
              { condition: 'iteration == "2"', target: 'complete' },
            ],
            default: 'working',
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
        label: '',
      },
    };

    const fsm = new MeshFSM('concat-test', config, db, testDir);
    await fsm.initialize();

    // First iteration
    await fsm.handleMessage(
      'concat-test/worker',
      'concat-test/worker',
      'task-complete',
      {},
      {}
    );

    // Verify string concatenation worked
    const context = fsm.getContext();
    assert.strictEqual(context.label, 'attempt-0');  // Uses original iteration value
    assert.strictEqual(context.iteration, '1');
  });

  test('two-variable arithmetic', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        {
          name: 'working',
          coordinator: 'worker',
          exit: {
            set: {
              total: '$base + $offset',  // Two-variable arithmetic
            },
            default: 'complete',
          },
        },
        {
          name: 'complete',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        base: 10,
        offset: 5,
        total: 0,
      },
    };

    const fsm = new MeshFSM('two-var-test', config, db, testDir);
    await fsm.initialize();

    await fsm.handleMessage(
      'two-var-test/worker',
      'two-var-test/worker',
      'task-complete',
      {},
      {}
    );

    assert.strictEqual(fsm.getContext().total, '15');
  });

  test('fallback to shell for complex expressions', async () => {
    // Create a script that the shell can execute
    const scriptDir = path.join(testDir, 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });

    const config: FSMConfig = {
      initialState: 'working',
      states: [
        {
          name: 'working',
          coordinator: 'worker',
          exit: {
            set: {
              // This requires shell because of echo
              complex_value: 'echo "computed-$(date +%s)"',
            },
            default: 'complete',
          },
        },
        {
          name: 'complete',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        complex_value: '',
      },
    };

    const fsm = new MeshFSM('shell-fallback', config, db, testDir);
    await fsm.initialize();

    await fsm.handleMessage(
      'shell-fallback/worker',
      'shell-fallback/worker',
      'task-complete',
      {},
      {}
    );

    // The value should start with 'computed-' (shell executed)
    const context = fsm.getContext();
    assert.ok(
      String(context.complex_value).startsWith('computed-'),
      `Expected value starting with 'computed-', got: ${context.complex_value}`
    );
  });

  test('path-like variables are not treated as division', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        {
          name: 'working',
          coordinator: 'worker',
          exit: {
            set: {
              agent_path: '$mesh/$agent',  // Should be string concat, NOT division
            },
            default: 'complete',
          },
        },
        {
          name: 'complete',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        mesh: 'dev',
        agent: 'worker',
        agent_path: '',
      },
    };

    const fsm = new MeshFSM('path-test', config, db, testDir);
    await fsm.initialize();

    await fsm.handleMessage(
      'path-test/worker',
      'path-test/worker',
      'task-complete',
      {},
      {}
    );

    // Should be string concatenation result, not arithmetic
    assert.strictEqual(fsm.getContext().agent_path, 'dev/worker');
  });

  test('subtraction operation works correctly', async () => {
    const config: FSMConfig = {
      initialState: 'countdown',
      states: [
        {
          name: 'countdown',
          coordinator: 'worker',
          exit: {
            set: {
              remaining: '$remaining - 1',
            },
            when: [
              { condition: 'remaining == "0"', target: 'done' },
            ],
            default: 'countdown',
          },
        },
        {
          name: 'done',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        remaining: 3,
      },
    };

    const fsm = new MeshFSM('countdown-test', config, db, testDir);
    await fsm.initialize();

    // Count down from 3
    await fsm.handleMessage('countdown-test/worker', 'countdown-test/worker', 'task-complete', {}, {});
    assert.strictEqual(fsm.getContext().remaining, '2');

    await fsm.handleMessage('countdown-test/worker', 'countdown-test/worker', 'task-complete', {}, {});
    assert.strictEqual(fsm.getContext().remaining, '1');

    await fsm.handleMessage('countdown-test/worker', 'countdown-test/worker', 'task-complete', {}, {});
    assert.strictEqual(fsm.getContext().remaining, '0');
    assert.strictEqual(fsm.getCurrentState(), 'done');
  });

  test('multiplication and division work correctly', async () => {
    const config: FSMConfig = {
      initialState: 'calculate',
      states: [
        {
          name: 'calculate',
          coordinator: 'worker',
          exit: {
            set: {
              doubled: '$value * 2',
              halved: '$value / 2',
            },
            default: 'done',
          },
        },
        {
          name: 'done',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        value: 10,
        doubled: 0,
        halved: 0,
      },
    };

    const fsm = new MeshFSM('math-ops-test', config, db, testDir);
    await fsm.initialize();

    await fsm.handleMessage('math-ops-test/worker', 'math-ops-test/worker', 'task-complete', {}, {});

    assert.strictEqual(fsm.getContext().doubled, '20');
    assert.strictEqual(fsm.getContext().halved, '5');
  });
});
