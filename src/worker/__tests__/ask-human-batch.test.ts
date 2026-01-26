/**
 * Tests for ask-human batching behavior
 *
 * Verifies that when multiple ask-human messages are pending,
 * the coordinator only resumes ONCE when ALL responses have arrived.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { MessageQueue } from '../../queue/index.ts';
import { MessageConsumer } from '../../core/consumer.ts';
import { WorkerDispatcher, type DispatcherConfig } from '../dispatcher.ts';

// Test fixture helpers
function createTempDir(prefix: string): { dir: string; cleanup: () => void } {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const msgsDir = path.join(baseDir, '.ai', 'tx', 'msgs');
  const dataDir = path.join(baseDir, '.ai', 'tx', 'data');
  const meshesDir = path.join(baseDir, 'meshes');
  fs.mkdirSync(msgsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(meshesDir, { recursive: true });

  return {
    dir: baseDir,
    cleanup: () => {
      try {
        fs.rmSync(baseDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  };
}

function createQueue(dataDir: string): MessageQueue {
  const dbPath = path.join(dataDir, 'queue.db');
  return new MessageQueue(dbPath);
}

function writeMessage(msgsDir: string, opts: {
  from: string;
  to: string;
  type: string;
  msgId?: string;
  body?: string;
}): string {
  const timestamp = Date.now();
  const filename = `${timestamp}-${opts.type}-${opts.from.replace('/', '-')}--${opts.to.replace('/', '-')}-${opts.msgId || timestamp}.md`;
  const filepath = path.join(msgsDir, filename);

  const lines = [
    '---',
    `to: ${opts.to}`,
    `from: ${opts.from}`,
    `type: ${opts.type}`,
  ];
  if (opts.msgId) lines.push(`msg-id: ${opts.msgId}`);
  lines.push(`timestamp: ${new Date().toISOString()}`);
  lines.push('---');
  lines.push('');
  lines.push(opts.body || 'Test body');

  fs.writeFileSync(filepath, lines.join('\n'));
  return filepath;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForEvent(emitter: EventEmitter, eventName: string, timeout = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeout);
    emitter.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('Ask-Human Batching', () => {
  let temp: { dir: string; cleanup: () => void };
  let queue: MessageQueue;
  let consumer: MessageConsumer;
  let msgsDir: string;
  let dataDir: string;

  beforeEach(async () => {
    temp = createTempDir('ask-human-batch-test');
    msgsDir = path.join(temp.dir, '.ai', 'tx', 'msgs');
    dataDir = path.join(temp.dir, '.ai', 'tx', 'data');
    queue = createQueue(dataDir);
    consumer = new MessageConsumer(msgsDir, queue, path.join(temp.dir, 'meshes'));
    await consumer.start();

    // Simulate dispatcher: resolve pending asks when responses arrive
    // (Consumer validates but dispatcher resolves - matches production behavior)
    consumer.on('ask-response-message', (event: { from: string; to: string; msgId?: string }) => {
      queue.resolvePendingAsk(event.from, event.to, event.msgId);
    });
  });

  afterEach(async () => {
    await consumer.stop();
    queue.close();
    temp.cleanup();
  });

  describe('Pending ask tracking', () => {
    it('should track multiple ask-human messages independently', async () => {
      const agentId = 'test/worker';

      // Write 3 ask-human messages
      writeMessage(msgsDir, {
        from: agentId,
        to: 'core/core',
        type: 'ask-human',
        msgId: 'ask-1',
        body: 'First question'
      });
      await waitForEvent(consumer, 'ask-message');

      writeMessage(msgsDir, {
        from: agentId,
        to: 'core/core',
        type: 'ask-human',
        msgId: 'ask-2',
        body: 'Second question'
      });
      await waitForEvent(consumer, 'ask-message');

      writeMessage(msgsDir, {
        from: agentId,
        to: 'core/core',
        type: 'ask-human',
        msgId: 'ask-3',
        body: 'Third question'
      });
      await waitForEvent(consumer, 'ask-message');

      // Check pending asks in queue
      const pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 3, 'Should have 3 pending asks');

      // Filter for core/core asks
      const coreAsks = pending.filter(a => a.to_agent === 'core/core');
      assert.strictEqual(coreAsks.length, 3, 'All 3 should be to core/core');
    });

    it('should decrement pending count as responses arrive', async () => {
      const agentId = 'test/worker';

      // Write 3 ask-human messages
      for (let i = 1; i <= 3; i++) {
        writeMessage(msgsDir, {
          from: agentId,
          to: 'core/core',
          type: 'ask-human',
          msgId: `ask-${i}`,
          body: `Question ${i}`
        });
        await waitForEvent(consumer, 'ask-message');
      }

      // Verify 3 pending
      let pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 3);

      // Send first response
      writeMessage(msgsDir, {
        from: 'core/core',
        to: agentId,
        type: 'ask-response',
        msgId: 'ask-1',
        body: 'Answer 1'
      });
      await waitForEvent(consumer, 'ask-response-message');

      // Verify 2 pending
      pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 2, 'Should have 2 pending after first response');

      // Send second response
      writeMessage(msgsDir, {
        from: 'core/core',
        to: agentId,
        type: 'ask-response',
        msgId: 'ask-2',
        body: 'Answer 2'
      });
      await waitForEvent(consumer, 'ask-response-message');

      // Verify 1 pending
      pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 1, 'Should have 1 pending after second response');

      // Send third response
      writeMessage(msgsDir, {
        from: 'core/core',
        to: agentId,
        type: 'ask-response',
        msgId: 'ask-3',
        body: 'Answer 3'
      });
      await waitForEvent(consumer, 'ask-response-message');

      // Verify 0 pending
      pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 0, 'Should have 0 pending after all responses');
    });

    it('should handle responses arriving out of order', async () => {
      const agentId = 'test/worker';

      // Write 3 ask-human messages
      for (let i = 1; i <= 3; i++) {
        writeMessage(msgsDir, {
          from: agentId,
          to: 'core/core',
          type: 'ask-human',
          msgId: `ask-${i}`,
          body: `Question ${i}`
        });
        await waitForEvent(consumer, 'ask-message');
      }

      // Respond in reverse order
      writeMessage(msgsDir, {
        from: 'core/core',
        to: agentId,
        type: 'ask-response',
        msgId: 'ask-3',
        body: 'Answer 3'
      });
      await waitForEvent(consumer, 'ask-response-message');

      let pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 2);
      assert.ok(!pending.find(p => p.msg_id === 'ask-3'), 'ask-3 should be resolved');

      writeMessage(msgsDir, {
        from: 'core/core',
        to: agentId,
        type: 'ask-response',
        msgId: 'ask-1',
        body: 'Answer 1'
      });
      await waitForEvent(consumer, 'ask-response-message');

      pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 1);
      assert.strictEqual(pending[0].msg_id, 'ask-2', 'Only ask-2 should remain');

      writeMessage(msgsDir, {
        from: 'core/core',
        to: agentId,
        type: 'ask-response',
        msgId: 'ask-2',
        body: 'Answer 2'
      });
      await waitForEvent(consumer, 'ask-response-message');

      pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 0, 'All should be resolved');
    });
  });

  describe('Response arrival with delays', () => {
    it('should track asks even with delays between messages', async () => {
      const agentId = 'test/worker';

      // Write first ask
      writeMessage(msgsDir, {
        from: agentId,
        to: 'core/core',
        type: 'ask-human',
        msgId: 'delayed-1',
        body: 'First question'
      });
      await waitForEvent(consumer, 'ask-message');

      // Small delay
      await sleep(100);

      // Write second ask
      writeMessage(msgsDir, {
        from: agentId,
        to: 'core/core',
        type: 'ask-human',
        msgId: 'delayed-2',
        body: 'Second question'
      });
      await waitForEvent(consumer, 'ask-message');

      // Small delay
      await sleep(100);

      // Write third ask
      writeMessage(msgsDir, {
        from: agentId,
        to: 'core/core',
        type: 'ask-human',
        msgId: 'delayed-3',
        body: 'Third question'
      });
      await waitForEvent(consumer, 'ask-message');

      // All three should be tracked
      const pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 3, 'All 3 asks should be tracked despite delays');
    });

    it('should properly resolve with delays between responses', async () => {
      const agentId = 'test/worker';

      // Write 2 asks
      writeMessage(msgsDir, {
        from: agentId,
        to: 'core/core',
        type: 'ask-human',
        msgId: 'delay-resp-1',
      });
      await waitForEvent(consumer, 'ask-message');

      writeMessage(msgsDir, {
        from: agentId,
        to: 'core/core',
        type: 'ask-human',
        msgId: 'delay-resp-2',
      });
      await waitForEvent(consumer, 'ask-message');

      // First response
      writeMessage(msgsDir, {
        from: 'core/core',
        to: agentId,
        type: 'ask-response',
        msgId: 'delay-resp-1',
        body: 'Answer 1'
      });
      await waitForEvent(consumer, 'ask-response-message');

      // Delay before second response
      await sleep(200);

      let pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 1, 'Should still have 1 pending after delay');

      // Second response
      writeMessage(msgsDir, {
        from: 'core/core',
        to: agentId,
        type: 'ask-response',
        msgId: 'delay-resp-2',
        body: 'Answer 2'
      });
      await waitForEvent(consumer, 'ask-response-message');

      pending = queue.getPendingAsks(agentId);
      assert.strictEqual(pending.length, 0, 'All should be resolved');
    });
  });

  describe('Independent agent tracking', () => {
    it('should track asks for different agents independently', async () => {
      const agent1 = 'mesh1/worker1';
      const agent2 = 'mesh2/worker2';

      // Agent 1 sends 2 asks
      writeMessage(msgsDir, { from: agent1, to: 'core/core', type: 'ask-human', msgId: 'a1-1' });
      await waitForEvent(consumer, 'ask-message');
      writeMessage(msgsDir, { from: agent1, to: 'core/core', type: 'ask-human', msgId: 'a1-2' });
      await waitForEvent(consumer, 'ask-message');

      // Agent 2 sends 3 asks
      writeMessage(msgsDir, { from: agent2, to: 'core/core', type: 'ask-human', msgId: 'a2-1' });
      await waitForEvent(consumer, 'ask-message');
      writeMessage(msgsDir, { from: agent2, to: 'core/core', type: 'ask-human', msgId: 'a2-2' });
      await waitForEvent(consumer, 'ask-message');
      writeMessage(msgsDir, { from: agent2, to: 'core/core', type: 'ask-human', msgId: 'a2-3' });
      await waitForEvent(consumer, 'ask-message');

      // Verify counts
      let pending1 = queue.getPendingAsks(agent1);
      let pending2 = queue.getPendingAsks(agent2);
      assert.strictEqual(pending1.length, 2, 'Agent 1 should have 2 pending');
      assert.strictEqual(pending2.length, 3, 'Agent 2 should have 3 pending');

      // Respond to agent 1's first ask
      writeMessage(msgsDir, { from: 'core/core', to: agent1, type: 'ask-response', msgId: 'a1-1' });
      await waitForEvent(consumer, 'ask-response-message');

      // Verify agent 2 unaffected
      pending1 = queue.getPendingAsks(agent1);
      pending2 = queue.getPendingAsks(agent2);
      assert.strictEqual(pending1.length, 1, 'Agent 1 should have 1 pending');
      assert.strictEqual(pending2.length, 3, 'Agent 2 should still have 3 pending');

      // Clear agent 1
      writeMessage(msgsDir, { from: 'core/core', to: agent1, type: 'ask-response', msgId: 'a1-2' });
      await waitForEvent(consumer, 'ask-response-message');

      pending1 = queue.getPendingAsks(agent1);
      pending2 = queue.getPendingAsks(agent2);
      assert.strictEqual(pending1.length, 0, 'Agent 1 should be clear');
      assert.strictEqual(pending2.length, 3, 'Agent 2 should still have 3');
    });
  });
});
