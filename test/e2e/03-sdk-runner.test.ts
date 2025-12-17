/**
 * V4 SDK Runner Test - Test 3
 *
 * Verifies that SDK-based worker runner can be configured and handles
 * basic lifecycle events. Note: Full integration requires Claude API access.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { SdkRunner, SdkRunnerConfig } from '../../src/worker/index.ts';
import { MessageQueue } from '../../src/queue/index.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('V4 SDK Runner Test', () => {
  let env: TestEnv;
  let queue: MessageQueue;

  before(async () => {
    env = createTestEnv('tx-v4-sdk-runner');
    queue = new MessageQueue(env.dbPath);
  });

  after(async () => {
    if (queue) queue.close();
    env.cleanup();
  });

  it('should create SdkRunner with config', () => {
    const config: SdkRunnerConfig = {
      id: 'dev/dev',
      model: 'sonnet',
      systemPrompt: 'You are a development assistant.',
      workDir: env.rootDir,
      msgsDir: env.msgsDir
    };

    const runner = new SdkRunner(config, queue);

    assert.ok(runner, 'SdkRunner should be created');
    assert.strictEqual(runner.isRunning(), false, 'Runner should not be running yet');
  });

  it('should return early when no messages to process', async () => {
    const config: SdkRunnerConfig = {
      id: 'idle/worker',
      model: 'haiku',
      systemPrompt: 'Idle worker prompt',
      workDir: env.rootDir,
      msgsDir: env.msgsDir
    };

    const runner = new SdkRunner(config, queue);
    const result = await runner.run();

    assert.strictEqual(result.success, true, 'Should succeed');
    assert.strictEqual(result.messagesProcessed, 0, 'Should process 0 messages');
    assert.strictEqual(runner.isRunning(), false, 'Runner should exit cleanly');
  });

  it('should emit start event when running', async () => {
    const config: SdkRunnerConfig = {
      id: 'events/worker',
      model: 'haiku',
      systemPrompt: 'Events test worker',
      workDir: env.rootDir,
      msgsDir: env.msgsDir
    };

    const runner = new SdkRunner(config, queue);
    let startEmitted = false;

    runner.on('start', () => {
      startEmitted = true;
    });

    await runner.run();

    assert.strictEqual(startEmitted, true, 'Start event should be emitted');
  });

  it('should kill runner when requested', async () => {
    const config: SdkRunnerConfig = {
      id: 'kill/worker',
      model: 'haiku',
      systemPrompt: 'Kill test worker',
      workDir: env.rootDir,
      msgsDir: env.msgsDir
    };

    const runner = new SdkRunner(config, queue);
    runner.kill();
    assert.strictEqual(runner.isRunning(), false, 'Should be stopped after kill');
  });
});
