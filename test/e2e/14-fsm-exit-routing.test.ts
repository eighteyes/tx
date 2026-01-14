/**
 * Test 14: FSM Exit-Based Routing
 *
 * Integration test verifying exit.run and exit.when clause routing
 * with ralph-ice-cream-like PASS/REFINE/BLOCKED signal patterns.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MeshFSM } from '../../src/mesh/fsm.ts';
import type { FSMConfig } from '../../src/shared/types.ts';

describe('FSM Exit-Based Routing Integration', () => {
  let testDir: string;
  let db: Database.Database;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-fsm-routing-'));
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('ralph-ice-cream pattern: haiku layer with PASS signal', async () => {
    const config: FSMConfig = {
      initialState: 'ralph_haiku_loop',
      states: [
        {
          name: 'ralph_haiku_loop',
          coordinator: 'ralph-haiku',
          exit: {
            set: {
              haiku_success_signal: '$(echo "$REARMATTER" | yq ".success_signal")',
            },
            when: [
              { condition: 'haiku_success_signal == "PASS"', target: 'sonnet_review_loop' },
              { condition: 'haiku_success_signal == "REFINE"', target: 'ralph_haiku_loop' },
              { condition: 'haiku_success_signal == "BLOCKED"', target: 'error_state' },
            ],
            default: 'ralph_haiku_loop',
          },
        },
        {
          name: 'sonnet_review_loop',
          coordinator: 'sonnet-reviewer',
        },
        {
          name: 'error_state',
          coordinator: 'error-handler',
        },
      ],
      transitions: [],
      context: {
        haiku_success_signal: '',
      },
    };

    const fsm = new MeshFSM('ralph-ice-cream', config, db, testDir);
    await fsm.initialize();

    // Simulate PASS signal
    const exit = config.states[0].exit!;
    const context = { haiku_success_signal: 'PASS' };

    const nextState = await fsm.evaluateExitRouting(exit, context);
    assert.strictEqual(nextState, 'sonnet_review_loop');
  });

  test('ralph-ice-cream pattern: haiku layer with REFINE signal (self-loop)', async () => {
    const config: FSMConfig = {
      initialState: 'ralph_haiku_loop',
      states: [
        {
          name: 'ralph_haiku_loop',
          coordinator: 'ralph-haiku',
          exit: {
            when: [
              { condition: 'haiku_success_signal == "PASS"', target: 'sonnet_review_loop' },
              { condition: 'haiku_success_signal == "REFINE"', target: 'ralph_haiku_loop' },
              { condition: 'haiku_success_signal == "BLOCKED"', target: 'error_state' },
            ],
            default: 'ralph_haiku_loop',
          },
        },
        {
          name: 'sonnet_review_loop',
          coordinator: 'sonnet-reviewer',
        },
        {
          name: 'error_state',
          coordinator: 'error-handler',
        },
      ],
      transitions: [],
    };

    const fsm = new MeshFSM('ralph-ice-cream', config, db, testDir);
    await fsm.initialize();

    // Simulate REFINE signal (should self-loop)
    const exit = config.states[0].exit!;
    const context = { haiku_success_signal: 'REFINE' };

    const nextState = await fsm.evaluateExitRouting(exit, context);
    assert.strictEqual(nextState, 'ralph_haiku_loop');
  });

  test('ralph-ice-cream pattern: haiku layer with BLOCKED signal', async () => {
    const config: FSMConfig = {
      initialState: 'ralph_haiku_loop',
      states: [
        {
          name: 'ralph_haiku_loop',
          coordinator: 'ralph-haiku',
          exit: {
            when: [
              { condition: 'haiku_success_signal == "PASS"', target: 'sonnet_review_loop' },
              { condition: 'haiku_success_signal == "REFINE"', target: 'ralph_haiku_loop' },
              { condition: 'haiku_success_signal == "BLOCKED"', target: 'error_state' },
            ],
            default: 'ralph_haiku_loop',
          },
        },
        {
          name: 'sonnet_review_loop',
          coordinator: 'sonnet-reviewer',
        },
        {
          name: 'error_state',
          coordinator: 'error-handler',
        },
      ],
      transitions: [],
    };

    const fsm = new MeshFSM('ralph-ice-cream', config, db, testDir);
    await fsm.initialize();

    // Simulate BLOCKED signal
    const exit = config.states[0].exit!;
    const context = { haiku_success_signal: 'BLOCKED' };

    const nextState = await fsm.evaluateExitRouting(exit, context);
    assert.strictEqual(nextState, 'error_state');
  });

  test('exit.run with literal state name', async () => {
    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'worker',
          exit: {
            run: 'finish',
          },
        },
        {
          name: 'finish',
          coordinator: 'worker',
        },
      ],
      transitions: [],
    };

    const fsm = new MeshFSM('literal-routing', config, db, testDir);
    await fsm.initialize();

    const exit = config.states[0].exit!;
    const context = {};

    const nextState = await fsm.evaluateExitRouting(exit, context);
    assert.strictEqual(nextState, 'finish');
  });

  test('exit.run with script that echoes state', async () => {
    const config: FSMConfig = {
      initialState: 'conditional',
      states: [
        {
          name: 'conditional',
          coordinator: 'worker',
          exit: {
            run: 'if [ "$signal" = "PASS" ]; then echo "success"; else echo "retry"; fi',
          },
        },
        {
          name: 'success',
          coordinator: 'worker',
        },
        {
          name: 'retry',
          coordinator: 'worker',
        },
      ],
      transitions: [],
    };

    const fsm = new MeshFSM('script-routing', config, db, testDir);
    await fsm.initialize();

    const exit = config.states[0].exit!;

    // Test PASS signal -> success
    const context1 = { signal: 'PASS' };
    const nextState1 = await fsm.evaluateExitRouting(exit, context1);
    assert.strictEqual(nextState1, 'success');

    // Test other signal -> retry
    const context2 = { signal: 'REFINE' };
    const nextState2 = await fsm.evaluateExitRouting(exit, context2);
    assert.strictEqual(nextState2, 'retry');
  });

  test('exit.run has priority over when clauses', async () => {
    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'worker',
          exit: {
            run: 'forced',  // Should win
            when: [
              { condition: 'signal == "PASS"', target: 'when_target' },
            ],
          },
        },
        {
          name: 'forced',
          coordinator: 'worker',
        },
        {
          name: 'when_target',
          coordinator: 'worker',
        },
      ],
      transitions: [],
    };

    const fsm = new MeshFSM('priority-routing', config, db, testDir);
    await fsm.initialize();

    const exit = config.states[0].exit!;
    const context = { signal: 'PASS' };

    const nextState = await fsm.evaluateExitRouting(exit, context);
    assert.strictEqual(nextState, 'forced');  // run wins over when
  });

  test('default is required when no when clause matches', async () => {
    const config: FSMConfig = {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'worker',
          exit: {
            when: [
              { condition: 'signal == "SPECIFIC_VALUE"', target: 'specific' },
            ],
            default: 'fallback',  // Required
          },
        },
        {
          name: 'specific',
          coordinator: 'worker',
        },
        {
          name: 'fallback',
          coordinator: 'worker',
        },
      ],
      transitions: [],
    };

    const fsm = new MeshFSM('default-routing', config, db, testDir);
    await fsm.initialize();

    const exit = config.states[0].exit!;
    const context = { signal: 'OTHER_VALUE' };

    const nextState = await fsm.evaluateExitRouting(exit, context);
    assert.strictEqual(nextState, 'fallback');
  });

  test('multi-layer cascade: haiku -> sonnet with different signals', async () => {
    const config: FSMConfig = {
      initialState: 'haiku_layer',
      states: [
        {
          name: 'haiku_layer',
          coordinator: 'haiku-worker',
          exit: {
            when: [
              { condition: 'haiku_signal == "PASS"', target: 'sonnet_layer' },
              { condition: 'haiku_signal == "REFINE"', target: 'haiku_layer' },
            ],
            default: 'error',
          },
        },
        {
          name: 'sonnet_layer',
          coordinator: 'sonnet-worker',
          exit: {
            when: [
              { condition: 'sonnet_signal == "PASS"', target: 'opus_layer' },
              { condition: 'sonnet_signal == "REFINE"', target: 'sonnet_layer' },
            ],
            default: 'haiku_layer',  // Cascade back
          },
        },
        {
          name: 'opus_layer',
          coordinator: 'opus-worker',
        },
        {
          name: 'error',
          coordinator: 'error-handler',
        },
      ],
      transitions: [],
    };

    const fsm = new MeshFSM('multi-layer', config, db, testDir);
    await fsm.initialize();

    // Test haiku PASS -> sonnet
    const haiku_exit = config.states[0].exit!;
    const haiku_context = { haiku_signal: 'PASS' };
    const haiku_next = await fsm.evaluateExitRouting(haiku_exit, haiku_context);
    assert.strictEqual(haiku_next, 'sonnet_layer');

    // Test sonnet PASS -> opus
    const sonnet_exit = config.states[1].exit!;
    const sonnet_context = { sonnet_signal: 'PASS' };
    const sonnet_next = await fsm.evaluateExitRouting(sonnet_exit, sonnet_context);
    assert.strictEqual(sonnet_next, 'opus_layer');

    // Test sonnet REFINE -> sonnet (self-loop)
    const sonnet_refine = { sonnet_signal: 'REFINE' };
    const sonnet_loop = await fsm.evaluateExitRouting(sonnet_exit, sonnet_refine);
    assert.strictEqual(sonnet_loop, 'sonnet_layer');
  });
});
