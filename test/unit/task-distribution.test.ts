/**
 * Task Distribution Tests
 *
 * Tests for:
 * - TaskDistributionCoordinator lifecycle
 * - Subtask batch registration
 * - Result collection
 * - Completion detection
 * - Subtask parser
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskDistributionCoordinator, type Subtask } from '../../src/worker/task-distribution-coordinator.ts';
import { parseSpawnerOutput, formatSubtaskResults } from '../../src/worker/subtask-parser.ts';

/**
 * ===========================================================================
 * TASK DISTRIBUTION COORDINATOR TESTS
 * ===========================================================================
 */

test('TaskDistributionCoordinator - registers batch successfully', () => {
  const coordinator = new TaskDistributionCoordinator();

  const subtasks: Subtask[] = [
    { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
    { id: 'subtask-2', description: 'Task 2', assigned_agent: 'worker-2' },
  ];

  const batchId = coordinator.registerBatch(
    'parent-123',
    'mesh/spawner',
    'mesh/reviewer',
    subtasks
  );

  assert.equal(batchId, 'parent-123');

  const retrieved = coordinator.getSubtasks('parent-123');
  assert.deepEqual(retrieved, subtasks);
});

test('TaskDistributionCoordinator - records results and detects completion', () => {
  const coordinator = new TaskDistributionCoordinator();

  const subtasks: Subtask[] = [
    { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
    { id: 'subtask-2', description: 'Task 2', assigned_agent: 'worker-2' },
  ];

  coordinator.registerBatch(
    'parent-123',
    'mesh/spawner',
    'mesh/reviewer',
    subtasks
  );

  // Record first result - should not be complete
  const firstComplete = coordinator.recordResult(
    'parent-123',
    'subtask-1',
    'worker-1',
    'Result 1',
    true
  );

  assert.equal(firstComplete, false);
  assert.equal(coordinator.isBatchComplete('parent-123'), false);

  // Record second result - should complete
  const secondComplete = coordinator.recordResult(
    'parent-123',
    'subtask-2',
    'worker-2',
    'Result 2',
    true
  );

  assert.equal(secondComplete, true);
  assert.equal(coordinator.isBatchComplete('parent-123'), true);
});

test('TaskDistributionCoordinator - getBatchResults returns results when complete', () => {
  const coordinator = new TaskDistributionCoordinator();

  const subtasks: Subtask[] = [
    { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
    { id: 'subtask-2', description: 'Task 2', assigned_agent: 'worker-2' },
  ];

  coordinator.registerBatch(
    'parent-123',
    'mesh/spawner',
    'mesh/reviewer',
    subtasks
  );

  // Before completion
  const beforeResults = coordinator.getBatchResults('parent-123');
  assert.equal(beforeResults, undefined);

  // Record results
  coordinator.recordResult('parent-123', 'subtask-1', 'worker-1', 'Result 1', true);
  coordinator.recordResult('parent-123', 'subtask-2', 'worker-2', 'Result 2', true);

  // After completion
  const afterResults = coordinator.getBatchResults('parent-123');
  assert.notEqual(afterResults, undefined);
  assert.equal(afterResults!.subtask_count, 2);
  assert.equal(afterResults!.successful_count, 2);
  assert.equal(afterResults!.failed_count, 0);
  assert.equal(afterResults!.results.length, 2);
});

test('TaskDistributionCoordinator - tracks failed results', () => {
  const coordinator = new TaskDistributionCoordinator();

  const subtasks: Subtask[] = [
    { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
    { id: 'subtask-2', description: 'Task 2', assigned_agent: 'worker-2' },
  ];

  coordinator.registerBatch(
    'parent-123',
    'mesh/spawner',
    'mesh/reviewer',
    subtasks
  );

  coordinator.recordResult('parent-123', 'subtask-1', 'worker-1', 'Result 1', true);
  coordinator.recordResult('parent-123', 'subtask-2', 'worker-2', '', false, 'Error occurred');

  const results = coordinator.getBatchResults('parent-123');
  assert.equal(results!.successful_count, 1);
  assert.equal(results!.failed_count, 1);
  assert.equal(results!.results[1].success, false);
  assert.equal(results!.results[1].error, 'Error occurred');
});

test('TaskDistributionCoordinator - emits batch:complete event', async () => {
  const coordinator = new TaskDistributionCoordinator();

  const subtasks: Subtask[] = [
    { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
  ];

  coordinator.registerBatch(
    'parent-123',
    'mesh/spawner',
    'mesh/reviewer',
    subtasks
  );

  let eventFired = false;
  coordinator.once('batch:complete', (event) => {
    eventFired = true;
    assert.equal(event.parent_task_id, 'parent-123');
    assert.equal(event.subtask_count, 1);
    assert.equal(event.successful_count, 1);
  });

  coordinator.recordResult('parent-123', 'subtask-1', 'worker-1', 'Result 1', true);

  // Wait a tick for event to fire
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(eventFired, true);
});

test('TaskDistributionCoordinator - emits batch:timeout event', async () => {
  const coordinator = new TaskDistributionCoordinator();

  const subtasks: Subtask[] = [
    { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
    { id: 'subtask-2', description: 'Task 2', assigned_agent: 'worker-2' },
  ];

  let eventFired = false;
  coordinator.once('batch:timeout', (event) => {
    eventFired = true;
    assert.equal(event.parent_task_id, 'parent-123');
    assert.equal(event.completed_count, 1);
    assert.deepEqual(event.pending_subtasks, ['subtask-2']);
  });

  coordinator.registerBatch(
    'parent-123',
    'mesh/spawner',
    'mesh/reviewer',
    subtasks,
    { timeout_ms: 100 } // Very short timeout
  );

  // Complete only one subtask
  coordinator.recordResult('parent-123', 'subtask-1', 'worker-1', 'Result 1', true);

  // Wait for timeout
  await new Promise(resolve => setTimeout(resolve, 150));

  assert.equal(eventFired, true);
});

test('TaskDistributionCoordinator - allows partial failure when enabled', () => {
  const coordinator = new TaskDistributionCoordinator();

  const subtasks: Subtask[] = [
    { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
    { id: 'subtask-2', description: 'Task 2', assigned_agent: 'worker-2' },
  ];

  coordinator.registerBatch(
    'parent-123',
    'mesh/spawner',
    'mesh/reviewer',
    subtasks,
    { allow_partial_failure: true }
  );

  // Complete only one subtask
  coordinator.recordResult('parent-123', 'subtask-1', 'worker-1', 'Result 1', true);

  // With partial failure, batch should be considered complete
  const results = coordinator.getBatchResults('parent-123');
  assert.notEqual(results, undefined);
  assert.equal(results!.successful_count, 1);
});

test('TaskDistributionCoordinator - cleanupBatch removes batch data', () => {
  const coordinator = new TaskDistributionCoordinator();

  const subtasks: Subtask[] = [
    { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
  ];

  coordinator.registerBatch(
    'parent-123',
    'mesh/spawner',
    'mesh/reviewer',
    subtasks
  );

  assert.notEqual(coordinator.getSubtasks('parent-123'), undefined);

  coordinator.cleanupBatch('parent-123');

  assert.equal(coordinator.getSubtasks('parent-123'), undefined);
});

test('TaskDistributionCoordinator - getActiveBatches returns batch info', () => {
  const coordinator = new TaskDistributionCoordinator();

  const subtasks: Subtask[] = [
    { id: 'subtask-1', description: 'Task 1', assigned_agent: 'worker-1' },
    { id: 'subtask-2', description: 'Task 2', assigned_agent: 'worker-2' },
  ];

  coordinator.registerBatch(
    'parent-123',
    'mesh/spawner',
    'mesh/reviewer',
    subtasks
  );

  coordinator.recordResult('parent-123', 'subtask-1', 'worker-1', 'Result 1', true);

  const active = coordinator.getActiveBatches();
  assert.equal(active.length, 1);
  assert.equal(active[0].parent_task_id, 'parent-123');
  assert.equal(active[0].subtask_count, 2);
  assert.equal(active[0].completed_count, 1);
});

/**
 * ===========================================================================
 * SUBTASK PARSER TESTS
 * ===========================================================================
 */

test('parseSpawnerOutput - parses standard SUBTASK format', () => {
  const output = `
SUBTASK 1: Analyze market trends
This subtask focuses on analyzing market trends in the US region.

SUBTASK 2: Review competitor data
Review and analyze competitor performance data.

SUBTASK 3: Generate recommendations
Based on the analysis, generate actionable recommendations.
`;

  const result = parseSpawnerOutput(output);

  assert.equal(result.success, true);
  assert.equal(result.subtasks.length, 3);
  assert.equal(result.subtasks[0].id, 'subtask-1');
  assert.equal(result.subtasks[0].title, 'Analyze market trends');
  assert.match(result.subtasks[0].description, /market trends in the US/);
  assert.equal(result.subtasks[1].id, 'subtask-2');
  assert.equal(result.subtasks[2].id, 'subtask-3');
});

test('parseSpawnerOutput - parses markdown header format', () => {
  const output = `
## SUBTASK 1: First task
Content for first task.

## SUBTASK 2: Second task
Content for second task.
`;

  const result = parseSpawnerOutput(output);

  assert.equal(result.success, true);
  assert.equal(result.subtasks.length, 2);
  assert.equal(result.subtasks[0].title, 'First task');
  assert.equal(result.subtasks[1].title, 'Second task');
});

test('parseSpawnerOutput - handles missing subtasks', () => {
  const output = 'This output has no subtasks in it.';

  const result = parseSpawnerOutput(output);

  assert.equal(result.success, false);
  assert.match(result.error!, /No subtasks found/);
});

test('parseSpawnerOutput - warns on empty descriptions', () => {
  const output = `
SUBTASK 1: Task one
Content here.

SUBTASK 2: Task two

SUBTASK 3: Task three
More content.
`;

  const result = parseSpawnerOutput(output);

  assert.equal(result.success, true);
  assert.equal(result.warnings!.length, 1);
  assert.match(result.warnings![0], /no description/);
});

test('parseSpawnerOutput - warns on non-consecutive sequences', () => {
  const output = `
SUBTASK 1: First task
Content.

SUBTASK 3: Third task
Content.

SUBTASK 5: Fifth task
Content.
`;

  const result = parseSpawnerOutput(output);

  assert.equal(result.success, true);
  assert.equal(result.subtasks.length, 3);
  assert.equal(result.warnings!.length, 1);
  assert.match(result.warnings![0], /not consecutive/);
});

test('formatSubtaskResults - formats results correctly', () => {
  const results = [
    {
      subtask_id: 'subtask-1',
      agent: 'worker-1',
      output: 'Analysis complete',
      success: true,
    },
    {
      subtask_id: 'subtask-2',
      agent: 'worker-2',
      output: '',
      success: false,
      error: 'Timeout',
    },
  ];

  const formatted = formatSubtaskResults(results);

  assert.match(formatted, /Total subtasks: 2/);
  assert.match(formatted, /Successful: 1/);
  assert.match(formatted, /Failed: 1/);
  assert.match(formatted, /SUBTASK 1 RESULT/);
  assert.match(formatted, /SUBTASK 2 RESULT/);
  assert.match(formatted, /Analysis complete/);
  assert.match(formatted, /Timeout/);
  assert.match(formatted, /✓ Success/);
  assert.match(formatted, /✗ Failed/);
});

test('formatSubtaskResults - handles empty output', () => {
  const results = [
    {
      subtask_id: 'subtask-1',
      agent: 'worker-1',
      output: '',
      success: false,
      error: 'Failed to generate output',
    },
  ];

  const formatted = formatSubtaskResults(results);

  assert.match(formatted, /\(no output\)/);
  assert.match(formatted, /Failed to generate output/);
});
