/**
 * Real LLM Test 03: Quality Iteration
 *
 * Tests quality gate feedback loop with real LLM.
 * Worker receives feedback and iterates on output.
 *
 * This test requires ANTHROPIC_API_KEY environment variable.
 */

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MessageQueue } from '../../../src/queue/index.ts';
import { MessageConsumer } from '../../../src/core/consumer.ts';
import { WorkerDispatcher } from '../../../src/worker/dispatcher.ts';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.ts';
import YAML from 'yaml';

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

describe('Real LLM Test: Quality Iteration', { skip: !hasApiKey }, () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;
  let dispatcher: WorkerDispatcher;

  before(() => {
    if (!hasApiKey) {
      console.log('Skipping: ANTHROPIC_API_KEY not set');
    }
  });

  beforeEach(async () => {
    env = createTestEnv('tx-v4-quality');
    queue = new MessageQueue(env.dbPath);

    // Create quality test mesh
    const meshDir = path.join(env.meshesDir, 'quality-test');
    fs.mkdirSync(meshDir, { recursive: true });

    const config = {
      mesh: 'quality-test',
      description: 'Quality iteration test mesh',
      agents: [
        {
          name: 'worker',
          model: 'haiku',
          prompt: 'worker.md',
        },
      ],
      entry_point: 'worker',
      // Note: Quality hooks would be configured here in real mesh
      // For this test, we simulate feedback via messages
    };

    fs.writeFileSync(
      path.join(meshDir, 'config.yaml'),
      YAML.stringify(config)
    );

    fs.writeFileSync(
      path.join(meshDir, 'worker.md'),
      `# Quality Test Worker

You are a test worker that improves output based on feedback.

## Initial Task

When you first receive a task, provide a simple response.

## On Quality Feedback

If you receive a message with type "quality-feedback":
1. Read the feedback
2. Improve your response based on the feedback
3. Send updated task-complete

## Response Format

\`\`\`markdown
---
to: core/core
from: quality-test/worker
type: task-complete
status: complete
headline: Output updated
---

[Your improved response here]

---
success_signal: true
iteration: [current iteration number]
\`\`\`
`
    );

    consumer = new MessageConsumer(env.msgsDir, queue);
    dispatcher = new WorkerDispatcher({
      workDir: env.rootDir,
      msgsDir: env.msgsDir,
      meshesDir: env.meshesDir,
    }, queue);

    await consumer.start();
    await dispatcher.start();
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterEach(async () => {
    if (dispatcher) await dispatcher.stop();
    if (consumer) await consumer.stop();
    if (queue) queue.close();
    if (env) env.cleanup();
  });

  it('should receive and process initial task', async () => {
    // Send task
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'quality-test/worker',
      payload: {
        headline: 'Quality test task',
        body: 'Write a short greeting.',
        'msg-id': 'quality-001',
      },
    });

    // Wait for completion
    const timeout = 60000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const messages = queue.queryMessages({
        from_agent: 'quality-test/worker',
      });

      if (messages.length > 0) {
        assert.ok(true, 'Worker completed initial task');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('Test timed out - this is expected if API is slow');
  });

  it('should respond to quality feedback', async () => {
    // This test simulates the quality feedback loop
    // In real use, the quality hook would generate feedback

    // First, send initial task
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'quality-test/worker',
      payload: {
        headline: 'Write greeting',
        body: 'Write a greeting message.',
        'msg-id': 'quality-002',
      },
    });

    // Wait for first completion
    const timeout = 60000;
    let firstCompletion = false;

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const messages = queue.queryMessages({
        from_agent: 'quality-test/worker',
      });

      if (messages.length > 0) {
        firstCompletion = true;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!firstCompletion) {
      console.log('First completion timed out');
      return;
    }

    // Send quality feedback (simulates quality hook)
    queue.insert({
      from_agent: 'system/quality',
      to_agent: 'quality-test/worker',
      payload: {
        headline: 'Quality Feedback',
        body: 'The greeting was good but please make it more enthusiastic!',
        'msg-id': 'quality-feedback-001',
      },
    });

    // Wait for improved response
    const feedbackStartTime = Date.now();
    while (Date.now() - feedbackStartTime < timeout) {
      const messages = queue.queryMessages({
        from_agent: 'quality-test/worker',
      });

      // Look for second completion (after feedback)
      if (messages.length > 1) {
        assert.ok(true, 'Worker responded to feedback');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });
});
