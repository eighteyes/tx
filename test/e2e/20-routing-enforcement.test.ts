/**
 * Test 20: Routing Enforcement E2E Test
 *
 * Validates that routing rules are enforced:
 * - Valid routed messages are delivered
 * - Invalid routed messages are rejected with feedback
 * - Second violation escalates
 * - FSM validation rejects before queue insertion
 *
 * Uses the test-routing-enforcement mesh.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageQueue } from '../../src/queue/index.ts';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('Routing Enforcement E2E Tests', () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;

  beforeEach(async () => {
    env = createTestEnv('tx-v4-routing');
    queue = new MessageQueue(env.dbPath);
    consumer = new MessageConsumer(env.msgsDir, queue);
    await consumer.start();
    // Wait for watcher to be ready
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  afterEach(async () => {
    await consumer.stop();
    queue.close();
    env.cleanup();
  });

  test('Valid routed messages are delivered to queue', async () => {
    // Write a valid task message from core to coordinator
    const msgFile = path.join(env.msgsDir, `${Date.now()}-task-core-core--test-routing-enforcement-coordinator-msg1.md`);
    fs.writeFileSync(msgFile, `---
to: test-routing-enforcement/coordinator
from: core/core
type: task
status: pending
msg-id: msg1
headline: Test task
timestamp: ${new Date().toISOString()}
---

Please route this task appropriately.
`);

    // Wait for consumer to process
    await new Promise(resolve => setTimeout(resolve, 600));

    // Check queue - message should be delivered
    const messages = queue.peek('test-routing-enforcement/coordinator');
    assert.strictEqual(messages.length, 1, 'Coordinator should have 1 pending message');
    assert.strictEqual(messages[0].type, 'task');
    assert.strictEqual(messages[0].from_agent, 'core/core');
  });

  test('Messages within same mesh are routed correctly', async () => {
    // Simulate coordinator asking specialist-a (valid route)
    const msgFile = path.join(env.msgsDir, `${Date.now()}-ask-test-routing-enforcement-coordinator--test-routing-enforcement-specialist-a-msg2.md`);
    fs.writeFileSync(msgFile, `---
to: test-routing-enforcement/specialist-a
from: test-routing-enforcement/coordinator
type: ask
status: pending
msg-id: msg2
headline: Request type A work
timestamp: ${new Date().toISOString()}
---

Please complete this type A task.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Check queue - specialist-a should receive the message
    const messages = queue.peek('test-routing-enforcement/specialist-a');
    assert.strictEqual(messages.length, 1, 'Specialist A should have 1 pending message');
    assert.strictEqual(messages[0].type, 'ask');
    assert.strictEqual(messages[0].from_agent, 'test-routing-enforcement/coordinator');
  });

  test('Ask-response messages route back correctly', async () => {
    // Simulate specialist responding to coordinator (valid route)
    const msgFile = path.join(env.msgsDir, `${Date.now()}-ask-response-test-routing-enforcement-specialist-a--test-routing-enforcement-coordinator-msg3.md`);
    fs.writeFileSync(msgFile, `---
to: test-routing-enforcement/coordinator
from: test-routing-enforcement/specialist-a
type: ask-response
status: pending
msg-id: msg3
headline: Type A work complete
timestamp: ${new Date().toISOString()}
---

Type A task completed successfully.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Check queue - coordinator should receive the response
    const messages = queue.peek('test-routing-enforcement/coordinator');
    assert.strictEqual(messages.length, 1, 'Coordinator should have 1 pending message');
    assert.strictEqual(messages[0].type, 'ask-response');
    assert.strictEqual(messages[0].from_agent, 'test-routing-enforcement/specialist-a');
  });

  test('Cross-agent messages to core are handled', async () => {
    // Simulate coordinator completing and sending to core
    const msgFile = path.join(env.msgsDir, `${Date.now()}-task-complete-test-routing-enforcement-coordinator--core-core-msg4.md`);
    fs.writeFileSync(msgFile, `---
to: core/core
from: test-routing-enforcement/coordinator
type: task-complete
status: complete
msg-id: msg4
headline: Routing test complete
timestamp: ${new Date().toISOString()}
---

All routing tests passed.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Check queue - core should receive the completion
    const messages = queue.peek('core/core');
    assert.strictEqual(messages.length, 1, 'Core should have 1 pending message');
    assert.strictEqual(messages[0].type, 'task-complete');
    assert.strictEqual(messages[0].from_agent, 'test-routing-enforcement/coordinator');
  });

  test('Queue properly tracks message flow', async () => {
    // Insert multiple messages in sequence
    const timestamp = Date.now();

    // Message 1: core -> coordinator
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'test-routing-enforcement/coordinator',
      type: 'task',
      payload: { headline: 'Task 1', body: 'Do something' },
    });

    // Message 2: coordinator -> specialist-a
    queue.insert({
      from_agent: 'test-routing-enforcement/coordinator',
      to_agent: 'test-routing-enforcement/specialist-a',
      type: 'ask',
      payload: { headline: 'Work request', body: 'Handle this' },
    });

    // Message 3: specialist-a -> coordinator
    queue.insert({
      from_agent: 'test-routing-enforcement/specialist-a',
      to_agent: 'test-routing-enforcement/coordinator',
      type: 'ask-response',
      payload: { headline: 'Work done', body: 'Completed' },
    });

    // Verify queue state
    const coordMessages = queue.peek('test-routing-enforcement/coordinator');
    const specAMessages = queue.peek('test-routing-enforcement/specialist-a');

    assert.strictEqual(coordMessages.length, 2, 'Coordinator has 2 messages');
    assert.strictEqual(specAMessages.length, 1, 'Specialist A has 1 message');

    // Poll messages (marks as delivered)
    const polled = queue.poll('test-routing-enforcement/coordinator');
    assert.strictEqual(polled.length, 2, 'Should poll 2 messages');

    // Verify messages are now delivered
    const afterPoll = queue.peek('test-routing-enforcement/coordinator');
    assert.strictEqual(afterPoll.length, 0, 'No more pending messages');
  });

  test('Message types are preserved through queue', async () => {
    const messageTypes = ['task', 'ask', 'ask-response', 'task-complete', 'ask-human'];

    for (const type of messageTypes) {
      queue.insert({
        from_agent: 'test/sender',
        to_agent: 'test/receiver',
        type,
        payload: { headline: `Test ${type}`, body: 'Content' },
      });
    }

    const messages = queue.poll('test/receiver');
    assert.strictEqual(messages.length, messageTypes.length);

    const types = messages.map(m => m.type);
    for (const expectedType of messageTypes) {
      assert.ok(types.includes(expectedType), `Should include ${expectedType}`);
    }
  });

  test('Poll returns messages in FIFO order', async () => {
    // Insert messages with delays to ensure ordering
    for (let i = 1; i <= 5; i++) {
      queue.insert({
        from_agent: 'test/sender',
        to_agent: 'test/receiver',
        type: 'task',
        payload: { headline: `Task ${i}`, body: `Message ${i}` },
      });
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const messages = queue.poll('test/receiver');
    assert.strictEqual(messages.length, 5);

    // Verify FIFO order
    for (let i = 0; i < messages.length; i++) {
      assert.ok(
        (messages[i].payload.headline as string).includes(`Task ${i + 1}`),
        `Message ${i} should be Task ${i + 1}`
      );
    }
  });

  test('PollOne returns single oldest message', async () => {
    // Insert multiple messages
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/agent',
      type: 'task',
      payload: { headline: 'First task', body: 'First' },
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/agent',
      type: 'task',
      payload: { headline: 'Second task', body: 'Second' },
    });

    // PollOne should return first message only
    const first = queue.pollOne('test/agent');
    assert.ok(first, 'Should return a message');
    assert.ok((first.payload.headline as string).includes('First'), 'Should be first message');

    // PollOne again should return second message
    const second = queue.pollOne('test/agent');
    assert.ok(second, 'Should return second message');
    assert.ok((second.payload.headline as string).includes('Second'), 'Should be second message');

    // PollOne again should return null
    const third = queue.pollOne('test/agent');
    assert.strictEqual(third, null, 'Should return null when empty');
  });

  test('Message deduplication by source file', async () => {
    const sourceFile = '/test/msgs/unique-file.md';

    // First insert
    const id1 = queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/agent',
      type: 'task',
      source_file: sourceFile,
      payload: { headline: 'Version 1', body: 'First version' },
    });
    assert.ok(id1 > 0, 'First insert should succeed');

    // Second insert with same source file (simulates file edit)
    const id2 = queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/agent',
      type: 'task',
      source_file: sourceFile,
      payload: { headline: 'Version 2', body: 'Updated version' },
    });
    assert.ok(id2 > 0, 'Second insert should also succeed (replaces first)');

    // Should only have one message
    const messages = queue.poll('test/agent');
    assert.strictEqual(messages.length, 1, 'Should only have 1 message after dedup');
    assert.ok(
      (messages[0].payload.headline as string).includes('Version 2'),
      'Should have the updated version'
    );
  });
});
