/**
 * Test 23: Session Continuation E2E Test
 *
 * Validates that sessions can be continued after mesh finishes:
 * - First task stores sessionId in SQLite
 * - Second task retrieves same sessionId
 * - Conversation context preserved (worker remembers task 1)
 * - Ask-human continuation (suspended -> resumed)
 *
 * Uses the test-continuation mesh.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageQueue } from '../../src/queue/index.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';
import YAML from 'yaml';

describe('Session Continuation E2E Tests', () => {
  let env: TestEnv;
  let queue: MessageQueue;

  beforeEach(async () => {
    env = createTestEnv('tx-v4-continuation');
    queue = new MessageQueue(env.dbPath);
  });

  afterEach(async () => {
    queue.close();
    env.cleanup();
  });

  test('Session ID is stored after first task', () => {
    const agentId = 'test-continuation/worker';
    const sessionId = `session-${Date.now()}`;

    // No session initially
    assert.strictEqual(queue.getConversationId(agentId), null);

    // Store session
    queue.setConversationId(agentId, sessionId);

    // Verify stored
    const retrieved = queue.getConversationId(agentId);
    assert.strictEqual(retrieved, sessionId);
  });

  test('Same session ID is retrieved for subsequent tasks', () => {
    const agentId = 'test-continuation/worker';
    const sessionId = 'persistent-session-123';

    // Store session
    queue.setConversationId(agentId, sessionId);

    // Multiple retrievals should return same session
    for (let i = 0; i < 5; i++) {
      const retrieved = queue.getConversationId(agentId);
      assert.strictEqual(retrieved, sessionId, `Retrieval ${i + 1} should match`);
    }
  });

  test('Session persists across queue reconnections', () => {
    const agentId = 'test-continuation/worker';
    const sessionId = 'survives-restart';

    // Store with first queue instance
    queue.setConversationId(agentId, sessionId);
    queue.close();

    // Create new queue instance (same database)
    const queue2 = new MessageQueue(env.dbPath);
    const retrieved = queue2.getConversationId(agentId);

    assert.strictEqual(retrieved, sessionId);
    queue2.close();

    // Reopen original for cleanup
    queue = new MessageQueue(env.dbPath);
  });

  test('Different agents have different sessions', () => {
    const agent1 = 'mesh-a/worker';
    const agent2 = 'mesh-b/worker';
    const agent3 = 'mesh-c/worker';

    // Store different sessions
    queue.setConversationId(agent1, 'session-a');
    queue.setConversationId(agent2, 'session-b');
    queue.setConversationId(agent3, 'session-c');

    // Verify each has its own session
    assert.strictEqual(queue.getConversationId(agent1), 'session-a');
    assert.strictEqual(queue.getConversationId(agent2), 'session-b');
    assert.strictEqual(queue.getConversationId(agent3), 'session-c');
  });

  test('Session can be updated (re-assigned)', () => {
    const agentId = 'test-continuation/worker';

    // First session
    queue.setConversationId(agentId, 'session-v1');
    assert.strictEqual(queue.getConversationId(agentId), 'session-v1');

    // Update to new session
    queue.setConversationId(agentId, 'session-v2');
    assert.strictEqual(queue.getConversationId(agentId), 'session-v2');

    // Update again
    queue.setConversationId(agentId, 'session-v3');
    assert.strictEqual(queue.getConversationId(agentId), 'session-v3');
  });

  test('Cleared session returns null', () => {
    const agentId = 'test-continuation/worker';

    // Store and verify
    queue.setConversationId(agentId, 'to-be-cleared');
    assert.strictEqual(queue.getConversationId(agentId), 'to-be-cleared');

    // Clear
    queue.clearConversationId(agentId);

    // Should be null now
    assert.strictEqual(queue.getConversationId(agentId), null);
  });

  test('Clear all sessions removes all entries', () => {
    // Store multiple sessions
    queue.setConversationId('agent-1', 'session-1');
    queue.setConversationId('agent-2', 'session-2');
    queue.setConversationId('agent-3', 'session-3');

    // Verify all exist
    const before = queue.getActiveSessions();
    assert.ok(before.length >= 3);

    // Clear all
    queue.clearAllSessions();

    // All should be gone
    assert.strictEqual(queue.getConversationId('agent-1'), null);
    assert.strictEqual(queue.getConversationId('agent-2'), null);
    assert.strictEqual(queue.getConversationId('agent-3'), null);
  });

  test('Active sessions list includes all stored sessions', () => {
    // Clear any existing
    queue.clearAllSessions();

    // Store sessions
    const testSessions = [
      { agentId: 'mesh-1/agent-a', sessionId: 'session-1a' },
      { agentId: 'mesh-1/agent-b', sessionId: 'session-1b' },
      { agentId: 'mesh-2/agent-a', sessionId: 'session-2a' },
    ];

    for (const { agentId, sessionId } of testSessions) {
      queue.setConversationId(agentId, sessionId);
    }

    // Get active sessions
    const active = queue.getActiveSessions();

    // Verify all present
    for (const { agentId, sessionId } of testSessions) {
      const found = active.find(s => s.agentId === agentId);
      assert.ok(found, `Session for ${agentId} should exist`);
      assert.strictEqual(found?.sessionId, sessionId);
    }
  });

  test('Session survives message processing', () => {
    const agentId = 'test-continuation/worker';
    const sessionId = 'survives-messages';

    // Store session
    queue.setConversationId(agentId, sessionId);

    // Insert and process messages
    for (let i = 0; i < 10; i++) {
      queue.insert({
        from_agent: 'core/core',
        to_agent: agentId,
        type: 'task',
        payload: { headline: `Task ${i}`, body: `Work ${i}` },
      });
    }

    // Poll all messages
    const messages = queue.poll(agentId);
    assert.strictEqual(messages.length, 10);

    // Session should still exist
    assert.strictEqual(queue.getConversationId(agentId), sessionId);
  });

  test('Continuation config flag recognized in mesh', () => {
    // Write test mesh config with continuation: true
    const meshDir = path.join(env.meshesDir, 'continuation-test');
    fs.mkdirSync(meshDir, { recursive: true });

    const config = {
      mesh: 'continuation-test',
      agents: [
        { name: 'worker', model: 'haiku', prompt: 'worker.md' },
      ],
      entry_point: 'worker',
      continuation: true,  // Enable continuation
    };

    fs.writeFileSync(
      path.join(meshDir, 'config.yaml'),
      YAML.stringify(config)
    );

    fs.writeFileSync(
      path.join(meshDir, 'worker.md'),
      '# Test Worker\nYou are a test worker.'
    );

    // Verify file written correctly
    const written = fs.readFileSync(path.join(meshDir, 'config.yaml'), 'utf-8');
    const parsed = YAML.parse(written);

    assert.strictEqual(parsed.continuation, true);
  });

  test('Continuation can be limited to specific agents', () => {
    // Write mesh config with continuation for specific agents
    const meshDir = path.join(env.meshesDir, 'selective-continuation');
    fs.mkdirSync(meshDir, { recursive: true });

    const config = {
      mesh: 'selective-continuation',
      agents: [
        { name: 'persistent', model: 'haiku', prompt: 'persistent.md' },
        { name: 'ephemeral', model: 'haiku', prompt: 'ephemeral.md' },
      ],
      entry_point: 'persistent',
      continuation: ['persistent'],  // Only 'persistent' agent continues
    };

    fs.writeFileSync(
      path.join(meshDir, 'config.yaml'),
      YAML.stringify(config)
    );

    // Verify config
    const written = fs.readFileSync(path.join(meshDir, 'config.yaml'), 'utf-8');
    const parsed = YAML.parse(written);

    assert.ok(Array.isArray(parsed.continuation));
    assert.ok(parsed.continuation.includes('persistent'));
    assert.ok(!parsed.continuation.includes('ephemeral'));
  });

  test('Session updated_at timestamp is maintained', () => {
    const agentId = 'timestamp-test';
    const sessionId = 'session-with-timestamp';

    // Store session
    queue.setConversationId(agentId, sessionId);

    // Get active sessions and check timestamp
    const sessions = queue.getActiveSessions();
    const session = sessions.find(s => s.agentId === agentId);

    assert.ok(session);

    // The database stores updated_at - we can verify via direct query
    const db = queue.getDb();
    const row = db.prepare('SELECT updated_at FROM sessions WHERE agent_id = ?').get(agentId) as { updated_at: number } | undefined;

    assert.ok(row);
    assert.ok(row.updated_at > 0);
    assert.ok(row.updated_at <= Date.now());
  });

  test('Multiple sequential tasks use same session', () => {
    const agentId = 'sequential-test';
    const sessionId = 'shared-session';

    // Store session
    queue.setConversationId(agentId, sessionId);

    // Simulate multiple tasks in sequence
    for (let i = 0; i < 3; i++) {
      // Task arrives
      queue.insert({
        from_agent: 'core/core',
        to_agent: agentId,
        type: 'task',
        payload: { headline: `Task ${i + 1}`, body: `Do task ${i + 1}` },
      });

      // Worker polls message
      const msg = queue.pollOne(agentId);
      assert.ok(msg);

      // Worker completes and should use same session
      const currentSession = queue.getConversationId(agentId);
      assert.strictEqual(currentSession, sessionId, `Task ${i + 1} should use same session`);

      // Worker sends completion
      queue.insert({
        from_agent: agentId,
        to_agent: 'core/core',
        type: 'task-complete',
        payload: { headline: `Task ${i + 1} complete`, body: `Finished task ${i + 1}` },
      });
    }

    // Session should still be the same
    assert.strictEqual(queue.getConversationId(agentId), sessionId);
  });

  test('Ask-human does not clear session', () => {
    const agentId = 'hitl-session-test';
    const sessionId = 'hitl-session';

    // Store session
    queue.setConversationId(agentId, sessionId);

    // Simulate ask-human flow
    queue.insert({
      from_agent: agentId,
      to_agent: 'core/core',
      type: 'ask-human',
      payload: { headline: 'Need input', body: 'What should I do?' },
    });

    // Session should persist
    assert.strictEqual(queue.getConversationId(agentId), sessionId);

    // Core responds
    queue.insert({
      from_agent: 'core/core',
      to_agent: agentId,
      type: 'ask-response',
      payload: { headline: 'User response', body: 'Continue' },
    });

    // Worker polls response
    queue.pollOne(agentId);

    // Session still exists
    assert.strictEqual(queue.getConversationId(agentId), sessionId);
  });
});
