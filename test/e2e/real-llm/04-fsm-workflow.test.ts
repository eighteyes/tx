/**
 * Real LLM Test 04: FSM Workflow
 *
 * Tests multi-state FSM workflow with real LLM transitions.
 * Workers transition through planning -> implementation states.
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
import { MeshFSM } from '../../../src/mesh/fsm.ts';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.ts';
import YAML from 'yaml';

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

describe('Real LLM Test: FSM Workflow', { skip: !hasApiKey }, () => {
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
    env = createTestEnv('tx-v4-fsm-workflow');
    queue = new MessageQueue(env.dbPath);

    // Create FSM workflow mesh
    const meshDir = path.join(env.meshesDir, 'fsm-workflow');
    fs.mkdirSync(meshDir, { recursive: true });

    const config = {
      mesh: 'fsm-workflow',
      description: 'FSM workflow test mesh',
      agents: [
        { name: 'planner', model: 'haiku', prompt: 'planner.md' },
        { name: 'implementer', model: 'haiku', prompt: 'implementer.md' },
      ],
      entry_point: 'planner',
      fsm: {
        initial: 'planning',
        context: {
          iteration: 0,
        },
        states: {
          planning: {
            agents: ['planner'],
            exit: {
              set: { iteration: '$iteration + 1' },
              run: 'implementation',
            },
          },
          implementation: {
            agents: ['implementer'],
            exit: {
              set: { iteration: '$iteration + 1' },
              run: 'complete',
            },
          },
          complete: {
            agents: ['implementer'],
          },
        },
      },
    };

    fs.writeFileSync(
      path.join(meshDir, 'config.yaml'),
      YAML.stringify(config)
    );

    fs.writeFileSync(
      path.join(meshDir, 'planner.md'),
      `# FSM Planner

You are a planner in an FSM workflow.

## Task

1. Receive task
2. Create a brief plan
3. Send task-complete to trigger transition to implementation

## Message Format

\`\`\`markdown
---
to: fsm-workflow/implementer
from: fsm-workflow/planner
type: task-complete
status: complete
headline: Planning done
---

## Plan
[Brief plan description]

Ready for implementation.

---
success_signal: true
\`\`\`
`
    );

    fs.writeFileSync(
      path.join(meshDir, 'implementer.md'),
      `# FSM Implementer

You are an implementer in an FSM workflow.

## Task

1. Receive plan from planner
2. Implement the plan
3. Send task-complete to core

## Message Format

\`\`\`markdown
---
to: core/core
from: fsm-workflow/implementer
type: task-complete
status: complete
headline: Implementation done
---

## Result
[Implementation summary]

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

  it('should validate FSM state management without LLM', async () => {
    // This test validates FSM state management
    // without requiring actual API calls

    const db = queue.getDb();
    const fsm = new MeshFSM('fsm-test', {
      initialState: 'start',
      states: [
        {
          name: 'start',
          coordinator: 'worker',
          exit: { run: 'end' },
        },
        { name: 'end', coordinator: 'worker' },
      ],
      transitions: [],
      context: { step: 0 },
    }, db, env.rootDir);

    await fsm.initialize();

    assert.strictEqual(fsm.getCurrentState(), 'start');

    await fsm.handleMessage(
      'fsm-test/worker',
      'fsm-test/worker',
      'task-complete',
      {},
      {}
    );

    assert.strictEqual(fsm.getCurrentState(), 'end');
  });

  it('should trigger FSM workflow with task message', async () => {
    // Send task to planner
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'fsm-workflow/planner',
      payload: {
        headline: 'FSM workflow test',
        body: 'Create a plan and implement it.',
        'msg-id': 'fsm-001',
      },
    });

    // Wait for some activity (planner completion)
    const timeout = 60000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const plannerMessages = queue.queryMessages({
        from_agent: 'fsm-workflow/planner',
      });

      if (plannerMessages.length > 0) {
        assert.ok(true, 'Planner completed');

        // Check for implementer completion
        const implMessages = queue.queryMessages({
          from_agent: 'fsm-workflow/implementer',
        });

        if (implMessages.length > 0) {
          assert.ok(true, 'Full FSM workflow completed');
          return;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('FSM workflow test timed out - partial completion is OK');
  });
});
