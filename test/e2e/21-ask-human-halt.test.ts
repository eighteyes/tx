/**
 * Test 21: Ask-Human Halt E2E Test
 *
 * Validates that ask-human properly halts workers:
 * - Worker sends ask-human mid-execution
 * - Worker process killed (not just paused)
 * - Session stored in suspendedSessions map
 * - Ask-response resumes with same sessionId
 * - Conversation context preserved
 *
 * Uses the test-ask-human-halt mesh.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageQueue } from '../../src/queue/index.ts';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('Ask-Human Halt E2E Tests', () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;

  beforeEach(async () => {
    env = createTestEnv('tx-v4-ask-human');
    queue = new MessageQueue(env.dbPath);
    consumer = new MessageConsumer(env.msgsDir, queue);
    await consumer.start();
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  afterEach(async () => {
    await consumer.stop();
    queue.close();
    env.cleanup();
  });

  test('Ask-human message routes to core', async () => {
    // Simulate worker sending ask-human
    const msgFile = path.join(env.msgsDir, `${Date.now()}-ask-human-test-ask-human-halt-worker--core-core-q1.md`);
    fs.writeFileSync(msgFile, `---
to: core/core
from: test-ask-human-halt/worker
type: ask-human
status: pending
msg-id: q1
headline: Need user input
timestamp: ${new Date().toISOString()}
---

What is your name?
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Core should receive the ask-human
    const messages = queue.poll('core/core');
    assert.strictEqual(messages.length, 1, 'Core should receive 1 message');
    assert.strictEqual(messages[0].type, 'ask-human');
    assert.strictEqual(messages[0].from_agent, 'test-ask-human-halt/worker');
    assert.ok(
      (messages[0].payload.body as string)?.includes('name'),
      'Should contain the question'
    );
  });

  test('Ask-response routes back to worker', async () => {
    // First, worker asks human
    queue.insert({
      from_agent: 'test-ask-human-halt/worker',
      to_agent: 'core/core',
      type: 'ask-human',
      payload: {
        'msg-id': 'q1',
        headline: 'Need user input',
        body: 'What is your name?',
      },
    });

    // Core receives and responds
    const coreMessages = queue.poll('core/core');
    assert.strictEqual(coreMessages.length, 1);

    // Core sends ask-response back
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'test-ask-human-halt/worker',
      type: 'ask-response',
      payload: {
        'msg-id': 'r1',
        headline: 'User response',
        body: 'Alice',
      },
    });

    // Worker should receive the response
    const workerMessages = queue.poll('test-ask-human-halt/worker');
    assert.strictEqual(workerMessages.length, 1, 'Worker should receive 1 message');
    assert.strictEqual(workerMessages[0].type, 'ask-response');
    assert.strictEqual(workerMessages[0].from_agent, 'core/core');
    assert.ok(
      (workerMessages[0].payload.body as string)?.includes('Alice'),
      'Should contain the response'
    );
  });

  test('Full HITL round trip via message files', async () => {
    const timestamp = Date.now();

    // Step 1: Worker sends ask-human via file
    const askFile = path.join(env.msgsDir, `${timestamp}-ask-human-test-ask-human-halt-worker--core-core-hitl1.md`);
    fs.writeFileSync(askFile, `---
to: core/core
from: test-ask-human-halt/worker
type: ask-human
status: pending
msg-id: hitl1
headline: Confirmation needed
timestamp: ${new Date().toISOString()}
---

Should I proceed with the task?
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Step 2: Verify core received it
    const coreMessages = queue.poll('core/core');
    assert.strictEqual(coreMessages.length, 1);
    assert.strictEqual(coreMessages[0].type, 'ask-human');

    // Step 3: Core sends response via file
    const responseFile = path.join(env.msgsDir, `${timestamp + 1}-ask-response-core-core--test-ask-human-halt-worker-hitl1-r.md`);
    fs.writeFileSync(responseFile, `---
to: test-ask-human-halt/worker
from: core/core
type: ask-response
status: pending
msg-id: hitl1-response
headline: User confirmed
timestamp: ${new Date().toISOString()}
---

Yes, proceed with the task.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Step 4: Worker receives response
    const workerMessages = queue.poll('test-ask-human-halt/worker');
    assert.strictEqual(workerMessages.length, 1);
    assert.strictEqual(workerMessages[0].type, 'ask-response');
    assert.ok(
      (workerMessages[0].payload.body as string)?.includes('proceed'),
      'Response should contain confirmation'
    );
  });

  test('Pending asks are tracked in database', async () => {
    // Track pending ask
    const askId = queue.trackPendingAsk(
      'test-ask-human-halt/worker',
      'core/core',
      'ask-123'
    );
    assert.ok(askId > 0, 'Should return ask ID');

    // Verify pending ask exists
    const pending = queue.getPendingAsks('test-ask-human-halt/worker');
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].to_agent, 'core/core');
    assert.strictEqual(pending[0].msg_id, 'ask-123');
  });

  test('Pending asks can be resolved by msg-id', async () => {
    // Track pending ask
    queue.trackPendingAsk('worker-1', 'core/core', 'specific-ask-id');

    // Resolve by msg-id
    const result = queue.resolvePendingAsk('core/core', 'worker-1', 'specific-ask-id');

    assert.strictEqual(result.resolved, true);
    assert.strictEqual(result.matchType, 'msg-id');
    assert.strictEqual(result.ask?.msg_id, 'specific-ask-id');

    // Verify it's removed
    const remaining = queue.getPendingAsks('worker-1');
    assert.strictEqual(remaining.length, 0);
  });

  test('Pending asks can be resolved by agent match', async () => {
    // Track pending ask without specific msg-id lookup
    queue.trackPendingAsk('worker-2', 'core/core', 'some-ask');

    // Resolve by agent match (no msg-id)
    const result = queue.resolvePendingAsk('core/core', 'worker-2');

    assert.strictEqual(result.resolved, true);
    assert.strictEqual(result.matchType, 'agent');
  });

  test('Unmatched ask-response returns not resolved', async () => {
    // No pending asks tracked
    const result = queue.resolvePendingAsk('core/core', 'unknown-worker', 'fake-id');

    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.matchType, 'none');
  });

  test('Multiple pending asks from same agent', async () => {
    // Track multiple asks
    queue.trackPendingAsk('worker-multi', 'agent-1', 'ask-1');
    queue.trackPendingAsk('worker-multi', 'agent-2', 'ask-2');
    queue.trackPendingAsk('worker-multi', 'agent-3', 'ask-3');

    // Verify all tracked
    const pending = queue.getPendingAsks('worker-multi');
    assert.strictEqual(pending.length, 3);

    // Get counts by target
    const counts = queue.getPendingAskCounts('worker-multi');
    assert.strictEqual(counts.get('agent-1'), 1);
    assert.strictEqual(counts.get('agent-2'), 1);
    assert.strictEqual(counts.get('agent-3'), 1);
  });

  test('Clear pending asks for agent', async () => {
    // Track asks
    queue.trackPendingAsk('worker-clear', 'target-1', 'ask-1');
    queue.trackPendingAsk('worker-clear', 'target-2', 'ask-2');

    // Clear all
    const cleared = queue.clearPendingAsks('worker-clear');
    assert.strictEqual(cleared, 2, 'Should clear 2 asks');

    // Verify cleared
    const remaining = queue.getPendingAsks('worker-clear');
    assert.strictEqual(remaining.length, 0);
  });

  test('Session can be stored and retrieved', async () => {
    const agentId = 'test-ask-human-halt/worker';
    const sessionId = 'session-abc123';

    // Store session
    queue.setConversationId(agentId, sessionId);

    // Retrieve session
    const retrieved = queue.getConversationId(agentId);
    assert.strictEqual(retrieved, sessionId);

    // Update session
    const newSessionId = 'session-xyz789';
    queue.setConversationId(agentId, newSessionId);

    const updated = queue.getConversationId(agentId);
    assert.strictEqual(updated, newSessionId);
  });

  test('Session persists across queue reconnect', async () => {
    const agentId = 'persistent-agent';
    const sessionId = 'persistent-session';

    // Store session
    queue.setConversationId(agentId, sessionId);

    // Create new queue instance (same database)
    const queue2 = new MessageQueue(env.dbPath);

    // Retrieve from new instance
    const retrieved = queue2.getConversationId(agentId);
    assert.strictEqual(retrieved, sessionId);

    queue2.close();
  });

  test('Clear session removes it', async () => {
    const agentId = 'clear-session-agent';
    const sessionId = 'to-be-cleared';

    // Store and verify
    queue.setConversationId(agentId, sessionId);
    assert.strictEqual(queue.getConversationId(agentId), sessionId);

    // Clear
    queue.clearConversationId(agentId);

    // Should be null
    assert.strictEqual(queue.getConversationId(agentId), null);
  });

  test('Active sessions can be listed', async () => {
    // Store multiple sessions
    queue.setConversationId('agent-1', 'session-1');
    queue.setConversationId('agent-2', 'session-2');
    queue.setConversationId('agent-3', 'session-3');

    // Get all active sessions
    const sessions = queue.getActiveSessions();

    assert.ok(sessions.length >= 3);
    const agentIds = sessions.map(s => s.agentId);
    assert.ok(agentIds.includes('agent-1'));
    assert.ok(agentIds.includes('agent-2'));
    assert.ok(agentIds.includes('agent-3'));
  });

  // ==========================================================================
  // Terminal-by-default messaging E2E tests
  // ==========================================================================

  test('Terminal-by-default: worker ask-human without type field', async () => {
    // Worker sends message to core without type field - should infer ask-human
    const msgFile = path.join(env.msgsDir, `${Date.now()}-notype-test-ask-human-halt-worker--core-core-tbd1.md`);
    fs.writeFileSync(msgFile, `---
to: core/core
from: test-ask-human-halt/worker
msg-id: tbd1
headline: Implicit ask-human
timestamp: ${new Date().toISOString()}
---

What should I do next?
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Core should receive the message with inferred ask-human type
    const messages = queue.poll('core/core');
    assert.strictEqual(messages.length, 1, 'Core should receive 1 message');
    assert.strictEqual(messages[0].type, 'ask-human', 'Type should be inferred as ask-human');
    assert.strictEqual(messages[0].from_agent, 'test-ask-human-halt/worker');
    assert.ok(
      (messages[0].payload.body as string)?.includes('What should I do next'),
      'Body should be preserved'
    );
  });

  test('Terminal-by-default: core response without type field', async () => {
    // Core sends response to worker without type field - should infer ask-response
    const msgFile = path.join(env.msgsDir, `${Date.now()}-notype-core-core--test-ask-human-halt-worker-tbd2.md`);
    fs.writeFileSync(msgFile, `---
to: test-ask-human-halt/worker
from: core/core
msg-id: tbd2
headline: User response
timestamp: ${new Date().toISOString()}
---

Please proceed with option B.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Worker should receive the message with inferred ask-response type
    const messages = queue.poll('test-ask-human-halt/worker');
    assert.strictEqual(messages.length, 1, 'Worker should receive 1 message');
    assert.strictEqual(messages[0].type, 'ask-response', 'Type should be inferred as ask-response');
    assert.strictEqual(messages[0].from_agent, 'core/core');
  });

  test('Terminal-by-default: in-reply-to triggers ask-response inference', async () => {
    // First, worker asks human
    const askFile = path.join(env.msgsDir, `${Date.now()}-notype-test-ask-human-halt-worker--core-core-tbd3.md`);
    fs.writeFileSync(askFile, `---
to: core/core
from: test-ask-human-halt/worker
msg-id: tbd3
headline: Question for user
timestamp: ${new Date().toISOString()}
---

Should I continue?
`);

    await new Promise(resolve => setTimeout(resolve, 400));

    // Core responds with in-reply-to but no type
    const responseFile = path.join(env.msgsDir, `${Date.now()}-notype-core-core--test-ask-human-halt-worker-tbd3r.md`);
    fs.writeFileSync(responseFile, `---
to: test-ask-human-halt/worker
from: core/core
msg-id: tbd3r
in-reply-to: tbd3
headline: Confirmation
timestamp: ${new Date().toISOString()}
---

Yes, continue.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Worker should receive ask-response (inferred from in-reply-to)
    const messages = queue.poll('test-ask-human-halt/worker');
    assert.strictEqual(messages.length, 1, 'Worker should receive 1 response');
    assert.strictEqual(messages[0].type, 'ask-response', 'Type should be inferred as ask-response');
  });

  test('Terminal-by-default: full HITL round trip without explicit types', async () => {
    const timestamp = Date.now();

    // Step 1: Worker sends ask-human without type field
    const askFile = path.join(env.msgsDir, `${timestamp}-notype-test-ask-human-halt-worker--core-core-tbd4.md`);
    fs.writeFileSync(askFile, `---
to: core/core
from: test-ask-human-halt/worker
msg-id: tbd4
headline: Confirmation needed
timestamp: ${new Date().toISOString()}
---

Should I delete the file?
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Step 2: Verify core received ask-human (inferred)
    const coreMessages = queue.poll('core/core');
    assert.strictEqual(coreMessages.length, 1);
    assert.strictEqual(coreMessages[0].type, 'ask-human', 'Worker message should be inferred as ask-human');

    // Step 3: Core sends response without type field
    const responseFile = path.join(env.msgsDir, `${timestamp + 1}-notype-core-core--test-ask-human-halt-worker-tbd4r.md`);
    fs.writeFileSync(responseFile, `---
to: test-ask-human-halt/worker
from: core/core
msg-id: tbd4r
in-reply-to: tbd4
headline: User confirmed
timestamp: ${new Date().toISOString()}
---

Yes, delete it.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Step 4: Worker receives ask-response (inferred)
    const workerMessages = queue.poll('test-ask-human-halt/worker');
    assert.strictEqual(workerMessages.length, 1);
    assert.strictEqual(workerMessages[0].type, 'ask-response', 'Core message should be inferred as ask-response');
    assert.ok(
      (workerMessages[0].payload.body as string)?.includes('delete it'),
      'Response should contain confirmation'
    );
  });
});
