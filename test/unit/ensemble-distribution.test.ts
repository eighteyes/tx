/**
 * Ensemble and Task Distribution - Comprehensive Test Suite
 *
 * Tests for:
 * - Type definitions and interfaces
 * - Aggregation Engine strategies
 * - Distribution Engine strategies
 * - MeshValidator ensemble/task_distribution validation
 * - Example mesh configuration validation
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AggregationEngine } from '../../src/mesh/aggregation.ts';
import { DistributionEngine } from '../../src/mesh/distribution.ts';
import { MeshValidator } from '../../src/worker/mesh-validator.ts';

/**
 * ===========================================================================
 * AGGREGATION ENGINE TESTS
 * ===========================================================================
 */

test('AggregationEngine - concat strategy concatenates results with agent labels', async () => {
  const results = [
    { agent: 'agent-1', content: 'Finding A' },
    { agent: 'agent-2', content: 'Finding B' }
  ];

  const result = await AggregationEngine.aggregate('concat', results);

  assert.equal(result.metadata.strategy, 'concat');
  assert.equal(result.metadata.agent_count, 2);
  // Note: successful_agents and failed_agents are not part of the AggregationResult interface
  // These would need to be tracked separately if needed
  assert.match(result.aggregated_content, /agent-1/);
  assert.match(result.aggregated_content, /agent-2/);
  assert.match(result.aggregated_content, /Finding A/);
  assert.match(result.aggregated_content, /Finding B/);
});

test('AggregationEngine - concat handles empty content gracefully', async () => {
  const results = [
    { agent: 'agent-1', content: 'Finding A' },
    { agent: 'agent-2', content: '' }
  ];

  const result = await AggregationEngine.aggregate('concat', results);

  // Note: successful_agents and failed_agents tracking not part of current AggregationResult
  // The test verifies content presence instead
  assert.match(result.aggregated_content, /agent-1/);
  assert.match(result.aggregated_content, /Finding A/);
});

test('AggregationEngine - deduplicate removes duplicate lines', async () => {
  const results = [
    { agent: 'agent-1', content: 'Issue A\nIssue B' },
    { agent: 'agent-2', content: 'Issue A\nIssue C' },
    { agent: 'agent-3', content: 'Issue B\nIssue D' }
  ];

  const result = await AggregationEngine.aggregate('deduplicate', results);

  assert.equal(result.metadata.strategy, 'deduplicate');
  assert((result.metadata?.duplicates_removed as number) > 0);
  assert.equal(result.metadata?.unique_lines, 4);
  assert.match(result.aggregated_content, /Issue A/);
  assert.match(result.aggregated_content, /Issue B/);
  assert.match(result.aggregated_content, /Issue C/);
  assert.match(result.aggregated_content, /Issue D/);
});

test('AggregationEngine - deduplicate is case-insensitive', async () => {
  const results = [
    { agent: 'agent-1', content: 'Finding A' },
    { agent: 'agent-2', content: 'finding a' },
    { agent: 'agent-3', content: 'FINDING A' }
  ];

  const result = await AggregationEngine.aggregate('deduplicate', results);

  assert.equal(result.metadata?.unique_lines, 1);
  assert.equal(result.metadata?.duplicates_removed, 2);
});

test('AggregationEngine - voting identifies single winner', async () => {
  const results = [
    { agent: 'agent-1', content: 'yes' },
    { agent: 'agent-2', content: 'yes' },
    { agent: 'agent-3', content: 'no' }
  ];

  const result = await AggregationEngine.aggregate('voting', results);

  assert.equal(result.metadata.strategy, 'voting');
  assert.match(result.aggregated_content, /yes/);
  assert.match(result.aggregated_content, /2\/3/);
  assert.match(result.aggregated_content, /agent-1/);
  assert.match(result.aggregated_content, /agent-2/);
});

test('AggregationEngine - voting detects tie', async () => {
  const results = [
    { agent: 'agent-1', content: 'option-a' },
    { agent: 'agent-2', content: 'option-b' }
  ];

  const result = await AggregationEngine.aggregate('voting', results);

  assert.match(result.aggregated_content, /Tie/);
  assert.match(result.aggregated_content, /option-a/);
  assert.match(result.aggregated_content, /option-b/);
});

test('AggregationEngine - consensus identifies common themes', async () => {
  const results = [
    { agent: 'agent-1', content: 'Key Point A\nKey Point B' },
    { agent: 'agent-2', content: 'Key Point A\nKey Point C' },
    { agent: 'agent-3', content: 'Key Point B\nKey Point D' }
  ];

  const result = await AggregationEngine.aggregate('consensus', results);

  assert.equal(result.metadata.strategy, 'consensus');
  assert.match(result.aggregated_content, /Common Themes/);
  assert.match(result.aggregated_content, /Key Point A/);
  assert.match(result.aggregated_content, /Key Point B/);
  assert.equal(result.metadata?.common_themes, 2);
  assert.equal(result.metadata?.unique_points, 2);
});

test('AggregationEngine - custom strategy falls back to concat', async () => {
  const results = [
    { agent: 'agent-1', content: 'Finding A' },
    { agent: 'agent-2', content: 'Finding B' }
  ];

  const result = await AggregationEngine.aggregate('custom', results, {
    customPrompt: 'aggregation-prompts/custom.md'
  });

  assert.equal(result.metadata.strategy, 'custom');
  assert.equal(result.metadata?.strategy_type, 'custom');
  assert.match(result.aggregated_content, /Phase 2/);
  assert.match(result.aggregated_content, /Fallback/);
});

/**
 * ===========================================================================
 * DISTRIBUTION ENGINE TESTS
 * ===========================================================================
 */

test('DistributionEngine - equal strategy produces N equal subtasks', async () => {
  const result = await DistributionEngine.distribute(
    'equal',
    'Analyze market trends in US, EU, Asia, and emerging markets',
    ['expert-1', 'expert-2', 'expert-3', 'expert-4'],
    { subtaskCount: 4 }
  );

  assert.equal(result.subtask_count, 4);
  assert.equal(result.subtasks.length, 4);
  assert.equal(result.metadata?.strategy, 'equal');
});

test('DistributionEngine - equal assigns subtasks in round-robin order', async () => {
  const result = await DistributionEngine.distribute(
    'equal',
    'Large task description for analysis',
    ['expert-a', 'expert-b', 'expert-c'],
    { subtaskCount: 6 }
  );

  const agents = result.subtasks.map(s => s.assigned_agent);
  assert.equal(agents[0], 'expert-a');
  assert.equal(agents[1], 'expert-b');
  assert.equal(agents[2], 'expert-c');
  assert.equal(agents[3], 'expert-a'); // Wraps around
  assert.equal(agents[4], 'expert-b');
  assert.equal(agents[5], 'expert-c');
});

test('DistributionEngine - equal creates properly formatted subtask IDs', async () => {
  const result = await DistributionEngine.distribute(
    'equal',
    'Task to distribute',
    ['expert-1', 'expert-2'],
    { subtaskCount: 3 }
  );

  assert.equal(result.subtasks[0].id, 'subtask-1');
  assert.equal(result.subtasks[1].id, 'subtask-2');
  assert.equal(result.subtasks[2].id, 'subtask-3');
});

test('DistributionEngine - equal defaults to agent count', async () => {
  const result = await DistributionEngine.distribute(
    'equal',
    'Task description',
    ['expert-1', 'expert-2', 'expert-3']
  );

  assert.equal(result.subtask_count, 3);
  assert.equal(result.subtasks.length, 3);
});

test('DistributionEngine - weighted defaults to equal in Phase 1', async () => {
  const result = await DistributionEngine.distribute(
    'weighted',
    'Task for weighted distribution',
    ['expert-1', 'expert-2'],
    { subtaskCount: 2 }
  );

  assert.equal(result.subtask_count, 2);
  assert.equal(result.subtasks.length, 2);
  assert.equal(result.subtasks[0].assigned_agent, 'expert-1');
  assert.equal(result.subtasks[1].assigned_agent, 'expert-2');
});

test('DistributionEngine - adaptive defaults to equal in Phase 1', async () => {
  const result = await DistributionEngine.distribute(
    'adaptive',
    'Complex task for adaptive distribution',
    ['specialist-1', 'specialist-2'],
    { subtaskCount: 2 }
  );

  assert.equal(result.subtask_count, 2);
  assert.equal(result.subtasks.length, 2);
  assert.equal(result.subtasks[0].assigned_agent, 'specialist-1');
  assert.equal(result.subtasks[1].assigned_agent, 'specialist-2');
});

test('DistributionEngine - custom defaults to equal in Phase 1', async () => {
  const result = await DistributionEngine.distribute(
    'custom',
    'Task for custom distribution',
    ['expert-1', 'expert-2'],
    {
      customPrompt: 'distribution-prompts/custom.md',
      subtaskCount: 2
    }
  );

  assert.equal(result.subtask_count, 2);
  assert.equal(result.metadata?.strategy, 'custom');
  assert.equal(result.subtasks.length, 2);
});

/**
 * ===========================================================================
 * MESH VALIDATOR - ENSEMBLE TESTS
 * ===========================================================================
 */

test('MeshValidator - Ensemble validates valid configuration', () => {
  const mockMesh = {
    mesh: 'test-ensemble',
    agents: [
      { name: 'agent-a', model: 'sonnet' as const, prompt: 'a.md' },
      { name: 'agent-b', model: 'sonnet' as const, prompt: 'b.md' },
      { name: 'agent-c', model: 'sonnet' as const, prompt: 'c.md' }
    ]
  };

  const result = MeshValidator.validate({
    ...mockMesh,
    ensemble: {
      agents: ['agent-a', 'agent-b', 'agent-c'],
      aggregation_strategy: 'concat'
    }
  }, 'test.yaml');

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('MeshValidator - Ensemble rejects non-existent agents', () => {
  const mockMesh = {
    mesh: 'test-ensemble',
    agents: [
      { name: 'agent-a', model: 'sonnet' as const, prompt: 'a.md' },
      { name: 'agent-b', model: 'sonnet' as const, prompt: 'b.md' }
    ]
  };

  const result = MeshValidator.validate({
    ...mockMesh,
    ensemble: {
      agents: ['agent-a', 'nonexistent-agent'],
      aggregation_strategy: 'concat'
    }
  }, 'test.yaml');

  assert.equal(result.valid, false);
  assert(result.errors.some(e => e.includes('nonexistent-agent')));
});

test('MeshValidator - Ensemble rejects invalid aggregation_strategy', () => {
  const mockMesh = {
    mesh: 'test-ensemble',
    agents: [
      { name: 'agent-a', model: 'sonnet' as const, prompt: 'a.md' },
      { name: 'agent-b', model: 'sonnet' as const, prompt: 'b.md' }
    ]
  };

  const result = MeshValidator.validate({
    ...mockMesh,
    ensemble: {
      agents: ['agent-a', 'agent-b'],
      aggregation_strategy: 'invalid-strategy' as any
    }
  }, 'test.yaml');

  assert.equal(result.valid, false);
  assert(result.errors.some(e => e.includes('aggregation_strategy')));
});

test('MeshValidator - Ensemble rejects custom without aggregation_prompt', () => {
  const mockMesh = {
    mesh: 'test-ensemble',
    agents: [
      { name: 'agent-a', model: 'sonnet' as const, prompt: 'a.md' },
      { name: 'agent-b', model: 'sonnet' as const, prompt: 'b.md' }
    ]
  };

  const result = MeshValidator.validate({
    ...mockMesh,
    ensemble: {
      agents: ['agent-a', 'agent-b'],
      aggregation_strategy: 'custom'
    }
  }, 'test.yaml');

  assert.equal(result.valid, false);
  assert(result.errors.some(e => e.includes('aggregation_prompt')));
});

test('MeshValidator - Ensemble accepts custom with aggregation_prompt', () => {
  const mockMesh = {
    mesh: 'test-ensemble',
    agents: [
      { name: 'agent-a', model: 'sonnet' as const, prompt: 'a.md' },
      { name: 'agent-b', model: 'sonnet' as const, prompt: 'b.md' }
    ]
  };

  const result = MeshValidator.validate({
    ...mockMesh,
    ensemble: {
      agents: ['agent-a', 'agent-b'],
      aggregation_strategy: 'custom',
      aggregation_prompt: 'aggregation.md'
    }
  }, 'test.yaml');

  assert.equal(result.valid, true);
});

test('MeshValidator - Ensemble validates timeout_ms range', () => {
  const mockMesh = {
    mesh: 'test-ensemble',
    agents: [
      { name: 'agent-a', model: 'sonnet' as const, prompt: 'a.md' }
    ]
  };

  const validResult = MeshValidator.validate({
    ...mockMesh,
    ensemble: {
      agents: ['agent-a'],
      aggregation_strategy: 'concat',
      timeout_ms: 60000
    }
  }, 'test.yaml');

  assert.equal(validResult.valid, true);

  const tooLowResult = MeshValidator.validate({
    ...mockMesh,
    ensemble: {
      agents: ['agent-a'],
      aggregation_strategy: 'concat',
      timeout_ms: 50
    }
  }, 'test.yaml');

  assert.equal(tooLowResult.valid, false);
});

test('MeshValidator - Ensemble validates fault_tolerance.min_success_count', () => {
  const mockMesh = {
    mesh: 'test-ensemble',
    agents: [
      { name: 'agent-a', model: 'sonnet' as const, prompt: 'a.md' },
      { name: 'agent-b', model: 'sonnet' as const, prompt: 'b.md' },
      { name: 'agent-c', model: 'sonnet' as const, prompt: 'c.md' }
    ]
  };

  const validResult = MeshValidator.validate({
    ...mockMesh,
    ensemble: {
      agents: ['agent-a', 'agent-b', 'agent-c'],
      aggregation_strategy: 'concat',
      fault_tolerance: {
        min_success_count: 2
      }
    }
  }, 'test.yaml');

  assert.equal(validResult.valid, true);

  const invalidResult = MeshValidator.validate({
    ...mockMesh,
    ensemble: {
      agents: ['agent-a', 'agent-b'],
      aggregation_strategy: 'concat',
      fault_tolerance: {
        min_success_count: 5
      }
    }
  }, 'test.yaml');

  assert.equal(invalidResult.valid, false);
});

/**
 * ===========================================================================
 * MESH VALIDATOR - TASK DISTRIBUTION TESTS
 * ===========================================================================
 */

test('MeshValidator - TaskDistribution validates valid configuration', () => {
  const mockMesh = {
    mesh: 'test-distribution',
    agents: [
      { name: 'spawner', model: 'sonnet' as const, prompt: 'spawner.md' },
      { name: 'worker-1', model: 'haiku' as const, prompt: 'worker.md' },
      { name: 'worker-2', model: 'haiku' as const, prompt: 'worker.md' },
      { name: 'reviewer', model: 'opus' as const, prompt: 'reviewer.md' }
    ]
  };

  const result = MeshValidator.validate({
    ...mockMesh,
    task_distribution: {
      spawner: 'spawner',
      subagents: ['worker-1', 'worker-2'],
      reviewer: 'reviewer',
      distribution_strategy: 'equal'
    }
  }, 'test.yaml');

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('MeshValidator - TaskDistribution rejects missing spawner', () => {
  const mockMesh = {
    mesh: 'test-distribution',
    agents: [
      { name: 'worker-1', model: 'haiku' as const, prompt: 'worker.md' },
      { name: 'reviewer', model: 'opus' as const, prompt: 'reviewer.md' }
    ]
  };

  const result = MeshValidator.validate({
    ...mockMesh,
    task_distribution: {
      spawner: undefined,
      subagents: ['worker-1'],
      reviewer: 'reviewer',
      distribution_strategy: 'equal'
    } as any
  }, 'test.yaml');

  assert.equal(result.valid, false);
  assert(result.errors.some(e => e.includes('spawner')));
});

test('MeshValidator - TaskDistribution rejects non-existent spawner', () => {
  const mockMesh = {
    mesh: 'test-distribution',
    agents: [
      { name: 'worker-1', model: 'haiku' as const, prompt: 'worker.md' },
      { name: 'reviewer', model: 'opus' as const, prompt: 'reviewer.md' }
    ]
  };

  const result = MeshValidator.validate({
    ...mockMesh,
    task_distribution: {
      spawner: 'nonexistent',
      subagents: ['worker-1'],
      reviewer: 'reviewer',
      distribution_strategy: 'equal'
    }
  }, 'test.yaml');

  assert.equal(result.valid, false);
  assert(result.errors.some(e => e.includes('spawner')));
});

test('MeshValidator - TaskDistribution rejects invalid distribution_strategy', () => {
  const mockMesh = {
    mesh: 'test-distribution',
    agents: [
      { name: 'spawner', model: 'sonnet' as const, prompt: 'spawner.md' },
      { name: 'worker-1', model: 'haiku' as const, prompt: 'worker.md' },
      { name: 'reviewer', model: 'opus' as const, prompt: 'reviewer.md' }
    ]
  };

  const result = MeshValidator.validate({
    ...mockMesh,
    task_distribution: {
      spawner: 'spawner',
      subagents: ['worker-1'],
      reviewer: 'reviewer',
      distribution_strategy: 'invalid' as any
    }
  }, 'test.yaml');

  assert.equal(result.valid, false);
  assert(result.errors.some(e => e.includes('distribution_strategy')));
});

test('MeshValidator - TaskDistribution validates subtask_count', () => {
  const mockMesh = {
    mesh: 'test-distribution',
    agents: [
      { name: 'spawner', model: 'sonnet' as const, prompt: 'spawner.md' },
      { name: 'worker-1', model: 'haiku' as const, prompt: 'worker.md' },
      { name: 'worker-2', model: 'haiku' as const, prompt: 'worker.md' },
      { name: 'reviewer', model: 'opus' as const, prompt: 'reviewer.md' }
    ]
  };

  const validResult = MeshValidator.validate({
    ...mockMesh,
    task_distribution: {
      spawner: 'spawner',
      subagents: ['worker-1', 'worker-2'],
      reviewer: 'reviewer',
      distribution_strategy: 'equal',
      subtask_count: 4
    }
  }, 'test.yaml');

  assert.equal(validResult.valid, true);

  const invalidResult = MeshValidator.validate({
    ...mockMesh,
    task_distribution: {
      spawner: 'spawner',
      subagents: ['worker-1'],
      reviewer: 'reviewer',
      distribution_strategy: 'equal',
      subtask_count: 0
    }
  }, 'test.yaml');

  assert.equal(invalidResult.valid, false);
});
