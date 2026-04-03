/**
 * Real LLM Test 12: Mesh Completion
 *
 * Full end-to-end test with a real Claude worker (haiku).
 * Verifies that the test-echo mesh correctly completes its lifecycle:
 * spawns a worker, processes the task, and sends task-complete to core.
 *
 * Responsibilities:
 * - Copy test-echo mesh into isolated test environment
 * - Write a task message to trigger the echo agent
 * - Wait for worker:complete event from the dispatcher
 * - Confirm task-complete message lands in the queue from test-echo/echo
 * - Verify the response body is non-empty
 *
 * Cost: ~$0.02 (1 haiku agent × ~$0.02)
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

describe('Real LLM Test: Mesh Completion', { skip: !hasClaude }, () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = createTestEnv('tx-v4-mesh-completion');
    queue = new MessageQueue(env.dbPath);

    // Copy test-echo mesh into the isolated environment
    const srcMeshDir = path.resolve(__dirname, '../../../meshes/test-echo');
    const destMeshDir = path.join(env.meshesDir, 'test-echo');
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

  it('should complete echo mesh lifecycle', { timeout: 120000 }, async () => {
    // 1. Insert task into queue and emit worker-message (bypasses chokidar)
    const ts = Date.now();
    const msgId = `echo-${ts}`;

    const queueId = queue.insert({
      from_agent: 'core/core',
      to_agent: 'test-echo/echo',
      payload: {
        headline: 'Echo test',
        body: 'Echo back: hello world',
        'msg-id': msgId,
      },
    });

    console.log('[LLM] inserted task message for test-echo/echo');
    consumer.emit('worker-message', {
      id: queueId,
      agentId: 'test-echo/echo',
      from: 'core/core',
    });

    // 2. Wait for worker:complete — confirms the echo agent ran to completion
    console.log('[LLM] waiting for worker:complete (up to 60s)...');
    const completeEvent = await harness.waitForEvent(
      'worker:complete',
      (data) => {
        const id = data.agentId || data.id || '';
        return id.includes('test-echo') || id.includes('echo');
      },
      { timeout: 60000 }
    );

    assert.ok(completeEvent, 'worker:complete should fire for test-echo/echo');
    console.log(`[LLM] worker:complete received for: ${completeEvent.data.agentId || completeEvent.data.id}`);

    // 3. Check for response message file from test-echo/echo → core/core
    //    (Consumer watcher is not running, so check msg files directly)
    const msgFiles = fs.readdirSync(env.msgsDir);
    const echoFiles = msgFiles.filter(
      (f) => f.includes('echo') && f.includes('core') && f !== path.basename(env.msgsDir)
    );
    console.log(`[LLM] echo response files: ${echoFiles.join(', ') || '(none)'}`);

    assert.ok(echoFiles.length > 0, 'test-echo/echo should write a response message file');

    // 4. Verify response body is non-empty
    const responseContent = fs.readFileSync(path.join(env.msgsDir, echoFiles[0]), 'utf-8');
    const bodyMatch = responseContent.split('---').slice(2).join('---').trim();
    assert.ok(bodyMatch.length > 0, 'Echo agent should produce non-empty output');
    console.log(`[LLM] echo output (first 200 chars): ${bodyMatch.slice(0, 200)}`);

    // 5. Verify event sequence
    harness.assertEventSequence([
      'worker:spawn',
      'worker:complete',
    ]);

    console.log('[LLM] Echo mesh lifecycle verified');
  });
});
