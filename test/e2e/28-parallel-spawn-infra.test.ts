/**
 * Test 28: Parallel Spawn Infrastructure
 *
 * Tests parallelism dispatcher mechanics WITHOUT real LLM.
 * Starts dispatcher to load mesh configs, then directly invokes
 * handleParallelBlockCompletion() to test the fork/join logic.
 *
 * Responsibilities:
 * - Verify parallel:spawn fires when entry agent completes
 * - Verify exit agent is gated until all parallel agents complete
 * - Verify parallel:complete fires when all parallel agents finish
 * - Verify task messages are written for each parallel agent
 * - Verify parallelism config structure
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerDispatcher } from '../../src/worker/dispatcher.ts';
import {
  setupTestEnv,
  cleanupTestEnv,
  sleep,
  type TestEnv,
} from '../utils/test-env.ts';
import { EventHarness } from '../utils/event-harness.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Copy the real test-parallelism mesh into the test environment.
 */
function copyTestParallelismMesh(env: TestEnv): void {
  const srcMeshDir = path.resolve(__dirname, '../../meshes/test-parallelism');
  const destMeshDir = path.join(env.meshesDir, 'test-parallelism');

  fs.mkdirSync(destMeshDir, { recursive: true });

  const files = fs.readdirSync(srcMeshDir);
  for (const file of files) {
    const srcPath = path.join(srcMeshDir, file);
    const destPath = path.join(destMeshDir, file);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      for (const subFile of fs.readdirSync(srcPath)) {
        fs.copyFileSync(path.join(srcPath, subFile), path.join(destPath, subFile));
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Get the loaded mesh config from the dispatcher (private field access).
 */
function getMeshConfig(dispatcher: WorkerDispatcher, meshName: string): any {
  return (dispatcher as any).meshConfigs.get(meshName);
}

/**
 * Call handleParallelBlockCompletion on the dispatcher (private method access).
 * This simulates what happens when a worker's state machine hits "complete".
 */
function simulateAgentCompletion(
  dispatcher: WorkerDispatcher,
  meshName: string,
  agentName: string
): void {
  const meshConfig = getMeshConfig(dispatcher, meshName);
  if (!meshConfig) throw new Error(`Mesh config not found: ${meshName}`);
  (dispatcher as any).handleParallelBlockCompletion(meshName, agentName, meshConfig);
}

describe('Parallel Spawn Infrastructure', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('parallel-infra');

    // Copy real test-parallelism mesh
    copyTestParallelismMesh(env);

    // Create package.json that preload agent expects to load
    fs.writeFileSync(
      path.join(env.rootDir, 'package.json'),
      JSON.stringify({ name: 'test-parallelism-pkg', version: '1.0.0' })
    );

    // Initialize dispatcher (no consumer needed — we call methods directly)
    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue
    );

    harness = new EventHarness(dispatcher);

    // Start dispatcher to load mesh configs (no consumer = no message processing)
    await dispatcher.start();
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  test('mesh config loaded with parallelism block', async () => {
    const meshConfig = getMeshConfig(dispatcher, 'test-parallelism');

    assert.ok(meshConfig, 'test-parallelism mesh should be loaded');
    assert.ok(meshConfig.parallelism, 'Config should have parallelism block');
    assert.strictEqual(meshConfig.parallelism.length, 1, 'Should have 1 parallelism block');

    const block = meshConfig.parallelism[0];
    assert.deepStrictEqual(
      block.agents.sort(),
      ['analyst', 'critic', 'reviewer'],
      'Block agents should be analyst, critic, reviewer'
    );
    assert.strictEqual(block.entry, 'preload', 'Entry should be preload');
    assert.strictEqual(block.exit, 'synthesizer', 'Exit should be synthesizer');
  });

  test('parallel:spawn fires when entry agent completes', async () => {
    // Simulate preload (entry agent) completing
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'preload');

    // Check parallel:spawn was emitted
    const spawnEvents = harness.getEvents('parallel:spawn');
    assert.strictEqual(spawnEvents.length, 1, 'Should emit exactly 1 parallel:spawn');

    const data = spawnEvents[0].data;
    assert.strictEqual(data.meshName, 'test-parallelism');
    assert.deepStrictEqual(
      data.agents.sort(),
      ['analyst', 'critic', 'reviewer'],
      'Should spawn all 3 parallel agents'
    );
    assert.strictEqual(data.entry, 'preload', 'Entry should be preload');
    assert.strictEqual(data.exit, 'synthesizer', 'Exit should be synthesizer');
    assert.strictEqual(data.blockKey, 'test-parallelism:0', 'Block key should be mesh:index');
  });

  test('exit agent is gated until all parallel agents complete', async () => {
    // Trigger parallel spawn
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'preload');

    // Verify synthesizer is gated
    assert.strictEqual(
      dispatcher.isParallelGated('test-parallelism', 'synthesizer'),
      true,
      'Synthesizer should be gated before any parallel agents complete'
    );

    // Complete analyst (1 of 3)
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'analyst');
    assert.strictEqual(
      dispatcher.isParallelGated('test-parallelism', 'synthesizer'),
      true,
      'Synthesizer should still be gated (1/3 complete)'
    );

    // Complete reviewer (2 of 3)
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'reviewer');
    assert.strictEqual(
      dispatcher.isParallelGated('test-parallelism', 'synthesizer'),
      true,
      'Synthesizer should still be gated (2/3 complete)'
    );

    // Complete critic (3 of 3)
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'critic');

    // Gate should now be cleared
    assert.strictEqual(
      dispatcher.isParallelGated('test-parallelism', 'synthesizer'),
      false,
      'Synthesizer should be ungated after all parallel agents complete'
    );
  });

  test('parallel:complete fires with all completed agents', async () => {
    // Trigger full lifecycle
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'preload');
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'analyst');
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'reviewer');
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'critic');

    // Check parallel:complete
    const completeEvents = harness.getEvents('parallel:complete');
    assert.strictEqual(completeEvents.length, 1, 'Should emit exactly 1 parallel:complete');

    const data = completeEvents[0].data;
    assert.strictEqual(data.meshName, 'test-parallelism');
    assert.strictEqual(data.exitAgent, 'synthesizer');
    assert.deepStrictEqual(
      data.completedAgents.sort(),
      ['analyst', 'critic', 'reviewer'],
      'All 3 agents should be in completedAgents'
    );
  });

  test('task messages written for each parallel agent on spawn', async () => {
    // Trigger parallel spawn
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'preload');

    // Give time for systemWriter to write files
    await sleep(300);

    // Check message files in msgs dir
    const msgFiles = fs.readdirSync(env.msgsDir);
    const parallelTaskFiles = msgFiles.filter((f) => {
      if (!f.endsWith('.md')) return false;
      const content = fs.readFileSync(path.join(env.msgsDir, f), 'utf-8');
      return content.includes('Parallel fork from preload');
    });

    assert.ok(
      parallelTaskFiles.length >= 3,
      `Expected at least 3 parallel task messages, found ${parallelTaskFiles.length}. ` +
      `Files: [${msgFiles.join(', ')}]`
    );

    // Verify each agent got a message
    const targets = new Set<string>();
    for (const f of parallelTaskFiles) {
      const content = fs.readFileSync(path.join(env.msgsDir, f), 'utf-8');
      if (content.includes('to: test-parallelism/analyst')) targets.add('analyst');
      if (content.includes('to: test-parallelism/reviewer')) targets.add('reviewer');
      if (content.includes('to: test-parallelism/critic')) targets.add('critic');
    }

    assert.ok(targets.has('analyst'), 'Should have task for analyst');
    assert.ok(targets.has('reviewer'), 'Should have task for reviewer');
    assert.ok(targets.has('critic'), 'Should have task for critic');
  });

  test('event sequence follows expected order', async () => {
    // Full lifecycle
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'preload');
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'analyst');
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'reviewer');
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'critic');

    // Assert event subsequence
    harness.assertEventSequence([
      'parallel:spawn',
      'parallel:complete',
    ]);
  });

  test('non-parallel agent completion does not trigger spawn', async () => {
    // Completing an agent that isn't the entry should not trigger parallel:spawn
    simulateAgentCompletion(dispatcher, 'test-parallelism', 'analyst');

    const spawnEvents = harness.getEvents('parallel:spawn');
    assert.strictEqual(spawnEvents.length, 0, 'Should not emit parallel:spawn for non-entry agent');
  });

  test('isParallelGated returns false when no parallel block active', async () => {
    // Before any parallel block is triggered
    assert.strictEqual(
      dispatcher.isParallelGated('test-parallelism', 'synthesizer'),
      false,
      'Should not be gated when no parallel block is active'
    );

    assert.strictEqual(
      dispatcher.isParallelGated('nonexistent-mesh', 'whatever'),
      false,
      'Should not be gated for nonexistent mesh'
    );
  });
});
