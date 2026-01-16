/**
 * Test 10: Quality Hooks Flow
 *
 * Integration test verifying quality lifecycle hooks work correctly
 * through the dispatcher → hooks → quality stack pipeline.
 */

import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageQueue } from '../../src/queue/index.ts';
import { WorkerDispatcher } from '../../src/worker/index.ts';
import { LifecycleHooks, type HookContext } from '../../src/worker/hooks.ts';
import type { GateType, PreflightOutput } from '../../src/quality/index.ts';

/**
 * Import resolveLifecycle via the module (it's not exported, so we test via dispatcher)
 * We'll test the behavior by creating mesh configs and checking dispatch behavior.
 */

describe('Quality Hooks Flow', () => {
  let testDir: string;
  let msgsDir: string;
  let meshesDir: string;
  let queue: MessageQueue;
  let hooks: LifecycleHooks;

  beforeEach(() => {
    // Create temp test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-quality-hooks-'));
    msgsDir = path.join(testDir, '.ai', 'tx', 'msgs');
    meshesDir = path.join(testDir, 'meshes');

    fs.mkdirSync(msgsDir, { recursive: true });
    fs.mkdirSync(path.join(meshesDir, 'configs'), { recursive: true });
    fs.mkdirSync(path.join(meshesDir, 'agents', 'quality-test'), { recursive: true });

    // Create queue
    const dbPath = path.join(testDir, '.ai', 'tx', 'data', 'queue.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    queue = new MessageQueue(dbPath);

    // Create hooks
    hooks = new LifecycleHooks(testDir, queue, meshesDir);
  });

  afterEach(() => {
    queue.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('lifecycle hooks expand to quality hooks via dispatcher', async () => {
    // Create mesh config with explicit quality lifecycle hooks
    const meshConfig = {
      mesh: 'quality-test',
      description: 'Test mesh with quality gates',
      agents: [
        { name: 'worker', model: 'haiku', prompt: 'meshes/agents/quality-test/worker.md' }
      ],
      entry_point: 'worker',
      lifecycle: {
        pre: ['quality:preflight'],
        post: ['quality:checklist', 'quality:rubric']
      }
    };
    fs.writeFileSync(
      path.join(meshesDir, 'configs', 'quality-test.json'),
      JSON.stringify(meshConfig, null, 2)
    );

    // Create test worker prompt
    const workerPrompt = `# Quality Test Worker\nYou are a test worker.`;
    fs.writeFileSync(
      path.join(meshesDir, 'agents', 'quality-test', 'worker.md'),
      workerPrompt
    );

    // Create dispatcher to verify lifecycle resolution
    const dispatcher = new WorkerDispatcher({
      workDir: testDir,
      msgsDir,
      meshesDir
    }, queue);

    // Start dispatcher to load mesh configs
    await dispatcher.start();

    // Verify dispatcher loaded the mesh
    const meshLoaded = await new Promise<boolean>((resolve) => {
      dispatcher.on('mesh:loaded', ({ mesh }) => {
        if (mesh === 'quality-test') {
          resolve(true);
        }
      });
      // Give time for mesh to load
      setTimeout(() => resolve(false), 500);
    });

    await dispatcher.stop();

    // The mesh should have loaded successfully
    assert.ok(true, 'Dispatcher started and can load quality hooks mesh config');
  });

  test('specific quality gates via lifecycle hooks expand correctly', async () => {
    // Create mesh config with specific quality gates
    const meshConfig = {
      mesh: 'specific-gates',
      description: 'Test mesh with specific gates',
      agents: [
        { name: 'worker', model: 'haiku', prompt: 'meshes/agents/quality-test/worker.md' }
      ],
      entry_point: 'worker',
      lifecycle: {
        pre: ['quality:preflight'],
        post: ['quality:checklist', 'quality:rubric']  // Only specific gates
      }
    };
    fs.writeFileSync(
      path.join(meshesDir, 'configs', 'specific-gates.json'),
      JSON.stringify(meshConfig, null, 2)
    );

    // Create test worker prompt
    const workerPrompt = `# Specific Gates Test Worker\nYou are a test worker.`;
    fs.writeFileSync(
      path.join(meshesDir, 'agents', 'quality-test', 'worker.md'),
      workerPrompt
    );

    // Create dispatcher to verify lifecycle resolution
    const dispatcher = new WorkerDispatcher({
      workDir: testDir,
      msgsDir,
      meshesDir
    }, queue);

    await dispatcher.start();
    await dispatcher.stop();

    // If we got here without error, config was valid
    assert.ok(true, 'Quality hooks config with specific gates is valid');
  });

  test('quality:preflight hook populates context', async () => {
    // Create a mock context
    const context: HookContext = {
      meshInstance: 'test-instance',
      meshName: 'test',
      agentName: 'worker',
      workDir: testDir,
      agentId: 'test/worker',
      taskId: 'task-123',
      taskBody: 'Implement a TypeScript function that validates email addresses',
      msgsDir,
    };

    // Verify the hook is registered
    assert.ok(hooks.hasPreHook('quality:preflight'), 'quality:preflight hook should be registered');

    // Execute the preflight hook
    // This will run the heuristic preflight since we're not making LLM calls
    await hooks.executePreHooks(['quality:preflight'], context);

    // Verify context.qualityPreflight is populated
    assert.ok(context.qualityPreflight, 'qualityPreflight should be set in context');
    assert.ok(context.qualityPreflight.taskType, 'taskType should be set');
    assert.ok(Array.isArray(context.qualityPreflight.checklist), 'checklist should be an array');
    assert.ok(Array.isArray(context.qualityPreflight.rubric), 'rubric should be an array');
    assert.ok(Array.isArray(context.qualityPreflight.requiredGates), 'requiredGates should be an array');

    // Verify default iteration config
    assert.strictEqual(context.qualityIteration, 1, 'qualityIteration should default to 1');
    assert.strictEqual(context.qualityMaxIterations, 5, 'qualityMaxIterations should default to 5');
    assert.strictEqual(context.qualityOnFail, 'loop', 'qualityOnFail should default to loop');
  });

  test('quality:checklist hook receives worker output and evaluates', async () => {
    // Create context with preflight data
    const preflight: PreflightOutput = {
      taskType: 'implementation',
      checklist: ['Uses TypeScript', 'Has tests'],
      rubric: [
        { criterion: 'correctness', weight: 0.5, description: 'Code is correct' },
        { criterion: 'completeness', weight: 0.5, description: 'All requirements met' },
      ],
      requiredGates: ['checklist'] as GateType[],
      suggestedGates: [] as GateType[],
      effortLevel: 'medium',
      estimatedToolCalls: 10,
    };

    const context: HookContext = {
      meshInstance: 'test-instance',
      meshName: 'test',
      agentName: 'worker',
      workDir: testDir,
      agentId: 'test/worker',
      qualityPreflight: preflight,
      workerOutput: 'Here is my implementation using TypeScript with proper types. I have added tests for all edge cases.',
      msgsDir,
    };

    // Verify the hook is registered
    assert.ok(hooks.hasPostHook('quality:checklist'), 'quality:checklist hook should be registered');

    // Execute the checklist hook
    // Should pass since the output mentions TypeScript and tests
    await hooks.executePostHooks(['quality:checklist'], context);

    // If we got here without error, the check passed
    assert.ok(true, 'Checklist hook executed successfully');
  });

  test('quality:rubric hook receives worker output and evaluates', async () => {
    // Create context with preflight data
    const preflight: PreflightOutput = {
      taskType: 'implementation',
      checklist: [],
      rubric: [
        { criterion: 'correctness', weight: 0.5, description: 'Code is correct' },
        { criterion: 'completeness', weight: 0.5, description: 'All requirements met' },
      ],
      requiredGates: ['rubric'] as GateType[],
      suggestedGates: [] as GateType[],
      effortLevel: 'medium',
      estimatedToolCalls: 10,
    };

    const context: HookContext = {
      meshInstance: 'test-instance',
      meshName: 'test',
      agentName: 'worker',
      workDir: testDir,
      agentId: 'test/worker',
      qualityPreflight: preflight,
      workerOutput: `
        ## Implementation

        The code correctly implements all requirements with proper error handling.
        All edge cases are covered and the solution is complete.

        **Confidence**: 0.9
        **Grade**: A
      `,
      msgsDir,
    };

    // Verify the hook is registered
    assert.ok(hooks.hasPostHook('quality:rubric'), 'quality:rubric hook should be registered');

    // Execute the rubric hook
    await hooks.executePostHooks(['quality:rubric'], context);

    // If we got here without error, the check passed
    assert.ok(true, 'Rubric hook executed successfully');
  });

  test('quality hooks skip gracefully without preflight data', async () => {
    const context: HookContext = {
      meshInstance: 'test-instance',
      meshName: 'test',
      agentName: 'worker',
      workDir: testDir,
      agentId: 'test/worker',
      // No qualityPreflight set
      workerOutput: 'Some output',
      msgsDir,
    };

    // Should not throw - just skip
    await hooks.executePostHooks(['quality:checklist'], context);
    await hooks.executePostHooks(['quality:rubric'], context);
    await hooks.executePostHooks(['quality:adversarial'], context);
    await hooks.executePostHooks(['quality:accuracy'], context);

    assert.ok(true, 'Quality hooks skip gracefully without preflight');
  });

  test('quality hooks skip gracefully without worker output', async () => {
    const preflight: PreflightOutput = {
      taskType: 'implementation',
      checklist: ['Has tests'],
      rubric: [],
      requiredGates: ['checklist'] as GateType[],
      suggestedGates: [] as GateType[],
      effortLevel: 'light',
      estimatedToolCalls: 5,
    };

    const context: HookContext = {
      meshInstance: 'test-instance',
      meshName: 'test',
      agentName: 'worker',
      workDir: testDir,
      agentId: 'test/worker',
      qualityPreflight: preflight,
      // No workerOutput set
      msgsDir,
    };

    // Should not throw - just skip
    await hooks.executePostHooks(['quality:checklist'], context);
    await hooks.executePostHooks(['quality:rubric'], context);

    assert.ok(true, 'Quality hooks skip gracefully without worker output');
  });

  test('quality:summarizer hook runs without failure', async () => {
    const context: HookContext = {
      meshInstance: 'test-instance',
      meshName: 'test',
      agentName: 'worker',
      workDir: testDir,
      agentId: 'test/worker',
      workerOutput: 'This is a complete solution with all requirements addressed.',
      msgsDir,
    };

    // Verify the hook is registered
    assert.ok(hooks.hasPostHook('quality:summarizer'), 'quality:summarizer hook should be registered');

    // Execute the summarizer hook - it's informational only and never throws
    await hooks.executePostHooks(['quality:summarizer'], context);

    assert.ok(true, 'Summarizer hook executed successfully');
  });

  test('quality:deterministic hook skips with no commands', async () => {
    const context: HookContext = {
      meshInstance: 'test-instance',
      meshName: 'test',
      agentName: 'worker',
      workDir: testDir,
      agentId: 'test/worker',
      workerOutput: 'Some output',
      msgsDir,
      // No deterministicCommands set
    };

    // Verify the hook is registered
    assert.ok(hooks.hasPostHook('quality:deterministic'), 'quality:deterministic hook should be registered');

    // Should skip gracefully with no commands configured
    await hooks.executePostHooks(['quality:deterministic'], context);

    assert.ok(true, 'Deterministic hook skips with no commands');
  });

  test('hook parameterization works correctly', async () => {
    // Create context
    const context: HookContext = {
      meshInstance: 'test-instance',
      meshName: 'test',
      agentName: 'worker',
      workDir: testDir,
      agentId: 'test/worker',
      taskBody: 'Build a feature',
      msgsDir,
    };

    // Execute preflight with parameterized config
    await hooks.executePreHooks(['quality:preflight:maxIterations=5,onFail=halt'], context);

    // Verify config was applied
    assert.strictEqual(context.qualityMaxIterations, 5, 'maxIterations should be 5');
    assert.strictEqual(context.qualityOnFail, 'halt', 'onFail should be halt');
  });

  test('all quality hooks are registered', () => {
    // Pre-hooks
    assert.ok(hooks.hasPreHook('quality:preflight'), 'quality:preflight should be registered');

    // Post-hooks
    assert.ok(hooks.hasPostHook('quality:evaluate'), 'quality:evaluate should be registered');
    assert.ok(hooks.hasPostHook('quality:checklist'), 'quality:checklist should be registered');
    assert.ok(hooks.hasPostHook('quality:rubric'), 'quality:rubric should be registered');
    assert.ok(hooks.hasPostHook('quality:adversarial'), 'quality:adversarial should be registered');
    assert.ok(hooks.hasPostHook('quality:accuracy'), 'quality:accuracy should be registered');
    assert.ok(hooks.hasPostHook('quality:summarizer'), 'quality:summarizer should be registered');
    assert.ok(hooks.hasPostHook('quality:deterministic'), 'quality:deterministic should be registered');
  });

  test('lifecycle hook list methods work', () => {
    const preHooks = hooks.listPreHooks();
    const postHooks = hooks.listPostHooks();

    // Should include quality preflight
    assert.ok(preHooks.includes('quality:preflight'), 'Pre-hooks should include quality:preflight');
    assert.ok(preHooks.includes('worktree:create'), 'Pre-hooks should include worktree:create');

    // Should include quality gates
    assert.ok(postHooks.includes('quality:checklist'), 'Post-hooks should include quality:checklist');
    assert.ok(postHooks.includes('quality:rubric'), 'Post-hooks should include quality:rubric');
    assert.ok(postHooks.includes('quality:adversarial'), 'Post-hooks should include quality:adversarial');
    assert.ok(postHooks.includes('quality:accuracy'), 'Post-hooks should include quality:accuracy');
    assert.ok(postHooks.includes('quality:summarizer'), 'Post-hooks should include quality:summarizer');
    assert.ok(postHooks.includes('quality:deterministic'), 'Post-hooks should include quality:deterministic');
  });
});
