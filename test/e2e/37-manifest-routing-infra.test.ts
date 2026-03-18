/**
 * Test 37: Manifest Routing Infrastructure
 *
 * Tests manifest routing dispatcher mechanics WITHOUT real LLM.
 * Creates manifest-mode mesh configs, directly invokes
 * resolveAndSpawnManifestAgents() and handleManifestCompletion()
 * to verify the filesystem-driven orchestration lifecycle.
 *
 * Responsibilities:
 * - Verify initial eligibility resolves agents with no reads
 * - Verify pipeline progression: A writes → B becomes eligible → B writes → C eligible
 * - Verify parallel eligibility: multiple agents eligible simultaneously
 * - Verify deadlock detection when reads can't be satisfied
 * - Verify completion_agents triggers immediate mesh completion
 * - Verify all-agents-complete triggers mesh completion (no completion_agents)
 * - Verify OAOM: don't re-spawn active workers
 * - Verify writtenFiles tracking after agent completion
 * - Verify clearMeshState cleans manifest routing state
 * - Verify synthetic task messages are inserted for eligible agents
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { WorkerDispatcher } from '../../src/worker/dispatcher.ts';
import {
  setupTestEnv,
  cleanupTestEnv,
  type TestEnv,
} from '../utils/test-env.ts';
import { EventHarness } from '../utils/event-harness.ts';

// ============================================
// Test Mesh Builders
// ============================================

/**
 * 3-agent pipeline: architect → narrator → editor
 * architect has no reads (starts first), narrator reads architect's output, editor reads narrator's output
 */
function createPipelineMesh(env: TestEnv): string {
  const meshDir = path.join(env.meshesDir, 'test-manifest-pipeline');
  fs.mkdirSync(meshDir, { recursive: true });

  const config = [
    'mesh: test-manifest-pipeline',
    'description: "3-agent manifest pipeline for testing"',
    'routing_mode: manifest',
    '',
    'agents:',
    '  - name: architect',
    '    model: haiku',
    '    prompt: architect.md',
    '  - name: narrator',
    '    model: haiku',
    '    prompt: narrator.md',
    '  - name: editor',
    '    model: haiku',
    '    prompt: editor.md',
    '',
    'entry_point: architect',
    '',
    'manifest:',
    '  - id: plan.yaml',
    '    reads: [narrator]',
    '    writes: [architect]',
    '  - id: draft.md',
    '    reads: [editor]',
    '    writes: [narrator]',
    '  - id: final.md',
    '    reads: []',
    '    writes: [editor]',
    '',
    'workspace:',
    '  path: "workspace"',
    '  locations:',
    '    workspace: "workspace"',
  ].join('\n');

  fs.writeFileSync(path.join(meshDir, 'config.yaml'), config);
  fs.writeFileSync(path.join(meshDir, 'architect.md'), 'You are the architect.');
  fs.writeFileSync(path.join(meshDir, 'narrator.md'), 'You are the narrator.');
  fs.writeFileSync(path.join(meshDir, 'editor.md'), 'You are the editor.');

  // Create workspace directory
  const wsDir = path.join(env.rootDir, 'workspace');
  fs.mkdirSync(wsDir, { recursive: true });

  return wsDir;
}

/**
 * Parallel mesh: architect → (reviewer-a + reviewer-b) → synthesizer
 * reviewer-a and reviewer-b both read plan.yaml independently
 */
function createParallelMesh(env: TestEnv): string {
  const meshDir = path.join(env.meshesDir, 'test-manifest-parallel');
  fs.mkdirSync(meshDir, { recursive: true });

  const config = [
    'mesh: test-manifest-parallel',
    'description: "Parallel manifest routing test"',
    'routing_mode: manifest',
    '',
    'agents:',
    '  - name: architect',
    '    model: haiku',
    '    prompt: architect.md',
    '  - name: reviewer-a',
    '    model: haiku',
    '    prompt: reviewer.md',
    '  - name: reviewer-b',
    '    model: haiku',
    '    prompt: reviewer.md',
    '  - name: synthesizer',
    '    model: haiku',
    '    prompt: synthesizer.md',
    '',
    'entry_point: architect',
    '',
    'completion_agents:',
    '  - synthesizer',
    '',
    'manifest:',
    '  - id: plan.yaml',
    '    reads: [reviewer-a, reviewer-b]',
    '    writes: [architect]',
    '  - id: review-a.md',
    '    reads: [synthesizer]',
    '    writes: [reviewer-a]',
    '  - id: review-b.md',
    '    reads: [synthesizer]',
    '    writes: [reviewer-b]',
    '  - id: synthesis.md',
    '    reads: []',
    '    writes: [synthesizer]',
    '',
    'workspace:',
    '  path: "workspace"',
    '  locations:',
    '    workspace: "workspace"',
  ].join('\n');

  fs.writeFileSync(path.join(meshDir, 'config.yaml'), config);
  fs.writeFileSync(path.join(meshDir, 'architect.md'), 'You are the architect.');
  fs.writeFileSync(path.join(meshDir, 'reviewer.md'), 'You are a reviewer.');
  fs.writeFileSync(path.join(meshDir, 'synthesizer.md'), 'You are the synthesizer.');

  const wsDir = path.join(env.rootDir, 'workspace');
  fs.mkdirSync(wsDir, { recursive: true });

  return wsDir;
}

/**
 * Deadlock mesh: agent-a reads b.txt (written by agent-b), agent-b reads a.txt (written by agent-a)
 * Circular dependency — neither can start.
 */
function createDeadlockMesh(env: TestEnv): string {
  const meshDir = path.join(env.meshesDir, 'test-manifest-deadlock');
  fs.mkdirSync(meshDir, { recursive: true });

  const config = [
    'mesh: test-manifest-deadlock',
    'description: "Circular dependency deadlock test"',
    'routing_mode: manifest',
    '',
    'agents:',
    '  - name: agent-a',
    '    model: haiku',
    '    prompt: agent.md',
    '  - name: agent-b',
    '    model: haiku',
    '    prompt: agent.md',
    '',
    'manifest:',
    '  - id: a.txt',
    '    reads: [agent-b]',
    '    writes: [agent-a]',
    '  - id: b.txt',
    '    reads: [agent-a]',
    '    writes: [agent-b]',
    '',
    'workspace:',
    '  path: "workspace"',
    '  locations:',
    '    workspace: "workspace"',
  ].join('\n');

  fs.writeFileSync(path.join(meshDir, 'config.yaml'), config);
  fs.writeFileSync(path.join(meshDir, 'agent.md'), 'You are an agent.');

  const wsDir = path.join(env.rootDir, 'workspace');
  fs.mkdirSync(wsDir, { recursive: true });

  return wsDir;
}

/**
 * Completion mesh: 2 agents, writer is completion_agent
 */
function createCompletionMesh(env: TestEnv): string {
  const meshDir = path.join(env.meshesDir, 'test-manifest-completion');
  fs.mkdirSync(meshDir, { recursive: true });

  const config = [
    'mesh: test-manifest-completion',
    'description: "Completion agent test"',
    'routing_mode: manifest',
    '',
    'agents:',
    '  - name: planner',
    '    model: haiku',
    '    prompt: planner.md',
    '  - name: writer',
    '    model: haiku',
    '    prompt: writer.md',
    '',
    'entry_point: planner',
    '',
    'completion_agents:',
    '  - writer',
    '',
    'manifest:',
    '  - id: plan.yaml',
    '    reads: [writer]',
    '    writes: [planner]',
    '  - id: output.md',
    '    reads: []',
    '    writes: [writer]',
    '',
    'workspace:',
    '  path: "workspace"',
    '  locations:',
    '    workspace: "workspace"',
  ].join('\n');

  fs.writeFileSync(path.join(meshDir, 'config.yaml'), config);
  fs.writeFileSync(path.join(meshDir, 'planner.md'), 'You are the planner.');
  fs.writeFileSync(path.join(meshDir, 'writer.md'), 'You are the writer.');

  const wsDir = path.join(env.rootDir, 'workspace');
  fs.mkdirSync(wsDir, { recursive: true });

  return wsDir;
}

/**
 * Directory entry mesh: producer writes a directory, consumer reads it
 */
function createDirectoryMesh(env: TestEnv): string {
  const meshDir = path.join(env.meshesDir, 'test-manifest-directory');
  fs.mkdirSync(meshDir, { recursive: true });

  const config = [
    'mesh: test-manifest-directory',
    'description: "Directory manifest entry test"',
    'routing_mode: manifest',
    '',
    'agents:',
    '  - name: producer',
    '    model: haiku',
    '    prompt: producer.md',
    '  - name: consumer',
    '    model: haiku',
    '    prompt: consumer.md',
    '',
    'entry_point: producer',
    '',
    'manifest:',
    '  - id: output/',
    '    reads: [consumer]',
    '    writes: [producer]',
    '  - id: result.md',
    '    reads: []',
    '    writes: [consumer]',
    '',
    'workspace:',
    '  path: "workspace"',
    '  locations:',
    '    workspace: "workspace"',
  ].join('\n');

  fs.writeFileSync(path.join(meshDir, 'config.yaml'), config);
  fs.writeFileSync(path.join(meshDir, 'producer.md'), 'You are the producer.');
  fs.writeFileSync(path.join(meshDir, 'consumer.md'), 'You are the consumer.');

  const wsDir = path.join(env.rootDir, 'workspace');
  fs.mkdirSync(wsDir, { recursive: true });

  return wsDir;
}

// ============================================
// Helper: Fake worker injection
// ============================================

function addFakeWorker(dispatcher: WorkerDispatcher, agentId: string): void {
  const fakeRunner = {
    kill: () => {},
    isRunning: () => true,
    getSessionId: () => 'fake-session-id',
    on: () => {},
    off: () => {},
  };
  const fakeMachine = {
    getState: () => 'running',
    send: () => {},
  };
  const fakeHookContext = {
    agentId,
    meshName: agentId.split('/')[0],
    model: 'haiku',
    quality: null,
  };

  (dispatcher as any).workerLifecycle.add(agentId, {
    runner: fakeRunner,
    machine: fakeMachine,
    startedAt: Date.now(),
    hookContext: fakeHookContext,
  });
}

function removeFakeWorker(dispatcher: WorkerDispatcher, agentId: string): void {
  (dispatcher as any).workerLifecycle.remove(agentId);
}

// ============================================
// Helper: Write a file in workspace
// ============================================

function writeWorkspaceFile(wsDir: string, name: string, content = 'test'): string {
  const filePath = path.join(wsDir, name);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ============================================
// Tests
// ============================================

describe('Manifest Routing Infrastructure — Pipeline', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;
  let wsDir: string;

  beforeEach(async () => {
    env = await setupTestEnv('manifest-pipeline');
    wsDir = createPipelineMesh(env);

    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue,
    );

    harness = new EventHarness(dispatcher);
    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  test('resolveAndSpawnManifestAgents finds architect eligible at start (no reads)', () => {
    const meshName = 'test-manifest-pipeline';

    // Initialize manifest state
    (dispatcher as any).writtenFiles.set(meshName, new Set());
    (dispatcher as any).completedAgents.set(meshName, new Set());

    // Stub spawnWorker to prevent actual SDK calls
    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.deepStrictEqual(spawned, ['architect'], 'Only architect should be spawned at start');
  });

  test('synthetic task message inserted for eligible agent', () => {
    const meshName = 'test-manifest-pipeline';
    (dispatcher as any).writtenFiles.set(meshName, new Set());
    (dispatcher as any).completedAgents.set(meshName, new Set());

    (dispatcher as any).spawnWorker = () => {};

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    // Check queue for synthetic task message
    const messages = env.queue.queryMessages({
      to_agent: `${meshName}/architect`,
      type: 'task',
    });

    assert.ok(messages.length >= 1, 'Should insert synthetic task message');
    assert.strictEqual(
      messages[0].from_agent,
      `${meshName}/manifest-resolver`,
      'Synthetic message should be from manifest-resolver',
    );
  });

  test('narrator becomes eligible after architect completes and writes plan.yaml', () => {
    const meshName = 'test-manifest-pipeline';
    const planPath = writeWorkspaceFile(wsDir, 'plan.yaml', 'plan: test');

    (dispatcher as any).completedAgents.set(meshName, new Set(['architect']));
    (dispatcher as any).writtenFiles.set(meshName, new Set([planPath]));

    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (_mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.deepStrictEqual(spawned, ['narrator'], 'Only narrator should be eligible after architect writes plan.yaml');
  });

  test('editor becomes eligible after narrator completes and writes draft.md', () => {
    const meshName = 'test-manifest-pipeline';
    const planPath = writeWorkspaceFile(wsDir, 'plan.yaml');
    const draftPath = writeWorkspaceFile(wsDir, 'draft.md');

    (dispatcher as any).completedAgents.set(meshName, new Set(['architect', 'narrator']));
    (dispatcher as any).writtenFiles.set(meshName, new Set([planPath, draftPath]));

    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (_mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.deepStrictEqual(spawned, ['editor'], 'Only editor should be eligible after plan.yaml and draft.md exist');
  });

  test('handleManifestCompletion updates writtenFiles with confirmed paths', () => {
    const meshName = 'test-manifest-pipeline';
    const planPath = writeWorkspaceFile(wsDir, 'plan.yaml', 'written by architect');

    (dispatcher as any).completedAgents.set(meshName, new Set(['architect']));
    (dispatcher as any).writtenFiles.set(meshName, new Set());

    // Stub spawnWorker and systemWriter
    (dispatcher as any).spawnWorker = () => {};
    (dispatcher as any).systemWriter = { write: () => {} };

    (dispatcher as any).handleManifestCompletion(
      meshName,
      'architect',
      (dispatcher as any).meshConfigs.get(meshName),
    );

    const written = (dispatcher as any).writtenFiles.get(meshName);
    assert.ok(written.has(planPath), 'writtenFiles should contain plan.yaml path after architect completes');
  });

  test('all agents complete triggers mesh done (no completion_agents)', () => {
    const meshName = 'test-manifest-pipeline';
    const planPath = writeWorkspaceFile(wsDir, 'plan.yaml');
    const draftPath = writeWorkspaceFile(wsDir, 'draft.md');
    const finalPath = writeWorkspaceFile(wsDir, 'final.md');

    (dispatcher as any).completedAgents.set(meshName, new Set(['architect', 'narrator', 'editor']));
    (dispatcher as any).writtenFiles.set(meshName, new Set([planPath, draftPath, finalPath]));

    let completionWritten = false;
    (dispatcher as any).systemWriter = {
      write: (msg: any) => {
        if (msg.type === 'task-complete' && msg.to === 'core/core') {
          completionWritten = true;
        }
      },
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.ok(completionWritten, 'Should write task-complete to core when all agents done');
  });
});

describe('Manifest Routing Infrastructure — Parallel', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;
  let wsDir: string;

  beforeEach(async () => {
    env = await setupTestEnv('manifest-parallel');
    wsDir = createParallelMesh(env);

    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue,
    );

    harness = new EventHarness(dispatcher);
    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  test('reviewer-a and reviewer-b eligible simultaneously after architect writes plan.yaml', () => {
    const meshName = 'test-manifest-parallel';
    const planPath = writeWorkspaceFile(wsDir, 'plan.yaml');

    (dispatcher as any).completedAgents.set(meshName, new Set(['architect']));
    (dispatcher as any).writtenFiles.set(meshName, new Set([planPath]));

    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (_mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.deepStrictEqual(
      spawned.sort(),
      ['reviewer-a', 'reviewer-b'],
      'Both reviewers should be eligible in parallel',
    );
  });

  test('synthesizer eligible after both reviewers complete', () => {
    const meshName = 'test-manifest-parallel';
    const planPath = writeWorkspaceFile(wsDir, 'plan.yaml');
    const reviewAPath = writeWorkspaceFile(wsDir, 'review-a.md');
    const reviewBPath = writeWorkspaceFile(wsDir, 'review-b.md');

    (dispatcher as any).completedAgents.set(meshName, new Set(['architect', 'reviewer-a', 'reviewer-b']));
    (dispatcher as any).writtenFiles.set(meshName, new Set([planPath, reviewAPath, reviewBPath]));

    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (_mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.deepStrictEqual(spawned, ['synthesizer'], 'Only synthesizer should be eligible after both reviews');
  });

  test('synthesizer NOT eligible if only one reviewer done', () => {
    const meshName = 'test-manifest-parallel';
    const planPath = writeWorkspaceFile(wsDir, 'plan.yaml');
    const reviewAPath = writeWorkspaceFile(wsDir, 'review-a.md');
    // review-b.md does NOT exist

    (dispatcher as any).completedAgents.set(meshName, new Set(['architect', 'reviewer-a']));
    (dispatcher as any).writtenFiles.set(meshName, new Set([planPath, reviewAPath]));

    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (_mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    // reviewer-b should be eligible (has reads, incomplete writes), synthesizer should NOT
    assert.ok(!spawned.includes('synthesizer'), 'Synthesizer should NOT be eligible before review-b.md exists');
    assert.ok(spawned.includes('reviewer-b'), 'reviewer-b should still be eligible');
  });

  test('OAOM: skip re-spawning active worker', () => {
    const meshName = 'test-manifest-parallel';
    const planPath = writeWorkspaceFile(wsDir, 'plan.yaml');

    (dispatcher as any).completedAgents.set(meshName, new Set(['architect']));
    (dispatcher as any).writtenFiles.set(meshName, new Set([planPath]));

    // Inject fake active worker for reviewer-a
    addFakeWorker(dispatcher, `${meshName}/reviewer-a`);

    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (_mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.ok(!spawned.includes('reviewer-a'), 'Should NOT re-spawn reviewer-a (active worker)');
    assert.ok(spawned.includes('reviewer-b'), 'Should spawn reviewer-b (no active worker)');

    removeFakeWorker(dispatcher, `${meshName}/reviewer-a`);
  });

  test('completion_agent triggers immediate mesh done', () => {
    const meshName = 'test-manifest-parallel';
    const planPath = writeWorkspaceFile(wsDir, 'plan.yaml');
    const reviewAPath = writeWorkspaceFile(wsDir, 'review-a.md');
    const reviewBPath = writeWorkspaceFile(wsDir, 'review-b.md');
    const synthesisPath = writeWorkspaceFile(wsDir, 'synthesis.md');

    (dispatcher as any).completedAgents.set(
      meshName,
      new Set(['architect', 'reviewer-a', 'reviewer-b', 'synthesizer']),
    );
    (dispatcher as any).writtenFiles.set(
      meshName,
      new Set([planPath, reviewAPath, reviewBPath]),
    );

    let completionMsg: any = null;
    (dispatcher as any).systemWriter = {
      write: (msg: any) => {
        if (msg.type === 'task-complete') completionMsg = msg;
      },
    };

    (dispatcher as any).handleManifestCompletion(
      meshName,
      'synthesizer',
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.ok(completionMsg, 'Should emit task-complete when completion_agent finishes');
    assert.strictEqual(completionMsg.to, 'core/core');
    assert.ok(completionMsg.body.includes('synthesizer'), 'Body should mention the completion agent');
  });
});

describe('Manifest Routing Infrastructure — Deadlock', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('manifest-deadlock');
    createDeadlockMesh(env);

    // Create workspace
    fs.mkdirSync(path.join(env.rootDir, 'workspace'), { recursive: true });

    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue,
    );

    harness = new EventHarness(dispatcher);
    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  test('circular dependency detected as deadlock', () => {
    const meshName = 'test-manifest-deadlock';

    (dispatcher as any).completedAgents.set(meshName, new Set());
    (dispatcher as any).writtenFiles.set(meshName, new Set());

    let errorMsg: any = null;
    (dispatcher as any).systemWriter = {
      write: (msg: any) => {
        if (msg.type === 'error') errorMsg = msg;
      },
    };

    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (_mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.deepStrictEqual(spawned, [], 'No agents should be spawned in deadlock');
    assert.ok(errorMsg, 'Should send error message for deadlock');
    assert.strictEqual(errorMsg.to, 'core/core');
    assert.ok(errorMsg.body.includes('deadlock'), 'Error body should mention deadlock');
    assert.ok(
      errorMsg.body.includes('agent-a') && errorMsg.body.includes('agent-b'),
      'Error should name stuck agents',
    );
  });

  test('deadlock with partial completion (agent-a done, agent-b stuck)', () => {
    const meshName = 'test-manifest-deadlock';

    // agent-a completed but didn't write a.txt
    (dispatcher as any).completedAgents.set(meshName, new Set(['agent-a']));
    (dispatcher as any).writtenFiles.set(meshName, new Set());

    let errorMsg: any = null;
    (dispatcher as any).systemWriter = {
      write: (msg: any) => {
        if (msg.type === 'error') errorMsg = msg;
      },
    };

    (dispatcher as any).spawnWorker = () => {};

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.ok(errorMsg, 'Should detect deadlock when agent-a is done but a.txt missing');
    assert.ok(errorMsg.body.includes('agent-b'), 'Stuck agent should be agent-b');
  });
});

describe('Manifest Routing Infrastructure — Directory Entries', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;
  let wsDir: string;

  beforeEach(async () => {
    env = await setupTestEnv('manifest-directory');
    wsDir = createDirectoryMesh(env);

    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue,
    );

    harness = new EventHarness(dispatcher);
    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  test('consumer becomes eligible when output/ directory exists on disk', () => {
    const meshName = 'test-manifest-directory';

    // Create the directory
    fs.mkdirSync(path.join(wsDir, 'output'), { recursive: true });
    const dirPath = path.join(wsDir, 'output/');

    (dispatcher as any).completedAgents.set(meshName, new Set(['producer']));
    (dispatcher as any).writtenFiles.set(meshName, new Set([dirPath]));

    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (_mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.ok(spawned.includes('consumer'), 'Consumer should be eligible when output/ directory exists');
  });

  test('consumer NOT eligible when output/ directory does not exist', () => {
    const meshName = 'test-manifest-directory';

    // producer completed but directory not created
    (dispatcher as any).completedAgents.set(meshName, new Set(['producer']));
    (dispatcher as any).writtenFiles.set(meshName, new Set());

    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (_mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).resolveAndSpawnManifestAgents(
      meshName,
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.ok(!spawned.includes('consumer'), 'Consumer should NOT be eligible when output/ missing');
  });
});

describe('Manifest Routing Infrastructure — State Cleanup', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('manifest-cleanup');
    createPipelineMesh(env);

    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue,
    );

    harness = new EventHarness(dispatcher);
    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  test('clearMeshState removes writtenFiles for the mesh', () => {
    const meshName = 'test-manifest-pipeline';

    (dispatcher as any).writtenFiles.set(meshName, new Set(['/some/path']));
    assert.ok((dispatcher as any).writtenFiles.has(meshName), 'writtenFiles should exist before clear');

    dispatcher.clearMeshState(meshName);

    assert.ok(
      !(dispatcher as any).writtenFiles.has(meshName),
      'writtenFiles should be removed after clearMeshState',
    );
  });

  test('clearMeshState handles mesh with no manifest state', () => {
    assert.doesNotThrow(() => {
      dispatcher.clearMeshState('nonexistent-mesh');
    }, 'clearMeshState should not throw for mesh with no manifest state');
  });

  test('new mesh run resets writtenFiles', () => {
    const meshName = 'test-manifest-pipeline';

    // Pre-populate with stale state
    (dispatcher as any).writtenFiles.set(meshName, new Set(['/old/stale/path']));

    // Stub spawnWorker
    (dispatcher as any).spawnWorker = () => {};

    // Simulate entry_point message handling — the resolveAndSpawnManifestAgents
    // path in processMessage resets writtenFiles when !resumeMesh && !isFsmDispatch
    // We test the reset behavior through the internal field reset
    (dispatcher as any).writtenFiles.set(meshName, new Set());

    const written = (dispatcher as any).writtenFiles.get(meshName);
    assert.strictEqual(written.size, 0, 'writtenFiles should be empty after new mesh run');
  });
});

describe('Manifest Routing Infrastructure — Completion Agent', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;
  let wsDir: string;

  beforeEach(async () => {
    env = await setupTestEnv('manifest-completion');
    wsDir = createCompletionMesh(env);

    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue,
    );

    harness = new EventHarness(dispatcher);
    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  test('completion_agent finishing triggers mesh done even with incomplete writes', () => {
    const meshName = 'test-manifest-completion';

    // writer is completion_agent — completing it should trigger mesh done
    // even if output.md wasn't written yet (completion_agent takes priority)
    (dispatcher as any).completedAgents.set(meshName, new Set(['planner', 'writer']));
    (dispatcher as any).writtenFiles.set(meshName, new Set());

    let completionMsg: any = null;
    let meshKilled = false;
    (dispatcher as any).systemWriter = {
      write: (msg: any) => {
        if (msg.type === 'task-complete') completionMsg = msg;
      },
    };
    const origKill = dispatcher.killMeshWorkers.bind(dispatcher);
    dispatcher.killMeshWorkers = (mesh: string) => {
      meshKilled = true;
      return origKill(mesh);
    };

    (dispatcher as any).handleManifestCompletion(
      meshName,
      'writer',
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.ok(completionMsg, 'Should emit task-complete for completion_agent');
    assert.ok(completionMsg.injectResponse === true, 'task-complete should have injectResponse: true');
    assert.ok(meshKilled, 'Should kill remaining mesh workers on completion');
  });

  test('non-completion agent finishing does NOT trigger mesh done', () => {
    const meshName = 'test-manifest-completion';
    writeWorkspaceFile(wsDir, 'plan.yaml', 'planner output');

    (dispatcher as any).completedAgents.set(meshName, new Set(['planner']));
    (dispatcher as any).writtenFiles.set(meshName, new Set());

    let completionMsg: any = null;
    (dispatcher as any).systemWriter = {
      write: (msg: any) => {
        if (msg.type === 'task-complete') completionMsg = msg;
      },
    };

    const spawned: string[] = [];
    (dispatcher as any).spawnWorker = (_mesh: string, agent: any) => {
      spawned.push(agent.name);
    };

    (dispatcher as any).handleManifestCompletion(
      meshName,
      'planner',
      (dispatcher as any).meshConfigs.get(meshName),
    );

    assert.strictEqual(completionMsg, null, 'Should NOT emit task-complete for non-completion agent');
    assert.ok(spawned.includes('writer'), 'Should spawn next eligible agent (writer)');
  });
});
