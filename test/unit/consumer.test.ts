/**
 * Consumer Unit Tests - Type Inference
 *
 * Tests the terminal-by-default messaging feature:
 * - inferMessageType() logic
 * - parseMessage() handling of missing type field
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MessageQueue } from '../../src/queue/index.ts';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('Consumer Type Inference', () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;

  beforeEach(async () => {
    env = createTestEnv('tx-v4-type-inference');

    // Create test-mesh config so the consumer can route messages to it
    const meshDir = path.join(env.meshesDir, 'test-mesh');
    fs.mkdirSync(meshDir, { recursive: true });
    fs.writeFileSync(path.join(meshDir, 'config.yaml'), `mesh: test-mesh
entry_point: worker
agents:
  - name: worker
  - name: reviewer
`);

    queue = new MessageQueue(env.dbPath);
    consumer = new MessageConsumer(env.msgsDir, queue, env.meshesDir);
    await consumer.start();
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  afterEach(async () => {
    await consumer.stop();
    queue.close();
    env.cleanup();
  });

  test('Infers ask-human when to is core/core and type is missing', async () => {
    // Write message without type field
    const msgFile = path.join(env.msgsDir, `${Date.now()}-notype-test-worker--core-core-q1.md`);
    fs.writeFileSync(msgFile, `---
to: core/core
from: test-mesh/worker
msg-id: q1
headline: Need user input
timestamp: ${new Date().toISOString()}
---

What should I do next?
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Core should receive the message with inferred type
    const messages = queue.poll('core/core');
    assert.strictEqual(messages.length, 1, 'Core should receive 1 message');
    assert.strictEqual(messages[0].type, 'ask-human', 'Type should be inferred as ask-human');
    assert.strictEqual(messages[0].from_agent, 'test-mesh/worker');
  });


  test('Infers ask-response when from is core/core', async () => {
    // Write message from core/core without type
    const msgFile = path.join(env.msgsDir, `${Date.now()}-notype-core-core--test-mesh-worker-r2.md`);
    fs.writeFileSync(msgFile, `---
to: test-mesh/worker
from: core/core
msg-id: r2
headline: Your answer
timestamp: ${new Date().toISOString()}
---

The user says yes.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Worker should receive the message with inferred type
    const messages = queue.poll('test-mesh/worker');
    assert.strictEqual(messages.length, 1, 'Worker should receive 1 message');
    assert.strictEqual(messages[0].type, 'ask-response', 'Type should be inferred as ask-response');
  });

  test('Infers ask for agent-to-agent messages', async () => {
    // Write message between two agents without type
    const msgFile = path.join(env.msgsDir, `${Date.now()}-notype-test-mesh-worker--test-mesh-reviewer-a1.md`);
    fs.writeFileSync(msgFile, `---
to: test-mesh/reviewer
from: test-mesh/worker
msg-id: a1
headline: Question for reviewer
timestamp: ${new Date().toISOString()}
---

Is this code correct?
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Reviewer should receive the message with inferred type
    const messages = queue.poll('test-mesh/reviewer');
    assert.strictEqual(messages.length, 1, 'Reviewer should receive 1 message');
    assert.strictEqual(messages[0].type, 'ask', 'Type should be inferred as ask');
    assert.strictEqual(messages[0].from_agent, 'test-mesh/worker');
  });

  test('Explicit type is not overridden', async () => {
    // Write message with explicit type
    const msgFile = path.join(env.msgsDir, `${Date.now()}-explicit-test-mesh-worker--core-core-t1.md`);
    fs.writeFileSync(msgFile, `---
to: core/core
from: test-mesh/worker
type: task-complete
msg-id: t1
headline: Task finished
status: complete
timestamp: ${new Date().toISOString()}
---

All done!
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Core should receive message with explicit type preserved
    const messages = queue.poll('core/core');
    assert.strictEqual(messages.length, 1, 'Core should receive 1 message');
    assert.strictEqual(messages[0].type, 'task-complete', 'Explicit type should be preserved');
  });

  test('Message with only to and from is still processed', async () => {
    // Minimal message - only required fields
    const msgFile = path.join(env.msgsDir, `${Date.now()}-minimal-test-mesh-worker--core-core-m1.md`);
    fs.writeFileSync(msgFile, `---
to: core/core
from: test-mesh/worker
---

Minimal message body.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    const messages = queue.poll('core/core');
    assert.strictEqual(messages.length, 1, 'Minimal message should be processed');
    assert.strictEqual(messages[0].type, 'ask-human', 'Type should be inferred as ask-human');
    assert.ok(
      (messages[0].payload.body as string)?.includes('Minimal message body'),
      'Body should be preserved'
    );
  });
});
