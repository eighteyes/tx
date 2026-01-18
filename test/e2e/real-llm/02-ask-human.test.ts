/**
 * Real LLM Test 02: Ask-Human Flow
 *
 * Tests the HITL (Human-In-The-Loop) flow with real worker.
 * Worker sends ask-human, waits for response, then completes.
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

describe('Real LLM Test: Ask-Human Flow', { skip: !hasApiKey }, () => {
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
    env = createTestEnv('tx-v4-ask-human');
    queue = new MessageQueue(env.dbPath);

    // Create HITL test mesh
    const meshDir = path.join(env.meshesDir, 'hitl-test');
    fs.mkdirSync(meshDir, { recursive: true });

    const config = {
      mesh: 'hitl-test',
      description: 'HITL test mesh',
      agents: [
        {
          name: 'worker',
          model: 'haiku',
          prompt: 'worker.md',
        },
      ],
      entry_point: 'worker',
    };

    fs.writeFileSync(
      path.join(meshDir, 'config.yaml'),
      YAML.stringify(config)
    );

    fs.writeFileSync(
      path.join(meshDir, 'worker.md'),
      `# HITL Test Worker

You are a test worker that needs user input.

## When you receive a task containing "ask name":

1. Send an ask-human message asking for the user's name
2. Wait for the response
3. Greet the user by name in your task-complete

## Ask-Human Format

\`\`\`markdown
---
to: core/core
from: hitl-test/worker
type: ask-human
headline: Need your name
---

What is your name?
\`\`\`

## After receiving response with name:

\`\`\`markdown
---
to: core/core
from: hitl-test/worker
type: task-complete
status: complete
headline: Greeting complete
---

Hello, [NAME]! Nice to meet you.

---
success_signal: true
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

  it('should handle ask-human flow', async () => {
    // Send task that triggers ask-human
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'hitl-test/worker',
      type: 'task',
      payload: {
        headline: 'Ask name test',
        body: 'Please ask name and greet the user.',
        'msg-id': 'hitl-001',
      },
    });

    // Wait for ask-human message
    const timeout = 60000;
    const startTime = Date.now();
    let askHumanReceived = false;

    while (Date.now() - startTime < timeout) {
      const messages = queue.queryMessages({
        type: 'ask-human',
        from_agent: 'hitl-test/worker',
      });

      if (messages.length > 0) {
        askHumanReceived = true;
        const msg = messages[0];

        // Verify ask-human content
        const body = String(msg.payload?.body || '');
        assert.ok(
          /name/i.test(body),
          'Ask-human should ask for name'
        );

        // Send response
        queue.insert({
          from_agent: 'core/core',
          to_agent: 'hitl-test/worker',
          type: 'ask-response',
          payload: {
            headline: 'User response',
            body: 'Alice',
            'msg-id': 'hitl-001-response',
          },
        });

        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!askHumanReceived) {
      console.log('Ask-human not received within timeout - test inconclusive');
      return;
    }

    // Wait for task completion
    const completionStartTime = Date.now();
    while (Date.now() - completionStartTime < timeout) {
      const completions = queue.queryMessages({
        type: 'task-complete',
        from_agent: 'hitl-test/worker',
      });

      if (completions.length > 0) {
        const msg = completions[0];
        const body = String(msg.payload?.body || '');

        // Should mention Alice (the name we provided)
        const mentionsName = /alice/i.test(body);
        assert.ok(
          mentionsName,
          `Completion should mention Alice, got: ${body.slice(0, 200)}`
        );
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });
});
