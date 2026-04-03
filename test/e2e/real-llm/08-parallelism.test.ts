/**
 * Real LLM Test 08: Parallelism
 *
 * Full end-to-end test with real Claude workers (haiku).
 * Verifies that the test-parallelism mesh correctly:
 * 1. Preloads context (entry agent)
 * 2. Spawns 3 parallel agents (analyst, reviewer, critic)
 * 3. Gates synthesizer until all parallel agents complete
 * 4. Synthesizer produces final output to core
 *
 * Responsibilities:
 * - Validate real parallel agent execution with LLM
 * - Verify event sequence through full lifecycle
 * - Confirm synthesizer receives parallel outputs
 *
 * Cost: ~$0.30 (5 haiku agents × ~$0.06 each)
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

describe('Real LLM Test: Parallelism', { skip: !hasClaude }, () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = createTestEnv('tx-v4-parallelism');
    queue = new MessageQueue(env.dbPath);

    // Copy test-parallelism mesh
    const srcMeshDir = path.resolve(__dirname, '../../../meshes/test-parallelism');
    const destMeshDir = path.join(env.meshesDir, 'test-parallelism');
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

    // Create package.json that preload agent loads
    fs.writeFileSync(
      path.join(env.rootDir, 'package.json'),
      JSON.stringify({ name: 'test-parallelism-pkg', version: '1.0.0' })
    );

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

  it('should execute full parallel mesh lifecycle', { timeout: 120000 }, async () => {
    // 1. Insert task into queue and emit worker-message (bypasses chokidar)
    const ts = Date.now();
    const msgId = `par-${ts}`;

    const queueId = queue.insert({
      from_agent: 'core/core',
      to_agent: 'test-parallelism/preload',
      payload: {
        headline: 'Parallel test',
        body: 'Analyze the project structure.',
        'msg-id': msgId,
      },
    });

    console.log('[LLM] inserted task message for test-parallelism/preload');
    consumer.emit('worker-message', {
      id: queueId,
      agentId: 'test-parallelism/preload',
      from: 'core/core',
    });

    // 2. Wait for parallel:spawn — confirms preload completed and parallel agents launched
    console.log('[LLM] waiting for parallel:spawn (up to 60s)...');
    const spawnEvent = await harness.waitForEvent(
      'parallel:spawn',
      (data) => data.meshName === 'test-parallelism',
      { timeout: 60000 }
    );

    assert.ok(spawnEvent, 'parallel:spawn should fire');
    assert.deepStrictEqual(
      spawnEvent.data.agents.sort(),
      ['analyst', 'critic', 'reviewer'],
      'Should spawn analyst, critic, reviewer'
    );

    console.log('[LLM] parallel:spawn received — 3 parallel agents launched');

    // 3. Wait for parallel:complete — confirms all 3 parallel agents finished
    console.log('[LLM] waiting for parallel:complete (up to 90s)...');
    const completeEvent = await harness.waitForEvent(
      'parallel:complete',
      (data) => data.meshName === 'test-parallelism',
      { timeout: 90000 }
    );

    assert.ok(completeEvent, 'parallel:complete should fire');
    assert.deepStrictEqual(
      completeEvent.data.completedAgents.sort(),
      ['analyst', 'critic', 'reviewer'],
      'All 3 parallel agents should be in completedAgents'
    );

    console.log('[LLM] parallel:complete received — all parallel agents done');

    // 4. Wait for synthesizer worker:complete event, then check message files
    console.log('[LLM] waiting for synthesizer worker:complete (up to 60s)...');
    await harness.waitForEvent(
      'worker:complete',
      (data) => (data.agentId ?? data.id ?? '').includes('synthesizer'),
      { timeout: 60000 }
    );

    // Check message files in msgsDir for synthesizer response
    const msgFiles = fs.readdirSync(env.msgsDir);
    const synthFiles = msgFiles.filter(
      (f) => f.includes('synthesizer') || f.includes('synth')
    );
    assert.ok(synthFiles.length > 0, 'Synthesizer should write a response message file');
    const responseContent = fs.readFileSync(path.join(env.msgsDir, synthFiles[0]), 'utf-8');
    const bodyMatch = responseContent.split('---').slice(2).join('---').trim();
    assert.ok(bodyMatch.length > 0, 'Synthesizer should produce non-empty output');
    console.log(`[LLM] Synthesizer output (first 200 chars): ${bodyMatch.slice(0, 200)}`);

    // 5. Assert event sequence
    harness.assertEventSequence([
      'worker:spawn',    // preload
      'parallel:spawn',  // fork to parallel agents
      'parallel:complete', // all parallel agents done
    ]);

    console.log('[LLM] Full parallel lifecycle verified');
  });
});
