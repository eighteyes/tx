/**
 * Real LLM Test 11: Ensemble
 *
 * Full end-to-end test with real Claude workers (haiku).
 * Verifies that the ensemble coordinator correctly spawns 3 parallel
 * worker agents, aggregates their outputs, and emits ensemble events.
 *
 * Strategy: bypass the FSM entry agent (which requires file-based message
 * routing) and directly trigger the ensemble state after force-transitioning
 * the FSM. This tests the actual ensemble mechanics with real LLM workers.
 *
 * Responsibilities:
 * - Copy test-fsm-full mesh into isolated test environment
 * - Force FSM to fan_out state (bypasses entry agent file routing)
 * - Directly trigger handleEnsembleState
 * - Wait for ensemble:start event (confirms workers spawned)
 * - Wait for ensemble:complete event (confirms aggregation)
 *
 * Cost: ~$0.18 (3 haiku workers × ~$0.06 each)
 * Requires: `claude` CLI authenticated (subscription or API key)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { MessageQueue } from '../../../src/queue/index.ts';
import { MessageConsumer } from '../../../src/core/consumer.ts';
import { WorkerDispatcher } from '../../../src/worker/dispatcher.ts';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.ts';
import { EventHarness } from '../../utils/event-harness.ts';

// Skip if claude CLI is not available
let hasClaude = false;
try {
  execSync('claude --version', { stdio: 'pipe' });
  hasClaude = true;
} catch {
  hasClaude = false;
}

describe('Real LLM Test: Ensemble', { skip: !hasClaude }, () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = createTestEnv('tx-v4-ensemble');
    queue = new MessageQueue(env.dbPath);

    // Copy test-fsm-full mesh (contains ensemble fan_out state)
    const srcMeshDir = path.resolve(__dirname, '../../../meshes/test-fsm-full');
    const destMeshDir = path.join(env.meshesDir, 'test-fsm-full');
    fs.mkdirSync(destMeshDir, { recursive: true });

    const meshFiles = fs.readdirSync(srcMeshDir);
    for (const file of meshFiles) {
      const srcPath = path.join(srcMeshDir, file);
      const destPath = path.join(destMeshDir, file);
      const stat = fs.statSync(srcPath);

      if (stat.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        for (const sub of fs.readdirSync(srcPath)) {
          fs.copyFileSync(path.join(srcPath, sub), path.join(destPath, sub));
        }
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }

    // Create workspace directories required by FSM
    fs.mkdirSync(path.join(env.rootDir, '.ai', 'test-fsm-full', 'workspace'), { recursive: true });
    fs.mkdirSync(path.join(env.rootDir, '.ai', 'tx', 'test-fsm-full'), { recursive: true });

    // Boot consumer (event bus only — no chokidar watcher) + dispatcher
    consumer = new MessageConsumer(env.msgsDir, queue);
    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
        godMode: true,  // Bypass permissions for test env (no HITL)
      },
      queue
    );

    harness = new EventHarness(dispatcher);

    // Log worker lifecycle for visibility
    dispatcher.on('worker:spawn', (d: any) => console.log(`[LLM] worker:spawn ${d.agentId}`));
    dispatcher.on('worker:complete', (d: any) => console.log(`[LLM] worker:complete ${d.agentId || d.id}`));
    dispatcher.on('worker:error', (d: any) => console.log(`[LLM] worker:error ${d.agentId || d.id}: ${d.error}`));
    dispatcher.on('fsm:transition', (d: any) => console.log(`[LLM] fsm:transition ${d.from} → ${d.to}`));
    dispatcher.on('ensemble:start', (d: any) => console.log(`[LLM] ensemble:start meshName=${d.meshName}`));
    dispatcher.on('ensemble:complete', (d: any) => console.log(`[LLM] ensemble:complete meshName=${d.meshName}`));
    dispatcher.on('ensemble:error', (d: any) => console.log(`[LLM] ensemble:error meshName=${d.meshName}: ${d.error}`));

    // Skip consumer.start() — bypasses chokidar (EMFILE in test envs)
    await dispatcher.start(consumer);
    console.log('[LLM] dispatcher started, meshes loaded');
  });

  afterEach(async () => {
    harness.destroy();
    if (dispatcher) await dispatcher.stop(consumer);
    if (consumer) await consumer.stop();
    if (queue) queue.close();
    if (env) env.cleanup();
  });

  it('should execute ensemble state with real workers', { timeout: 120000 }, async () => {
    // Strategy: FSM transitions require file-based message routing through the
    // consumer (chokidar) which is disabled in tests. Instead, we:
    // 1. Force-transition the FSM to the fan_out (ensemble) state
    // 2. Directly trigger handleEnsembleState via the dispatcher
    // This tests the actual ensemble mechanics with real haiku workers.

    // 1. Get FSM and force-transition to fan_out
    const fsm = (dispatcher as any).meshFSMs.get('test-fsm-full');
    assert.ok(fsm, 'FSM should be initialized for test-fsm-full');
    assert.ok(fsm.isInitialized(), 'FSM should be initialized');

    console.log(`[LLM] FSM current state: ${fsm.getCurrentState()}`);

    const transitioned = await fsm.forceTransition('fan_out', 'test:direct-ensemble');
    assert.ok(transitioned, 'FSM should transition to fan_out');
    console.log(`[LLM] FSM force-transitioned to fan_out`);

    // 2. Get the fan_out state config and trigger ensemble directly
    const fanOutConfig = fsm.getStateConfig('fan_out');
    assert.ok(fanOutConfig, 'fan_out state config should exist');
    assert.ok(fanOutConfig.ensemble, 'fan_out should have ensemble config');
    console.log(`[LLM] Ensemble config: agents=[${fanOutConfig.ensemble.agents}], type=${fanOutConfig.ensemble.type}`);

    // 3. Trigger handleEnsembleState directly — this spawns real haiku workers
    console.log('[LLM] triggering handleEnsembleState...');
    await (dispatcher as any).handleEnsembleState('test-fsm-full', fanOutConfig, fsm);

    // Note: handleEnsembleState spawns workers async. Wait for events.

    // 4. Wait for ensemble:start — confirms workers were spawned
    console.log('[LLM] waiting for ensemble:start (up to 30s)...');
    const startEvent = await harness.waitForEvent(
      'ensemble:start',
      (data) => data?.meshName === 'test-fsm-full',
      { timeout: 30000 }
    );

    assert.ok(startEvent, 'ensemble:start should fire');
    console.log(`[LLM] ensemble:start received`);

    // 5. Wait for ensemble:complete — confirms all workers finished and aggregated
    console.log('[LLM] waiting for ensemble:complete (up to 90s)...');
    const completeEvent = await harness.waitForEvent(
      'ensemble:complete',
      (data) => data?.meshName === 'test-fsm-full',
      { timeout: 90000 }
    );

    assert.ok(completeEvent, 'ensemble:complete should fire');
    console.log(`[LLM] ensemble:complete received`);

    // 6. Assert event sequence
    harness.assertEventSequence([
      'ensemble:start',
      'ensemble:complete',
    ]);

    console.log('[LLM] Ensemble lifecycle verified');
  });
});
