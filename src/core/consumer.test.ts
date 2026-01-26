/**
 * Unit Tests for MessageConsumer Ask-Parity-Gate
 *
 * Tests the parity gate logic that ensures workers wait for ask responses
 * before completing tasks. Uses mocks to test in isolation without file system.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { MessageQueue, Message } from '../queue/index.ts';
import { MessageConsumer, type ParityReminderEvent } from './consumer.ts';

// Minimal mock for MessageQueue - only what we need
function createMockQueue(): MessageQueue {
  let insertId = 1;
  // Track pending asks in memory for parity gate tests
  const pendingAsks: Array<{ id: number; from_agent: string; to_agent: string; msg_id: string; created_at: number }> = [];
  let pendingAskId = 1;

  return {
    insert: () => insertId++,
    poll: () => [],
    peek: () => [],
    peekOne: () => null,
    pollOne: () => null,
    hasMessageFromFile: () => false,
    close: () => {},
    // Parity gate methods
    trackPendingAsk: (fromAgent: string, toAgent: string, msgId: string) => {
      pendingAsks.push({
        id: pendingAskId++,
        from_agent: fromAgent,
        to_agent: toAgent,
        msg_id: msgId,
        created_at: Date.now(),
      });
      return pendingAskId - 1;
    },
    getPendingAsks: (fromAgent: string) => {
      return pendingAsks.filter(a => a.from_agent === fromAgent);
    },
    getPendingAskCounts: (fromAgent: string) => {
      const counts = new Map<string, number>();
      for (const ask of pendingAsks.filter(a => a.from_agent === fromAgent)) {
        counts.set(ask.to_agent, (counts.get(ask.to_agent) || 0) + 1);
      }
      return counts;
    },
    findPendingAsk: (respondingAgent: string, targetAgent: string, msgId?: string) => {
      // Read-only lookup - same logic as resolvePendingAsk but no deletion
      if (msgId) {
        const byMsgId = pendingAsks.find(a => a.from_agent === targetAgent && a.msg_id === msgId);
        if (byMsgId) {
          return { found: true, matchType: 'msg-id' as const, ask: byMsgId };
        }
      }
      const byAgent = pendingAsks.find(a => a.from_agent === targetAgent && a.to_agent === respondingAgent);
      if (byAgent) {
        return { found: true, matchType: 'agent' as const, ask: byAgent };
      }
      return { found: false, matchType: 'none' as const };
    },
    resolvePendingAsk: (respondingAgent: string, targetAgent: string, msgId?: string) => {
      // Try exact msg-id match first
      if (msgId) {
        const byMsgId = pendingAsks.findIndex(a => a.from_agent === targetAgent && a.msg_id === msgId);
        if (byMsgId !== -1) {
          const ask = pendingAsks.splice(byMsgId, 1)[0];
          return { resolved: true, matchType: 'msg-id' as const, ask };
        }
      }
      // Fall back to agent match
      const byAgent = pendingAsks.findIndex(a => a.from_agent === targetAgent && a.to_agent === respondingAgent);
      if (byAgent !== -1) {
        const ask = pendingAsks.splice(byAgent, 1)[0];
        return { resolved: true, matchType: 'agent' as const, ask };
      }
      return { resolved: false, matchType: 'none' as const };
    },
    clearPendingAsks: (fromAgent: string) => {
      const toRemove = pendingAsks.filter(a => a.from_agent === fromAgent);
      for (const ask of toRemove) {
        const idx = pendingAsks.indexOf(ask);
        if (idx !== -1) pendingAsks.splice(idx, 1);
      }
      return toRemove.length;
    },
  } as unknown as MessageQueue;
}

// Helper to create temp directory for tests
function createTempDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const msgsDir = path.join(dir, 'msgs');
  fs.mkdirSync(msgsDir, { recursive: true });
  return {
    dir: msgsDir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  };
}

// Helper to write a test message file
function writeMessage(msgsDir: string, opts: {
  from: string;
  to: string;
  type: string;
  msgId?: string;
  body?: string;
}): string {
  const filename = `${Date.now()}-${opts.type}-test.md`;
  const filepath = path.join(msgsDir, filename);

  const lines = [
    '---',
    `to: ${opts.to}`,
    `from: ${opts.from}`,
    `type: ${opts.type}`,
  ];
  if (opts.msgId) lines.push(`msg-id: ${opts.msgId}`);
  lines.push('---');
  lines.push('');
  lines.push(opts.body || 'Test body');

  fs.writeFileSync(filepath, lines.join('\n'));
  return filepath;
}

// Helper to wait for event
function waitForEvent(emitter: EventEmitter, eventName: string, timeout = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeout);
    emitter.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// Helper to wait for no event (confirm event doesn't fire)
function expectNoEvent(emitter: EventEmitter, eventName: string, waitMs = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), waitMs);
    emitter.once(eventName, () => {
      clearTimeout(timer);
      reject(new Error(`Unexpected ${eventName} event emitted`));
    });
  });
}

describe('Ask-Parity-Gate', () => {
  let temp: { dir: string; cleanup: () => void };
  let consumer: MessageConsumer;
  let mockQueue: MessageQueue;
  let deletedFiles: string[] = [];
  let originalUnlink: typeof fs.unlinkSync;

  beforeEach(async () => {
    temp = createTempDir('parity-gate-test');
    mockQueue = createMockQueue();
    consumer = new MessageConsumer(temp.dir, mockQueue);
    deletedFiles = [];

    // Mock unlinkSync to track deleted files
    originalUnlink = fs.unlinkSync;
    fs.unlinkSync = ((filepath: string) => {
      deletedFiles.push(filepath);
      // Actually delete the file for clean test environment
      originalUnlink(filepath);
    }) as typeof fs.unlinkSync;

    await consumer.start();

    // Simulate dispatcher: resolve pending asks when responses arrive
    // (Consumer validates but dispatcher resolves - matches production behavior)
    consumer.on('ask-response-message', (event: { from: string; to: string; msgId?: string }) => {
      mockQueue.resolvePendingAsk(event.from, event.to, event.msgId);
    });
  });

  afterEach(async () => {
    fs.unlinkSync = originalUnlink;
    await consumer.stop();
    temp.cleanup();
  });

  describe('Scenario 1: Single ask resolved → task-complete passes', () => {
    it('should emit worker-message when ask is resolved before task-complete', async () => {
      const agentId = 'dev/worker';
      const msgId = 'ask-001';

      // 1. Worker sends ask
      writeMessage(temp.dir, {
        from: agentId,
        to: 'brain/brain',
        type: 'ask',
        msgId,
        body: 'What is the API format?'
      });

      // Wait for ask to be processed
      await waitForEvent(consumer, 'ask-message');

      // 2. Brain responds
      writeMessage(temp.dir, {
        from: 'brain/brain',
        to: agentId,
        type: 'ask-response',
        msgId,
        body: 'The API uses JSON format.'
      });

      // Wait for ask-response to be processed
      await waitForEvent(consumer, 'ask-response-message');

      // 3. Worker sends task-complete (to another worker, not core)
      const workerMessagePromise = waitForEvent(consumer, 'worker-message');

      writeMessage(temp.dir, {
        from: agentId,
        to: 'qa/worker',
        type: 'task-complete',
        body: 'Feature implementation complete.'
      });

      // Should emit worker-message (not blocked)
      const event = await workerMessagePromise as { from: string; type: string };
      assert.strictEqual(event.from, agentId);
      assert.strictEqual(event.type, 'task-complete');
      assert.strictEqual(deletedFiles.length, 0, 'No files should be deleted');
    });

    it('should emit core-message when ask is resolved before task-complete to core', async () => {
      const agentId = 'dev/worker';
      const msgId = 'ask-002';

      // 1. Worker sends ask
      writeMessage(temp.dir, {
        from: agentId,
        to: 'brain/brain',
        type: 'ask',
        msgId,
        body: 'What is the API format?'
      });

      await waitForEvent(consumer, 'ask-message');

      // 2. Brain responds
      writeMessage(temp.dir, {
        from: 'brain/brain',
        to: agentId,
        type: 'ask-response',
        msgId,
        body: 'The API uses JSON format.'
      });

      await waitForEvent(consumer, 'ask-response-message');

      // 3. Worker sends task-complete to core
      const coreMessagePromise = waitForEvent(consumer, 'core-message');

      writeMessage(temp.dir, {
        from: agentId,
        to: 'core/core',
        type: 'task-complete',
        body: 'Feature implementation complete.'
      });

      // Should emit core-message (not blocked)
      const event = await coreMessagePromise as { from: string; type: string };
      assert.strictEqual(event.from, agentId);
      assert.strictEqual(event.type, 'task-complete');
      assert.strictEqual(deletedFiles.length, 0, 'No files should be deleted');
    });
  });

  describe('Scenario 2: Pending ask → task-complete rejected', () => {
    it('should emit parity-reminder and delete file when task-complete has pending ask (to worker)', async () => {
      const agentId = 'dev/worker';
      const msgId = 'ask-pending-001';

      // 1. Worker sends ask (no response yet)
      writeMessage(temp.dir, {
        from: agentId,
        to: 'brain/brain',
        type: 'ask',
        msgId,
        body: 'Waiting for answer...'
      });

      await waitForEvent(consumer, 'ask-message');

      // 2. Worker tries to send task-complete (should be blocked)
      const parityPromise = waitForEvent(consumer, 'parity-reminder');
      const noWorkerMessage = expectNoEvent(consumer, 'worker-message', 300);

      writeMessage(temp.dir, {
        from: agentId,
        to: 'qa/worker',
        type: 'task-complete',
        body: 'Trying to complete without response.'
      });

      // Should emit parity-reminder
      const parityEvent = await parityPromise as ParityReminderEvent;
      assert.strictEqual(parityEvent.agentId, agentId);
      assert.strictEqual(parityEvent.pendingAsks.length, 1);
      assert.strictEqual(parityEvent.pendingAsks[0].msgId, msgId);
      assert.strictEqual(parityEvent.pendingAsks[0].to, 'brain/brain');

      // Should delete the task-complete file
      assert.strictEqual(deletedFiles.length, 1);
      assert.ok(deletedFiles[0].includes('task-complete'));

      // Should NOT emit worker-message
      await noWorkerMessage;
    });

    it('should emit parity-reminder and delete file when task-complete has pending ask (to core)', async () => {
      const agentId = 'dev/worker';
      const msgId = 'ask-pending-002';

      // 1. Worker sends ask (no response yet)
      writeMessage(temp.dir, {
        from: agentId,
        to: 'brain/brain',
        type: 'ask',
        msgId,
        body: 'Waiting for answer...'
      });

      await waitForEvent(consumer, 'ask-message');

      // 2. Worker tries to send task-complete to core (should be blocked)
      const parityPromise = waitForEvent(consumer, 'parity-reminder');
      const noCoreMessage = expectNoEvent(consumer, 'core-message', 300);

      writeMessage(temp.dir, {
        from: agentId,
        to: 'core/core',
        type: 'task-complete',
        body: 'Trying to complete without response.'
      });

      // Should emit parity-reminder
      const parityEvent = await parityPromise as ParityReminderEvent;
      assert.strictEqual(parityEvent.agentId, agentId);
      assert.strictEqual(parityEvent.pendingAsks.length, 1);

      // Should delete the task-complete file
      assert.strictEqual(deletedFiles.length, 1);

      // Should NOT emit core-message
      await noCoreMessage;
    });
  });

  describe('Scenario 3: Multiple asks, partial resolution → still blocked', () => {
    it('should block task-complete when only some asks are resolved', async () => {
      const agentId = 'dev/worker';
      const msgId1 = 'ask-foo';
      const msgId2 = 'ask-bar';

      // 1. Worker sends first ask
      writeMessage(temp.dir, {
        from: agentId,
        to: 'brain/brain',
        type: 'ask',
        msgId: msgId1,
        body: 'First question'
      });
      await waitForEvent(consumer, 'ask-message');

      // 2. Worker sends second ask
      writeMessage(temp.dir, {
        from: agentId,
        to: 'qa/worker',
        type: 'ask',
        msgId: msgId2,
        body: 'Second question'
      });
      await waitForEvent(consumer, 'ask-message');

      // 3. Only first ask gets response
      writeMessage(temp.dir, {
        from: 'brain/brain',
        to: agentId,
        type: 'ask-response',
        msgId: msgId1,
        body: 'Answer to first'
      });
      await waitForEvent(consumer, 'ask-response-message');

      // 4. Worker tries to complete - should be blocked (bar still pending)
      const parityPromise = waitForEvent(consumer, 'parity-reminder');
      const noWorkerMessage = expectNoEvent(consumer, 'worker-message', 300);

      writeMessage(temp.dir, {
        from: agentId,
        to: 'core/core',
        type: 'task-complete',
        body: 'Trying to complete with pending ask.'
      });

      // Should emit parity-reminder with remaining ask
      const parityEvent = await parityPromise as ParityReminderEvent;
      assert.strictEqual(parityEvent.agentId, agentId);
      assert.strictEqual(parityEvent.pendingAsks.length, 1);
      assert.strictEqual(parityEvent.pendingAsks[0].msgId, msgId2);
      assert.strictEqual(parityEvent.pendingAsks[0].to, 'qa/worker');

      // Should delete the file
      assert.strictEqual(deletedFiles.length, 1);

      // Should NOT emit worker-message
      await noWorkerMessage;
    });

    it('should pass when all multiple asks are resolved', async () => {
      const agentId = 'dev/worker';
      const msgId1 = 'ask-alpha';
      const msgId2 = 'ask-beta';

      // 1. Worker sends first ask
      writeMessage(temp.dir, {
        from: agentId,
        to: 'brain/brain',
        type: 'ask',
        msgId: msgId1,
      });
      await waitForEvent(consumer, 'ask-message');

      // 2. Worker sends second ask
      writeMessage(temp.dir, {
        from: agentId,
        to: 'qa/worker',
        type: 'ask',
        msgId: msgId2,
      });
      await waitForEvent(consumer, 'ask-message');

      // 3. Both get responses
      writeMessage(temp.dir, {
        from: 'brain/brain',
        to: agentId,
        type: 'ask-response',
        msgId: msgId1,
      });
      await waitForEvent(consumer, 'ask-response-message');

      writeMessage(temp.dir, {
        from: 'qa/worker',
        to: agentId,
        type: 'ask-response',
        msgId: msgId2,
      });
      await waitForEvent(consumer, 'ask-response-message');

      // 4. Worker completes - should pass
      const coreMessagePromise = waitForEvent(consumer, 'core-message');

      writeMessage(temp.dir, {
        from: agentId,
        to: 'core/core',
        type: 'task-complete',
      });

      const event = await coreMessagePromise as { from: string; type: string };
      assert.strictEqual(event.from, agentId);
      assert.strictEqual(event.type, 'task-complete');
      assert.strictEqual(deletedFiles.length, 0, 'No files should be deleted');
    });
  });

  describe('Scenario 4: Session restart → old pending asks cleared', () => {
    it('should clear pending asks when dispatcher emits session-start', async () => {
      const agentId = 'dev/worker';
      const msgId = 'stale-ask-001';

      // Create a mock dispatcher
      const mockDispatcher = new EventEmitter();
      consumer.subscribeToDispatcher(mockDispatcher);

      // 1. Worker sends ask
      writeMessage(temp.dir, {
        from: agentId,
        to: 'brain/brain',
        type: 'ask',
        msgId,
      });
      await waitForEvent(consumer, 'ask-message');

      // 2. Dispatcher signals session restart (worker was restarted)
      mockDispatcher.emit('session-start', { agentId });

      // 3. Worker sends task-complete - should pass (pending asks cleared)
      const coreMessagePromise = waitForEvent(consumer, 'core-message');

      writeMessage(temp.dir, {
        from: agentId,
        to: 'core/core',
        type: 'task-complete',
      });

      const event = await coreMessagePromise as { from: string; type: string };
      assert.strictEqual(event.from, agentId);
      assert.strictEqual(event.type, 'task-complete');
      assert.strictEqual(deletedFiles.length, 0, 'No files should be deleted');
    });

    it('should only clear asks for the restarted agent', async () => {
      const agent1 = 'dev/worker';
      const agent2 = 'qa/worker';
      const msgId1 = 'agent1-ask';
      const msgId2 = 'agent2-ask';

      const mockDispatcher = new EventEmitter();
      consumer.subscribeToDispatcher(mockDispatcher);

      // Both agents send asks
      writeMessage(temp.dir, {
        from: agent1,
        to: 'brain/brain',
        type: 'ask',
        msgId: msgId1,
      });
      await waitForEvent(consumer, 'ask-message');

      writeMessage(temp.dir, {
        from: agent2,
        to: 'brain/brain',
        type: 'ask',
        msgId: msgId2,
      });
      await waitForEvent(consumer, 'ask-message');

      // Only agent1 restarts
      mockDispatcher.emit('session-start', { agentId: agent1 });

      // Agent1 should be able to complete
      const coreMessagePromise = waitForEvent(consumer, 'core-message');
      writeMessage(temp.dir, {
        from: agent1,
        to: 'core/core',
        type: 'task-complete',
      });
      await coreMessagePromise;

      // Agent2 should still be blocked
      const parityPromise = waitForEvent(consumer, 'parity-reminder');
      writeMessage(temp.dir, {
        from: agent2,
        to: 'core/core',
        type: 'task-complete',
      });

      const parityEvent = await parityPromise as ParityReminderEvent;
      assert.strictEqual(parityEvent.agentId, agent2);
      assert.strictEqual(parityEvent.pendingAsks[0].msgId, msgId2);
    });
  });

  describe('Scenario 5: ask-response for unknown msg-id → warning logged, no crash', () => {
    it('should log warning but not crash when receiving ask-response for unknown msg-id', async () => {
      const agentId = 'dev/worker';
      const unknownMsgId = 'unknown-ask-999';

      // Send ask-response for non-existent ask
      const askResponsePromise = waitForEvent(consumer, 'ask-response-message');

      writeMessage(temp.dir, {
        from: 'brain/brain',
        to: agentId,
        type: 'ask-response',
        msgId: unknownMsgId,
        body: 'Response to unknown ask'
      });

      // Should still emit the ask-response-message event
      const event = await askResponsePromise as { msgId: string };
      assert.strictEqual(event.msgId, unknownMsgId);

      // Should not crash - consumer should still be running
      assert.strictEqual(consumer.isRunning(), true);

      // Subsequent messages should still work
      const coreMessagePromise = waitForEvent(consumer, 'core-message');
      writeMessage(temp.dir, {
        from: agentId,
        to: 'core/core',
        type: 'task-complete',
      });
      await coreMessagePromise;
    });

    it('should handle ask-response when agent has no pending asks at all', async () => {
      // Never sent any asks, just send a response
      const askResponsePromise = waitForEvent(consumer, 'ask-response-message');

      writeMessage(temp.dir, {
        from: 'brain/brain',
        to: 'new/agent',
        type: 'ask-response',
        msgId: 'orphan-response',
      });

      await askResponsePromise;
      assert.strictEqual(consumer.isRunning(), true);
    });
  });

  describe('Scenario 6: ask-response should NOT emit worker-message', () => {
    it('should emit ONLY ask-response-message, NOT worker-message for ask-response', async () => {
      const agentId = 'dev/worker';
      const msgId = 'ask-exclusive-001';

      // 1. Worker sends ask first
      writeMessage(temp.dir, {
        from: agentId,
        to: 'brain/brain',
        type: 'ask',
        msgId,
        body: 'Question requiring response'
      });
      await waitForEvent(consumer, 'ask-message');

      // 2. Brain responds - should emit ONLY ask-response-message
      const askResponsePromise = waitForEvent(consumer, 'ask-response-message');
      const noWorkerMessagePromise = expectNoEvent(consumer, 'worker-message', 500);

      writeMessage(temp.dir, {
        from: 'brain/brain',
        to: agentId,
        type: 'ask-response',
        msgId,
        body: 'The answer is 42'
      });

      // Verify ask-response-message is emitted
      const event = await askResponsePromise as { from: string; to: string; msgId: string };
      assert.strictEqual(event.from, 'brain/brain');
      assert.strictEqual(event.to, agentId);
      assert.strictEqual(event.msgId, msgId);

      // Verify worker-message was NOT emitted (this would cause duplicate worker spawn)
      await noWorkerMessagePromise;
    });

    it('should NOT spawn duplicate coordinator when prep agents respond', async () => {
      // This tests the root cause bug: parallel prep responses should NOT spawn workers
      const coordinatorId = 'dev/coordinator';
      const prepAgent1 = 'dev/prep-1';
      const prepAgent2 = 'dev/prep-2';
      const msgId1 = 'prep-ask-001';
      const msgId2 = 'prep-ask-002';

      // Track all emitted events
      const emittedEvents: string[] = [];
      consumer.on('ask-message', () => emittedEvents.push('ask-message'));
      consumer.on('ask-response-message', () => emittedEvents.push('ask-response-message'));
      consumer.on('worker-message', () => emittedEvents.push('worker-message'));

      // 1. Coordinator sends parallel asks to two prep agents
      writeMessage(temp.dir, {
        from: coordinatorId,
        to: prepAgent1,
        type: 'ask',
        msgId: msgId1,
      });
      await waitForEvent(consumer, 'ask-message');

      writeMessage(temp.dir, {
        from: coordinatorId,
        to: prepAgent2,
        type: 'ask',
        msgId: msgId2,
      });
      await waitForEvent(consumer, 'ask-message');

      // Clear event tracking before responses
      emittedEvents.length = 0;

      // 2. Both prep agents respond - should NOT spawn workers
      const response1Promise = waitForEvent(consumer, 'ask-response-message');
      writeMessage(temp.dir, {
        from: prepAgent1,
        to: coordinatorId,
        type: 'ask-response',
        msgId: msgId1,
        body: 'Prep 1 done'
      });
      await response1Promise;

      const response2Promise = waitForEvent(consumer, 'ask-response-message');
      writeMessage(temp.dir, {
        from: prepAgent2,
        to: coordinatorId,
        type: 'ask-response',
        msgId: msgId2,
        body: 'Prep 2 done'
      });
      await response2Promise;

      // Wait a bit to ensure no late worker-message events
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify: should have exactly 2 ask-response-message events, ZERO worker-message events
      const askResponseCount = emittedEvents.filter(e => e === 'ask-response-message').length;
      const workerMessageCount = emittedEvents.filter(e => e === 'worker-message').length;

      assert.strictEqual(askResponseCount, 2, 'Should emit exactly 2 ask-response-message events');
      assert.strictEqual(workerMessageCount, 0, 'Should emit ZERO worker-message events (this was the bug)');
    });
  });

  describe('Edge Cases', () => {
    it('should handle ask-human messages the same as ask messages', async () => {
      const agentId = 'dev/worker';
      const msgId = 'ask-human-001';

      // Worker sends ask-human
      writeMessage(temp.dir, {
        from: agentId,
        to: 'core/core',
        type: 'ask-human',
        msgId,
        body: 'Need user input'
      });
      await waitForEvent(consumer, 'ask-message');

      // Try to complete - should be blocked
      const parityPromise = waitForEvent(consumer, 'parity-reminder');

      writeMessage(temp.dir, {
        from: agentId,
        to: 'core/core',
        type: 'task-complete',
      });

      const parityEvent = await parityPromise as ParityReminderEvent;
      assert.strictEqual(parityEvent.pendingAsks[0].msgId, msgId);
    });

it('should allow task-complete when ask has no msg-id (not tracked for parity)', async () => {
      // NOTE: Asks without msg-id are NOT tracked for parity gate purposes
      // because there's no way to correlate them with responses reliably.
      // This test verifies that behavior - the task-complete is allowed.
      const agentId = 'dev/worker';
      const targetAgent = 'brain/brain';

      // Worker sends ask WITHOUT msg-id
      writeMessage(temp.dir, {
        from: agentId,
        to: targetAgent,
        type: 'ask',
        // no msgId - NOT tracked for parity
      });
      await waitForEvent(consumer, 'ask-message');

      // Task-complete should PASS (asks without msg-id are not tracked)
      const coreMessagePromise = waitForEvent(consumer, 'core-message');

      writeMessage(temp.dir, {
        from: agentId,
        to: 'core/core',
        type: 'task-complete',
      });

      const event = await coreMessagePromise as { from: string; type: string };
      assert.strictEqual(event.from, agentId);
      assert.strictEqual(event.type, 'task-complete');
      assert.strictEqual(deletedFiles.length, 0, 'No files should be deleted');
    });

    it('should track asks per agent independently', async () => {
      const agent1 = 'dev/worker1';
      const agent2 = 'dev/worker2';

      // Agent1 sends ask
      writeMessage(temp.dir, {
        from: agent1,
        to: 'brain/brain',
        type: 'ask',
        msgId: 'agent1-ask',
      });
      await waitForEvent(consumer, 'ask-message');

      // Agent2 should be able to complete (no pending asks for agent2)
      const coreMessagePromise = waitForEvent(consumer, 'core-message');

      writeMessage(temp.dir, {
        from: agent2,
        to: 'core/core',
        type: 'task-complete',
      });

      await coreMessagePromise;
      assert.strictEqual(deletedFiles.length, 0);
    });
  });
});
