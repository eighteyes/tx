/**
 * Consumer Type Inference Tests - Phase 7: Terminal-by-default messaging
 *
 * Tests the inferMessageType function that infers message types
 * from routing and boundary context when type field is omitted.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { MessageQueue } from '../../src/queue/index.ts';
import { createTestEnv, createTestMessage, sleep, type TestEnv } from '../helpers/test-env.ts';

describe('Consumer Type Inference (Phase 7)', () => {
  let env: TestEnv;
  let consumer: MessageConsumer;
  let queue: MessageQueue;

  before(async () => {
    env = createTestEnv('tx-type-inference');

    // Create a test mesh config with boundary_agents
    const meshDir = path.join(env.meshesDir, 'test-mesh');
    fs.mkdirSync(meshDir, { recursive: true });
    fs.writeFileSync(
      path.join(meshDir, 'config.yaml'),
      `mesh: test-mesh
entry_point: worker
boundary_agents:
  - coordinator
agents:
  - name: worker
  - name: coordinator
`
    );

    queue = new MessageQueue(env.dbPath);
    consumer = new MessageConsumer(env.msgsDir, queue, env.meshesDir);
    await consumer.start();
  });

  after(async () => {
    if (consumer) await consumer.stop();
    if (queue) queue.close();
    env.cleanup();
  });

  describe('inferMessageType() logic', () => {
    it('should infer ask-response when in-reply-to is present', async () => {
      // Message with in-reply-to should become ask-response
      createTestMessage(env.msgsDir, `${Date.now()}-infer-reply-test.md`, {
        to: 'test-mesh/worker',
        from: 'test-mesh/coordinator',
        'in-reply-to': 'original-ask-123',
        msgId: 'reply-test-1',
        body: 'This is a response to an earlier ask',
      });

      await sleep(400);

      const messages = queue.poll('test-mesh/worker');
      const msg = messages.find((m) => m.payload?.['msg-id'] === 'reply-test-1');

      assert.ok(msg, 'Message should be queued');
      assert.strictEqual(msg.type, 'ask-response', 'Should infer ask-response from in-reply-to');
    });

    it('should infer ask-human when message to core/core from non-core agent', async () => {
      // Message to core/core without status:complete → ask-human
      createTestMessage(env.msgsDir, `${Date.now()}-infer-human-test.md`, {
        to: 'core/core',
        from: 'test-mesh/worker',
        msgId: 'human-test-1',
        body: 'I need help from the human',
      });

      await sleep(400);

      // Core messages emit different event, check via poll
      const messages = queue.poll('core/core');
      const msg = messages.find((m) => m.payload?.['msg-id'] === 'human-test-1');

      assert.ok(msg, 'Message should be queued');
      assert.strictEqual(msg.type, 'ask-human', 'Should infer ask-human for non-boundary agent to core');
    });

    it('should infer task-complete when boundary agent sends status:complete to core/core', async () => {
      // Boundary agent with status:complete → task-complete
      createTestMessage(env.msgsDir, `${Date.now()}-infer-complete-test.md`, {
        to: 'core/core',
        from: 'test-mesh/coordinator', // coordinator is a boundary_agent
        status: 'complete',
        msgId: 'complete-test-1',
        body: 'Task completed successfully',
      });

      await sleep(400);

      const messages = queue.poll('core/core');
      const msg = messages.find((m) => m.payload?.['msg-id'] === 'complete-test-1');

      assert.ok(msg, 'Message should be queued');
      assert.strictEqual(msg.type, 'task-complete', 'Should infer task-complete for boundary agent with status:complete');
    });

    it('should infer ask-response when core/core sends to agent', async () => {
      // core/core → agent = ask-response (human responding)
      createTestMessage(env.msgsDir, `${Date.now()}-infer-core-response-test.md`, {
        to: 'test-mesh/worker',
        from: 'core/core',
        msgId: 'core-response-1',
        body: 'Human response to agent question',
      });

      await sleep(400);

      const messages = queue.poll('test-mesh/worker');
      const msg = messages.find((m) => m.payload?.['msg-id'] === 'core-response-1');

      assert.ok(msg, 'Message should be queued');
      assert.strictEqual(msg.type, 'ask-response', 'Should infer ask-response from core/core');
    });

    it('should infer ask for agent-to-agent messages', async () => {
      // Agent-to-agent within mesh → ask
      createTestMessage(env.msgsDir, `${Date.now()}-infer-ask-test.md`, {
        to: 'test-mesh/coordinator',
        from: 'test-mesh/worker',
        msgId: 'ask-test-1',
        body: 'Can you help me with this?',
      });

      await sleep(400);

      const messages = queue.poll('test-mesh/coordinator');
      const msg = messages.find((m) => m.payload?.['msg-id'] === 'ask-test-1');

      assert.ok(msg, 'Message should be queued');
      assert.strictEqual(msg.type, 'ask', 'Should infer ask for agent-to-agent');
    });
  });

  describe('parseMessage() without type field', () => {
    it('should accept messages without type field', async () => {
      // Create message without type - should not be rejected
      const timestamp = Date.now();
      const filepath = path.join(env.msgsDir, `${timestamp}-no-type-test.md`);

      fs.writeFileSync(
        filepath,
        `---
to: test-mesh/worker
from: test-mesh/coordinator
msg-id: no-type-1
---

Message body without explicit type field.
`
      );

      await sleep(400);

      const messages = queue.poll('test-mesh/worker');
      const msg = messages.find((m) => m.payload?.['msg-id'] === 'no-type-1');

      assert.ok(msg, 'Message without type should be accepted and queued');
      assert.ok(msg.type, 'Type should be inferred');
    });

    it('should still reject messages without to field', async () => {
      // Message without 'to' should be rejected
      const timestamp = Date.now();
      const filepath = path.join(env.msgsDir, `${timestamp}-no-to-test.md`);

      fs.writeFileSync(
        filepath,
        `---
from: test-mesh/worker
type: ask
msg-id: no-to-1
---

Message without to field.
`
      );

      await sleep(400);

      // This message should not appear in any queue
      const allMessages = queue.poll('test-mesh/worker');
      const msg = allMessages.find((m) => m.payload?.['msg-id'] === 'no-to-1');

      assert.ok(!msg, 'Message without "to" field should be rejected');
    });

    it('should still reject messages without from field', async () => {
      // Message without 'from' should be rejected
      const timestamp = Date.now();
      const filepath = path.join(env.msgsDir, `${timestamp}-no-from-test.md`);

      fs.writeFileSync(
        filepath,
        `---
to: test-mesh/worker
type: ask
msg-id: no-from-1
---

Message without from field.
`
      );

      await sleep(400);

      const messages = queue.poll('test-mesh/worker');
      const msg = messages.find((m) => m.payload?.['msg-id'] === 'no-from-1');

      assert.ok(!msg, 'Message without "from" field should be rejected');
    });
  });

  describe('explicit type field (backward compatibility)', () => {
    it('should use explicit type when provided', async () => {
      // Message with explicit type - should use it (with deprecation warning in logs)
      createTestMessage(env.msgsDir, `${Date.now()}-explicit-type-test.md`, {
        to: 'test-mesh/worker',
        from: 'test-mesh/coordinator',
        type: 'task', // Explicitly set type
        msgId: 'explicit-type-1',
        body: 'Message with explicit type',
      });

      await sleep(400);

      const messages = queue.poll('test-mesh/worker');
      const msg = messages.find((m) => m.payload?.['msg-id'] === 'explicit-type-1');

      assert.ok(msg, 'Message should be queued');
      assert.strictEqual(msg.type, 'task', 'Should use explicit type when provided');
    });
  });
});
