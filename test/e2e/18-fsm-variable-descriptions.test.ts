/**
 * Test 18: FSM Variable Descriptions
 *
 * E2E test verifying that FSM context variable descriptions are:
 * 1. Stored correctly in MeshFSM
 * 2. Exposed via getContextDescriptions() getter
 * 3. Injected into agent prompts in the correct format
 *
 * This tests Phase 0.5 from the quality pass plan.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MeshFSM } from '../../src/mesh/fsm.ts';
import { PromptInjector, type FSMInjectionContext } from '../../src/workspace/injector.ts';
import type { FSMConfig, FSMStateConfig } from '../../src/shared/types.ts';

describe('FSM Variable Descriptions', () => {
  let testDir: string;
  let db: Database.Database;
  let injector: PromptInjector;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-v4-fsm-descriptions-'));
    db = new Database(':memory:');
    injector = new PromptInjector();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('stores context_descriptions in FSM and exposes via getter', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        {
          name: 'working',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        iteration: 0,
        workspace: '/workspace/test',
        max_retries: 3,
      },
      context_descriptions: {
        iteration: 'Current iteration number, increments after each attempt',
        workspace: 'Isolated git worktree for this feature',
        max_retries: 'Maximum attempts before escalating to user',
      },
    };

    const fsm = new MeshFSM('description-test', config, db, testDir);
    await fsm.initialize();

    // Verify descriptions are stored and accessible
    const descriptions = fsm.getContextDescriptions();
    assert.strictEqual(descriptions.iteration, 'Current iteration number, increments after each attempt');
    assert.strictEqual(descriptions.workspace, 'Isolated git worktree for this feature');
    assert.strictEqual(descriptions.max_retries, 'Maximum attempts before escalating to user');
  });

  test('returns empty object when no descriptions defined', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        {
          name: 'working',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        iteration: 0,
      },
      // No context_descriptions defined
    };

    const fsm = new MeshFSM('no-descriptions', config, db, testDir);
    await fsm.initialize();

    const descriptions = fsm.getContextDescriptions();
    assert.deepStrictEqual(descriptions, {});
  });

  test('prompt injection includes descriptions in correct format', async () => {
    const basePrompt = '# Test Agent\n\nYou are a test agent.';

    const stateConfig: FSMStateConfig = {
      name: 'working',
      coordinator: 'worker',
    };

    const fsmContext: FSMInjectionContext = {
      meshName: 'test-mesh',
      currentState: 'working',
      stateConfig,
      context: {
        iteration: 1,
        workspace: '/workspace/tx-cli-v4',
        max_retries: 3,
      },
      contextDescriptions: {
        iteration: 'Current iteration number, increments after each attempt',
        workspace: 'Isolated git worktree for this feature',
        max_retries: 'Maximum attempts before escalating to user',
      },
      gateRetries: {},
    };

    const result = injector.injectFSMContext(basePrompt, fsmContext);

    // Verify the output contains FSM Context Variables section
    assert.ok(result.includes('## FSM Context Variables'), 'Should contain FSM Context Variables header');

    // Verify each variable with its description is present
    assert.ok(result.includes('- **iteration**: 1'), 'Should show iteration variable');
    assert.ok(result.includes('_Current iteration number, increments after each attempt_'), 'Should show iteration description');

    assert.ok(result.includes('- **workspace**: /workspace/tx-cli-v4'), 'Should show workspace variable');
    assert.ok(result.includes('_Isolated git worktree for this feature_'), 'Should show workspace description');

    assert.ok(result.includes('- **max_retries**: 3'), 'Should show max_retries variable');
    assert.ok(result.includes('_Maximum attempts before escalating to user_'), 'Should show max_retries description');
  });

  test('variables without descriptions are shown without description line', async () => {
    const basePrompt = '# Test Agent';

    const stateConfig: FSMStateConfig = {
      name: 'working',
      coordinator: 'worker',
    };

    const fsmContext: FSMInjectionContext = {
      meshName: 'test-mesh',
      currentState: 'working',
      stateConfig,
      context: {
        iteration: 1,
        workspace: '/workspace/test',
        undocumented_var: 'some value',
      },
      contextDescriptions: {
        iteration: 'Current iteration number',
        workspace: 'Isolated git worktree for this feature',
        // undocumented_var has no description
      },
      gateRetries: {},
    };

    const result = injector.injectFSMContext(basePrompt, fsmContext);

    // Verify documented variables have descriptions
    assert.ok(result.includes('_Current iteration number_'), 'Should show iteration description');
    assert.ok(result.includes('_Isolated git worktree for this feature_'), 'Should show workspace description');

    // Verify undocumented variable is shown but without description
    assert.ok(result.includes('- **undocumented_var**: some value'), 'Should show undocumented variable');
    // Count occurrences of underscores followed by text (description format) - should be 2, not 3
    const descriptionMatches = result.match(/_[^_]+_/g) || [];
    // Should have descriptions for iteration and workspace only
    assert.strictEqual(descriptionMatches.length, 2, 'Should only have 2 descriptions (iteration and workspace)');
  });

  test('descriptions remain consistent when context values update', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        {
          name: 'working',
          coordinator: 'worker',
          exit: {
            set: {
              iteration: '$iteration + 1',
            },
            when: [
              { condition: 'iteration == "3"', target: 'complete' },
            ],
            default: 'working',
          },
        },
        {
          name: 'complete',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        iteration: 0,
      },
      context_descriptions: {
        iteration: 'Current iteration number, increments after each attempt',
      },
    };

    const fsm = new MeshFSM('update-test', config, db, testDir);
    await fsm.initialize();

    // Verify initial descriptions
    let descriptions = fsm.getContextDescriptions();
    assert.strictEqual(descriptions.iteration, 'Current iteration number, increments after each attempt');

    // Update context via message handling
    await fsm.handleMessage('update-test/worker', 'update-test/worker', 'task-complete', {}, {});

    // Verify context value changed
    assert.strictEqual(fsm.getContext().iteration, '1');

    // Verify descriptions remain unchanged
    descriptions = fsm.getContextDescriptions();
    assert.strictEqual(descriptions.iteration, 'Current iteration number, increments after each attempt');

    // Another update
    await fsm.handleMessage('update-test/worker', 'update-test/worker', 'task-complete', {}, {});
    assert.strictEqual(fsm.getContext().iteration, '2');

    // Descriptions still consistent
    descriptions = fsm.getContextDescriptions();
    assert.strictEqual(descriptions.iteration, 'Current iteration number, increments after each attempt');
  });

  test('handles complex context values with descriptions', async () => {
    const basePrompt = '# Test Agent';

    const stateConfig: FSMStateConfig = {
      name: 'working',
      coordinator: 'worker',
    };

    const fsmContext: FSMInjectionContext = {
      meshName: 'test-mesh',
      currentState: 'working',
      stateConfig,
      context: {
        simple_value: 42,
        object_value: { nested: 'data', count: 5 },
        array_like: 'item1,item2,item3',
      },
      contextDescriptions: {
        simple_value: 'A simple numeric counter',
        object_value: 'Complex configuration object',
        array_like: 'Comma-separated list of items',
      },
      gateRetries: {},
    };

    const result = injector.injectFSMContext(basePrompt, fsmContext);

    // Verify simple value
    assert.ok(result.includes('- **simple_value**: 42'), 'Should show simple numeric value');
    assert.ok(result.includes('_A simple numeric counter_'), 'Should show simple value description');

    // Verify object is stringified
    assert.ok(result.includes('{"nested":"data","count":5}'), 'Should show stringified object');
    assert.ok(result.includes('_Complex configuration object_'), 'Should show object description');

    // Verify string value
    assert.ok(result.includes('- **array_like**: item1,item2,item3'), 'Should show string value');
    assert.ok(result.includes('_Comma-separated list of items_'), 'Should show array_like description');
  });

  test('getContextDescriptions returns a copy not a reference', async () => {
    const config: FSMConfig = {
      initialState: 'working',
      states: [
        {
          name: 'working',
          coordinator: 'worker',
        },
      ],
      transitions: [],
      context: {
        iteration: 0,
      },
      context_descriptions: {
        iteration: 'Original description',
      },
    };

    const fsm = new MeshFSM('copy-test', config, db, testDir);
    await fsm.initialize();

    // Get descriptions and modify the returned object
    const descriptions1 = fsm.getContextDescriptions();
    descriptions1.iteration = 'Modified description';
    descriptions1.newKey = 'New value';

    // Get descriptions again - should be unchanged
    const descriptions2 = fsm.getContextDescriptions();
    assert.strictEqual(descriptions2.iteration, 'Original description', 'Should return original description');
    assert.strictEqual(descriptions2.newKey, undefined, 'Should not have new key');
  });
});
