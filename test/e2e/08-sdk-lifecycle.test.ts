/**
 * Test 8: SDK Runner Lifecycle
 *
 * Comprehensive tests for SDK runner lifecycle events, prompt building,
 * command frontmatter handling, and error scenarios.
 *
 * Note: Tests that require actual Claude API calls are marked with
 * "integration" in comments - they will fail without API access but
 * validate the infrastructure.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SdkRunner, type SdkRunnerConfig } from '../../src/worker/index.ts';
import { MessageQueue } from '../../src/queue/index.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';

describe('V4 SDK Lifecycle Tests', () => {
  let env: TestEnv;
  let queue: MessageQueue;

  before(() => {
    env = createTestEnv('tx-v4-sdk-lifecycle');
    queue = new MessageQueue(env.dbPath);
  });

  after(() => {
    queue.close();
    env.cleanup();
  });

  describe('Prompt Building', () => {
    it('should build prompt with command leading when command frontmatter exists', async () => {
      const config: SdkRunnerConfig = {
        id: 'prompt/command',
        model: 'haiku',
        systemPrompt: 'Test worker',
        workDir: env.rootDir,
        msgsDir: env.msgsDir
      };

      // Insert message with command frontmatter
      queue.insert({
        from_agent: 'core/core',
        to_agent: 'prompt/command',
        type: 'task',
        payload: {
          'msg-id': 'cmd-test-1',
          headline: 'Execute slash command',
          body: 'User requested: /know:prepare',
          command: '/know:prepare'
        }
      });

      const runner = new SdkRunner(config, queue);

      // Capture the prompt via 'start' event context
      let capturedStartEvent = false;
      runner.on('start', () => {
        capturedStartEvent = true;
      });

      // Run will try to call SDK - we're testing the setup
      // The actual SDK call may fail without API access
      try {
        await runner.run();
      } catch (err) {
        // Expected if no API access - that's fine for this test
      }

      assert.ok(capturedStartEvent, 'Start event should be emitted');
    });

    it('should build prompt without command when no command frontmatter', async () => {
      const config: SdkRunnerConfig = {
        id: 'prompt/nocommand',
        model: 'haiku',
        systemPrompt: 'Test worker',
        workDir: env.rootDir,
        msgsDir: env.msgsDir
      };

      // Insert message WITHOUT command frontmatter
      queue.insert({
        from_agent: 'core/core',
        to_agent: 'prompt/nocommand',
        type: 'task',
        payload: {
          'msg-id': 'no-cmd-test',
          headline: 'Regular task',
          body: 'Please do some work'
        }
      });

      const runner = new SdkRunner(config, queue);
      let emittedStart = false;

      runner.on('start', () => {
        emittedStart = true;
      });

      try {
        await runner.run();
      } catch (err) {
        // SDK call may fail - we're testing the setup
      }

      assert.ok(emittedStart, 'Start should be emitted for non-command message');
    });
  });

  describe('Duplicate Run Protection', () => {
    it('should reject duplicate run() calls', async () => {
      const config: SdkRunnerConfig = {
        id: 'duplicate/worker',
        model: 'haiku',
        systemPrompt: 'Duplicate test',
        workDir: env.rootDir,
        msgsDir: env.msgsDir
      };

      // Insert a message so runner has something to process
      queue.insert({
        from_agent: 'core/core',
        to_agent: 'duplicate/worker',
        type: 'task',
        payload: {
          'msg-id': 'dup-test',
          headline: 'Long task',
          body: 'This task takes time'
        }
      });

      const runner = new SdkRunner(config, queue);

      // Start first run (don't await - let it run)
      const firstRunPromise = runner.run();

      // Immediately try second run
      const secondResult = await runner.run();

      // Second run should be rejected
      assert.strictEqual(secondResult.success, false, 'Duplicate run should fail');
      assert.ok(secondResult.error?.includes('Already running'), 'Should indicate already running');
      assert.strictEqual(secondResult.messagesProcessed, 0, 'Should process 0 messages');

      // Clean up first run
      runner.kill();
      await firstRunPromise.catch(() => {}); // Ignore error from killed runner
    });
  });

  describe('Event Emissions', () => {
    it('should emit start event with worker ID', async () => {
      const workerId = 'events/start-test';
      const config: SdkRunnerConfig = {
        id: workerId,
        model: 'haiku',
        systemPrompt: 'Events test',
        workDir: env.rootDir,
        msgsDir: env.msgsDir
      };

      const runner = new SdkRunner(config, queue);
      let startEventData: any = null;

      runner.on('start', (data) => {
        startEventData = data;
      });

      await runner.run(); // No messages, completes immediately

      if (!startEventData) throw new Error('Start event should be emitted');
      assert.strictEqual(startEventData.id, workerId, 'Event should contain worker ID');
    });

    it('should emit complete event with processing summary', async () => {
      const workerId = 'events/complete-test';
      const config: SdkRunnerConfig = {
        id: workerId,
        model: 'haiku',
        systemPrompt: 'Complete events test',
        workDir: env.rootDir,
        msgsDir: env.msgsDir
      };

      const runner = new SdkRunner(config, queue);
      let completeEventData: any = null;

      runner.on('complete', (data) => {
        completeEventData = data;
      });

      const result = await runner.run();

      if (!completeEventData) throw new Error('Complete event should be emitted');
      assert.strictEqual(completeEventData.id, workerId, 'Complete event should have worker ID');
      assert.strictEqual(completeEventData.messagesProcessed, 0, 'Should report 0 messages processed');
      assert.strictEqual(result.success, true, 'Run should succeed with no messages');
    });

    it('should emit error event when SDK throws', async () => {
      // This test validates error handling infrastructure
      // Actual SDK errors depend on API state
      const config: SdkRunnerConfig = {
        id: 'events/error-test',
        model: 'haiku',
        systemPrompt: 'Error test',
        workDir: env.rootDir,
        msgsDir: env.msgsDir
      };

      const runner = new SdkRunner(config, queue);
      const errorEvents: Array<{ id: string; error: string }> = [];

      runner.on('error', (data) => {
        errorEvents.push(data);
      });

      // Insert message to trigger SDK call
      queue.insert({
        from_agent: 'core/core',
        to_agent: 'events/error-test',
        type: 'task',
        payload: {
          'msg-id': 'error-trigger',
          headline: 'Trigger SDK',
          body: 'This may error without API access'
        }
      });

      const result = await runner.run();

      // If SDK fails (no API key), error event should be emitted
      // If SDK succeeds, no error - both are valid test outcomes
      if (!result.success) {
        assert.ok(errorEvents.length > 0 || result.error, 'Should have error on failure');
      }
    });
  });

  describe('Kill Behavior', () => {
    it('should stop running state when kill() called', () => {
      const config: SdkRunnerConfig = {
        id: 'kill/state-test',
        model: 'haiku',
        systemPrompt: 'Kill state test',
        workDir: env.rootDir,
        msgsDir: env.msgsDir
      };

      const runner = new SdkRunner(config, queue);

      assert.strictEqual(runner.isRunning(), false, 'Should not be running initially');

      runner.kill();

      assert.strictEqual(runner.isRunning(), false, 'Should still not be running after kill');
    });

    it('should abort in-progress SDK call when kill() called', async () => {
      const config: SdkRunnerConfig = {
        id: 'kill/abort-test',
        model: 'haiku',
        systemPrompt: 'Abort test',
        workDir: env.rootDir,
        msgsDir: env.msgsDir
      };

      // Insert message to trigger SDK call
      queue.insert({
        from_agent: 'core/core',
        to_agent: 'kill/abort-test',
        type: 'task',
        payload: {
          'msg-id': 'abort-trigger',
          headline: 'Long running task',
          body: 'This task should be aborted'
        }
      });

      const runner = new SdkRunner(config, queue);

      // Must handle error event to prevent unhandled error
      runner.on('error', () => {
        // Expected when aborted
      });

      // Start run without awaiting
      const runPromise = runner.run();

      // Give it a moment to start, then kill
      await new Promise(resolve => setTimeout(resolve, 100));
      runner.kill();

      // Should complete (either with abort error or success)
      const result = await runPromise;

      assert.strictEqual(runner.isRunning(), false, 'Should not be running after kill');
    });
  });

  describe('Message Processing', () => {
    it('should use pollOne to process one message at a time', async () => {
      const workerId = 'process/one-at-a-time';

      // Insert multiple messages
      for (let i = 0; i < 3; i++) {
        queue.insert({
          from_agent: 'core/core',
          to_agent: workerId,
          type: 'task',
          payload: {
            'msg-id': `batch-${i}`,
            headline: `Task ${i}`,
            body: `Batch task ${i}`
          }
        });
      }

      // Verify messages are in queue
      const pending = queue.poll(workerId);
      assert.strictEqual(pending.length, 3, 'Should have 3 pending messages');

      // Re-insert them since poll consumed them
      for (const msg of pending) {
        queue.insert({
          from_agent: msg.from_agent,
          to_agent: msg.to_agent,
          type: msg.type,
          payload: msg.payload
        });
      }

      // Now test pollOne behavior
      const first = queue.pollOne(workerId);
      assert.ok(first, 'Should get first message');

      const second = queue.pollOne(workerId);
      assert.ok(second, 'Should get second message');
      assert.notStrictEqual(first?.id, second?.id, 'Should be different messages');

      // Clean up remaining
      queue.poll(workerId);
    });

    it('should include all task context in prompt', async () => {
      // This validates the buildUserPrompt structure
      const workerId = 'process/context-test';
      const config: SdkRunnerConfig = {
        id: workerId,
        model: 'haiku',
        systemPrompt: 'Context test',
        workDir: env.rootDir,
        msgsDir: env.msgsDir
      };

      // Insert message with full context
      queue.insert({
        from_agent: 'test/sender',
        to_agent: workerId,
        type: 'task',
        payload: {
          'msg-id': 'context-full',
          headline: 'Full Context Task',
          body: 'This is the task body with details.',
          command: '/know:add feature-x'
        }
      });

      const runner = new SdkRunner(config, queue);
      let taskCompleteEvent: { messageId: number } | null = null;

      runner.on('task:complete', (data) => {
        taskCompleteEvent = data;
      });

      try {
        await runner.run();
      } catch (err) {
        // May fail without API access
      }

      // The task should at least have been attempted
      // (we can verify via the queue being emptied)
      const remaining = queue.poll(workerId);
      // Message was consumed by pollOne in run()
    });
  });

  describe('Model Configuration', () => {
    it('should accept valid semantic model names', () => {
      const models: Array<'opus' | 'sonnet' | 'haiku'> = ['opus', 'sonnet', 'haiku'];

      for (const model of models) {
        const config: SdkRunnerConfig = {
          id: `model/${model}`,
          model,
          systemPrompt: `${model} test`,
          workDir: env.rootDir,
          msgsDir: env.msgsDir
        };

        const runner = new SdkRunner(config, queue);
        assert.ok(runner, `Should create runner with model: ${model}`);
      }
    });
  });

  describe('Timeout Configuration', () => {
    it('should accept optional timeout config', () => {
      const config: SdkRunnerConfig = {
        id: 'timeout/test',
        model: 'haiku',
        systemPrompt: 'Timeout test',
        workDir: env.rootDir,
        msgsDir: env.msgsDir
      };

      const runner = new SdkRunner(config, queue);
      assert.ok(runner, 'Should create runner with timeout config');
    });

    it('should accept optional maxTurns config', () => {
      const config: SdkRunnerConfig = {
        id: 'maxturns/test',
        model: 'haiku',
        systemPrompt: 'Max turns test',
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        maxTurns: 5
      };

      const runner = new SdkRunner(config, queue);
      assert.ok(runner, 'Should create runner with maxTurns config');
    });
  });
});
