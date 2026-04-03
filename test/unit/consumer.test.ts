/**
 * Consumer Unit Tests
 *
 * Tests message routing and processing:
 * - Core vs worker routing
 * - Minimal message acceptance
 * - Message field validation
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MessageQueue } from '../../src/queue/index.ts';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('Consumer Message Routing', () => {
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

  test('Routes message to core/core when to is core/core', async () => {
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

    const messages = queue.poll('core/core');
    assert.strictEqual(messages.length, 1, 'Core should receive 1 message');
    assert.strictEqual(messages[0].from_agent, 'test-mesh/worker');
  });


  test('Routes message to worker when from is core/core', async () => {
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

    const messages = queue.poll('test-mesh/worker');
    assert.strictEqual(messages.length, 1, 'Worker should receive 1 message');
  });

  test('Routes agent-to-agent messages to recipient', async () => {
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

    const messages = queue.poll('test-mesh/reviewer');
    assert.strictEqual(messages.length, 1, 'Reviewer should receive 1 message');
    assert.strictEqual(messages[0].from_agent, 'test-mesh/worker');
  });

  test('Message with status:complete routes to core', async () => {
    const msgFile = path.join(env.msgsDir, `${Date.now()}-explicit-test-mesh-worker--core-core-t1.md`);
    fs.writeFileSync(msgFile, `---
to: core/core
from: test-mesh/worker
msg-id: t1
headline: Task finished
status: complete
timestamp: ${new Date().toISOString()}
---

All done!
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    const messages = queue.poll('core/core');
    assert.strictEqual(messages.length, 1, 'Core should receive 1 message');
  });

  test('Message with only to and from is still processed', async () => {
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
    assert.ok(
      (messages[0].payload.body as string)?.includes('Minimal message body'),
      'Body should be preserved'
    );
  });
});
