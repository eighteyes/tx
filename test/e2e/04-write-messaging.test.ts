/**
 * V4 Write Messaging Test - Test 4
 *
 * Integration test validating "Write is Canonical" principle:
 * Agent writes message file -> Consumer routes to queue -> Recipient receives
 *
 * Combines: Consumer + Queue + message format
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { MessageQueue } from '../../src/queue/index.ts';
import { createTestEnv, createTestMessage, sleep, type TestEnv } from '../helpers/test-env.ts';

describe('V4 Write Messaging Integration Test', () => {
  let env: TestEnv;
  let consumer: MessageConsumer;
  let queue: MessageQueue;

  before(async () => {
    env = createTestEnv('tx-v4-write-messaging');
    queue = new MessageQueue(env.dbPath);
    consumer = new MessageConsumer(env.msgsDir, queue);
    await consumer.start();
  });

  after(async () => {
    if (consumer) await consumer.stop();
    if (queue) queue.close();
    env.cleanup();
  });

  it('agent writes message file, recipient receives via queue', async () => {
    const recipient = 'dev/worker';
    const sender = 'core/orchestrator';

    // Step 1: Agent writes a message file (simulating Write tool)
    const msgId = 'write-test-001';
    createTestMessage(env.msgsDir, '1209040000-task-core--dev-write-test.md', {
      to: recipient,
      from: sender,
      type: 'task',
      status: 'start',
      msgId,
      headline: 'Write Messaging Test',
      body: '# Task\n\nThis message was written by an agent.',
      rearmatter: {
        grade: 'A',
        confidence: 0.95,
        speculation: '{}',
        gaps: '{}'
      }
    });

    // Step 2: Wait for consumer to process file
    await sleep(500);

    // Step 3: Recipient polls queue
    const messages = queue.poll(recipient);

    // Step 4: Verify message received correctly
    assert.ok(messages.length >= 1, `Expected at least 1 message, got ${messages.length}`);

    const msg = messages.find(m => m.payload?.['msg-id'] === msgId);
    assert.ok(msg, 'Should find the message by msgId');

    // Verify routing
    assert.strictEqual(msg.from_agent, sender, 'from_agent should match sender');
    assert.strictEqual(msg.to_agent, recipient, 'to_agent should match recipient');
    assert.strictEqual(msg.type, 'task', 'type should be task');

    // Verify payload contains body
    const body = msg.payload.body as string;
    assert.ok(body, 'Payload should contain body');
    assert.ok(body.includes('written by an agent'), 'Body content should be preserved');

    // Verify rearmatter is included
    assert.ok(msg.payload.rearmatter, 'Payload should contain rearmatter');
    const rearmatter = msg.payload.rearmatter as any;
    assert.strictEqual(rearmatter.grade, 'A', 'Rearmatter grade should be A');
    assert.strictEqual(rearmatter.confidence, 0.95, 'Rearmatter confidence should be 0.95');
  });

  it('message includes filepath in payload for traceability', async () => {
    const recipient = 'debug/agent';

    createTestMessage(env.msgsDir, '1209040100-update-core--debug-trace.md', {
      to: recipient,
      from: 'core/core',
      type: 'update',
      msgId: 'trace-test',
      body: 'Traceability test message.'
    });

    await sleep(500);

    const messages = queue.poll(recipient);
    const msg = messages.find(m => m.payload?.['msg-id'] === 'trace-test');

    assert.ok(msg, 'Should find the trace test message');
    assert.ok(msg.payload.filepath, 'Payload should include filepath');
    assert.ok(msg.payload.filepath.includes('trace.md'), 'Filepath should reference the message file');
  });

  it('consumer handles rapid sequential writes', async () => {
    const recipient = 'batch/processor';
    const messageCount = 5;

    // Rapidly write multiple messages
    for (let i = 0; i < messageCount; i++) {
      createTestMessage(env.msgsDir, `1209040200-task-core--batch-rapid${i}.md`, {
        to: recipient,
        from: 'core/core',
        type: 'task',
        msgId: `rapid-${i}`,
        body: `Rapid message ${i}`
      });
    }

    // Wait for all to process
    await sleep(800);

    const messages = queue.poll(recipient);
    assert.ok(
      messages.length >= messageCount,
      `Expected at least ${messageCount} messages, got ${messages.length}`
    );

    // Verify all rapid messages arrived
    for (let i = 0; i < messageCount; i++) {
      const found = messages.find(m => m.payload?.['msg-id'] === `rapid-${i}`);
      assert.ok(found, `Should find rapid message ${i}`);
    }
  });

  it('recipient receives messages only addressed to them', async () => {
    const recipientA = 'alpha/agent';
    const recipientB = 'beta/agent';

    // Write messages to different recipients
    createTestMessage(env.msgsDir, '1209040300-task-core--alpha-exclusive.md', {
      to: recipientA,
      from: 'core/core',
      type: 'task',
      msgId: 'alpha-only',
      body: 'For alpha only.'
    });

    createTestMessage(env.msgsDir, '1209040301-task-core--beta-exclusive.md', {
      to: recipientB,
      from: 'core/core',
      type: 'task',
      msgId: 'beta-only',
      body: 'For beta only.'
    });

    await sleep(500);

    // Alpha polls
    const alphaMessages = queue.poll(recipientA);
    assert.ok(
      alphaMessages.every(m => m.to_agent === recipientA),
      'Alpha should only receive messages addressed to alpha'
    );
    assert.ok(
      alphaMessages.some(m => m.payload?.['msg-id'] === 'alpha-only'),
      'Alpha should receive alpha-only message'
    );

    // Beta polls
    const betaMessages = queue.poll(recipientB);
    assert.ok(
      betaMessages.every(m => m.to_agent === recipientB),
      'Beta should only receive messages addressed to beta'
    );
    assert.ok(
      betaMessages.some(m => m.payload?.['msg-id'] === 'beta-only'),
      'Beta should receive beta-only message'
    );
  });

  it('message is marked delivered after poll', async () => {
    const recipient = 'once/reader';

    createTestMessage(env.msgsDir, '1209040400-task-core--once-delivery.md', {
      to: recipient,
      from: 'core/core',
      type: 'task',
      msgId: 'deliver-once',
      body: 'Should only be delivered once.'
    });

    await sleep(500);

    // First poll receives the message
    const firstPoll = queue.poll(recipient);
    const msg = firstPoll.find(m => m.payload?.['msg-id'] === 'deliver-once');
    assert.ok(msg, 'First poll should receive the message');

    // Second poll should not get the same message
    const secondPoll = queue.poll(recipient);
    const duplicate = secondPoll.find(m => m.payload?.['msg-id'] === 'deliver-once');
    assert.strictEqual(duplicate, undefined, 'Second poll should not re-deliver the message');
  });
});
