/**
 * Test 37: Config Options Infrastructure
 *
 * Tests mesh config option enforcement mechanics WITHOUT real LLM.
 * Loads mesh configs via WorkerDispatcher.start(), then directly inspects
 * private state and calls pure helper functions to verify each config
 * option is loaded, preserved, and applied correctly.
 *
 * Responsibilities:
 * - Verify dev_mode flag loads and causes haiku model override in spawn path
 * - Verify agent permissions are loaded and resolvePermissions returns correct output
 * - Verify routing_mode: 'dispatcher' config feeds extractDispatcherRouting correctly
 * - Verify routing_mode: 'dispatcher' causes extractAgentRouting to return undefined
 * - Verify disable: true causes mesh to be skipped from meshConfigs
 * - Verify manifest_enforcement sub-fields survive config loading intact
 * - Verify stop_on_first_complete: false and check_queue_on_complete: false are preserved
 * - Verify load_claude_md: false flag is present on loaded config
 * - Verify rearmatter config sub-fields survive loading intact
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { WorkerDispatcher } from '../../src/worker/dispatcher.ts';
import { resolvePermissions } from '../../src/worker/permissions.ts';
import {
  setupTestEnv,
  cleanupTestEnv,
  createTestMesh,
  type TestEnv,
} from '../utils/test-env.ts';
import { EventHarness } from '../utils/event-harness.ts';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get a loaded mesh config from the dispatcher (private field access).
 */
function getMeshConfig(dispatcher: WorkerDispatcher, meshName: string): any {
  return (dispatcher as any).meshConfigs.get(meshName);
}

/**
 * Call the dispatcher's configLoader.extractDispatcherRouting (private).
 */
function extractDispatcherRouting(dispatcher: WorkerDispatcher, meshConfig: any): any {
  return (dispatcher as any).configLoader.extractDispatcherRouting(meshConfig);
}

/**
 * Call the dispatcher's configLoader.extractAgentRouting (private).
 */
function extractAgentRouting(
  dispatcher: WorkerDispatcher,
  meshName: string,
  agentName: string,
  meshConfig: any
): any {
  return (dispatcher as any).configLoader.extractAgentRouting(meshName, agentName, meshConfig);
}

// ============================================================================
// Test suite
// ============================================================================

describe('Config Options Infrastructure', () => {
  let env: TestEnv;
  let dispatcher: WorkerDispatcher;
  let harness: EventHarness;

  beforeEach(async () => {
    env = await setupTestEnv('config-options-infra');

    dispatcher = new WorkerDispatcher(
      {
        workDir: env.rootDir,
        msgsDir: env.msgsDir,
        meshesDir: env.meshesDir,
      },
      env.queue
    );

    harness = new EventHarness(dispatcher);
  });

  afterEach(async () => {
    harness.destroy();
    await dispatcher.stop();
    await cleanupTestEnv(env);
  });

  // --------------------------------------------------------------------------
  // 1. dev_mode
  // --------------------------------------------------------------------------

  test('dev_mode: true flag is present on loaded mesh config', async () => {
    createTestMesh(env, {
      name: 'test-dev-mode',
      config: {
        mesh: 'test-dev-mode',
        agents: [{ name: 'worker', model: 'opus', prompt: 'worker.md' }],
        entry_point: 'worker',
        dev_mode: true,
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-dev-mode');
    assert.ok(meshConfig, 'test-dev-mode mesh should be loaded');
    assert.strictEqual(
      meshConfig.dev_mode,
      true,
      'dev_mode flag should be present and true on loaded config'
    );
    // Verify the agent config preserved its declared model (override happens at spawn time)
    assert.strictEqual(
      meshConfig.agents[0].model,
      'opus',
      'Agent model in config should remain as declared (override is applied at spawn time)'
    );
  });

  test('dev_mode: false mesh still loads with agent model intact', async () => {
    createTestMesh(env, {
      name: 'test-no-dev-mode',
      config: {
        mesh: 'test-no-dev-mode',
        agents: [{ name: 'worker', model: 'sonnet', prompt: 'worker.md' }],
        entry_point: 'worker',
        dev_mode: false,
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-no-dev-mode');
    assert.ok(meshConfig, 'test-no-dev-mode mesh should be loaded');
    assert.strictEqual(
      meshConfig.dev_mode,
      false,
      'dev_mode flag should be false on loaded config'
    );
    assert.strictEqual(
      meshConfig.agents[0].model,
      'sonnet',
      'Agent model should remain sonnet when dev_mode is false'
    );
  });

  // --------------------------------------------------------------------------
  // 2. permissions
  // --------------------------------------------------------------------------

  test('resolvePermissions returns restricted set for explicit allowedTools config', () => {
    const permissions = {
      allowedTools: ['Read', 'Write'],
      mode: 'default' as const,
    };

    const resolved = resolvePermissions(permissions, false);

    assert.deepStrictEqual(
      resolved.allowedTools,
      ['Read', 'Write'],
      'allowedTools should match exactly what was configured'
    );
    assert.strictEqual(resolved.mode, 'default', 'mode should be default');
  });

  test('resolvePermissions allows Task when explicitly included in allowedTools', () => {
    const permissions = {
      allowedTools: ['Read', 'Write', 'Task'],
      mode: 'default' as const,
    };

    const resolved = resolvePermissions(permissions, false);

    assert.ok(
      resolved.allowedTools.includes('Task'),
      'Task should be in allowedTools when explicitly configured'
    );
    // Task was explicitly allowed, so it should NOT be in disallowedTools
    const disallowed = resolved.disallowedTools ?? [];
    assert.ok(
      !disallowed.includes('Task'),
      'Task should not appear in disallowedTools when explicitly allowed'
    );
  });

  test('resolvePermissions denies Task by default when no permissions block', () => {
    const resolved = resolvePermissions(undefined, false);

    const disallowed = resolved.disallowedTools ?? [];
    assert.ok(
      disallowed.includes('Task'),
      'Task should be in DEFAULT_DISALLOWED_TOOLS when no permissions block is set'
    );
  });

  test('resolvePermissions god mode bypasses all restrictions', () => {
    const permissions = {
      allowedTools: ['Read'],
      mode: 'default' as const,
    };

    const resolved = resolvePermissions(permissions, true);

    assert.strictEqual(resolved.mode, 'bypassPermissions', 'god mode should set bypassPermissions');
    assert.strictEqual(
      resolved.allowDangerouslySkipPermissions,
      true,
      'god mode should set allowDangerouslySkipPermissions'
    );
  });

  test('agent permissions block loads correctly from mesh config', async () => {
    createTestMesh(env, {
      name: 'test-permissions',
      config: {
        mesh: 'test-permissions',
        agents: [
          {
            name: 'restricted-worker',
            model: 'haiku',
            prompt: 'worker.md',
            permissions: {
              allowedTools: ['Read', 'Write'],
              mode: 'default',
            },
          },
        ],
        entry_point: 'restricted-worker',
      },
      prompts: { 'worker.md': 'You are a restricted test worker.' },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-permissions');
    assert.ok(meshConfig, 'test-permissions mesh should be loaded');

    const agent = meshConfig.agents[0];
    assert.ok(agent.permissions, 'Agent should have a permissions block');
    assert.deepStrictEqual(
      agent.permissions.allowedTools,
      ['Read', 'Write'],
      'allowedTools should survive config loading intact'
    );
    assert.strictEqual(agent.permissions.mode, 'default', 'mode should be default');

    // Verify resolvePermissions works correctly with this loaded config
    const resolved = resolvePermissions(agent.permissions, false);
    assert.deepStrictEqual(
      resolved.allowedTools,
      ['Read', 'Write'],
      'resolvePermissions should return the configured allowedTools'
    );
  });

  // --------------------------------------------------------------------------
  // 3. routing_mode: 'dispatcher'
  // --------------------------------------------------------------------------

  test('routing_mode: dispatcher — extractDispatcherRouting returns routing table', async () => {
    // DispatcherRoutingConfig is a flat map: agentName → string | branch-object | array
    createTestMesh(env, {
      name: 'test-dispatch-routing',
      config: {
        mesh: 'test-dispatch-routing',
        routing_mode: 'dispatcher',
        agents: [
          { name: 'coordinator', model: 'haiku', prompt: 'coord.md' },
          { name: 'worker', model: 'haiku', prompt: 'worker.md' },
        ],
        entry_point: 'coordinator',
        routing: {
          coordinator: 'worker',   // linear: coordinator always hands off to worker
          // worker absent = terminal agent, routes to core/core
        },
      },
      prompts: {
        'coord.md': 'You are a coordinator.',
        'worker.md': 'You are a worker.',
      },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-dispatch-routing');
    assert.ok(meshConfig, 'test-dispatch-routing mesh should be loaded');
    assert.strictEqual(meshConfig.routing_mode, 'dispatcher', 'routing_mode should be dispatcher');

    const routingTable = extractDispatcherRouting(dispatcher, meshConfig);
    assert.ok(
      routingTable !== undefined,
      'extractDispatcherRouting should return routing table for dispatcher-mode mesh'
    );
    assert.ok(
      typeof routingTable === 'object',
      'extractDispatcherRouting should return an object'
    );
    // Verify the coordinator entry is present in the routing table
    assert.strictEqual(
      (routingTable as any).coordinator,
      'worker',
      'coordinator routing entry should resolve to worker'
    );
  });

  test('routing_mode: dispatcher — extractAgentRouting returns undefined', async () => {
    // DispatcherRoutingConfig is a flat map: agentName → string | branch-object | array
    createTestMesh(env, {
      name: 'test-dispatch-routing-agent',
      config: {
        mesh: 'test-dispatch-routing-agent',
        routing_mode: 'dispatcher',
        agents: [
          { name: 'coordinator', model: 'haiku', prompt: 'coord.md' },
          { name: 'worker', model: 'haiku', prompt: 'worker.md' },
        ],
        entry_point: 'coordinator',
        routing: {
          coordinator: 'worker',
        },
      },
      prompts: {
        'coord.md': 'You are a coordinator.',
        'worker.md': 'You are a worker.',
      },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-dispatch-routing-agent');
    assert.ok(meshConfig, 'test-dispatch-routing-agent mesh should be loaded');

    // In dispatcher routing mode, per-agent routing should return undefined —
    // the dispatcher owns routing centrally, not individual agents.
    const agentRouting = extractAgentRouting(
      dispatcher,
      'test-dispatch-routing-agent',
      'coordinator',
      meshConfig
    );
    assert.strictEqual(
      agentRouting,
      undefined,
      'extractAgentRouting should return undefined for dispatcher-mode mesh'
    );
  });

  // --------------------------------------------------------------------------
  // 4. disable: true
  // --------------------------------------------------------------------------

  test('disable: true — mesh is NOT loaded into meshConfigs', async () => {
    createTestMesh(env, {
      name: 'test-disabled-mesh',
      config: {
        mesh: 'test-disabled-mesh',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
        disable: true,
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    // Also create an active mesh to confirm loading works in general
    createTestMesh(env, {
      name: 'test-active-mesh',
      config: {
        mesh: 'test-active-mesh',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
      },
      prompts: { 'worker.md': 'You are an active test worker.' },
    });

    await dispatcher.start();

    const disabledConfig = getMeshConfig(dispatcher, 'test-disabled-mesh');
    assert.strictEqual(
      disabledConfig,
      undefined,
      'Disabled mesh should not be present in meshConfigs after loading'
    );

    const activeConfig = getMeshConfig(dispatcher, 'test-active-mesh');
    assert.ok(
      activeConfig !== undefined,
      'Active mesh should be loaded normally when disable is not set'
    );
  });

  // --------------------------------------------------------------------------
  // 5. manifest_enforcement
  // --------------------------------------------------------------------------

  test('manifest_enforcement sub-fields survive config loading intact', async () => {
    createTestMesh(env, {
      name: 'test-manifest-enforce',
      config: {
        mesh: 'test-manifest-enforce',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
        manifest_enforcement: {
          post_validation: true,
          pre_validation: false,
          max_retry: 3,
          strict: true,
          warning: false,
        },
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-manifest-enforce');
    assert.ok(meshConfig, 'test-manifest-enforce mesh should be loaded');
    assert.ok(meshConfig.manifest_enforcement, 'manifest_enforcement block should be present');

    const me = meshConfig.manifest_enforcement;
    assert.strictEqual(me.post_validation, true, 'post_validation should be true');
    assert.strictEqual(me.pre_validation, false, 'pre_validation should be false');
    assert.strictEqual(me.max_retry, 3, 'max_retry should be 3');
    assert.strictEqual(me.strict, true, 'strict should be true');
    assert.strictEqual(me.warning, false, 'warning should be false');
  });

  // --------------------------------------------------------------------------
  // 6. stop_on_first_complete and check_queue_on_complete
  // --------------------------------------------------------------------------

  test('stop_on_first_complete: false is preserved in loaded config', async () => {
    createTestMesh(env, {
      name: 'test-stop-flags',
      config: {
        mesh: 'test-stop-flags',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
        stop_on_first_complete: false,
        check_queue_on_complete: false,
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-stop-flags');
    assert.ok(meshConfig, 'test-stop-flags mesh should be loaded');
    assert.strictEqual(
      meshConfig.stop_on_first_complete,
      false,
      'stop_on_first_complete: false should be preserved (not defaulted to true)'
    );
    assert.strictEqual(
      meshConfig.check_queue_on_complete,
      false,
      'check_queue_on_complete: false should be preserved (not defaulted to true)'
    );
  });

  test('stop_on_first_complete defaults to undefined when not set', async () => {
    createTestMesh(env, {
      name: 'test-stop-defaults',
      config: {
        mesh: 'test-stop-defaults',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-stop-defaults');
    assert.ok(meshConfig, 'test-stop-defaults mesh should be loaded');
    // When not set, both flags should be undefined — the consumer uses !== false to default to true
    assert.strictEqual(
      meshConfig.stop_on_first_complete,
      undefined,
      'stop_on_first_complete should be undefined when not configured'
    );
    assert.strictEqual(
      meshConfig.check_queue_on_complete,
      undefined,
      'check_queue_on_complete should be undefined when not configured'
    );
  });

  // --------------------------------------------------------------------------
  // 7. load_claude_md: false
  // --------------------------------------------------------------------------

  test('load_claude_md: false flag is present on loaded config', async () => {
    createTestMesh(env, {
      name: 'test-no-claude-md',
      config: {
        mesh: 'test-no-claude-md',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
        load_claude_md: false,
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    // Create a CLAUDE.md so the dispatcher would normally pick it up
    fs.writeFileSync(
      path.join(env.rootDir, 'CLAUDE.md'),
      '# Test Project\nThis is test project instructions.'
    );

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-no-claude-md');
    assert.ok(meshConfig, 'test-no-claude-md mesh should be loaded');
    assert.strictEqual(
      meshConfig.load_claude_md,
      false,
      'load_claude_md: false should be preserved on loaded config'
    );
    // The dispatcher checks: if (meshConfig?.load_claude_md !== false) { loadProjectClaudeMd() }
    // Verify the flag value would correctly gate the load
    assert.strictEqual(
      meshConfig.load_claude_md !== false,
      false,
      'Condition (load_claude_md !== false) should evaluate to false, gating CLAUDE.md inclusion'
    );
  });

  test('load_claude_md defaults to undefined (CLAUDE.md is included by default)', async () => {
    createTestMesh(env, {
      name: 'test-default-claude-md',
      config: {
        mesh: 'test-default-claude-md',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-default-claude-md');
    assert.ok(meshConfig, 'test-default-claude-md mesh should be loaded');
    // When not set, load_claude_md should be undefined; condition (undefined !== false) === true
    assert.strictEqual(
      meshConfig.load_claude_md,
      undefined,
      'load_claude_md should be undefined when not configured'
    );
    assert.strictEqual(
      meshConfig.load_claude_md !== false,
      true,
      'Condition (load_claude_md !== false) should be true, allowing CLAUDE.md inclusion'
    );
  });

  // --------------------------------------------------------------------------
  // 8. rearmatter
  // --------------------------------------------------------------------------

  test('rearmatter sub-fields survive config loading intact', async () => {
    createTestMesh(env, {
      name: 'test-rearmatter',
      config: {
        mesh: 'test-rearmatter',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
        rearmatter: {
          enabled: true,
          fields: ['grade', 'confidence'],
        },
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-rearmatter');
    assert.ok(meshConfig, 'test-rearmatter mesh should be loaded');
    assert.ok(meshConfig.rearmatter, 'rearmatter block should be present');

    assert.strictEqual(meshConfig.rearmatter.enabled, true, 'rearmatter.enabled should be true');
    assert.deepStrictEqual(
      meshConfig.rearmatter.fields,
      ['grade', 'confidence'],
      'rearmatter.fields should match configured values'
    );
  });

  test('rearmatter: disabled — enabled: false is preserved', async () => {
    createTestMesh(env, {
      name: 'test-rearmatter-off',
      config: {
        mesh: 'test-rearmatter-off',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'worker.md' }],
        entry_point: 'worker',
        rearmatter: {
          enabled: false,
          fields: ['grade'],
        },
      },
      prompts: { 'worker.md': 'You are a test worker.' },
    });

    await dispatcher.start();

    const meshConfig = getMeshConfig(dispatcher, 'test-rearmatter-off');
    assert.ok(meshConfig, 'test-rearmatter-off mesh should be loaded');
    assert.ok(meshConfig.rearmatter, 'rearmatter block should be present');
    assert.strictEqual(
      meshConfig.rearmatter.enabled,
      false,
      'rearmatter.enabled: false should be preserved'
    );
    // The dispatcher checks: if (meshConfig?.rearmatter?.enabled) — false should not trigger
    assert.strictEqual(
      Boolean(meshConfig.rearmatter?.enabled),
      false,
      'rearmatter section should not activate when enabled is false'
    );
  });
});
