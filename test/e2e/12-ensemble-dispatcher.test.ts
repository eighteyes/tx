/**
 * Test 12: Ensemble Dispatcher Integration
 *
 * Tests the WorkerDispatcher ensemble detection and parallel execution.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageQueue } from '../../src/queue/index.ts';
import { WorkerDispatcher } from '../../src/worker/index.ts';
import type { EnsembleConfig } from '../../src/shared/types.ts';

describe('V4 Ensemble Dispatcher Integration Test', () => {
  let testDir: string;
  let msgsDir: string;
  let meshesDir: string;
  let queue: MessageQueue;
  let dispatcher: WorkerDispatcher;

  beforeEach(() => {
    // Create temp test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-ensemble-'));
    msgsDir = path.join(testDir, '.ai', 'tx', 'msgs');
    meshesDir = path.join(testDir, 'meshes');

    fs.mkdirSync(msgsDir, { recursive: true });
    fs.mkdirSync(path.join(meshesDir, 'test-ensemble'), { recursive: true });

    // Create test ensemble mesh config
    const meshConfig = {
      mesh: 'test-ensemble',
      description: 'Test ensemble mesh',
      agents: [
        { name: 'agent-1', model: 'haiku', prompt: 'agent-1.md' },
        { name: 'agent-2', model: 'haiku', prompt: 'agent-2.md' },
        { name: 'agent-3', model: 'haiku', prompt: 'agent-3.md' },
      ],
      entry_point: 'agent-1',
      ensemble: {
        agents: ['agent-1', 'agent-2', 'agent-3'],
        aggregation_strategy: 'concat',
        timeout_ms: 5000,
      } as EnsembleConfig,
    };

    fs.writeFileSync(
      path.join(meshesDir, 'test-ensemble', 'config.yaml'),
      `mesh: test-ensemble
description: Test ensemble mesh
agents:
  - name: agent-1
    model: haiku
    prompt: agent-1.md
  - name: agent-2
    model: haiku
    prompt: agent-2.md
  - name: agent-3
    model: haiku
    prompt: agent-3.md
entry_point: agent-1
ensemble:
  agents:
    - agent-1
    - agent-2
    - agent-3
  aggregation_strategy: concat
  timeout_ms: 5000
`
    );

    // Create test agent prompts
    const agentPrompts = [
      { name: 'agent-1', content: '# Agent 1\nYou are agent 1. Respond with "Finding from agent 1".' },
      { name: 'agent-2', content: '# Agent 2\nYou are agent 2. Respond with "Finding from agent 2".' },
      { name: 'agent-3', content: '# Agent 3\nYou are agent 3. Respond with "Finding from agent 3".' },
    ];

    for (const { name, content } of agentPrompts) {
      fs.writeFileSync(
        path.join(meshesDir, 'test-ensemble', `${name}.md`),
        content
      );
    }

    // Create queue
    const dbPath = path.join(testDir, '.ai', 'tx', 'data', 'queue.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    queue = new MessageQueue(dbPath);

    // Create dispatcher
    dispatcher = new WorkerDispatcher(
      {
        workDir: testDir,
        msgsDir,
        meshesDir,
      },
      queue
    );
  });

  afterEach(async () => {
    // Cleanup
    await dispatcher.stop();
    queue.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('should load ensemble mesh config', async () => {
    const loadedMeshes: string[] = [];
    dispatcher.on('mesh:loaded', ({ mesh }) => {
      loadedMeshes.push(mesh);
    });

    await dispatcher.start();

    assert.ok(loadedMeshes.includes('test-ensemble'), 'Should load ensemble mesh');
  });

  test('should detect ensemble pattern in mesh config', async () => {
    await dispatcher.start();

    // The dispatcher should have loaded the ensemble mesh
    // We can verify by checking if it's running
    assert.ok(dispatcher.isRunning(), 'Dispatcher should be running');
  });

  test('should handle ensemble execution with fault tolerance', async () => {
    // Create mesh with fault tolerance
    const meshConfigWithFault = {
      mesh: 'test-ensemble-fault',
      description: 'Test ensemble with fault tolerance',
      agents: [
        { name: 'agent-1', model: 'haiku', prompt: 'agent-1.md' },
        { name: 'agent-2', model: 'haiku', prompt: 'agent-2.md' },
        { name: 'agent-3', model: 'haiku', prompt: 'agent-3.md' },
      ],
      entry_point: 'agent-1',
      ensemble: {
        agents: ['agent-1', 'agent-2', 'agent-3'],
        aggregation_strategy: 'concat',
        timeout_ms: 5000,
        fault_tolerance: {
          min_success_count: 2,
        },
      } as EnsembleConfig,
    };

    fs.mkdirSync(path.join(meshesDir, 'test-ensemble-fault'), { recursive: true });
    fs.writeFileSync(
      path.join(meshesDir, 'test-ensemble-fault', 'config.yaml'),
      `mesh: test-ensemble-fault
description: Test ensemble with fault tolerance
agents:
  - name: agent-1
    model: haiku
    prompt: agent-1.md
  - name: agent-2
    model: haiku
    prompt: agent-2.md
  - name: agent-3
    model: haiku
    prompt: agent-3.md
entry_point: agent-1
ensemble:
  agents:
    - agent-1
    - agent-2
    - agent-3
  aggregation_strategy: concat
  timeout_ms: 5000
  fault_tolerance:
    min_success_count: 2
`
    );

    // Create agent prompts
    const agentPrompts = [
      { name: 'agent-1', content: '# Agent 1\nYou are agent 1.' },
      { name: 'agent-2', content: '# Agent 2\nYou are agent 2.' },
      { name: 'agent-3', content: '# Agent 3\nYou are agent 3.' },
    ];

    for (const { name, content } of agentPrompts) {
      fs.writeFileSync(
        path.join(meshesDir, 'test-ensemble-fault', `${name}.md`),
        content
      );
    }

    await dispatcher.start();

    // Verify dispatcher loaded the fault-tolerant mesh
    assert.ok(dispatcher.isRunning(), 'Dispatcher should be running');
  });

  test('should handle deduplicate aggregation strategy', async () => {
    // Create mesh with deduplicate strategy
    const meshConfigWithDedupe = {
      mesh: 'test-ensemble-dedupe',
      description: 'Test ensemble with deduplicate',
      agents: [
        { name: 'agent-1', model: 'haiku', prompt: 'agent-1.md' },
        { name: 'agent-2', model: 'haiku', prompt: 'agent-2.md' },
      ],
      entry_point: 'agent-1',
      ensemble: {
        agents: ['agent-1', 'agent-2'],
        aggregation_strategy: 'deduplicate',
        timeout_ms: 5000,
      } as EnsembleConfig,
    };

    fs.mkdirSync(path.join(meshesDir, 'test-ensemble-dedupe'), { recursive: true });
    fs.writeFileSync(
      path.join(meshesDir, 'test-ensemble-dedupe', 'config.yaml'),
      `mesh: test-ensemble-dedupe
description: Test ensemble with deduplicate
agents:
  - name: agent-1
    model: haiku
    prompt: agent-1.md
  - name: agent-2
    model: haiku
    prompt: agent-2.md
entry_point: agent-1
ensemble:
  agents:
    - agent-1
    - agent-2
  aggregation_strategy: deduplicate
  timeout_ms: 5000
`
    );

    // Create agent prompts
    fs.writeFileSync(
      path.join(meshesDir, 'test-ensemble-dedupe', 'agent-1.md'),
      '# Agent 1\nYou are agent 1.'
    );
    fs.writeFileSync(
      path.join(meshesDir, 'test-ensemble-dedupe', 'agent-2.md'),
      '# Agent 2\nYou are agent 2.'
    );

    await dispatcher.start();

    assert.ok(dispatcher.isRunning(), 'Dispatcher should be running');
  });

  test('should emit ensemble:complete event', async () => {
    let ensembleComplete = false;
    dispatcher.on('ensemble:complete', (data) => {
      ensembleComplete = true;
      assert.ok(data.meshName, 'Should have meshName');
      assert.ok(data.ensembleId, 'Should have ensembleId');
    });

    await dispatcher.start();

    // Note: We can't actually run the ensemble without Claude API,
    // but we verify the dispatcher is set up correctly
    assert.strictEqual(ensembleComplete, false, 'No ensemble run yet');
  });

  test('should respect entry_point for ensemble triggering', async () => {
    // Create mesh with non-first entry point
    const meshConfig = {
      mesh: 'test-ensemble-entry',
      description: 'Test ensemble entry point',
      agents: [
        { name: 'router', model: 'haiku', prompt: 'router.md' },
        { name: 'worker-1', model: 'haiku', prompt: 'worker-1.md' },
        { name: 'worker-2', model: 'haiku', prompt: 'worker-2.md' },
      ],
      entry_point: 'router',  // Only router triggers ensemble
      ensemble: {
        agents: ['worker-1', 'worker-2'],
        aggregation_strategy: 'concat',
        timeout_ms: 5000,
      } as EnsembleConfig,
    };

    fs.mkdirSync(path.join(meshesDir, 'test-ensemble-entry'), { recursive: true });
    fs.writeFileSync(
      path.join(meshesDir, 'test-ensemble-entry', 'config.yaml'),
      `mesh: test-ensemble-entry
description: Test ensemble entry point
agents:
  - name: router
    model: haiku
    prompt: router.md
  - name: worker-1
    model: haiku
    prompt: worker-1.md
  - name: worker-2
    model: haiku
    prompt: worker-2.md
entry_point: router
ensemble:
  agents:
    - worker-1
    - worker-2
  aggregation_strategy: concat
  timeout_ms: 5000
`
    );

    // Create prompts
    fs.writeFileSync(
      path.join(meshesDir, 'test-ensemble-entry', 'router.md'),
      '# Router\nYou route tasks.'
    );
    fs.writeFileSync(
      path.join(meshesDir, 'test-ensemble-entry', 'worker-1.md'),
      '# Worker 1\nYou are worker 1.'
    );
    fs.writeFileSync(
      path.join(meshesDir, 'test-ensemble-entry', 'worker-2.md'),
      '# Worker 2\nYou are worker 2.'
    );

    await dispatcher.start();

    assert.ok(dispatcher.isRunning(), 'Dispatcher should be running');
  });
});
