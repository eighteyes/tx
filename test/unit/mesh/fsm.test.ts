/**
 * MeshFSM Test
 *
 * Tests the core FSM class for workflow orchestration.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MeshFSM, type FSMConfig, type FSMTransitionEvent, type FSMGateEvent } from '../../../src/mesh/index.ts';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.ts';

describe('MeshFSM', () => {
  let env: TestEnv;
  let db: Database.Database;
  let scriptsDir: string;

  const basicConfig: FSMConfig = {
    initialState: 'planning',
    states: [
      { name: 'planning', coordinator: 'planner' },
      { name: 'implementation', coordinator: 'developer' },
      { name: 'review', coordinator: 'reviewer' },
      { name: 'complete', coordinator: 'planner' },
    ],
    transitions: [
      { from: 'planning', to: 'implementation', trigger: 'ask', triggerAgent: 'planner' },
      { from: 'implementation', to: 'review', trigger: 'task-complete', triggerAgent: 'developer' },
      { from: 'review', to: 'complete', trigger: 'task-complete', triggerAgent: 'reviewer' },
    ],
  };

  before(async () => {
    env = createTestEnv('tx-fsm-core');
    scriptsDir = path.join(env.rootDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
  });

  beforeEach(() => {
    // Fresh database for each test
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
  });

  after(async () => {
    env.cleanup();
  });

  describe('initialization', () => {
    it('should create FSM with initial state', async () => {
      const fsm = new MeshFSM('test-mesh', basicConfig, db, env.rootDir);
      await fsm.initialize();

      assert.strictEqual(fsm.getCurrentState(), 'planning');
      assert.strictEqual(fsm.isInitialized(), true);
    });

    it('should persist initial state to database', async () => {
      const fsm = new MeshFSM('persist-test', basicConfig, db, env.rootDir);
      await fsm.initialize();

      // Create new FSM instance with same database
      const fsm2 = new MeshFSM('persist-test', basicConfig, db, env.rootDir);
      await fsm2.initialize();

      assert.strictEqual(fsm2.getCurrentState(), 'planning');
    });

    it('should emit transition event on initialization if state loaded', async () => {
      // First FSM creates state
      const fsm1 = new MeshFSM('emit-test', basicConfig, db, env.rootDir);
      await fsm1.initialize();

      // Second FSM loads it - should not emit (no transition happened)
      const fsm2 = new MeshFSM('emit-test', basicConfig, db, env.rootDir);
      let eventEmitted = false;
      fsm2.on('fsm:transition', () => { eventEmitted = true; });
      await fsm2.initialize();

      assert.strictEqual(eventEmitted, false);
    });
  });

  describe('state access', () => {
    it('should return current state config', async () => {
      const fsm = new MeshFSM('test-mesh', basicConfig, db, env.rootDir);
      await fsm.initialize();

      const stateConfig = fsm.getCurrentStateConfig();
      assert.ok(stateConfig);
      assert.strictEqual(stateConfig.name, 'planning');
      assert.strictEqual(stateConfig.coordinator, 'planner');
    });

    it('should return context', async () => {
      const configWithContext: FSMConfig = {
        ...basicConfig,
        context: { feature: 'auth', priority: 'high' },
      };

      const fsm = new MeshFSM('ctx-test', configWithContext, db, env.rootDir);
      await fsm.initialize();

      const context = fsm.getContext();
      assert.deepStrictEqual(context, { feature: 'auth', priority: 'high' });
    });

    it('should update context', async () => {
      const fsm = new MeshFSM('update-ctx', basicConfig, db, env.rootDir);
      await fsm.initialize();

      fsm.updateContext({ newKey: 'newValue', count: 42 });

      const context = fsm.getContext();
      assert.strictEqual(context.newKey, 'newValue');
      assert.strictEqual(context.count, 42);
    });

    it('should return status summary', async () => {
      const fsm = new MeshFSM('status-test', basicConfig, db, env.rootDir);
      await fsm.initialize();

      const status = fsm.getStatus();

      assert.strictEqual(status.meshName, 'status-test');
      assert.strictEqual(status.currentState, 'planning');
      assert.ok(Array.isArray(status.availableTransitions));
      assert.strictEqual(status.availableTransitions.length, 1);
      assert.strictEqual(status.availableTransitions[0].to, 'implementation');
    });
  });

  describe('message handling', () => {
    it('should not transition if FSM not initialized', async () => {
      const fsm = new MeshFSM('uninit', basicConfig, db, env.rootDir);
      // Don't call initialize()

      const result = await fsm.handleMessage('planner', 'developer', 'ask');
      assert.strictEqual(result, false);
    });

    it('should transition on matching ask message', async () => {
      const fsm = new MeshFSM('ask-test', basicConfig, db, env.rootDir);
      await fsm.initialize();

      let transitionEvent: any = null;
      fsm.on('fsm:transition', (e: FSMTransitionEvent) => { transitionEvent = e; });

      const result = await fsm.handleMessage('planner', 'developer', 'ask');

      assert.strictEqual(result, true);
      assert.strictEqual(fsm.getCurrentState(), 'implementation');
      assert.ok(transitionEvent !== null, 'Transition event should be emitted');
      const event = transitionEvent as FSMTransitionEvent;
      assert.strictEqual(event.from, 'planning');
      assert.strictEqual(event.to, 'implementation');
    });

    it('should not transition on non-matching trigger', async () => {
      const fsm = new MeshFSM('no-match', basicConfig, db, env.rootDir);
      await fsm.initialize();

      // 'task-complete' is not valid trigger from planning
      const result = await fsm.handleMessage('planner', 'developer', 'task-complete');

      assert.strictEqual(result, false);
      assert.strictEqual(fsm.getCurrentState(), 'planning');
    });

    it('should not transition on non-matching agent', async () => {
      const fsm = new MeshFSM('wrong-agent', basicConfig, db, env.rootDir);
      await fsm.initialize();

      // 'developer' is not the trigger agent for planning->implementation
      const result = await fsm.handleMessage('developer', 'reviewer', 'ask');

      assert.strictEqual(result, false);
      assert.strictEqual(fsm.getCurrentState(), 'planning');
    });

    it('should chain transitions correctly', async () => {
      const fsm = new MeshFSM('chain-test', basicConfig, db, env.rootDir);
      await fsm.initialize();

      // planning -> implementation
      await fsm.handleMessage('planner', 'developer', 'ask');
      assert.strictEqual(fsm.getCurrentState(), 'implementation');

      // implementation -> review
      await fsm.handleMessage('developer', 'reviewer', 'task-complete');
      assert.strictEqual(fsm.getCurrentState(), 'review');

      // review -> complete
      await fsm.handleMessage('reviewer', 'planner', 'task-complete');
      assert.strictEqual(fsm.getCurrentState(), 'complete');
    });
  });

  describe('force transition', () => {
    it('should force transition bypassing gates', async () => {
      const fsm = new MeshFSM('force-test', basicConfig, db, env.rootDir);
      await fsm.initialize();

      const result = await fsm.forceTransition('review', 'manual override');

      assert.strictEqual(result, true);
      assert.strictEqual(fsm.getCurrentState(), 'review');
    });

    it('should reject force transition to invalid state', async () => {
      const fsm = new MeshFSM('force-invalid', basicConfig, db, env.rootDir);
      await fsm.initialize();

      const result = await fsm.forceTransition('invalid-state', 'test');

      assert.strictEqual(result, false);
      assert.strictEqual(fsm.getCurrentState(), 'planning');
    });
  });

  describe('reset', () => {
    it('should reset to initial state', async () => {
      const configWithContext: FSMConfig = {
        ...basicConfig,
        context: { initial: true },
      };

      const fsm = new MeshFSM('reset-test', configWithContext, db, env.rootDir);
      await fsm.initialize();

      // Transition to a different state
      await fsm.handleMessage('planner', 'developer', 'ask');
      fsm.updateContext({ added: 'value' });

      // Reset
      await fsm.reset('test reset');

      assert.strictEqual(fsm.getCurrentState(), 'planning');
      const context = fsm.getContext();
      assert.strictEqual(context.initial, true);
      assert.strictEqual(context.added, undefined);
    });
  });

  describe('scripts', () => {
    it('should execute onEnter script', async () => {
      const enterScript = path.join(scriptsDir, 'on-enter.sh');
      fs.writeFileSync(enterScript, `#!/bin/bash
echo "ENTERED=true"
exit 0
`, { mode: 0o755 });

      const configWithScript: FSMConfig = {
        initialState: 'start',
        states: [
          { name: 'start', coordinator: 'starter' },
          { name: 'next', coordinator: 'runner', onEnter: enterScript },
        ],
        transitions: [
          { from: 'start', to: 'next', trigger: 'ask' },
        ],
      };

      const fsm = new MeshFSM('enter-script', configWithScript, db, env.rootDir);
      await fsm.initialize();

      let scriptEvent = false;
      fsm.on('fsm:script-run', () => { scriptEvent = true; });

      await fsm.handleMessage('starter', 'runner', 'ask');

      assert.strictEqual(fsm.getCurrentState(), 'next');
      assert.strictEqual(scriptEvent, true);
    });

    it('should fail transition on script error', async () => {
      const failScript = path.join(scriptsDir, 'fail.sh');
      fs.writeFileSync(failScript, `#!/bin/bash
echo "FAIL" >&2
exit 1
`, { mode: 0o755 });

      const configWithFailScript: FSMConfig = {
        initialState: 'start',
        states: [
          { name: 'start', coordinator: 'starter' },
          { name: 'next', coordinator: 'runner', onEnter: failScript },
        ],
        transitions: [
          { from: 'start', to: 'next', trigger: 'ask' },
        ],
      };

      const fsm = new MeshFSM('fail-script', configWithFailScript, db, env.rootDir);
      await fsm.initialize();

      // Script failure should throw
      await assert.rejects(
        () => fsm.handleMessage('starter', 'runner', 'ask'),
        /FSM script failed/
      );

      // State should have transitioned before script ran
      // (per architecture: script failures are FATAL)
    });
  });

  describe('gates with retries', () => {
    it('should block transition when gate fails', async () => {
      const gateScript = path.join(scriptsDir, 'gate-fail.sh');
      fs.writeFileSync(gateScript, `#!/bin/bash
exit 1
`, { mode: 0o755 });

      const configWithGate: FSMConfig = {
        initialState: 'start',
        states: [
          { name: 'start', coordinator: 'starter' },
          {
            name: 'guarded',
            coordinator: 'runner',
            gates: [{ type: 'script', script: gateScript, maxRetries: 2 }],
          },
        ],
        transitions: [
          { from: 'start', to: 'guarded', trigger: 'ask' },
        ],
      };

      const fsm = new MeshFSM('gate-block', configWithGate, db, env.rootDir);
      await fsm.initialize();

      let gateEvent: any = null;
      fsm.on('fsm:gate-check', (e: FSMGateEvent) => { gateEvent = e; });

      const result = await fsm.handleMessage('starter', 'runner', 'ask');

      assert.strictEqual(result, false);
      assert.strictEqual(fsm.getCurrentState(), 'start');
      assert.ok(gateEvent !== null);
      assert.strictEqual(gateEvent!.passed, false);
      assert.strictEqual(gateEvent!.retryCount, 0);
    });

    it('should allow transition after max retries', async () => {
      const gateScript = path.join(scriptsDir, 'gate-always-fail.sh');
      fs.writeFileSync(gateScript, `#!/bin/bash
exit 1
`, { mode: 0o755 });

      const configWithGate: FSMConfig = {
        initialState: 'start',
        states: [
          { name: 'start', coordinator: 'starter' },
          {
            name: 'guarded',
            coordinator: 'runner',
            gates: [{ type: 'script', script: gateScript, maxRetries: 1 }],
          },
        ],
        transitions: [
          { from: 'start', to: 'guarded', trigger: 'ask' },
        ],
      };

      const fsm = new MeshFSM('gate-exhaust', configWithGate, db, env.rootDir);
      await fsm.initialize();

      // First attempt - blocked, retry count = 1
      let result = await fsm.handleMessage('starter', 'runner', 'ask');
      assert.strictEqual(result, false);
      assert.strictEqual(fsm.getCurrentState(), 'start');

      // Second attempt - max retries exceeded, allow through
      result = await fsm.handleMessage('starter', 'runner', 'ask');
      assert.strictEqual(result, true);
      assert.strictEqual(fsm.getCurrentState(), 'guarded');
    });
  });
});
