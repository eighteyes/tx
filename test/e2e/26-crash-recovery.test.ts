/**
 * Test 26: Crash Recovery
 *
 * Tests crash detection and recovery system for interrupted mesh work.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageQueue } from '../../src/queue/index.ts';

describe('Crash Recovery System', () => {
  let testDir: string;
  let queue: MessageQueue;
  let dbPath: string;

  beforeEach(() => {
    // Create temp test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-crash-recovery-'));
    dbPath = path.join(testDir, 'queue.db');
    queue = new MessageQueue(dbPath);
  });

  afterEach(() => {
    if (queue) queue.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should create suspended_sessions table', () => {
    const tables = queue.listTables();
    assert.ok(tables.includes('suspended_sessions'), 'Should have suspended_sessions table');
  });

  test('should insert and retrieve suspended session', () => {
    const sessionData = {
      sessionId: 'test-session-1',
      reason: 'ask-human' as const,
      suspendedAt: Date.now(),
      meshName: 'test',
      pendingCount: 1
    };

    queue.suspendSession('test/agent', sessionData);

    const retrieved = queue.getSuspendedSession('test/agent');
    assert.ok(retrieved, 'Should retrieve suspended session');
    assert.strictEqual(retrieved.sessionId, 'test-session-1');
    assert.strictEqual(retrieved.agentId, 'test/agent');
    assert.strictEqual(retrieved.reason, 'ask-human');
  });

  test('should delete suspended session', () => {
    const sessionData = {
      sessionId: 'test-session-2',
      reason: 'ask-human' as const,
      suspendedAt: Date.now(),
      meshName: 'test',
      pendingCount: 1
    };

    queue.suspendSession('test/agent-2', sessionData);
    assert.ok(queue.getSuspendedSession('test/agent-2'), 'Session should exist');

    queue.resumeSession('test/agent-2');
    assert.strictEqual(queue.getSuspendedSession('test/agent-2'), null, 'Session should be deleted');
  });

  test('should list all suspended sessions', () => {
    queue.suspendSession('test/agent-a', {
      sessionId: 'session-a',
      reason: 'ask-human' as const,
      suspendedAt: Date.now(),
      meshName: 'test',
      pendingCount: 1
    });

    queue.suspendSession('test/agent-b', {
      sessionId: 'session-b',
      reason: 'crash' as const,
      suspendedAt: Date.now(),
      meshName: 'test',
      pendingCount: 2
    });

    const sessions = queue.listSuspendedSessions();
    assert.strictEqual(sessions.length, 2);
    assert.ok(sessions.find(s => s.sessionId === 'session-a'));
    assert.ok(sessions.find(s => s.sessionId === 'session-b'));
  });

  test('should clear all suspended sessions', () => {
    queue.suspendSession('test/agent-1', {
      sessionId: 'session-1',
      reason: 'ask-human' as const,
      suspendedAt: Date.now(),
      meshName: 'test',
      pendingCount: 1
    });

    queue.suspendSession('test/agent-2', {
      sessionId: 'session-2',
      reason: 'crash' as const,
      suspendedAt: Date.now(),
      meshName: 'test',
      pendingCount: 1
    });

    assert.strictEqual(queue.listSuspendedSessions().length, 2);

    queue.clearAllSuspendedSessions();
    assert.strictEqual(queue.listSuspendedSessions().length, 0);
  });

  test('should mark pending messages as interrupted', () => {
    // Insert some messages with different statuses
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/worker',
      type: 'task',
      payload: { test: 'pending-1' }
    });

    queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/worker',
      type: 'task',
      payload: { test: 'pending-2' }
    });

    // Poll ONE message to mark as delivered (leave the other pending)
    queue.pollOne('test/worker');

    // Mark all pending as interrupted
    const interruptedCount = queue.markPendingAsInterrupted();

    // Check that messages were marked as interrupted
    assert.strictEqual(interruptedCount, 1, 'Should have interrupted 1 message');
    const interrupted = queue.getInterruptedMessages();
    assert.strictEqual(interrupted.length, 1, 'Should have 1 interrupted message');
    assert.strictEqual(interrupted[0].status, 'interrupted', 'Message should have interrupted status');
  });

  test('should get interrupted messages', () => {
    // Insert a message and mark as interrupted manually
    const id = queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/worker',
      type: 'task',
      payload: { test: 'interrupted-test' }
    });

    // Directly update status to interrupted (simulating crash scenario)
    queue['db'].prepare('UPDATE messages SET status = ? WHERE id = ?').run('interrupted', id);

    const interrupted = queue.getInterruptedMessages();
    assert.ok(interrupted.length >= 1, 'Should find interrupted messages');
    assert.strictEqual(interrupted[0].status, 'interrupted');
  });

  test('should requeue interrupted messages', () => {
    // Create interrupted messages
    const id1 = queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/worker',
      type: 'task',
      payload: { test: 'requeue-1' }
    });

    const id2 = queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/worker',
      type: 'task',
      payload: { test: 'requeue-2' }
    });

    // Mark as interrupted
    queue['db'].prepare('UPDATE messages SET status = ? WHERE id IN (?, ?)').run('interrupted', id1, id2);

    // Verify they're interrupted
    const interrupted = queue.getInterruptedMessages();
    assert.strictEqual(interrupted.length, 2);

    // Requeue them
    const requeued = queue.requeueInterruptedMessages();
    assert.strictEqual(requeued, 2, 'Should requeue 2 messages');

    // Verify they're now pending
    const pending = queue.poll('test/worker');
    assert.ok(pending.length >= 2, 'Should have pending messages again');
  });

  test('should mark interrupted messages as failed (discard)', () => {
    // Create interrupted message
    const id = queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/worker',
      type: 'task',
      payload: { test: 'discard-test' }
    });

    // Mark as interrupted
    queue['db'].prepare('UPDATE messages SET status = ? WHERE id = ?').run('interrupted', id);

    // Get interrupted count
    const interrupted = queue.getInterruptedMessages();
    assert.strictEqual(interrupted.length, 1);

    // Mark as failed (discard)
    const stmt = queue['db'].prepare('UPDATE messages SET status = ? WHERE status = ?');
    stmt.run('failed', 'interrupted');

    // Verify no more interrupted messages
    const stillInterrupted = queue.getInterruptedMessages();
    assert.strictEqual(stillInterrupted.length, 0, 'Should have no interrupted messages');
  });

  test('should handle PID file operations', () => {
    const pidFile = path.join(testDir, 'tx.pid');

    // Write PID
    fs.writeFileSync(pidFile, String(process.pid));
    assert.ok(fs.existsSync(pidFile), 'PID file should exist');

    // Read and verify
    const pid = fs.readFileSync(pidFile, 'utf-8');
    assert.strictEqual(pid, String(process.pid));

    // Cleanup
    fs.unlinkSync(pidFile);
    assert.ok(!fs.existsSync(pidFile), 'PID file should be deleted');
  });

  test('should detect stale PID file (crash scenario)', () => {
    const pidFile = path.join(testDir, 'tx.pid');

    // Write PID of non-existent process
    fs.writeFileSync(pidFile, '99999999');

    // Check if process exists
    const pidExists = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    const stale = !pidExists(99999999);
    assert.ok(stale, 'Should detect stale PID');
  });
});
