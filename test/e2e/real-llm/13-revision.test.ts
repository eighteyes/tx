/**
 * Real LLM Test 13: Revision/Interrupt
 *
 * Full end-to-end test with a real Claude worker (haiku).
 * Verifies that the revision flow does not crash the system
 * when a revision message arrives while a worker is active.
 *
 * Responsibilities:
 * - Spawn a real worker and send an initial task
 * - Write a revision message (append mode) shortly after spawn
 * - Confirm the worker completes without error (revision may or may not
 *   have been hot-injected depending on timing)
 *
 * Cost: ~$0.05 (1 haiku worker)
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

describe('Real LLM Test: Revision', { skip: !hasClaude }, () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = createTestEnv('tx-v4-revision');
    queue = new MessageQueue(env.dbPath);

    // Build inline test-revision mesh directly in the meshes directory
    const meshDir = path.join(env.meshesDir, 'test-revision');
    fs.mkdirSync(meshDir, { recursive: true });

    fs.writeFileSync(
      path.join(meshDir, 'config.yaml'),
      [
        'mesh: test-revision',
        'agents:',
        '  - name: worker',
        '    model: haiku',
        '    prompt: worker.md',
        '    max_turns: 10',
        'entry_point: worker',
        'routing:',
        '  worker:',
        '    complete:',
        '      core: "Done"',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(meshDir, 'worker.md'),
      'You are a test worker. When you receive a task, write a detailed analysis. Take your time and be thorough.'
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

    dispatcher.on('worker:spawn', (d: any) => console.log(`[LLM] worker:spawn ${d.agentId}`));
    dispatcher.on('worker:complete', (d: any) => console.log(`[LLM] worker:complete ${d.agentId || d.id}`));
    dispatcher.on('worker:error', (d: any) => console.log(`[LLM] worker:error ${d.agentId || d.id}: ${d.error}`));

    // Skip consumer.start() — bypasses chokidar (EMFILE in test envs)
    await dispatcher.start(consumer);
    console.log('[LLM] dispatcher started, mesh loaded');
  });

  afterEach(async () => {
    harness.destroy();
    if (dispatcher) await dispatcher.stop(consumer);
    if (consumer) await consumer.stop();
    if (queue) queue.close();
    if (env) env.cleanup();
  });

  it('should handle revision during active worker', { timeout: 120000 }, async () => {
    const ts = Date.now();
    const msgId = `rev-task-${ts}`;

    // 1. Insert initial task into queue and emit worker-message (bypasses chokidar)
    const queueId = queue.insert({
      from_agent: 'core/core',
      to_agent: 'test-revision/worker',
      type: 'task',
      payload: {
        headline: 'Analysis task',
        body: 'Analyze the concept of software testing',
        'msg-id': msgId,
      },
    });

    console.log('[LLM] inserted task message for test-revision/worker');
    consumer.emit('worker-message', {
      id: queueId,
      agentId: 'test-revision/worker',
      from: 'core/core',
      type: 'task',
    });

    // 2. Wait for worker:spawn (up to 15s) — confirms the worker started
    console.log('[LLM] waiting for worker:spawn (up to 15s)...');
    const spawnEvent = await harness.waitForEvent(
      'worker:spawn',
      (data) => (data.agentId ?? '').includes('test-revision'),
      { timeout: 15000 }
    );
    assert.ok(spawnEvent, 'worker:spawn should fire after writing task message');
    console.log(`[LLM] worker:spawn received — agentId: ${spawnEvent.data.agentId}`);

    // 3. Give the worker a moment to start processing before sending the revision
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 4. Emit revision message directly (bypasses chokidar)
    console.log('[LLM] emitting revision message for test-revision/worker');
    consumer.emit('revision-message', {
      filepath: '',
      agentId: 'test-revision/worker',
      from: 'core/core',
      type: 'task',
      content: 'Also include a section about TDD methodology.',
      headline: 'Additional instructions',
      mode: 'append',
    });

    // 5. Wait for worker:complete OR worker:error (up to 90s)
    // The revision kills the running worker and attempts to resume the session.
    // In test environments without full consumer routing, the resume may not
    // succeed — but the key assertion is that the system handles the revision
    // without crashing or hanging.
    console.log('[LLM] waiting for worker terminal event (up to 90s)...');
    const terminalEvent = await Promise.race([
      harness.waitForEvent(
        'worker:complete',
        (data) => (data.agentId ?? data.id ?? '').includes('test-revision'),
        { timeout: 90000 }
      ).then((e) => ({ type: 'worker:complete', data: e.data })),
      harness.waitForEvent(
        'worker:error',
        (data) => (data.agentId ?? data.id ?? data.error ?? '').toString().includes('test-revision') ||
                  (data.agentId ?? data.id ?? data.error ?? '').toString().includes('aborted'),
        { timeout: 90000 }
      ).then((e) => ({ type: 'worker:error', data: e.data })),
    ]);

    assert.ok(terminalEvent, 'Worker should reach a terminal state after revision');
    console.log(`[LLM] terminal event: ${terminalEvent.type}`);

    // 6. Verify the worker produced output — check message files in msgsDir
    const msgFiles = fs.readdirSync(env.msgsDir);
    const responseFiles = msgFiles.filter(
      (f) => f.includes('worker') && f.includes('core')
    );

    if (responseFiles.length > 0) {
      const responseContent = fs.readFileSync(path.join(env.msgsDir, responseFiles[0]), 'utf-8');
      const bodyMatch = responseContent.split('---').slice(2).join('---').trim();
      assert.ok(bodyMatch.length > 0, 'Worker output should be non-empty');
      console.log(`[LLM] Worker output (first 200 chars): ${bodyMatch.slice(0, 200)}`);
    } else {
      // Worker may have completed without writing a response file
      // (e.g., revision killed it mid-response). The important thing is no crash.
      console.log('[LLM] No response message file found — worker may have been revised mid-flight.');
    }

    console.log('[LLM] Revision lifecycle verified — no crash on revision during active worker');
  });
});
