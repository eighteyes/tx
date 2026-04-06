/**
 * config-untested-fields.test.ts — Unit tests for mesh config fields not covered by config-loader.test.ts
 *
 * Responsibilities:
 * - Test top-level mesh fields: manifest_enforcement, dev_mode, worktree, reliability,
 *   rearmatter, routing_mode variants, boundary_agents, routing_fallback, routing_retry_max,
 *   disable, stop_on_first_complete, check_queue_on_complete, load_claude_md
 * - Test agent-level fields: permissions, chrome, command, mcpServers, thinking, fragments
 * - Test resolvePermissions() from src/worker/permissions.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MeshConfigLoader } from '../config-loader.ts';
import { resolvePermissions, DEFAULT_ALLOWED_TOOLS, DEFAULT_DISALLOWED_TOOLS } from '../../worker/permissions.ts';

// ─── Test fixture directory ────────────────────────────────────────────────────

const TEST_DIR = path.join(process.cwd(), '.ai', 'tmp', 'config-untested-fields-test');
const TEST_MESHES_DIR = path.join(TEST_DIR, 'meshes');

let originalTxRoot: string | undefined;

function setup(): void {
  originalTxRoot = process.env.TX_ROOT;
  delete process.env.TX_ROOT;
  fs.mkdirSync(TEST_MESHES_DIR, { recursive: true });
}

function teardown(): void {
  if (originalTxRoot !== undefined) {
    process.env.TX_ROOT = originalTxRoot;
  }
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Write a config.yaml and a prompt.md into a named mesh directory.
 * extraYaml is appended after the agents block.
 */
function createMeshWithConfig(meshName: string, extraYaml: string, agentExtra: string = ''): void {
  const meshDir = path.join(TEST_MESHES_DIR, meshName);
  fs.mkdirSync(meshDir, { recursive: true });

  const yaml = `mesh: ${meshName}
description: "Test mesh"
agents:
  - name: worker
    model: sonnet
    prompt: prompt.md${agentExtra ? '\n' + agentExtra : ''}
${extraYaml}
`;
  fs.writeFileSync(path.join(meshDir, 'config.yaml'), yaml);
  fs.writeFileSync(path.join(meshDir, 'prompt.md'), `# ${meshName} prompt`);
}

/**
 * Write a config.yaml where the AGENT block is replaced entirely.
 * Useful when we need a custom agent section (e.g. command instead of prompt).
 */
function createMeshWithCustomAgents(meshName: string, agentsYaml: string, meshExtraYaml: string = ''): void {
  const meshDir = path.join(TEST_MESHES_DIR, meshName);
  fs.mkdirSync(meshDir, { recursive: true });

  const yaml = `mesh: ${meshName}
description: "Test mesh"
${agentsYaml}
${meshExtraYaml}
`;
  fs.writeFileSync(path.join(meshDir, 'config.yaml'), yaml);
  // Provide a prompt.md in case any agent needs it
  fs.writeFileSync(path.join(meshDir, 'prompt.md'), `# ${meshName} prompt`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Untested mesh config fields', () => {
  let loader: MeshConfigLoader;

  beforeEach(() => {
    setup();
    loader = new MeshConfigLoader({ workDir: TEST_DIR, meshesDir: TEST_MESHES_DIR });
  });

  afterEach(teardown);

  // ── Top-level mesh fields ──────────────────────────────────────────────────

  describe('manifest_enforcement', () => {
    it('loads all sub-fields', () => {
      createMeshWithConfig('me-test', `manifest_enforcement:
  post_validation: true
  pre_validation: false
  max_retry: 3
  strict: true
  warning: false
`);
      loader.loadAll();
      const config = loader.get('me-test');
      assert.ok(config, 'mesh should be loaded');
      const me = config!.manifest_enforcement;
      assert.ok(me, 'manifest_enforcement should be present');
      assert.strictEqual(me.post_validation, true);
      assert.strictEqual(me.pre_validation, false);
      assert.strictEqual(me.max_retry, 3);
      assert.strictEqual(me.strict, true);
      assert.strictEqual(me.warning, false);
    });
  });

  describe('dev_mode', () => {
    it('loads dev_mode: true', () => {
      createMeshWithConfig('devmode-true', 'dev_mode: true\n');
      loader.loadAll();
      const config = loader.get('devmode-true');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual(config!.dev_mode, true);
    });

    it('loads dev_mode: false', () => {
      createMeshWithConfig('devmode-false', 'dev_mode: false\n');
      loader.loadAll();
      const config = loader.get('devmode-false');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual(config!.dev_mode, false);
    });
  });

  describe('worktree', () => {
    it('loads worktree: true', () => {
      createMeshWithConfig('worktree-test', 'worktree: true\n');
      loader.loadAll();
      const config = loader.get('worktree-test');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual(config!.worktree, true);
    });
  });

  describe('reliability', () => {
    it('loads reliability with heartbeat and circuitBreaker sub-fields', () => {
      createMeshWithConfig('reliability-test', `reliability:
  heartbeat:
    warnMs: 30000
    staleMs: 60000
    deadMs: 120000
  circuitBreaker:
    failureThreshold: 5
    cooldownMs: 10000
`);
      loader.loadAll();
      const config = loader.get('reliability-test');
      assert.ok(config, 'mesh should be loaded');
      const rel = config!.reliability;
      assert.ok(rel, 'reliability should be present');
      assert.strictEqual(rel.heartbeat?.warnMs, 30000);
      assert.strictEqual(rel.heartbeat?.staleMs, 60000);
      assert.strictEqual(rel.heartbeat?.deadMs, 120000);
      assert.strictEqual(rel.circuitBreaker?.failureThreshold, 5);
      assert.strictEqual(rel.circuitBreaker?.cooldownMs, 10000);
    });
  });

  describe('rearmatter', () => {
    it('loads rearmatter with enabled, fields, and thresholds', () => {
      createMeshWithConfig('rearmatter-test', `rearmatter:
  enabled: true
  fields:
    - grade
    - confidence
  thresholds:
    confidence: 0.7
`);
      loader.loadAll();
      const config = loader.get('rearmatter-test');
      assert.ok(config, 'mesh should be loaded');
      const rm = config!.rearmatter;
      assert.ok(rm, 'rearmatter should be present');
      assert.strictEqual(rm.enabled, true);
      assert.deepStrictEqual(rm.fields, ['grade', 'confidence']);
      assert.strictEqual(rm.thresholds?.confidence, 0.7);
    });
  });

  describe('routing_mode', () => {
    it('loads routing_mode: dispatcher and extractDispatcherRouting returns config', () => {
      createMeshWithConfig('routing-dispatcher', `routing_mode: dispatcher
routing:
  worker:
    complete: reviewer
`);
      loader.loadAll();
      const config = loader.get('routing-dispatcher');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual(config!.routing_mode, 'dispatcher');
      const dispatcherRouting = loader.extractDispatcherRouting(config);
      assert.ok(dispatcherRouting, 'extractDispatcherRouting should return routing config');
    });

    it('loads routing_mode: agent (default enum value)', () => {
      createMeshWithConfig('routing-agent', 'routing_mode: agent\n');
      loader.loadAll();
      const config = loader.get('routing-agent');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual(config!.routing_mode, 'agent');
      // extractDispatcherRouting returns undefined for non-dispatcher mode
      assert.strictEqual(loader.extractDispatcherRouting(config), undefined);
    });

    it('loads routing_mode: manifest (requires manifest section with agent entries)', () => {
      // routing_mode: manifest requires a non-empty manifest section
      // and every agent must appear in at least one manifest entry (reads or writes)
      createMeshWithConfig('routing-manifest', `routing_mode: manifest
manifest:
  - id: output
    location: output.md
    reads:
      - worker
    writes:
      - worker
`);
      loader.loadAll();
      const config = loader.get('routing-manifest');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual(config!.routing_mode, 'manifest');
    });

    it('loads routing_mode: static with array routing', () => {
      createMeshWithCustomAgents('routing-static', `agents:
  - name: worker-a
    model: sonnet
    prompt: prompt.md
  - name: worker-b
    model: sonnet
    prompt: prompt.md
  - name: worker-c
    model: sonnet
    prompt: prompt.md
`, `routing_mode: static
routing:
  - worker-a
  - worker-b
  - worker-c
`);
      loader.loadAll();
      const config = loader.get('routing-static');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual(config!.routing_mode, 'static');
      assert.ok(Array.isArray(config!.routing), 'routing should be an array');
      assert.deepStrictEqual(config!.routing, ['worker-a', 'worker-b', 'worker-c']);
    });

    it('rejects routing_mode: static with empty routing array', () => {
      createMeshWithCustomAgents('routing-static-empty', `agents:
  - name: worker-a
    model: sonnet
    prompt: prompt.md
`, `routing_mode: static
routing: []
`);
      loader.loadAll();
      const config = loader.get('routing-static-empty');
      assert.strictEqual(config, undefined, 'empty static routing should fail validation');
    });

    it('rejects routing_mode: static with agent name not in agents list', () => {
      createMeshWithCustomAgents('routing-static-bad-agent', `agents:
  - name: worker-a
    model: sonnet
    prompt: prompt.md
`, `routing_mode: static
routing:
  - worker-a
  - ghost-agent
`);
      loader.loadAll();
      const config = loader.get('routing-static-bad-agent');
      assert.strictEqual(config, undefined, 'static routing with unknown agent should fail validation');
    });

    it('static routing sets entry_point to routing[0] and completion_agents to [routing[last]]', () => {
      createMeshWithCustomAgents('routing-static-derived', `routing_mode: static
routing:
  - alpha
  - beta
  - gamma
entry_point: beta
agents:
  - name: alpha
    model: sonnet
    prompt: alpha/prompt.md
  - name: beta
    model: sonnet
    prompt: beta/prompt.md
  - name: gamma
    model: sonnet
    prompt: gamma/prompt.md
`);
      loader.loadAll();
      const config = loader.get('routing-static-derived');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual(config!.entry_point, 'alpha', 'entry_point overridden to routing[0]');
      assert.deepStrictEqual(config!.completion_agents, ['gamma'], 'completion_agents set to [routing[last]]');
    });
  });

  describe('boundary_agents (deprecated alias for completion_agents)', () => {
    it('loads boundary_agents as-is (not normalized to completion_agents at load time)', () => {
      createMeshWithConfig('boundary-test', 'boundary_agents:\n  - worker\n');
      loader.loadAll();
      const config = loader.get('boundary-test');
      assert.ok(config, 'mesh should be loaded');
      // boundary_agents is kept as-is on the loaded config; runtime normalizes it
      assert.deepStrictEqual(config!.boundary_agents, ['worker']);
    });
  });

  describe('routing_fallback (deprecated)', () => {
    it('loads routing_fallback and migrates it to guardrails.routing_error', () => {
      createMeshWithConfig('rfallback-test', 'routing_fallback: core/core\n');
      loader.loadAll();
      const config = loader.get('rfallback-test');
      assert.ok(config, 'mesh should be loaded');
      // Deprecated field is preserved on top level
      assert.strictEqual(config!.routing_fallback, 'core/core');
      // And also migrated into guardrails.routing_error
      assert.strictEqual(config!.guardrails?.routing_error?.routing_fallback, 'core/core');
    });
  });

  describe('routing_retry_max (deprecated)', () => {
    it('loads routing_retry_max and migrates it to guardrails.routing_error', () => {
      createMeshWithConfig('rretrymax-test', 'routing_retry_max: 5\n');
      loader.loadAll();
      const config = loader.get('rretrymax-test');
      assert.ok(config, 'mesh should be loaded');
      // Deprecated field is preserved on top level
      assert.strictEqual(config!.routing_retry_max, 5);
      // And also migrated into guardrails.routing_error
      assert.strictEqual(config!.guardrails?.routing_error?.routing_retry_max, 5);
    });
  });

  describe('disable', () => {
    it('does NOT store a disabled mesh — disable: true prevents loading into map', () => {
      createMeshWithConfig('disabled-mesh', 'disable: true\n');
      loader.loadAll();
      // Disabled meshes are skipped at storage time
      assert.strictEqual(loader.has('disabled-mesh'), false);
    });
  });

  describe('stop_on_first_complete', () => {
    it('loads stop_on_first_complete: false', () => {
      createMeshWithConfig('sofcfalse-test', 'stop_on_first_complete: false\n');
      loader.loadAll();
      const config = loader.get('sofcfalse-test');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual(config!.stop_on_first_complete, false);
    });
  });

  describe('check_queue_on_complete', () => {
    it('loads check_queue_on_complete: false', () => {
      createMeshWithConfig('cqocfalse-test', 'check_queue_on_complete: false\n');
      loader.loadAll();
      const config = loader.get('cqocfalse-test');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual(config!.check_queue_on_complete, false);
    });
  });

  describe('load_claude_md', () => {
    it('loads load_claude_md: false', () => {
      // TODO: load_claude_md is not in MESH_FIELD_SPECS so validator emits an unknown-field warning,
      // but validation still passes and the field is present on the loaded config.
      createMeshWithConfig('lcmd-test', 'load_claude_md: false\n');
      loader.loadAll();
      const config = loader.get('lcmd-test');
      assert.ok(config, 'mesh should be loaded despite unknown-field warning');
      assert.strictEqual((config as any).load_claude_md, false);
    });
  });

  // ── Agent-level fields ─────────────────────────────────────────────────────

  describe('agent permissions', () => {
    it('loads full permissions block: mode, allowedTools, disallowedTools', () => {
      // TODO: permissions is not in AGENT_FIELD_SPECS — validator emits unknown-field warning,
      // but loading still succeeds.
      createMeshWithCustomAgents('perms-full', `agents:
  - name: worker
    model: sonnet
    prompt: prompt.md
    permissions:
      mode: default
      allowedTools:
        - Read
        - Write
        - Bash
      disallowedTools:
        - Task
`);
      loader.loadAll();
      const config = loader.get('perms-full');
      assert.ok(config, 'mesh should be loaded');
      const perms = config!.agents[0].permissions;
      assert.ok(perms, 'permissions should be present');
      assert.strictEqual(perms.mode, 'default');
      assert.deepStrictEqual(perms.allowedTools, ['Read', 'Write', 'Bash']);
      assert.deepStrictEqual(perms.disallowedTools, ['Task']);
    });

    it('loads permissions with only allowedTools', () => {
      createMeshWithCustomAgents('perms-allowed-only', `agents:
  - name: worker
    model: sonnet
    prompt: prompt.md
    permissions:
      allowedTools:
        - Read
        - Write
`);
      loader.loadAll();
      const config = loader.get('perms-allowed-only');
      assert.ok(config, 'mesh should be loaded');
      const perms = config!.agents[0].permissions;
      assert.ok(perms, 'permissions should be present');
      assert.deepStrictEqual(perms.allowedTools, ['Read', 'Write']);
      assert.strictEqual(perms.mode, undefined);
      assert.strictEqual(perms.disallowedTools, undefined);
    });
  });

  describe('agent chrome', () => {
    it('loads chrome: true on agent', () => {
      // TODO: chrome is not in AGENT_FIELD_SPECS — validator emits unknown-field warning,
      // but loading still succeeds.
      createMeshWithCustomAgents('chrome-test', `agents:
  - name: worker
    model: sonnet
    prompt: prompt.md
    chrome: true
`);
      loader.loadAll();
      const config = loader.get('chrome-test');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual((config!.agents[0] as any).chrome, true);
    });
  });

  describe('agent command', () => {
    it('loads command without prompt — agent is valid with command alone', () => {
      createMeshWithCustomAgents('cmd-test', `agents:
  - name: worker
    model: sonnet
    command: /know:build
`);
      loader.loadAll();
      const config = loader.get('cmd-test');
      assert.ok(config, 'mesh should load when agent uses command instead of prompt');
      assert.strictEqual(config!.agents[0].command, '/know:build');
      assert.strictEqual(config!.agents[0].prompt, undefined);
    });
  });

  describe('agent mcpServers', () => {
    it('loads mcpServers map on agent', () => {
      createMeshWithCustomAgents('mcp-test', `agents:
  - name: worker
    model: sonnet
    prompt: prompt.md
    mcpServers:
      playwright:
        command: npx
        args:
          - playwright
        env: {}
`);
      loader.loadAll();
      const config = loader.get('mcp-test');
      assert.ok(config, 'mesh should be loaded');
      const mcp = config!.agents[0].mcpServers;
      assert.ok(mcp, 'mcpServers should be present');
      assert.ok(mcp['playwright'], 'playwright server should be present');
      assert.strictEqual((mcp['playwright'] as any).command, 'npx');
      assert.deepStrictEqual((mcp['playwright'] as any).args, ['playwright']);
    });
  });

  describe('agent thinking', () => {
    it('loads thinking: false on agent', () => {
      // TODO: thinking is not in AGENT_FIELD_SPECS — validator emits unknown-field warning,
      // but loading still succeeds.
      createMeshWithCustomAgents('thinking-test', `agents:
  - name: worker
    model: sonnet
    prompt: prompt.md
    thinking: false
`);
      loader.loadAll();
      const config = loader.get('thinking-test');
      assert.ok(config, 'mesh should be loaded');
      assert.strictEqual((config!.agents[0] as any).thinking, false);
    });
  });

  describe('agent fragments', () => {
    it('loads fragments as directory string — resolves to absolute path', () => {
      // TODO: fragments is not in AGENT_FIELD_SPECS — validator emits unknown-field warning,
      // but loading still succeeds.
      createMeshWithCustomAgents('fragments-dir', `agents:
  - name: worker
    model: sonnet
    prompt: prompt.md
    fragments: fragments/
`);
      loader.loadAll();
      const config = loader.get('fragments-dir');
      assert.ok(config, 'mesh should be loaded');
      const frags = (config!.agents[0] as any).fragments;
      // Directory string is resolved to an absolute path during load
      assert.ok(typeof frags === 'string', 'fragments should be a string');
      assert.ok(path.isAbsolute(frags), 'fragments directory path should be absolute');
      assert.ok(frags.endsWith('fragments'), 'resolved path should contain the directory name');
    });

    it('loads fragments as map — each value resolved to absolute path', () => {
      createMeshWithCustomAgents('fragments-map', `agents:
  - name: worker
    model: sonnet
    prompt: prompt.md
    fragments:
      context: context.md
      rules: rules.md
`);
      loader.loadAll();
      const config = loader.get('fragments-map');
      assert.ok(config, 'mesh should be loaded');
      const frags = (config!.agents[0] as any).fragments;
      assert.ok(frags && typeof frags === 'object', 'fragments should be an object');
      assert.ok(path.isAbsolute(frags.context), 'context path should be absolute');
      assert.ok(path.isAbsolute(frags.rules), 'rules path should be absolute');
      assert.ok(frags.context.endsWith('context.md'), 'context path should end with filename');
      assert.ok(frags.rules.endsWith('rules.md'), 'rules path should end with filename');
    });
  });

  // ── resolvePermissions() ───────────────────────────────────────────────────

  describe('resolvePermissions()', () => {
    it('no permissions block → returns DEFAULT_ALLOWED_TOOLS and DEFAULT_DISALLOWED_TOOLS', () => {
      const result = resolvePermissions(undefined, false);
      assert.strictEqual(result.mode, 'default');
      assert.deepStrictEqual(result.allowedTools, DEFAULT_ALLOWED_TOOLS);
      assert.deepStrictEqual(result.disallowedTools, DEFAULT_DISALLOWED_TOOLS);
    });

    it('allowedTools: [Read, Write] → those tools appear in allowedTools', () => {
      const result = resolvePermissions({ allowedTools: ['Read', 'Write'] }, false);
      assert.ok(result.allowedTools.includes('Read'), 'Read should be in allowedTools');
      assert.ok(result.allowedTools.includes('Write'), 'Write should be in allowedTools');
    });

    it('allowedTools: [Task] → Task removed from disallowedTools (explicit allow overrides)', () => {
      const result = resolvePermissions({ allowedTools: ['Task'] }, false);
      assert.ok(result.allowedTools.includes('Task'), 'Task should be in allowedTools');
      // Explicit allow overrides the default disallow
      assert.ok(
        !result.disallowedTools || !result.disallowedTools.includes('Task'),
        'Task should not be in disallowedTools when explicitly allowed'
      );
    });

    it('mode: bypassPermissions → returns bypassPermissions mode', () => {
      const result = resolvePermissions({ mode: 'bypassPermissions' }, false);
      assert.strictEqual(result.mode, 'bypassPermissions');
    });

    it('godMode: true → returns bypassPermissions regardless of permissions block', () => {
      const result = resolvePermissions({ mode: 'default', allowedTools: ['Read'] }, true);
      assert.strictEqual(result.mode, 'bypassPermissions');
      assert.strictEqual(result.allowDangerouslySkipPermissions, true);
    });

    it('godMode: true with no permissions block → still returns bypassPermissions', () => {
      const result = resolvePermissions(undefined, true);
      assert.strictEqual(result.mode, 'bypassPermissions');
      assert.strictEqual(result.allowDangerouslySkipPermissions, true);
    });
  });
});
