/**
 * Test 5: HITL Flow
 *
 * Validates that:
 * 1. Worker can send ask-human to core
 * 2. Core receives and displays the question
 * 3. User response is sent back to worker
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MessageQueue } from '../../src/queue/index.ts';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('V4 HITL Flow Test', () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;

  before(async () => {
    env = createTestEnv('tx-v4-hitl');
    queue = new MessageQueue(env.dbPath);
    consumer = new MessageConsumer(env.msgsDir, queue);
    await consumer.start();
    // Wait for watcher to be ready
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  after(async () => {
    await consumer.stop();
    queue.close();
    env.cleanup();
  });

  it('should route ask-human message from worker to core', async () => {
    // Worker sends ask-human
    const msgFile = path.join(env.msgsDir, '1209120000-ask-human-test-worker--core-q1.md');
    fs.writeFileSync(msgFile, `---
to: core/core
from: test/worker
type: ask-human
status: pending
msg-id: q1
headline: Need user input
timestamp: 2025-12-09T12:00:00.000Z
---

What is your favorite color?

---
grade: A
confidence: 0.95
`);

    // Wait for consumer to process
    await new Promise(resolve => setTimeout(resolve, 600));

    // Core should receive the message
    const messages = queue.poll('core/core');
    assert.strictEqual(messages.length, 1, 'Core should receive 1 message');
    assert.strictEqual(messages[0].type, 'ask-human');
    assert.strictEqual(messages[0].from_agent, 'test/worker');
    assert.ok((messages[0].payload.body as string)?.includes('favorite color'));
  });

  it('should route ask-response from core back to worker', async () => {
    // Core sends ask-response
    const msgFile = path.join(env.msgsDir, '1209120001-ask-response-core--test-worker-r1.md');
    fs.writeFileSync(msgFile, `---
to: test/worker
from: core/core
type: ask-response
status: pending
msg-id: r1
headline: User response
timestamp: 2025-12-09T12:00:01.000Z
---

Blue

---
grade: A
confidence: 1.0
`);

    // Wait for consumer to process
    await new Promise(resolve => setTimeout(resolve, 600));

    // Worker should receive the response
    const messages = queue.poll('test/worker');
    assert.strictEqual(messages.length, 1, 'Worker should receive 1 message');
    assert.strictEqual(messages[0].type, 'ask-response');
    assert.strictEqual(messages[0].from_agent, 'core/core');
    assert.ok((messages[0].payload.body as string)?.includes('Blue'));
  });

  it('should handle full HITL round trip', async () => {
    // Simulate complete HITL flow via queue directly

    // 1. Worker asks question
    queue.insert({
      from_agent: 'test/worker',
      to_agent: 'core/core',
      type: 'ask-human',
      payload: {
        'msg-id': 'q2',
        headline: 'Confirmation needed',
        body: 'Should I proceed with the task?',
      },
    });

    // 2. Verify core receives it
    const coreMessages = queue.poll('core/core');
    assert.strictEqual(coreMessages.length, 1);
    assert.strictEqual(coreMessages[0].type, 'ask-human');

    // 3. Core sends response
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/worker',
      type: 'ask-response',
      payload: {
        'msg-id': 'r2',
        headline: 'User confirmed',
        body: 'Yes, proceed',
      },
    });

    // 4. Worker receives response
    const workerMessages = queue.poll('test/worker');
    assert.strictEqual(workerMessages.length, 1);
    assert.strictEqual(workerMessages[0].type, 'ask-response');
    assert.ok((workerMessages[0].payload.body as string)?.includes('proceed'));
  });
});
