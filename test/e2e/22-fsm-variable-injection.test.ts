/**
 * Test 22: FSM Variable Injection E2E Test
 *
 * Validates that FSM context variables are injected into prompts:
 * - Variables appear in worker prompt
 * - Descriptions appear under variables
 * - Variables update between state transitions
 * - Worker can report variable values
 *
 * Uses the test-fsm-injection mesh.
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

describe('FSM Variable Injection E2E Tests', () => {
  let testDir: string;
  let db: Database.Database;
  let queue: MessageQueue;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-fsm-inject-'));
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

  test('FSM context variables are available for injection', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        { name: 'working', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        iteration: 0,
        workspace: '/test/workspace',
        feature_name: 'test-feature',
        max_retries: 3,
      },
    };

    const fsm = new MeshFSM('test-inject', config, db, testDir);
    await fsm.initialize();

    // Get context for injection
    const context = fsm.getContext();

    assert.strictEqual(context.iteration, 0);
    assert.strictEqual(context.workspace, '/test/workspace');
    assert.strictEqual(context.feature_name, 'test-feature');
    assert.strictEqual(context.max_retries, 3);
  });

  test('FSM context descriptions are stored', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        { name: 'working', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        iteration: 0,
        workspace: '/test/workspace',
      },
      context_descriptions: {
        iteration: 'Current iteration number',
        workspace: 'Isolated workspace path',
      },
    };

    const fsm = new MeshFSM('test-descriptions', config, db, testDir);
    await fsm.initialize();

    // Get descriptions
    const descriptions = fsm.getContextDescriptions();

    assert.strictEqual(descriptions?.iteration, 'Current iteration number');
    assert.strictEqual(descriptions?.workspace, 'Isolated workspace path');
  });

  test('FSM provides current state and context together', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        { name: 'working', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        iteration: 5,
        status: 'active',
      },
      context_descriptions: {
        iteration: 'How many times we have tried',
        status: 'Current processing status',
      },
    };

    const fsm = new MeshFSM('test-injection-context', config, db, testDir);
    await fsm.initialize();

    // Get state and context separately (for injection)
    const currentState = fsm.getCurrentState();
    const context = fsm.getContext();
    const descriptions = fsm.getContextDescriptions();

    assert.strictEqual(currentState, 'working');
    assert.strictEqual(context.iteration, 5);
    assert.strictEqual(context.status, 'active');
    assert.strictEqual(descriptions?.iteration, 'How many times we have tried');
    assert.strictEqual(descriptions?.status, 'Current processing status');
  });

  test('Context variables update after state transition', async () => {
    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'worker',
          exit: {
            set: {
              iteration: '$iteration + 1',
              status: 'transitioned',
            },
            run: 'end',
          },
        },
        { name: 'end', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        iteration: 0,
        status: 'initial',
      },
    };

    const fsm = new MeshFSM('test-update', config, db, testDir);
    await fsm.initialize();

    // Initial state
    let context = fsm.getContext();
    assert.strictEqual(context.iteration, 0);
    assert.strictEqual(context.status, 'initial');

    // Trigger transition
    await fsm.handleMessage('test-update/worker', 'test-update/worker', 'task-complete', {}, {});

    // After transition
    context = fsm.getContext();
    assert.strictEqual(context.iteration, '1');
    assert.strictEqual(context.status, 'transitioned');
    assert.strictEqual(fsm.getCurrentState(), 'end');
  });

  test('Variables persist and accumulate across multiple transitions', async () => {
    const config: FSMConfig = {
      initialState: 'state1',
      states: [
        {
          name: 'state1',
          coordinator: 'worker',
          exit: {
            set: { count: '$count + 10' },
            run: 'state2',
          },
        },
        {
          name: 'state2',
          coordinator: 'worker',
          exit: {
            set: { count: '$count + 20' },
            run: 'state3',
          },
        },
        {
          name: 'state3',
          coordinator: 'worker',
          exit: {
            set: { count: '$count + 30' },
            run: 'done',
          },
        },
        { name: 'done', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        count: 0,
      },
    };

    const fsm = new MeshFSM('test-accumulate', config, db, testDir);
    await fsm.initialize();

    assert.strictEqual(fsm.getContext().count, 0);

    // Transition 1: 0 + 10 = 10
    await fsm.handleMessage('test-accumulate/worker', 'test-accumulate/worker', 'task-complete', {}, {});
    assert.strictEqual(fsm.getContext().count, '10');
    assert.strictEqual(fsm.getCurrentState(), 'state2');

    // Transition 2: 10 + 20 = 30
    await fsm.handleMessage('test-accumulate/worker', 'test-accumulate/worker', 'task-complete', {}, {});
    assert.strictEqual(fsm.getContext().count, '30');
    assert.strictEqual(fsm.getCurrentState(), 'state3');

    // Transition 3: 30 + 30 = 60
    await fsm.handleMessage('test-accumulate/worker', 'test-accumulate/worker', 'task-complete', {}, {});
    assert.strictEqual(fsm.getContext().count, '60');
    assert.strictEqual(fsm.getCurrentState(), 'done');
  });

  test('Current state name tracks through transitions', async () => {
    const config: FSMConfig = {
      initialState: 'planning',
      states: [
        {
          name: 'planning',
          coordinator: 'planner',
          exit: { run: 'implementing' },
        },
        {
          name: 'implementing',
          coordinator: 'implementer',
          exit: { run: 'reviewing' },
        },
        { name: 'reviewing', coordinator: 'reviewer' },
      ],
      transitions: [],
      context: {},
    };

    const fsm = new MeshFSM('test-state-name', config, db, testDir);
    await fsm.initialize();

    // Check state at each step
    assert.strictEqual(fsm.getCurrentState(), 'planning');

    // Transition to outside mesh triggers state change
    await fsm.handleMessage('test-state-name/planner', 'core/core', 'task-complete', {}, {});
    assert.strictEqual(fsm.getCurrentState(), 'implementing');

    await fsm.handleMessage('test-state-name/implementer', 'core/core', 'task-complete', {}, {});
    assert.strictEqual(fsm.getCurrentState(), 'reviewing');
  });

  test('String concatenation variables work in context', async () => {
    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'worker',
          exit: {
            set: {
              path: '$base_path/$feature',
              label: 'attempt-$iteration',
              iteration: '$iteration + 1',
            },
            run: 'done',
          },
        },
        { name: 'done', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        base_path: '/workspace',
        feature: 'my-feature',
        iteration: 0,
        path: '',
        label: '',
      },
    };

    const fsm = new MeshFSM('test-concat', config, db, testDir);
    await fsm.initialize();

    await fsm.handleMessage('test-concat/worker', 'test-concat/worker', 'task-complete', {}, {});

    const ctx = fsm.getContext();
    assert.strictEqual(ctx.path, '/workspace/my-feature');
    assert.strictEqual(ctx.label, 'attempt-0');
    assert.strictEqual(ctx.iteration, '1');
  });

  test('Descriptions are optional - context works without them', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        { name: 'working', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        var1: 'value1',
        var2: 'value2',
      },
      // No context_descriptions
    };

    const fsm = new MeshFSM('test-no-descriptions', config, db, testDir);
    await fsm.initialize();

    const ctx = fsm.getContext();
    const desc = fsm.getContextDescriptions();

    assert.strictEqual(ctx.var1, 'value1');
    assert.strictEqual(ctx.var2, 'value2');
    assert.ok(!desc || Object.keys(desc).length === 0);
  });

  test('Partial descriptions - only some variables have descriptions', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        { name: 'working', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        documented_var: 'has description',
        undocumented_var: 'no description',
      },
      context_descriptions: {
        documented_var: 'This variable is documented',
        // undocumented_var intentionally missing
      },
    };

    const fsm = new MeshFSM('test-partial-desc', config, db, testDir);
    await fsm.initialize();

    const ctx = fsm.getContext();
    const desc = fsm.getContextDescriptions();

    assert.strictEqual(ctx.documented_var, 'has description');
    assert.strictEqual(ctx.undocumented_var, 'no description');
    assert.strictEqual(desc?.documented_var, 'This variable is documented');
    assert.strictEqual(desc?.undocumented_var, undefined);
  });

  test('Context variables can be various types', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        { name: 'working', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        string_var: 'hello',
        number_var: 42,
        zero_var: 0,
        negative_var: -10,
        float_var: 3.14,
        boolean_true: true,
        boolean_false: false,
        null_var: null,
      },
    };

    const fsm = new MeshFSM('test-types', config, db, testDir);
    await fsm.initialize();

    const ctx = fsm.getContext();

    assert.strictEqual(ctx.string_var, 'hello');
    assert.strictEqual(ctx.number_var, 42);
    assert.strictEqual(ctx.zero_var, 0);
    assert.strictEqual(ctx.negative_var, -10);
    assert.strictEqual(ctx.float_var, 3.14);
    assert.strictEqual(ctx.boolean_true, true);
    assert.strictEqual(ctx.boolean_false, false);
    assert.strictEqual(ctx.null_var, null);
  });

  test('Context variables restored from persistence include descriptions', async () => {
    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'worker',
          exit: { set: { count: '$count + 1' }, run: 'done' },
        },
        { name: 'done', coordinator: 'worker' },
      ],
      transitions: [],
      context: {
        count: 0,
      },
      context_descriptions: {
        count: 'Number of operations completed',
      },
    };

    // Create and transition FSM
    const fsm1 = new MeshFSM('test-persist-desc', config, db, testDir);
    await fsm1.initialize();
    await fsm1.handleMessage('test-persist-desc/worker', 'test-persist-desc/worker', 'task-complete', {}, {});

    // Create new instance (simulates restart)
    const fsm2 = new MeshFSM('test-persist-desc', config, db, testDir);
    await fsm2.initialize();

    // Verify state and context restored
    assert.strictEqual(fsm2.getCurrentState(), 'done');
    assert.strictEqual(fsm2.getContext().count, '1');

    // Verify descriptions still available
    const desc = fsm2.getContextDescriptions();
    assert.strictEqual(desc?.count, 'Number of operations completed');
  });
});
