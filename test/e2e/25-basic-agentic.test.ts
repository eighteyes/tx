/**
 * E2E Test 25: Basic Agentic Tests
 *
 * Simple tests that verify the agentic plumbing works:
 * 1. Core responds to messages
 * 2. Test-echo mesh echoes input back
 *
 * Uses haiku model for cost efficiency.
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MessageQueue } from '../../src/queue/index.ts';
import { MessageConsumer } from '../../src/core/consumer.ts';
import { WorkerDispatcher } from '../../src/worker/dispatcher.ts';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';
import YAML from 'yaml';

// Skip if no API key
const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

describe('Basic Agentic E2E', { skip: !hasApiKey }, () => {
  let env: TestEnv;
  let queue: MessageQueue;
  let consumer: MessageConsumer;
  let dispatcher: WorkerDispatcher;

  beforeEach(async () => {
    env = createTestEnv('tx-v4-basic-agentic');
    queue = new MessageQueue(env.dbPath);

    // Copy the test-echo mesh from the real meshes directory
    const srcMeshDir = path.join(process.cwd(), 'meshes', 'test-echo');
    const dstMeshDir = path.join(env.meshesDir, 'test-echo');
    fs.mkdirSync(dstMeshDir, { recursive: true });

    // Copy config.yaml
    const configContent = fs.readFileSync(path.join(srcMeshDir, 'config.yaml'), 'utf-8');
    fs.writeFileSync(path.join(dstMeshDir, 'config.yaml'), configContent);

    // Copy prompt.md
    const promptContent = fs.readFileSync(path.join(srcMeshDir, 'prompt.md'), 'utf-8');
    fs.writeFileSync(path.join(dstMeshDir, 'prompt.md'), promptContent);

    // Also create a simple-responder mesh for core test
    const responderDir = path.join(env.meshesDir, 'simple-responder');
    fs.mkdirSync(responderDir, { recursive: true });

    const responderConfig = {
      mesh: 'simple-responder',
      description: 'Simple responder for testing core message flow',
      agents: [
        {
          name: 'worker',
          model: 'haiku',
          prompt: 'prompt.md',
        },
      ],
      entry_point: 'worker',
      routing: {
        worker: {
          complete: {
            core: 'Response complete',
          },
        },
      },
    };

    fs.writeFileSync(
      path.join(responderDir, 'config.yaml'),
      YAML.stringify(responderConfig)
    );

    fs.writeFileSync(
      path.join(responderDir, 'prompt.md'),
      `# Simple Responder

You are a test responder. When you receive a task, acknowledge it with a brief response.

## Instructions

1. Read the task
2. Write a task-complete message acknowledging the task

## Message Format

Write a message file to .ai/tx/msgs/ with this format:

\`\`\`markdown
---
to: core/core
from: simple-responder/worker
type: task-complete
status: complete
headline: Task acknowledged
---

I received your task and acknowledge it.

---
success_signal: true
\`\`\`
`
    );

    // Initialize consumer and dispatcher
    consumer = new MessageConsumer(env.msgsDir, queue);
    dispatcher = new WorkerDispatcher({
      workDir: env.rootDir,
      msgsDir: env.msgsDir,
      meshesDir: env.meshesDir,
    }, queue);

    await consumer.start();
    await dispatcher.start();

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterEach(async () => {
    if (dispatcher) await dispatcher.stop();
    if (consumer) await consumer.stop();
    if (queue) queue.close();
    if (env) env.cleanup();
  });

  it('should receive response from worker mesh', { timeout: 30000 }, async () => {
    // Send task to simple-responder/worker
    const taskId = queue.insert({
      from_agent: 'core/core',
      to_agent: 'simple-responder/worker',
      type: 'task',
      payload: {
        headline: 'Basic test',
        body: 'Please acknowledge this message.',
        'msg-id': 'basic-agentic-001',
      },
    });

    assert.ok(taskId > 0, 'Task should be inserted');

    // Wait for task-complete response
    const timeout = 30000;
    const startTime = Date.now();
    let completed = false;

    while (Date.now() - startTime < timeout) {
      const messages = queue.queryMessages({
        type: 'task-complete',
        from_agent: 'simple-responder/worker',
      });

      if (messages.length > 0) {
        completed = true;
        const msg = messages[0];

        // Verify we got a response
        assert.ok(msg.payload, 'Response should have payload');
        assert.strictEqual(msg.type, 'task-complete', 'Should be task-complete type');
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    assert.ok(completed, 'Should receive task-complete within timeout');
  });

  it('should echo input via test-echo mesh', { timeout: 30000 }, async () => {
    const testMessage = 'hello world';

    // Send task to test-echo/echo
    const taskId = queue.insert({
      from_agent: 'core/core',
      to_agent: 'test-echo/echo',
      type: 'task',
      payload: {
        headline: 'Echo test',
        body: testMessage,
        'msg-id': 'echo-test-001',
      },
    });

    assert.ok(taskId > 0, 'Task should be inserted');

    // Wait for echo response
    const timeout = 30000;
    const startTime = Date.now();
    let completed = false;

    while (Date.now() - startTime < timeout) {
      const messages = queue.queryMessages({
        type: 'task-complete',
        from_agent: 'test-echo/echo',
      });

      if (messages.length > 0) {
        completed = true;
        const msg = messages[0];
        const body = String(msg.payload?.body || '');

        // Verify response contains ECHO: and our message
        assert.ok(
          /ECHO:/i.test(body) && /hello world/i.test(body),
          `Response should contain "ECHO: hello world", got: ${body.slice(0, 200)}`
        );
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    assert.ok(completed, 'Should receive echo response within timeout');
  });
});
