/**
 * Test 11: Message Revision Flow
 *
 * Tests the message interrupt flow where edited message files trigger
 * interrupt and resume of active workers.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { MessageQueue } from '../../src/queue/index.ts';
import { createTestEnv, createTestMessage, sleep, type TestEnv } from '../helpers/test-env.ts';

describe('Message Revision Flow', () => {
  let env: TestEnv;
  let consumer: MessageConsumer;
  let queue: MessageQueue;

  before(async () => {
    env = createTestEnv('tx-v4-revision');
    queue = new MessageQueue(env.dbPath);
    consumer = new MessageConsumer(env.msgsDir, queue);
    await consumer.start();
  });

  after(async () => {
    if (consumer) await consumer.stop();
    if (queue) queue.close();
    env.cleanup();
  });

  describe('Consumer Revision Detection', () => {
    it('should emit worker-message event for new messages with event type', async () => {
      let receivedEvent: any = null;

      consumer.on('worker-message', (event) => {
        receivedEvent = event;
      });

      createTestMessage(env.msgsDir, '1209030000-task-core--test-rev1.md', {
        to: 'test/worker',
        from: 'core/core',
        type: 'task',
        msgId: 'rev1',
        headline: 'Original task',
        body: 'Original task content'
      });

      await sleep(300);

      if (!receivedEvent) throw new Error('Should receive worker-message event');
      assert.strictEqual(receivedEvent.event, 'new', 'Should have event type "new"');
      assert.strictEqual(receivedEvent.agentId, 'test/worker', 'Should have correct agentId');
    });

    it('should emit revision-message event when file is edited', async () => {
      let revisionEvent: any = null;

      consumer.on('revision-message', (event) => {
        revisionEvent = event;
      });

      // Create initial message
      const filepath = createTestMessage(env.msgsDir, '1209030100-task-core--test-rev2.md', {
        to: 'test/worker',
        from: 'core/core',
        type: 'task',
        msgId: 'rev2',
        headline: 'Initial headline',
        body: 'Initial content'
      });

      await sleep(300);

      // Now edit the file (revision)
      const revisedContent = `---
to: test/worker
from: core/core
type: task
msg-id: rev2
headline: Revised headline
timestamp: ${new Date().toISOString()}
---

Revised content with updated instructions.
`;
      fs.writeFileSync(filepath, revisedContent);

      await sleep(300);

      if (!revisionEvent) throw new Error('Should receive revision-message event');
      assert.strictEqual(revisionEvent.agentId, 'test/worker', 'Should have correct agentId');
      assert.strictEqual(revisionEvent.headline, 'Revised headline', 'Should have revised headline');
      assert.ok(
        revisionEvent.content?.includes('Revised content'),
        'Should have revised content'
      );
    });

    it('should NOT queue revision messages (handled via interrupt+resume)', async () => {
      const agentId = 'revision/agent';
      let workerMessageCount = 0;

      // Count new worker-message events (which indicate queue insertions)
      const countHandler = (event: { agentId?: string }) => {
        if (event.agentId === agentId) {
          workerMessageCount++;
        }
      };
      consumer.on('worker-message', countHandler);

      // Create initial message
      const filepath = createTestMessage(env.msgsDir, '1209030200-task-core--revision-rev3.md', {
        to: agentId,
        from: 'core/core',
        type: 'task',
        msgId: 'rev3',
        body: 'Initial content'
      });

      await sleep(300);

      // Should have 1 worker-message event for the initial message
      assert.strictEqual(workerMessageCount, 1, 'Should have one worker-message for initial');

      // Edit the file (this should NOT emit worker-message, just revision-message)
      const revisedContent = `---
to: ${agentId}
from: core/core
type: task
msg-id: rev3
timestamp: ${new Date().toISOString()}
---

Revised content.
`;
      fs.writeFileSync(filepath, revisedContent);

      await sleep(300);

      consumer.off('worker-message', countHandler);

      // Count should still be 1 - revision does NOT create new worker-message
      assert.strictEqual(
        workerMessageCount,
        1,
        'Revision should NOT emit additional worker-message events'
      );
    });

    it('should NOT emit revision-message for core/core messages', async () => {
      let revisionReceived = false;

      const revisionHandler = () => {
        revisionReceived = true;
      };
      consumer.on('revision-message', revisionHandler);

      // Create initial core message
      const filepath = createTestMessage(env.msgsDir, '1209030300-task-dev--core-rev4.md', {
        to: 'core/core',
        from: 'dev/worker',
        type: 'task-complete',
        msgId: 'rev4',
        body: 'Initial response'
      });

      await sleep(300);

      // Edit it
      const revisedContent = `---
to: core/core
from: dev/worker
type: task-complete
msg-id: rev4
timestamp: ${new Date().toISOString()}
---

Revised response.
`;
      fs.writeFileSync(filepath, revisedContent);

      await sleep(300);

      consumer.off('revision-message', revisionHandler);

      assert.strictEqual(
        revisionReceived,
        false,
        'Should NOT emit revision-message for core/core targets'
      );
    });
  });

  describe('Consumer Event Types', () => {
    it('should include event type in core-message events', async () => {
      let coreEvent: any = null;

      consumer.on('core-message', (event) => {
        coreEvent = event;
      });

      createTestMessage(env.msgsDir, '1209030400-task-worker--core-ev1.md', {
        to: 'core/core',
        from: 'worker/agent',
        type: 'task-complete',
        msgId: 'ev1',
        body: 'Task completed'
      });

      await sleep(300);

      if (!coreEvent) throw new Error('Should receive core-message event');
      assert.strictEqual(coreEvent.event, 'new', 'Should have event type');
    });
  });
});
