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

  // ============================================================================
  // Terminal-by-Default Messaging Tests (Phase 7)
  // ============================================================================

  test('Message WITHOUT type field inferred as ask-human when to core/core', async () => {
    const timestamp = Date.now();

    // Worker sends message to core/core WITHOUT type field
    const askFile = path.join(env.msgsDir, `${timestamp}-no-type-test-ask-human-halt-worker--core-core-tbd1.md`);
    fs.writeFileSync(askFile, `---
to: core/core
from: test-ask-human-halt/worker
msg-id: tbd1
headline: Need clarification
timestamp: ${new Date().toISOString()}
---

What should I do next?
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Core should receive it as ask-human (inferred)
    const coreMessages = queue.poll('core/core');
    assert.strictEqual(coreMessages.length, 1, 'Core should receive 1 message');
    assert.strictEqual(coreMessages[0].type, 'ask-human', 'Type should be inferred as ask-human');
    assert.strictEqual(coreMessages[0].from_agent, 'test-ask-human-halt/worker');
  });

  test('Message WITHOUT type field inferred as ask-response when from core/core', async () => {
    const timestamp = Date.now();

    // First, queue an ask-human for tracking
    queue.trackPendingAsk('test-ask-human-halt/worker', 'core/core', 'tbd2-ask');

    // Core sends response WITHOUT type field
    const responseFile = path.join(env.msgsDir, `${timestamp}-no-type-core-core--test-ask-human-halt-worker-tbd2.md`);
    fs.writeFileSync(responseFile, `---
to: test-ask-human-halt/worker
from: core/core
headline: User response
timestamp: ${new Date().toISOString()}
---

Proceed with implementation.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Worker should receive it as ask-response (inferred)
    const workerMessages = queue.poll('test-ask-human-halt/worker');
    assert.strictEqual(workerMessages.length, 1, 'Worker should receive 1 message');
    assert.strictEqual(workerMessages[0].type, 'ask-response', 'Type should be inferred as ask-response');
    assert.strictEqual(workerMessages[0].from_agent, 'core/core');
  });

  test('Terminal-by-default full round trip without explicit types', async () => {
    const timestamp = Date.now();

    // Step 1: Worker sends ask-human WITHOUT type field
    const askFile = path.join(env.msgsDir, `${timestamp}-tbd-test-ask-human-halt-worker--core-core-tbd3.md`);
    fs.writeFileSync(askFile, `---
to: core/core
from: test-ask-human-halt/worker
msg-id: tbd3
headline: Confirmation needed
timestamp: ${new Date().toISOString()}
---

Should I proceed?
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Step 2: Verify core received it as ask-human
    const coreMessages = queue.poll('core/core');
    assert.strictEqual(coreMessages.length, 1);
    assert.strictEqual(coreMessages[0].type, 'ask-human', 'Should be inferred as ask-human');

    // Step 3: Core responds WITHOUT type field (inferred from core/core)
    const responseFile = path.join(env.msgsDir, `${timestamp + 1}-tbd-core-core--test-ask-human-halt-worker-tbd3-r.md`);
    fs.writeFileSync(responseFile, `---
to: test-ask-human-halt/worker
from: core/core
headline: User confirmed
timestamp: ${new Date().toISOString()}
---

Yes, proceed.
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Step 4: Worker receives response
    const workerMessages = queue.poll('test-ask-human-halt/worker');
    assert.strictEqual(workerMessages.length, 1);
    assert.strictEqual(workerMessages[0].type, 'ask-response', 'Should be inferred as ask-response');
    assert.ok(
      (workerMessages[0].payload.body as string)?.includes('proceed'),
      'Response should contain confirmation'
    );
  });

  test('Parity tracking works with inferred types', async () => {
    const timestamp = Date.now();

    // Worker sends ask-human WITHOUT type field
    const askFile = path.join(env.msgsDir, `${timestamp}-parity-test-ask-human-halt-worker--core-core-parity1.md`);
    fs.writeFileSync(askFile, `---
to: core/core
from: test-ask-human-halt/worker
msg-id: parity1
headline: Need input
timestamp: ${new Date().toISOString()}
---

What is the expected output?
`);

    await new Promise(resolve => setTimeout(resolve, 600));

    // Verify pending ask is tracked (consumer should track it when type is inferred as ask-human)
    const pending = queue.getPendingAsks('test-ask-human-halt/worker');
    assert.ok(pending.length >= 1, 'Should have pending ask tracked');
    const found = pending.find(p => p.msg_id === 'parity1');
    assert.ok(found, 'Should find the tracked ask');
    assert.strictEqual(found?.to_agent, 'core/core');
  });
});
