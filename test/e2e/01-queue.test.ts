/**
 * V4 Queue Test - Test 1
 *
 * Verifies that SQLite message queue works correctly.
 * Tests insert, poll, and message delivery marking.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { MessageQueue, Message } from '../../src/queue/index.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('V4 Queue Test', () => {
  let env: TestEnv;
  let queue: MessageQueue;

  before(async () => {
    // Create isolated test environment
    env = createTestEnv('tx-v4-queue');
    queue = new MessageQueue(env.dbPath);
  });

  after(async () => {
    if (queue) queue.close();
    env.cleanup();
  });

  it('should create queue database with schema', () => {
    // Database should exist after initialization
    assert.strictEqual(fs.existsSync(env.dbPath), true, 'Database file should exist');

    // Schema should have messages table
    const tables = queue.listTables();
    assert.ok(tables.includes('messages'), 'Should have messages table');
  });

  it('should insert a message', () => {
    const msg: Message = {
      from_agent: 'core/core',
      to_agent: 'mesh/worker',
      payload: { action: 'do-something', data: { foo: 'bar' } }
    };

    const id = queue.insert(msg);

    assert.ok(typeof id === 'number', 'Insert should return message ID');
    assert.ok(id > 0, 'Message ID should be positive');
  });

  it('should poll messages for recipient', () => {
    // Insert a message first
    const msg: Message = {
      from_agent: 'core/core',
      to_agent: 'mesh/poller',
      payload: { action: 'poll-test' }
    };
    queue.insert(msg);

    // Poll for messages
    const messages = queue.poll('mesh/poller');

    assert.ok(Array.isArray(messages), 'Poll should return array');
    assert.ok(messages.length >= 1, 'Should have at least one message');
    assert.strictEqual(messages[0].to_agent, 'mesh/poller');
    assert.strictEqual(messages[0].to_agent, 'mesh/poller');
  });

  it('should mark message as delivered after poll', () => {
    // Insert a message
    const msg: Message = {
      from_agent: 'sender/agent',
      to_agent: 'receiver/agent',
      payload: { info: 'delivery-test' }
    };
    const id = queue.insert(msg);

    // Poll to get it (should mark as delivered)
    const polled = queue.poll('receiver/agent');
    assert.ok(polled.length >= 1, 'Should get the message');

    // Try to poll again - should not get the same message
    const secondPoll = queue.poll('receiver/agent');
    const duplicates = secondPoll.filter(m => m.id === id);
    assert.strictEqual(duplicates.length, 0, 'Should not re-deliver same message');
  });

  it('should filter messages by recipient', () => {
    // Insert messages for different recipients
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'agent-a/worker',
      payload: { target: 'a' }
    });

    queue.insert({
      from_agent: 'core/core',
      to_agent: 'agent-b/worker',
      payload: { target: 'b' }
    });

    // Poll for agent-a only
    const messagesA = queue.poll('agent-a/worker');

    // All returned messages should be for agent-a
    for (const msg of messagesA) {
      assert.strictEqual(msg.to_agent, 'agent-a/worker', 'Should only get messages for agent-a');
    }
  });
});
