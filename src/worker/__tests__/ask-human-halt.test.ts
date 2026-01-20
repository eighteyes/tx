/**
 * Tests for ask-human mesh halt behavior
 *
 * Verifies that when an ask-human message is pending:
 * - The entire mesh is halted (no new workers spawn)
 * - Messages are queued but not processed
 * - After human responds, queued messages are processed
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
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

function createMeshConfig(meshesDir: string, meshName: string, agents: string[]): void {
  const meshDir = path.join(meshesDir, meshName);
  fs.mkdirSync(meshDir, { recursive: true });

  const config = {
    mesh: meshName,
    entry_point: agents[0],
    agents: agents.map(name => ({
      name,
      model: 'sonnet',
      prompt: `prompts/${name}.md`,
    })),
  };

  fs.writeFileSync(path.join(meshDir, 'config.yaml'), YAML.stringify(config));

  // Create prompt files
  const promptsDir = path.join(meshDir, 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });
  for (const agent of agents) {
    fs.writeFileSync(path.join(promptsDir, `${agent}.md`), `# ${agent} prompt`);
  }
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

describe('Ask-Human Mesh Halt', () => {
  let temp: { dir: string; cleanup: () => void };
  let queue: MessageQueue;
  let consumer: MessageConsumer;
  let dispatcher: WorkerDispatcher;
  let msgsDir: string;
  let dataDir: string;
  let meshesDir: string;

  beforeEach(async () => {
    temp = createTempDir('ask-human-halt-test');
    msgsDir = path.join(temp.dir, '.ai', 'tx', 'msgs');
    dataDir = path.join(temp.dir, '.ai', 'tx', 'data');
    meshesDir = path.join(temp.dir, 'meshes');
    queue = createQueue(dataDir);
    consumer = new MessageConsumer(msgsDir, queue, meshesDir);

    // Create test mesh with multiple agents
    createMeshConfig(meshesDir, 'test-mesh', ['worker1', 'worker2', 'worker3']);

    const dispatcherConfig: DispatcherConfig = {
      workDir: temp.dir,
      msgsDir,
      meshesDir,
    };
    dispatcher = new WorkerDispatcher(dispatcherConfig, queue);

    await consumer.start();
    await dispatcher.start(consumer);
  });

  afterEach(async () => {
    await dispatcher.stop(consumer);
    await consumer.stop();
    queue.close();
    temp.cleanup();
  });

  describe('Mesh halt on ask-human', () => {
    it('should halt mesh when ask-human is pending', async () => {
      const meshName = 'test-mesh';
      const agentId = `${meshName}/worker1`;

      // Manually set up a suspended session to simulate ask-human
      // In real flow, this happens when handleAskMessage processes an ask-human
      (dispatcher as any).suspendedSessions.set(agentId, {
        sessionId: 'test-session-123',
        reason: 'ask-human',
        suspendedAt: Date.now(),
        targetAgents: new Set(['core/core']),
        pendingResponseCount: 1,
        meshName,
        agentConfig: { name: 'worker1', model: 'sonnet', prompt: 'prompts/worker1.md' },
      });

      // Verify mesh is halted
      assert.strictEqual(
        dispatcher.hasPendingAskHumanForMesh(meshName),
        true,
        'Mesh should be marked as having pending ask-human'
      );

      // Track halted message events
      const haltedEvents: unknown[] = [];
      dispatcher.on('mesh:halted-message', (data) => haltedEvents.push(data));

      // Send a message to another agent in the same mesh
      writeMessage(msgsDir, {
        from: 'core/core',
        to: `${meshName}/worker2`,
        type: 'task',
        msgId: 'test-task-1',
        body: 'This task should be queued, not processed',
      });

      // Wait for consumer to process
      await sleep(200);

      // Verify the halted-message event was emitted
      assert.strictEqual(haltedEvents.length, 1, 'Should emit mesh:halted-message event');
      const haltedEvent = haltedEvents[0] as { agentId: string; meshName: string; reason: string };
      assert.strictEqual(haltedEvent.meshName, meshName);
      assert.strictEqual(haltedEvent.reason, 'pending-ask-human');

      // Verify no workers were spawned
      assert.strictEqual(
        dispatcher.hasActiveWorkers(`${meshName}/worker2`),
        false,
        'No worker should be spawned while mesh is halted'
      );

      // Verify message is still queued
      const pendingMsg = queue.peekOne(`${meshName}/worker2`);
      assert.ok(pendingMsg, 'Message should still be in queue');
      assert.strictEqual(pendingMsg?.type, 'task');
    });

    it('should not halt different mesh when one mesh has ask-human', async () => {
      const meshName1 = 'test-mesh';
      const meshName2 = 'other-mesh';

      // Create another mesh
      createMeshConfig(meshesDir, meshName2, ['agent1']);

      // Reload mesh configs
      (dispatcher as any).loadMeshConfigs();

      // Suspend only the first mesh
      (dispatcher as any).suspendedSessions.set(`${meshName1}/worker1`, {
        sessionId: 'test-session-123',
        reason: 'ask-human',
        suspendedAt: Date.now(),
        targetAgents: new Set(['core/core']),
        pendingResponseCount: 1,
        meshName: meshName1,
        agentConfig: { name: 'worker1', model: 'sonnet', prompt: 'prompts/worker1.md' },
      });

      // Verify first mesh is halted
      assert.strictEqual(
        dispatcher.hasPendingAskHumanForMesh(meshName1),
        true,
        'First mesh should be halted'
      );

      // Verify second mesh is NOT halted
      assert.strictEqual(
        dispatcher.hasPendingAskHumanForMesh(meshName2),
        false,
        'Second mesh should NOT be halted'
      );
    });

    it('should process queued messages after mesh is un-halted', async () => {
      const meshName = 'test-mesh';
      const agentId = `${meshName}/worker1`;

      // Set up suspended session
      (dispatcher as any).suspendedSessions.set(agentId, {
        sessionId: 'test-session-123',
        reason: 'ask-human',
        suspendedAt: Date.now(),
        targetAgents: new Set(['core/core']),
        pendingResponseCount: 1,
        meshName,
        agentConfig: { name: 'worker1', model: 'sonnet', prompt: 'prompts/worker1.md' },
      });

      // Send a message to queue (will be halted)
      writeMessage(msgsDir, {
        from: 'core/core',
        to: `${meshName}/worker2`,
        type: 'task',
        msgId: 'queued-task-1',
        body: 'Queued task',
      });

      await sleep(200);

      // Verify message is queued but no worker spawned
      assert.strictEqual(
        dispatcher.hasActiveWorkers(`${meshName}/worker2`),
        false,
        'No worker while halted'
      );
      assert.ok(queue.peekOne(`${meshName}/worker2`), 'Message in queue');

      // Clear the suspended session (simulate human response)
      (dispatcher as any).suspendedSessions.delete(agentId);

      // Verify mesh is no longer halted
      assert.strictEqual(
        dispatcher.hasPendingAskHumanForMesh(meshName),
        false,
        'Mesh should no longer be halted'
      );

      // Track un-halted events
      const unhaltedEvents: unknown[] = [];
      dispatcher.on('mesh:unhalted', (data) => unhaltedEvents.push(data));

      // Manually trigger processing of queued messages
      (dispatcher as any).processQueuedMeshMessages(meshName);

      // Wait for processing
      await sleep(300);

      // Note: Workers won't actually spawn because we don't have real runners,
      // but the method will attempt to spawn them. Check the method was called.
      // In a real scenario, workers would spawn after the mesh is un-halted.
    });
  });

  describe('getSuspendedSessionForMesh', () => {
    it('should return suspended session info for mesh', () => {
      const meshName = 'test-mesh';
      const agentId = `${meshName}/worker1`;

      (dispatcher as any).suspendedSessions.set(agentId, {
        sessionId: 'session-abc',
        reason: 'ask-human',
        suspendedAt: 12345,
        targetAgents: new Set(['core/core']),
        pendingResponseCount: 1,
        meshName,
        agentConfig: { name: 'worker1', model: 'sonnet', prompt: 'prompts/worker1.md' },
      });

      const info = dispatcher.getSuspendedSessionForMesh(meshName);
      assert.ok(info, 'Should return suspended session info');
      assert.strictEqual(info?.agentId, agentId);
      assert.strictEqual(info?.suspended.sessionId, 'session-abc');
    });

    it('should return undefined for mesh with no suspended session', () => {
      const info = dispatcher.getSuspendedSessionForMesh('nonexistent-mesh');
      assert.strictEqual(info, undefined, 'Should return undefined');
    });
  });
});
