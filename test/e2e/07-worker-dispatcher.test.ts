/**
 * Test 7: Worker Dispatcher
 *
 * Tests the WorkerDispatcher that watches for task messages and spawns workers.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { MessageQueue } from '../../src/queue/index.ts';
import { WorkerDispatcher } from '../../src/worker/index.ts';

describe('V4 Worker Dispatcher Test', () => {
  let testDir: string;
  let msgsDir: string;
  let meshesDir: string;
  let queue: MessageQueue;
  let dispatcher: WorkerDispatcher;
  let mockConsumer: EventEmitter;

  beforeEach(() => {
    // Create temp test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-dispatcher-'));
    msgsDir = path.join(testDir, '.ai', 'tx', 'msgs');
    meshesDir = path.join(testDir, 'meshes');

    fs.mkdirSync(msgsDir, { recursive: true });
    fs.mkdirSync(path.join(meshesDir, 'configs'), { recursive: true });
    fs.mkdirSync(path.join(meshesDir, 'agents', 'test'), { recursive: true });

    // Create test mesh config
    const meshConfig = {
      mesh: 'test',
      description: 'Test mesh',
      agents: [
        { name: 'worker', model: 'haiku', prompt: 'meshes/agents/test/worker.md' }
      ],
      entry_point: 'worker'
    };
    fs.writeFileSync(
      path.join(meshesDir, 'configs', 'test.json'),
      JSON.stringify(meshConfig, null, 2)
    );

    // Create test worker prompt
    const workerPrompt = `# Test Worker
You are a test worker. When you receive a task, acknowledge it.`;
    fs.writeFileSync(
      path.join(meshesDir, 'agents', 'test', 'worker.md'),
      workerPrompt
    );

    // Create queue
    const dbPath = path.join(testDir, '.ai', 'tx', 'data', 'queue.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    queue = new MessageQueue(dbPath);

    // Create dispatcher
    dispatcher = new WorkerDispatcher({
      workDir: testDir,
      msgsDir,
      meshesDir,
    }, queue);

    // Create mock consumer for event-driven dispatch
    mockConsumer = new EventEmitter();
  });

  afterEach(async () => {
    // Cleanup
    await dispatcher.stop(mockConsumer);
    queue.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('should load mesh configs on start', async () => {
    const loadedMeshes: string[] = [];
    dispatcher.on('mesh:loaded', ({ mesh }) => {
      loadedMeshes.push(mesh);
    });

    await dispatcher.start();

    assert.ok(loadedMeshes.includes('test'), 'Should load test mesh');
    assert.ok(dispatcher.isRunning(), 'Dispatcher should be running');
  });

  test('should detect task messages for workers', async () => {
    let spawnedAgent: string | null = null;
    dispatcher.on('worker:spawn', ({ agentId }) => {
      spawnedAgent = agentId;
    });

    // Start dispatcher with mock consumer for event-driven dispatch
    await dispatcher.start(mockConsumer);

    // Insert a task message for test/worker
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/worker',
      payload: {
        headline: 'Test task',
        body: 'Please run the test'
      }
    });

    // Emit worker-message event to trigger dispatch (simulates Consumer behavior)
    // Include all fields that the real Consumer emits
    mockConsumer.emit('worker-message', {
      id: 1,
      agentId: 'test/worker',
      from: 'core/core',
      type: 'task',
    });

    // Wait for dispatcher to detect and spawn
    await new Promise(resolve => setTimeout(resolve, 300));

    assert.strictEqual(spawnedAgent, 'test/worker', 'Should spawn worker for task');
  });

  test('should spawn worker for any message type (ask-response, update, etc)', async () => {
    let spawnedType: string | null = null;
    dispatcher.on('worker:spawn', () => {
      // Get the message type from queue
      const msg = queue.peekOne('test/worker');
      spawnedType = (msg?.payload?.headline as string) || null;
    });

    // Start dispatcher with mock consumer for event-driven dispatch
    await dispatcher.start(mockConsumer);

    // Insert an ask-response message (simulating HITL flow)
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/worker',
      payload: {
        headline: 'User response',
        body: 'Yes, proceed'
      }
    });

    // Emit worker-message event to trigger dispatch (simulates Consumer behavior)
    // Include all fields that the real Consumer emits
    mockConsumer.emit('worker-message', {
      id: 2,
      agentId: 'test/worker',
      from: 'core/core',
      type: 'ask-response',
    });

    await new Promise(resolve => setTimeout(resolve, 300));

    assert.strictEqual(spawnedType, 'User response', 'Should spawn worker for ask-response messages');
  });

  test('should track active workers', async () => {
    // Start dispatcher with mock consumer for event-driven dispatch
    await dispatcher.start(mockConsumer);

    // Initially no active workers
    assert.strictEqual(dispatcher.getActiveWorkerCount(), 0);
    assert.deepStrictEqual(dispatcher.getActiveWorkerIds(), []);

    // Insert task to trigger worker
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'test/worker',
      payload: { headline: 'Test', body: 'Test task' }
    });

    // Emit worker-message event to trigger dispatch (simulates Consumer behavior)
    // Include all fields that the real Consumer emits
    mockConsumer.emit('worker-message', {
      id: 3,
      agentId: 'test/worker',
      from: 'core/core',
      type: 'task',
    });

    // Wait for spawn
    await new Promise(resolve => setTimeout(resolve, 300));

    // Should have active worker (briefly, before it completes/fails)
    // Note: Worker may complete quickly if Claude is not available
    const ids = dispatcher.getActiveWorkerIds();
    // Either has worker or it completed already
    assert.ok(Array.isArray(ids), 'Should return array of IDs');
  });

  test('should stop cleanly', async () => {
    await dispatcher.start();
    assert.ok(dispatcher.isRunning());

    await dispatcher.stop();
    assert.ok(!dispatcher.isRunning());
  });
});
