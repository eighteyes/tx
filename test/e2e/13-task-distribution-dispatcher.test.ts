/**
 * Test 13: Task Distribution Dispatcher Integration
 *
 * Tests the full task distribution flow through the dispatcher:
 * 1. Spawner agent execution
 * 2. Subtask creation and enqueueing
 * 3. Parallel subagent processing
 * 4. Result aggregation
 * 5. Reviewer routing
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageQueue } from '../../src/queue/index.ts';
import { WorkerDispatcher } from '../../src/worker/index.ts';
import type { Message } from '../../src/queue/index.ts';

describe('V4 Task Distribution Dispatcher Test', () => {
  let testDir: string;
  let msgsDir: string;
  let meshesDir: string;
  let queue: MessageQueue;
  let dispatcher: WorkerDispatcher;

  beforeEach(() => {
    // Create temp test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-task-dist-'));
    msgsDir = path.join(testDir, '.ai', 'tx', 'msgs');
    meshesDir = path.join(testDir, 'meshes', 'test-distribution');

    fs.mkdirSync(msgsDir, { recursive: true });
    fs.mkdirSync(path.join(meshesDir, 'prompts'), { recursive: true });

    // Create test mesh config with task_distribution
    const meshConfig = {
      mesh: 'test-distribution',
      description: 'Test task distribution mesh',
      agents: [
        { name: 'analyst', model: 'haiku', prompt: 'prompts/analyst.md' },
        { name: 'worker-1', model: 'haiku', prompt: 'prompts/worker.md' },
        { name: 'worker-2', model: 'haiku', prompt: 'prompts/worker.md' },
        { name: 'reviewer', model: 'haiku', prompt: 'prompts/reviewer.md' }
      ],
      entry_point: 'analyst',
      task_distribution: {
        spawner: 'analyst',
        subagents: ['worker-1', 'worker-2'],
        reviewer: 'reviewer',
        distribution_strategy: 'equal',
        subtask_count: 2,
        timeout_ms: 30000,
        allow_partial_failure: false
      }
    };

    fs.writeFileSync(
      path.join(meshesDir, 'config.yaml'),
      `mesh: test-distribution
description: Test task distribution mesh

agents:
  - name: analyst
    model: haiku
    prompt: prompts/analyst.md
  - name: worker-1
    model: haiku
    prompt: prompts/worker.md
  - name: worker-2
    model: haiku
    prompt: prompts/worker.md
  - name: reviewer
    model: haiku
    prompt: prompts/reviewer.md

entry_point: analyst

task_distribution:
  spawner: analyst
  subagents: [worker-1, worker-2]
  reviewer: reviewer
  distribution_strategy: equal
  subtask_count: 2
  timeout_ms: 30000
  allow_partial_failure: false
`
    );

    // Create agent prompts
    fs.writeFileSync(
      path.join(meshesDir, 'prompts', 'analyst.md'),
      `# Analyst (Spawner)
You are a task decomposition agent. Split the incoming task into subtasks.

Output format:
SUBTASK 1: Title
Description...

SUBTASK 2: Title
Description...
`
    );

    fs.writeFileSync(
      path.join(meshesDir, 'prompts', 'worker.md'),
      `# Worker
You process a subtask and return results.
`
    );

    fs.writeFileSync(
      path.join(meshesDir, 'prompts', 'reviewer.md'),
      `# Reviewer
You synthesize subtask results into a final report.
`
    );

    // Create queue
    const dbPath = path.join(testDir, '.ai', 'tx', 'data', 'queue.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    queue = new MessageQueue(dbPath);

    // Create dispatcher
    dispatcher = new WorkerDispatcher({
      workDir: testDir,
      msgsDir,
      meshesDir: path.join(testDir, 'meshes'),
    }, queue);
  });

  afterEach(async () => {
    // Cleanup
    await dispatcher.stop();
    queue.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('should detect task_distribution pattern in mesh config', async () => {
    const loadedMeshes: Array<{ mesh: string; agents: number }> = [];
    dispatcher.on('mesh:loaded', (event) => {
      loadedMeshes.push(event);
    });

    await dispatcher.start();

    const testMesh = loadedMeshes.find(m => m.mesh === 'test-distribution');
    assert.ok(testMesh, 'Should load test-distribution mesh');
    assert.equal(testMesh.agents, 4, 'Should have 4 agents');
  });

  test('should parse spawner output and enqueue subtasks', async (t) => {
    // Mock spawner output
    const spawnerOutput = `
SUBTASK 1: Analyze US market
Focus on analyzing market trends in the United States region.

SUBTASK 2: Analyze EU market
Focus on analyzing market trends in the European Union region.
`;

    const subtasksEnqueued: Array<{ subtaskId: string; subagent: string }> = [];
    dispatcher.on('task-distribution:subtask-enqueued', (event) => {
      subtasksEnqueued.push({
        subtaskId: event.subtaskId,
        subagent: event.subagent,
      });
    });

    await dispatcher.start();

    // Simulate spawner completion by calling the private method via reflection
    // In a real scenario, this would happen through the worker completion event
    const meshConfig = (dispatcher as any).meshConfigs.get('test-distribution');
    await (dispatcher as any).handleSpawnerComplete(
      'test-distribution/analyst',
      spawnerOutput,
      'task-123',
      'test-distribution',
      meshConfig
    );

    // Allow async processing
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.equal(subtasksEnqueued.length, 2, 'Should enqueue 2 subtasks');
    assert.equal(subtasksEnqueued[0].subtaskId, 'subtask-1');
    assert.equal(subtasksEnqueued[1].subtaskId, 'subtask-2');

    // Check queue for subtask messages
    const messages = queue.poll('test-distribution/worker-1');
    assert.ok(messages.length > 0, 'Should have messages for worker-1');

    const subtaskMsg = messages.find(m => m.payload.subtask_id === 'subtask-1');
    assert.ok(subtaskMsg, 'Should find subtask-1 message');
    assert.equal(subtaskMsg!.payload.parent_task_id, 'task-123');
  });

  test('should record subagent results', async () => {
    await dispatcher.start();

    const meshConfig = (dispatcher as any).meshConfigs.get('test-distribution');
    const coordinator = (dispatcher as any).taskDistributionCoordinator;

    let batchCompleteEvent: any = null;
    coordinator.once('batch:complete', (event: any) => {
      batchCompleteEvent = event;
    });

    // Register a batch first
    const spawnerOutput = `
SUBTASK 1: Task one
Content for task one.

SUBTASK 2: Task two
Content for task two.
`;

    await (dispatcher as any).handleSpawnerComplete(
      'test-distribution/analyst',
      spawnerOutput,
      'task-123',
      'test-distribution',
      meshConfig
    );

    // Wait for batch registration
    await new Promise(resolve => setTimeout(resolve, 50));

    // Simulate subagent completion
    (dispatcher as any).handleSubagentComplete(
      'test-distribution/worker-1',
      'subtask-1',
      'task-123',
      'Analysis complete for US market',
      true
    );

    const batch = coordinator.getBatchResults('task-123');
    // Batch not complete yet (need both subtasks)
    assert.equal(batch, undefined);

    // Complete second subtask
    (dispatcher as any).handleSubagentComplete(
      'test-distribution/worker-2',
      'subtask-2',
      'task-123',
      'Analysis complete for EU market',
      true
    );

    // Wait for completion processing
    await new Promise(resolve => setTimeout(resolve, 50));

    // Batch complete event should have fired
    assert.ok(batchCompleteEvent, 'Batch should be complete');
    assert.equal(batchCompleteEvent.subtask_count, 2);
    assert.equal(batchCompleteEvent.successful_count, 2);
  });

  test('should route results to reviewer when batch complete', async () => {
    await dispatcher.start();

    const meshConfig = (dispatcher as any).meshConfigs.get('test-distribution');

    let reviewerTaskEnqueued = false;
    let reviewerMsgId: number | undefined;

    dispatcher.on('task-distribution:batch-complete', (event) => {
      reviewerTaskEnqueued = true;
      reviewerMsgId = event.reviewer_msg_id;
    });

    // Simulate full workflow
    const spawnerOutput = `
SUBTASK 1: Subtask one
Content one.

SUBTASK 2: Subtask two
Content two.
`;

    await (dispatcher as any).handleSpawnerComplete(
      'test-distribution/analyst',
      spawnerOutput,
      'task-456',
      'test-distribution',
      meshConfig
    );

    await new Promise(resolve => setTimeout(resolve, 50));

    // Complete both subtasks
    (dispatcher as any).handleSubagentComplete(
      'test-distribution/worker-1',
      'subtask-1',
      'task-456',
      'Result one',
      true
    );

    (dispatcher as any).handleSubagentComplete(
      'test-distribution/worker-2',
      'subtask-2',
      'task-456',
      'Result two',
      true
    );

    // Wait for batch completion
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.ok(reviewerTaskEnqueued, 'Should enqueue reviewer task');
    assert.ok(reviewerMsgId, 'Should have reviewer message ID');

    // Check reviewer message in queue
    const reviewerMessages = queue.poll('test-distribution/reviewer');
    assert.ok(reviewerMessages.length > 0, 'Should have reviewer messages');

    const reviewMsg = reviewerMessages.find(m => m.payload.parent_task_id === 'task-456');
    assert.ok(reviewMsg, 'Should find review message');
    assert.match(reviewMsg!.payload.headline as string, /Review.*subtask/i);
    assert.match(reviewMsg!.payload.body as string, /SUBTASK.*RESULT/);
  });

  test('should handle partial failure when allowed', async () => {
    await dispatcher.start();

    const coordinator = (dispatcher as any).taskDistributionCoordinator;

    let batchCompleteEvent: any = null;
    coordinator.once('batch:complete', (event: any) => {
      batchCompleteEvent = event;
    });

    // Register batch with partial failure allowed
    coordinator.registerBatch(
      'task-789',
      'test-distribution/analyst',
      'test-distribution/reviewer',
      [
        { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
        { id: 'subtask-2', description: 'Task 2', assigned_agent: 'worker-2' },
      ],
      { allow_partial_failure: true }
    );

    // Complete only one subtask successfully, other fails
    coordinator.recordResult(
      'task-789',
      'subtask-1',
      'test-distribution/worker-1',
      'Success output',
      true
    );

    coordinator.recordResult(
      'task-789',
      'subtask-2',
      'test-distribution/worker-2',
      '',
      false,
      'Worker timeout'
    );

    // Wait for async event processing
    await new Promise(resolve => setTimeout(resolve, 50));

    // Batch complete event should have fired despite one failure
    assert.ok(batchCompleteEvent, 'Batch should be complete with partial failure');
    assert.equal(batchCompleteEvent.successful_count, 1);
    assert.equal(batchCompleteEvent.failed_count, 1);
  });

  test('should emit timeout event when batch times out', async () => {
    await dispatcher.start();

    const coordinator = (dispatcher as any).taskDistributionCoordinator;

    let timeoutFired = false;
    let timeoutEvent: any;

    dispatcher.on('task-distribution:timeout', (event) => {
      timeoutFired = true;
      timeoutEvent = event;
    });

    // Register batch with very short timeout
    coordinator.registerBatch(
      'task-timeout',
      'test-distribution/analyst',
      'test-distribution/reviewer',
      [
        { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
        { id: 'subtask-2', description: 'Task 2', assigned_agent: 'worker-2' },
      ],
      { timeout_ms: 100 }
    );

    // Complete only one subtask
    coordinator.recordResult(
      'task-timeout',
      'subtask-1',
      'test-distribution/worker-1',
      'Output',
      true
    );

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 150));

    assert.ok(timeoutFired, 'Should emit timeout event');
    assert.equal(timeoutEvent.parent_task_id, 'task-timeout');
    assert.equal(timeoutEvent.completed_count, 1);
    assert.deepEqual(timeoutEvent.pending_subtasks, ['subtask-2']);
  });
});
