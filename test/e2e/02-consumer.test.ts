/**
 * V4 Consumer Test - Test 2
 *
 * Verifies that file watcher routes messages from .ai/tx/msgs/ to SQLite queue.
 * Tests file parsing, frontmatter extraction, and queue insertion.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { MessageQueue } from '../../src/queue/index.ts';
import { createTestEnv, createTestMessage, sleep, type TestEnv } from '../helpers/test-env.ts';

describe('V4 Consumer Test', () => {
  let env: TestEnv;
  let consumer: MessageConsumer;
  let queue: MessageQueue;

  before(async () => {
    // Create isolated test environment
    env = createTestEnv('tx-v4-consumer');
    queue = new MessageQueue(env.dbPath);
    consumer = new MessageConsumer(env.msgsDir, queue);
  });

  after(async () => {
    if (consumer) await consumer.stop();
    if (queue) queue.close();
    env.cleanup();
  });

  it('should start watching the message directory', async () => {
    await consumer.start();
    assert.strictEqual(consumer.isRunning(), true, 'Consumer should be running');
  });

  it('should parse and queue a new message file', async () => {
    // Ensure consumer is running
    if (!consumer.isRunning()) {
      await consumer.start();
    }

    // Create a test message file
    createTestMessage(env.msgsDir, '1209020000-task-core--dev-test1.md', {
      to: 'dev/dev',
      from: 'core/core',
      type: 'task',
      status: 'start',
      msgId: 'test1',
      headline: 'Test message',
      body: '# Task Body\n\nThis is a test message.',
      rearmatter: { grade: 'A', confidence: 0.95 }
    });

    // Wait for file to be processed
    await sleep(500);

    // Check queue for the message
    const messages = queue.poll('dev/dev');
    assert.ok(messages.length >= 1, 'Should have at least one message in queue');

    const msg = messages.find(m => m.payload?.['msg-id'] === 'test1');
    assert.ok(msg, 'Should find the test message');
    assert.strictEqual(msg.from_agent, 'core/core');
    assert.strictEqual(msg.to_agent, 'dev/dev');
    assert.ok(msg.payload, 'Should have payload');
  });

  it('should extract frontmatter fields correctly', async () => {
    // Create another test message
    createTestMessage(env.msgsDir, '1209020100-update-sender--receiver-test2.md', {
      to: 'receiver/agent',
      from: 'sender/agent',
      type: 'update',
      msgId: 'test2',
      headline: 'Update notification',
      body: 'Status update content here.'
    });

    await sleep(500);

    const messages = queue.poll('receiver/agent');
    const msg = messages.find(m => m.payload?.['msg-id'] === 'test2');

    assert.ok(msg, 'Should find the update message');
    assert.strictEqual(msg.from_agent, 'sender/agent');
    assert.strictEqual(msg.to_agent, 'receiver/agent');
    assert.ok(msg.payload, 'Should have payload');
    assert.ok(msg.payload.body, 'Should have body in payload');
  });

  it('should include rearmatter in payload', async () => {
    createTestMessage(env.msgsDir, '1209020200-task-test--test-test3.md', {
      to: 'test/agent',
      from: 'test/sender',
      type: 'task',
      msgId: 'test3',
      body: 'Message with rearmatter.',
      rearmatter: {
        grade: 'B',
        confidence: 0.8,
        speculation: '{}',
        gaps: '{}'
      }
    });

    await sleep(500);

    const messages = queue.poll('test/agent');
    const msg = messages.find(m => m.payload?.['msg-id'] === 'test3');

    assert.ok(msg, 'Should find the message');
    assert.ok(msg.payload.rearmatter, 'Should have rearmatter in payload');
    const rearmatter = msg.payload.rearmatter as any;
    assert.strictEqual(rearmatter.grade, 'B');
    assert.strictEqual(rearmatter.confidence, 0.8);
  });

  it('should extract command frontmatter', async () => {
    createTestMessage(env.msgsDir, '1209020300-task-core--brain-test4.md', {
      to: 'brain/brain',
      from: 'core/core',
      type: 'task',
      msgId: 'test4',
      headline: 'Execute slash command',
      command: '/know:prepare',
      body: 'Run the prepare command.'
    });

    await sleep(500);

    const messages = queue.poll('brain/brain');
    const msg = messages.find(m => m.payload?.['msg-id'] === 'test4');

    assert.ok(msg, 'Should find the message');
    assert.strictEqual(msg.payload.command, '/know:prepare', 'Should have command in payload');
  });

  it('should handle multiple messages in sequence', async () => {
    const recipient = 'batch/agent';

    // Create multiple messages
    for (let i = 0; i < 3; i++) {
      createTestMessage(env.msgsDir, `1209020${400 + i}-task-core--batch-batch${i}.md`, {
        to: recipient,
        from: 'core/core',
        type: 'task',
        msgId: `batch${i}`,
        body: `Batch message ${i}`
      });
    }

    await sleep(800);

    const messages = queue.poll(recipient);
    assert.ok(messages.length >= 3, `Should have at least 3 messages, got ${messages.length}`);
  });

  it('should stop watching when stopped', async () => {
    await consumer.stop();
    assert.strictEqual(consumer.isRunning(), false, 'Consumer should be stopped');
  });
});
