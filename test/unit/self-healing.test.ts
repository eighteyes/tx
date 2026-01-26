/**
 * Self-Healing Component Tests
 *
 * Tests for stale message cleaner and deadlock detector
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

import { StaleMessageCleaner, DEFAULT_STALE_CONFIG } from '../../src/queue/stale-cleaner.ts';
import { DeadlockDetector, DEFAULT_DEADLOCK_CONFIG } from '../../src/queue/deadlock-detector.ts';
import { MessageQueue } from '../../src/queue/index.ts';

describe('StaleMessageCleaner', () => {
  let testDir: string;
  let db: Database.Database;
  let queue: MessageQueue;
  let cleaner: StaleMessageCleaner;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-stale-test-'));
    const dataDir = path.join(testDir, '.ai', 'tx', 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const dbPath = path.join(dataDir, 'queue.db');
    queue = new MessageQueue(dbPath);
    db = queue.getDatabase();
    cleaner = new StaleMessageCleaner(db, {
      ttlMs: 1000, // 1 second for testing
      scanIntervalMs: 100,
      action: 'archive',
    });
  });

  afterEach(() => {
    cleaner.stop();
    queue.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('should have correct default config', () => {
    assert.strictEqual(DEFAULT_STALE_CONFIG.ttlMs, 1800000);
    assert.strictEqual(DEFAULT_STALE_CONFIG.scanIntervalMs, 300000);
    assert.strictEqual(DEFAULT_STALE_CONFIG.action, 'archive');
  });

  test('should create stale_messages table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='stale_messages'"
    ).all();
    assert.strictEqual(tables.length, 1);
  });

  test('should detect stale messages after TTL', async () => {
    // Insert a message with old timestamp
    const now = Date.now();
    db.prepare(`
      INSERT INTO messages (from_agent, to_agent, type, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('test/sender', 'test/receiver', 'task', '{}', 'pending', now - 2000);

    const staleMessages = cleaner.detectStaleMessages();
    assert.strictEqual(staleMessages.length, 1);
    assert.strictEqual(staleMessages[0].to_agent, 'test/receiver');
    assert.strictEqual(staleMessages[0].reason, 'ttl_expired');
  });

  test('should archive stale messages', async () => {
    // Insert old message
    const now = Date.now();
    db.prepare(`
      INSERT INTO messages (from_agent, to_agent, type, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('test/sender', 'test/receiver', 'task', '{"body": "test"}', 'pending', now - 2000);

    cleaner.scanAndClean();

    // Check message was archived
    const archived = db.prepare('SELECT * FROM stale_messages').all();
    assert.strictEqual(archived.length, 1);

    // Check message was removed from main queue
    const remaining = db.prepare("SELECT * FROM messages WHERE status = 'pending'").all();
    assert.strictEqual(remaining.length, 0);
  });

  test('should detect no_target_mesh reason', () => {
    cleaner.setKnownMeshes(['dev', 'test']);

    const now = Date.now();
    db.prepare(`
      INSERT INTO messages (from_agent, to_agent, type, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('core/core', 'unknown/worker', 'task', '{}', 'pending', now - 2000);

    const staleMessages = cleaner.detectStaleMessages();
    assert.strictEqual(staleMessages.length, 1);
    assert.strictEqual(staleMessages[0].reason, 'no_target_mesh');
  });

  test('should get stats', () => {
    // Archive some messages manually
    const now = Date.now();
    db.prepare(`
      INSERT INTO stale_messages (original_id, from_agent, to_agent, type, payload, source_file, created_at, archived_at, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, 'test/a', 'test/b', 'task', '{}', null, now - 5000, now, 'ttl_expired');

    const stats = cleaner.getStats();
    assert.strictEqual(stats.archived, 1);
    assert.strictEqual(stats.byReason['ttl_expired'], 1);
  });

  test('should start and stop', () => {
    assert.strictEqual(cleaner.isRunning(), false);
    cleaner.start();
    assert.strictEqual(cleaner.isRunning(), true);
    cleaner.stop();
    assert.strictEqual(cleaner.isRunning(), false);
  });
});

describe('DeadlockDetector', () => {
  let testDir: string;
  let msgsDir: string;
  let queue: MessageQueue;
  let detector: DeadlockDetector;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-deadlock-test-'));
    msgsDir = path.join(testDir, '.ai', 'tx', 'msgs');
    const dataDir = path.join(testDir, '.ai', 'tx', 'data');
    fs.mkdirSync(msgsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const dbPath = path.join(dataDir, 'queue.db');
    queue = new MessageQueue(dbPath);
    detector = new DeadlockDetector(queue, msgsDir, {
      enabled: true,
      scanIntervalMs: 100,
      autoBreakDepth: 3,
      escalateDepth: 5,
    });
  });

  afterEach(() => {
    detector.stop();
    queue.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('should have correct default config', () => {
    assert.strictEqual(DEFAULT_DEADLOCK_CONFIG.enabled, true);
    assert.strictEqual(DEFAULT_DEADLOCK_CONFIG.scanIntervalMs, 60000);
    assert.strictEqual(DEFAULT_DEADLOCK_CONFIG.autoBreakDepth, 3);
    assert.strictEqual(DEFAULT_DEADLOCK_CONFIG.escalateDepth, 5);
  });

  test('should detect no cycles when no asks pending', () => {
    const cycles = detector.detectCycles();
    assert.strictEqual(cycles.length, 0);
  });

  test('should detect simple 2-agent cycle', () => {
    // A asks B, B asks A
    queue.trackPendingAsk('agent/a', 'agent/b', 'msg-1');
    queue.trackPendingAsk('agent/b', 'agent/a', 'msg-2');

    const cycles = detector.detectCycles();
    assert.strictEqual(cycles.length, 1);
    assert.deepStrictEqual(cycles[0].cycleDepth, 2);
    assert.ok(cycles[0].agents.includes('agent/a'));
    assert.ok(cycles[0].agents.includes('agent/b'));
  });

  test('should detect 3-agent cycle', () => {
    // A -> B -> C -> A
    queue.trackPendingAsk('agent/a', 'agent/b', 'msg-1');
    queue.trackPendingAsk('agent/b', 'agent/c', 'msg-2');
    queue.trackPendingAsk('agent/c', 'agent/a', 'msg-3');

    const cycles = detector.detectCycles();
    assert.strictEqual(cycles.length, 1);
    assert.strictEqual(cycles[0].cycleDepth, 3);
  });

  test('should not detect cycle for linear chain', () => {
    // A -> B -> C (no back edge)
    queue.trackPendingAsk('agent/a', 'agent/b', 'msg-1');
    queue.trackPendingAsk('agent/b', 'agent/c', 'msg-2');

    const cycles = detector.detectCycles();
    assert.strictEqual(cycles.length, 0);
  });

  test('should start and stop', () => {
    assert.strictEqual(detector.isRunning(), false);
    detector.start();
    assert.strictEqual(detector.isRunning(), true);
    detector.stop();
    assert.strictEqual(detector.isRunning(), false);
  });

  test('should emit deadlock:detected event', async () => {
    let detectedCycle = null;
    detector.on('deadlock:detected', (cycle) => {
      detectedCycle = cycle;
    });

    // Create simple cycle
    queue.trackPendingAsk('agent/x', 'agent/y', 'msg-x');
    queue.trackPendingAsk('agent/y', 'agent/x', 'msg-y');

    detector.detectAndHandle();

    assert.ok(detectedCycle !== null);
  });
});
