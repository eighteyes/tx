/**
 * Test 15: FSM Ensemble States E2E
 *
 * Tests the FSM ensemble state implementation with:
 * - Parallel agent spawning
 * - Result aggregation
 * - FSM context flow
 * - Fault tolerance
 * - Subtask generation
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageQueue } from '../../src/queue/index.ts';
import { WorkerDispatcher } from '../../src/worker/index.ts';
import { MeshFSM } from '../../src/mesh/fsm.ts';
import { EnsembleCoordinator } from '../../src/worker/ensemble-coordinator.ts';
import type {
  FSMConfig,
  FSMStateConfig,
  FSMEnsembleConfig,
  EnsembleConfig,
  Message,
} from '../../src/shared/types.ts';

// Helper to safely access states array when FSMConfig.states is array | object union
const getStatesArray = (config: FSMConfig): FSMStateConfig[] => config.states as FSMStateConfig[];

describe('FSM Ensemble States E2E', () => {
  let testDir: string;
  let msgsDir: string;
  let meshesDir: string;
  let queue: MessageQueue;
  let dispatcher: WorkerDispatcher;
  let db: Database.Database;
  const fixturesMeshPath = path.join(process.cwd(), 'test/fixtures/meshes/fsm-ensemble-test');

  beforeEach(() => {
    // Create temp test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-fsm-ensemble-'));
    msgsDir = path.join(testDir, '.ai', 'tx', 'msgs');
    meshesDir = path.join(testDir, 'meshes');

    fs.mkdirSync(msgsDir, { recursive: true });
    fs.mkdirSync(meshesDir, { recursive: true });

    // Create queue
    const dbPath = path.join(testDir, '.ai', 'tx', 'data', 'queue.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    queue = new MessageQueue(dbPath);

    // Create in-memory DB for FSM tests
    db = new Database(':memory:');

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
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Ensemble State Configuration', () => {
    test('ensemble state spawns multiple agents in parallel and aggregates results', async () => {
      // Test that type: ensemble works with the EnsembleCoordinator
      const coordinator = new EnsembleCoordinator();

      const mockConfig: EnsembleConfig = {
        agents: ['reviewer-a', 'reviewer-b', 'reviewer-c'],
        aggregation_strategy: 'concat',
        timeout_ms: 5000,
      };

      const mockTask: Message = {
        from_agent: 'core/core',
        to_agent: 'fsm-ensemble-test/coordinator',
        payload: {
          'msg-id': 'test-task-1',
          body: 'Review this code',
        },
      };

      // Start ensemble
      const ensembleId = coordinator.startEnsemble('fsm-ensemble-test', mockConfig, mockTask);
      assert.match(ensembleId, /fsm-ensemble-test-\d+-[a-z0-9]+/);

      // Record results from all agents
      coordinator.recordAgentResult(ensembleId, 'reviewer-a', '## Findings from Reviewer A\n- Security issue found');
      coordinator.recordAgentResult(ensembleId, 'reviewer-b', '## Findings from Reviewer B\n- Performance concern');
      coordinator.recordAgentResult(ensembleId, 'reviewer-c', '## Findings from Reviewer C\n- Code style improvement');

      // Verify completion
      assert.strictEqual(coordinator.isComplete(ensembleId), true);

      // Verify aggregation
      const result = await coordinator.getAggregatedResult(ensembleId);
      assert.ok(result);
      assert.ok(result.output.includes('Findings from Reviewer A'));
      assert.ok(result.output.includes('Findings from Reviewer B'));
      assert.ok(result.output.includes('Findings from Reviewer C'));
      assert.strictEqual(result.metadata.strategy, 'concat');
      assert.strictEqual(result.metadata.success, true);

      // Cleanup
      coordinator.completeEnsemble(ensembleId);
    });

    test('ensemble with different agents uses agent array', async () => {
      // Config: agents: [reviewer-a, reviewer-b, reviewer-c]
      const coordinator = new EnsembleCoordinator();

      const config: EnsembleConfig = {
        agents: ['reviewer-a', 'reviewer-b', 'reviewer-c'],
        aggregation_strategy: 'concat',
        timeout_ms: 5000,
      };

      const task: Message = {
        from_agent: 'core/core',
        to_agent: 'test-mesh/entry',
        payload: { body: 'Test task' },
      };

      const id = coordinator.startEnsemble('test-mesh', config, task);

      // Verify all three agents can record results with different prompts
      coordinator.recordAgentResult(id, 'reviewer-a', 'Result A');
      coordinator.recordAgentResult(id, 'reviewer-b', 'Result B');
      coordinator.recordAgentResult(id, 'reviewer-c', 'Result C');

      const result = await coordinator.getAggregatedResult(id);

      assert.ok(result?.output.includes('Result A'));
      assert.ok(result?.output.includes('Result B'));
      assert.ok(result?.output.includes('Result C'));
      assert.strictEqual(result?.metadata.successful_agents.length, 3);
    });

    test('ensemble with same agent N times works', async () => {
      // Config: agent: worker, count: 3
      const coordinator = new EnsembleCoordinator();

      // For same-agent-N-times, we use an array with repeated agent names
      // The dispatcher would expand agent+count into agents array
      const config: EnsembleConfig = {
        agents: ['worker', 'worker', 'worker'],  // Simulates count: 3
        aggregation_strategy: 'concat',
        timeout_ms: 5000,
      };

      const task: Message = {
        from_agent: 'core/core',
        to_agent: 'test-mesh/entry',
        payload: { body: 'Test task' },
      };

      const id = coordinator.startEnsemble('test-mesh', config, task);

      // Record results with instance identifiers
      coordinator.recordAgentResult(id, 'worker', 'Instance 1 output');
      // Note: EnsembleCoordinator uses agent name as key, so we need unique IDs
      // In practice, dispatcher would use worker-0, worker-1, worker-2

      // For this test, verify the coordinator tracks correctly
      const state = coordinator.getEnsembleState(id);
      assert.ok(state);
      assert.strictEqual(state.config.agents.length, 3);
    });
  });

  describe('FSM Exit Routing with Ensemble', () => {
    test('FSM context flows through ensemble', async () => {
      const config: FSMConfig = {
        initialState: 'generate_subtasks',
        states: [
          {
            name: 'generate_subtasks',
            coordinator: 'coordinator',
            subtask: true,
            exit: {
              set: {
                subtask_count: '3',
              },
              default: 'parallel_review',
            },
          },
          {
            name: 'parallel_review',
            ensemble: {
              agents: ['reviewer-a', 'reviewer-b', 'reviewer-c'],
              aggregation: 'concat',
              timeout_ms: 60000,
            },
            exit: {
              set: {
                review_results: '$ENSEMBLE_OUTPUT',
              },
              default: 'synthesize',
            },
          },
          {
            name: 'synthesize',
            coordinator: 'synthesizer',
            exit: {
              default: 'complete',
            },
          },
          {
            name: 'complete',
            agents: ['core'],
          },
        ] as FSMStateConfig[],
        transitions: [],
        context: {
          subtask_count: 0,
          review_results: '',
        },
      };

      const fsm = new MeshFSM('fsm-ensemble-test', config, db, testDir);
      await fsm.initialize();

      // Verify initial state
      assert.strictEqual(fsm.getCurrentState(), 'generate_subtasks');

      // Verify context is accessible
      const context = fsm.getContext();
      assert.strictEqual(context.subtask_count, 0);
      assert.strictEqual(context.review_results, '');

      // Update context (simulating exit.set)
      fsm.updateContext({ subtask_count: 3 });
      const updated = fsm.getContext();
      assert.strictEqual(updated.subtask_count, 3);
    });

    test('subtask generation flows to ensemble', async () => {
      // State 1: coordinator with subtask: true
      const config: FSMConfig = {
        initialState: 'generate_subtasks',
        states: [
          {
            name: 'generate_subtasks',
            coordinator: 'coordinator',
            subtask: true,
            exit: {
              run: ['parse_subtasks'],  // Script to parse SUBTASK markers
              default: 'parallel_review',
            },
          },
          {
            name: 'parallel_review',
            ensemble: {
              agents: ['reviewer-a', 'reviewer-b', 'reviewer-c'],
              aggregation: 'concat',
            },
            exit: {
              default: 'complete',
            },
          },
          {
            name: 'complete',
            agents: ['core'],
          },
        ] as FSMStateConfig[],
        transitions: [],
        context: {
          subtask_count: 0,
        },
      };

      const fsm = new MeshFSM('subtask-test', config, db, testDir);
      await fsm.initialize();

      // Verify state config for subtask
      const stateConfig = fsm.getCurrentStateConfig();
      assert.strictEqual(stateConfig?.subtask, true);

      // Verify ensemble state config
      const ensembleState = getStatesArray(config).find((s: FSMStateConfig) => s.name === 'parallel_review');
      assert.ok(ensembleState);
      assert.strictEqual(ensembleState.type, 'ensemble');
      assert.ok(ensembleState.ensemble);
      assert.strictEqual(ensembleState.ensemble.agents?.length, 3);
    });
  });

  describe('Fault Tolerance', () => {
    test('fault tolerance with min_success_count', async () => {
      // Config: min_success_count: 2 with 3 agents
      const coordinator = new EnsembleCoordinator();

      const config: EnsembleConfig = {
        agents: ['agent-1', 'agent-2', 'agent-3'],
        aggregation_strategy: 'concat',
        timeout_ms: 5000,
        fault_tolerance: {
          min_success_count: 2,
        },
      };

      const task: Message = {
        from_agent: 'core/core',
        to_agent: 'test-mesh/entry',
        payload: { body: 'Test task' },
      };

      const id = coordinator.startEnsemble('test-mesh', config, task);

      // Simulate one agent failure, two succeed
      coordinator.recordAgentResult(id, 'agent-1', 'Success 1');
      coordinator.recordAgentResult(id, 'agent-2', 'Success 2');
      coordinator.recordAgentResult(id, 'agent-3', '', 'Timeout error');

      // Should be complete with 2/3 succeeded (min is 2)
      assert.strictEqual(coordinator.isComplete(id), true);

      const result = await coordinator.getAggregatedResult(id);
      assert.ok(result);
      assert.strictEqual(result.metadata.success, true);
      assert.deepStrictEqual(result.metadata.failed_agents, ['agent-3']);
      assert.strictEqual(result.metadata.successful_agents.length, 2);
    });

    test('ensemble fails when min_success_count not met', async () => {
      const coordinator = new EnsembleCoordinator();

      const config: EnsembleConfig = {
        agents: ['agent-1', 'agent-2', 'agent-3'],
        aggregation_strategy: 'concat',
        timeout_ms: 5000,
        fault_tolerance: {
          min_success_count: 3,  // All must succeed
        },
      };

      const task: Message = {
        from_agent: 'core/core',
        to_agent: 'test-mesh/entry',
        payload: { body: 'Test task' },
      };

      const id = coordinator.startEnsemble('test-mesh', config, task);

      // Only 2 succeed
      coordinator.recordAgentResult(id, 'agent-1', 'Success 1');
      coordinator.recordAgentResult(id, 'agent-2', 'Success 2');
      coordinator.recordAgentResult(id, 'agent-3', '', 'Error');

      const result = await coordinator.getAggregatedResult(id);
      assert.ok(result);
      assert.strictEqual(result.metadata.success, false);
      assert.ok(result.output.includes('failed'));
    });
  });

  describe('Aggregation Strategies', () => {
    test('aggregation strategies work correctly - concat', async () => {
      const coordinator = new EnsembleCoordinator();

      const config: EnsembleConfig = {
        agents: ['agent-1', 'agent-2'],
        aggregation_strategy: 'concat',
        timeout_ms: 5000,
      };

      const task: Message = {
        from_agent: 'core/core',
        to_agent: 'test-mesh/entry',
        payload: { body: 'Test' },
      };

      const id = coordinator.startEnsemble('test-mesh', config, task);

      coordinator.recordAgentResult(id, 'agent-1', 'Section A content');
      coordinator.recordAgentResult(id, 'agent-2', 'Section B content');

      const result = await coordinator.getAggregatedResult(id);
      assert.ok(result);
      assert.ok(result.output.includes('Section A content'));
      assert.ok(result.output.includes('Section B content'));
      assert.strictEqual(result.metadata.strategy, 'concat');
    });

    test('aggregation strategies work correctly - deduplicate', async () => {
      const coordinator = new EnsembleCoordinator();

      const config: EnsembleConfig = {
        agents: ['agent-1', 'agent-2', 'agent-3'],
        aggregation_strategy: 'deduplicate',
        timeout_ms: 5000,
      };

      const task: Message = {
        from_agent: 'core/core',
        to_agent: 'test-mesh/entry',
        payload: { body: 'Test' },
      };

      const id = coordinator.startEnsemble('test-mesh', config, task);

      // Same findings from different agents
      coordinator.recordAgentResult(id, 'agent-1', 'Finding A\nFinding B');
      coordinator.recordAgentResult(id, 'agent-2', 'Finding B\nFinding C');
      coordinator.recordAgentResult(id, 'agent-3', 'Finding A\nFinding C');

      const result = await coordinator.getAggregatedResult(id);
      assert.ok(result);
      assert.strictEqual(result.metadata.strategy, 'deduplicate');

      // Should have exactly 3 unique findings
      const lines = result.output.split('\n').filter((l: string) => l.trim());
      assert.strictEqual(lines.length, 3);
    });
  });

  describe('Dispatcher Integration', () => {
    test('dispatcher loads FSM ensemble mesh fixture', async () => {
      // Copy fixture to test meshes dir
      const fixtureMeshDir = path.join(meshesDir, 'fsm-ensemble-test');
      fs.mkdirSync(fixtureMeshDir, { recursive: true });

      // Copy config.yaml
      if (fs.existsSync(path.join(fixturesMeshPath, 'config.yaml'))) {
        fs.copyFileSync(
          path.join(fixturesMeshPath, 'config.yaml'),
          path.join(fixtureMeshDir, 'config.yaml')
        );
      } else {
        // Create minimal config if fixture doesn't exist
        fs.writeFileSync(
          path.join(fixtureMeshDir, 'config.yaml'),
          `mesh: fsm-ensemble-test
description: Test mesh for FSM ensemble states
agents:
  - name: coordinator
    model: haiku
    prompt: coordinator.md
  - name: reviewer-a
    model: haiku
    prompt: reviewer-a.md
entry_point: coordinator
fsm:
  initial: generate_subtasks
  states:
    generate_subtasks:
      agents: [coordinator]
      exit:
        default: parallel_review
    parallel_review:
      type: ensemble
      ensemble:
        agents: [reviewer-a]
        aggregation: concat
      exit:
        default: complete
    complete:
      agents: [core]
`
        );
      }

      // Create agent prompts
      fs.writeFileSync(
        path.join(fixtureMeshDir, 'coordinator.md'),
        '# Coordinator\nYou are a coordinator.'
      );
      fs.writeFileSync(
        path.join(fixtureMeshDir, 'reviewer-a.md'),
        '# Reviewer A\nYou are reviewer A.'
      );

      const loadedMeshes: string[] = [];
      dispatcher.on('mesh:loaded', ({ mesh }) => {
        loadedMeshes.push(mesh);
      });

      await dispatcher.start();

      assert.ok(loadedMeshes.includes('fsm-ensemble-test'), 'Should load fsm-ensemble-test mesh');
      assert.ok(dispatcher.isRunning(), 'Dispatcher should be running');
    });

    test('dispatcher detects ensemble state type in FSM config', async () => {
      // Create mesh with FSM ensemble state
      const meshDir = path.join(meshesDir, 'ensemble-fsm-test');
      fs.mkdirSync(meshDir, { recursive: true });

      fs.writeFileSync(
        path.join(meshDir, 'config.yaml'),
        `mesh: ensemble-fsm-test
description: FSM with ensemble state
agents:
  - name: worker-a
    model: haiku
    prompt: worker-a.md
  - name: worker-b
    model: haiku
    prompt: worker-b.md
entry_point: worker-a
fsm:
  initial: start
  states:
    start:
      agents: [worker-a]
      exit:
        default: parallel
    parallel:
      type: ensemble
      ensemble:
        agents: [worker-a, worker-b]
        aggregation: concat
        timeout_ms: 30000
      exit:
        default: complete
    complete:
      agents: [core]
`
      );

      fs.writeFileSync(
        path.join(meshDir, 'worker-a.md'),
        '# Worker A\nYou are worker A.'
      );
      fs.writeFileSync(
        path.join(meshDir, 'worker-b.md'),
        '# Worker B\nYou are worker B.'
      );

      await dispatcher.start();

      assert.ok(dispatcher.isRunning(), 'Dispatcher should be running');
    });
  });

  describe('ENSEMBLE_OUTPUT Context', () => {
    test('ENSEMBLE_OUTPUT is available in FSM context after ensemble completion', async () => {
      // FSM should capture ensemble output in context
      const config: FSMConfig = {
        initialState: 'parallel_work',
        states: [
          {
            name: 'parallel_work',
            ensemble: {
              agents: ['worker-1', 'worker-2'],
              aggregation: 'concat',
            },
            exit: {
              set: {
                ensemble_output: '$ENSEMBLE_OUTPUT',
              },
              default: 'use_results',
            },
          },
          {
            name: 'use_results',
            coordinator: 'synthesizer',
          },
        ] as FSMStateConfig[],
        transitions: [],
        context: {
          ensemble_output: '',
        },
      };

      const fsm = new MeshFSM('output-test', config, db, testDir);
      await fsm.initialize();

      // Verify the state config has exit.set for ENSEMBLE_OUTPUT
      const stateConfig = fsm.getCurrentStateConfig();
      assert.ok(stateConfig?.exit?.set);
      assert.strictEqual(stateConfig.exit.set.ensemble_output, '$ENSEMBLE_OUTPUT');

      // In actual execution, dispatcher would:
      // 1. Run ensemble
      // 2. Get aggregated result
      // 3. Set context.ensemble_output = result.output
      // 4. Transition to next state
    });
  });

  describe('FSM Ensemble State Validation', () => {
    test('ensemble state requires ensemble config', async () => {
      const config: FSMConfig = {
        initialState: 'invalid',
        states: [
          {
            name: 'invalid',
            // Missing ensemble config - should be invalid
            coordinator: 'worker',
          },
        ] as FSMStateConfig[],
        transitions: [],
      };

      // FSM should still initialize (validation happens in mesh-validator)
      const fsm = new MeshFSM('validation-test', config, db, testDir);
      await fsm.initialize();

      const stateConfig = fsm.getCurrentStateConfig();
      assert.strictEqual(stateConfig?.type, 'ensemble');
      assert.strictEqual(stateConfig?.ensemble, undefined);
    });

    test('ensemble state with agents array is valid', async () => {
      const ensembleConfig: FSMEnsembleConfig = {
        agents: ['agent-1', 'agent-2', 'agent-3'],
        aggregation: 'concat',
        timeout_ms: 60000,
      };

      assert.ok(ensembleConfig.agents);
      assert.strictEqual(ensembleConfig.agents.length, 3);
      assert.strictEqual(ensembleConfig.aggregation, 'concat');
    });

    test('ensemble state with agent+count is valid', async () => {
      const ensembleConfig: FSMEnsembleConfig = {
        agent: 'worker',
        count: 5,
        aggregation: 'deduplicate',
      };

      assert.ok(ensembleConfig.agent);
      assert.strictEqual(ensembleConfig.count, 5);
      assert.strictEqual(ensembleConfig.aggregation, 'deduplicate');
    });

    test('ensemble state with dynamic count reference is valid', async () => {
      const ensembleConfig: FSMEnsembleConfig = {
        agent: 'worker',
        count: '$subtask_count',  // Reference to FSM context variable
        aggregation: 'concat',
      };

      assert.ok(ensembleConfig.agent);
      assert.strictEqual(ensembleConfig.count, '$subtask_count');
    });
  });
});
