/**
 * MeshConfigLoader tests
 *
 * Tests mesh configuration loading, validation, and normalization.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MeshConfigLoader } from '../config-loader.ts';

// Test fixture directory
const TEST_DIR = path.join(process.cwd(), '.ai', 'tmp', 'config-loader-test');
const TEST_MESHES_DIR = path.join(TEST_DIR, 'meshes');

// Store original TX_ROOT
let originalTxRoot: string | undefined;

function setup(): void {
  // Clear TX_ROOT for isolated tests
  originalTxRoot = process.env.TX_ROOT;
  delete process.env.TX_ROOT;

  // Create test directories
  fs.mkdirSync(TEST_MESHES_DIR, { recursive: true });
}

function teardown(): void {
  // Restore TX_ROOT
  if (originalTxRoot !== undefined) {
    process.env.TX_ROOT = originalTxRoot;
  }

  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function createMeshConfig(meshName: string, agents: Array<{ name: string; model: string; prompt: string }> = [{ name: 'worker', model: 'sonnet', prompt: 'prompt.md' }]): void {
  const meshDir = path.join(TEST_MESHES_DIR, meshName);
  fs.mkdirSync(meshDir, { recursive: true });

  // Build properly formatted YAML
  const agentLines = agents.map(a =>
    `  - name: ${a.name}\n    model: ${a.model}\n    prompt: ${a.prompt}`
  ).join('\n');

  const yamlContent = `mesh: ${meshName}
description: "Test mesh: ${meshName}"
agents:
${agentLines}
`;

  fs.writeFileSync(path.join(meshDir, 'config.yaml'), yamlContent);
  fs.writeFileSync(path.join(meshDir, 'prompt.md'), `# ${meshName} Agent Prompt`);
}

describe('MeshConfigLoader', () => {
  let loader: MeshConfigLoader;

  beforeEach(() => {
    setup();
    loader = new MeshConfigLoader({
      workDir: TEST_DIR,
      meshesDir: TEST_MESHES_DIR,
    });
  });

  afterEach(() => {
    teardown();
  });

  describe('loadAll()', () => {
    it('should load mesh configs from meshes directory', () => {
      createMeshConfig('test-mesh');

      const configs = loader.loadAll();

      assert.strictEqual(configs.size, 1);
      assert.ok(configs.has('test-mesh'));
      assert.strictEqual(configs.get('test-mesh')?.mesh, 'test-mesh');
    });

    it('should load multiple mesh configs', () => {
      createMeshConfig('mesh-a');
      createMeshConfig('mesh-b');

      const configs = loader.loadAll();

      assert.strictEqual(configs.size, 2);
      assert.ok(configs.has('mesh-a'));
      assert.ok(configs.has('mesh-b'));
    });

    it('should emit mesh:loaded event for each config', () => {
      createMeshConfig('event-test');

      let eventEmitted = false;
      let meshName = '';
      let agentCount = 0;

      loader.on('mesh:loaded', (data: { mesh: string; agents: number }) => {
        eventEmitted = true;
        meshName = data.mesh;
        agentCount = data.agents;
      });

      loader.loadAll();

      assert.strictEqual(eventEmitted, true);
      assert.strictEqual(meshName, 'event-test');
      assert.strictEqual(agentCount, 1);
    });

    it('should return empty map when no meshes directory exists', () => {
      const emptyLoader = new MeshConfigLoader({
        workDir: TEST_DIR,
        meshesDir: path.join(TEST_DIR, 'nonexistent'),
      });

      const configs = emptyLoader.loadAll();
      assert.strictEqual(configs.size, 0);
    });
  });

  describe('get()', () => {
    it('should return loaded mesh config', () => {
      createMeshConfig('get-test');
      loader.loadAll();

      const config = loader.get('get-test');

      assert.ok(config);
      assert.strictEqual(config.mesh, 'get-test');
    });

    it('should return undefined for non-existent mesh', () => {
      loader.loadAll();

      const config = loader.get('nonexistent');

      assert.strictEqual(config, undefined);
    });
  });

  describe('has()', () => {
    it('should return true for loaded mesh', () => {
      createMeshConfig('has-test');
      loader.loadAll();

      assert.strictEqual(loader.has('has-test'), true);
    });

    it('should return false for non-existent mesh', () => {
      loader.loadAll();

      assert.strictEqual(loader.has('nonexistent'), false);
    });
  });

  describe('getMeshNames()', () => {
    it('should return list of loaded mesh names', () => {
      createMeshConfig('alpha');
      createMeshConfig('beta');
      loader.loadAll();

      const names = loader.getMeshNames();

      assert.strictEqual(names.length, 2);
      assert.ok(names.includes('alpha'));
      assert.ok(names.includes('beta'));
    });
  });

  describe('clear()', () => {
    it('should clear all loaded configs', () => {
      createMeshConfig('clear-test');
      loader.loadAll();

      assert.strictEqual(loader.has('clear-test'), true);

      loader.clear();

      assert.strictEqual(loader.has('clear-test'), false);
      assert.strictEqual(loader.getMeshNames().length, 0);
    });
  });

  describe('loadOnDemand()', () => {
    it('should load mesh config on demand', () => {
      createMeshConfig('jit-test');

      // Don't call loadAll() first
      const loaded = loader.loadOnDemand('jit-test');

      assert.strictEqual(loaded, true);
      assert.ok(loader.has('jit-test'));
    });

    it('should return true if mesh already loaded', () => {
      createMeshConfig('already-loaded');
      loader.loadAll();

      const loaded = loader.loadOnDemand('already-loaded');

      assert.strictEqual(loaded, true);
    });

    it('should return false for non-existent mesh', () => {
      const loaded = loader.loadOnDemand('nonexistent');

      assert.strictEqual(loaded, false);
    });
  });

  describe('extractAgentRouting()', () => {
    it('should extract routing config for agent', () => {
      const config = {
        mesh: 'routing-test',
        agents: [{ name: 'worker', model: 'sonnet', prompt: 'prompt.md' }],
        routing: {
          worker: {
            complete: {
              reviewer: 'Work complete, needs review',
            },
            error: {
              core: 'Error occurred',
            },
          },
        },
      };

      const routing = loader.extractAgentRouting('routing-test', 'worker', config as any);

      assert.ok(routing);
      assert.ok(routing.complete);
      assert.strictEqual(routing.complete.reviewer, 'Work complete, needs review');
      assert.ok(routing.error);
      assert.strictEqual(routing.error.core, 'Error occurred');
    });

    it('should return undefined for agent without routing', () => {
      const config = {
        mesh: 'no-routing',
        agents: [{ name: 'worker', model: 'sonnet', prompt: 'prompt.md' }],
      };

      const routing = loader.extractAgentRouting('no-routing', 'worker', config as any);

      assert.strictEqual(routing, undefined);
    });
  });

  describe('shouldContinueAgent()', () => {
    it('should return true when continuation is true', () => {
      assert.strictEqual(loader.shouldContinueAgent('any-agent', true), true);
    });

    it('should return false when continuation is false/undefined', () => {
      assert.strictEqual(loader.shouldContinueAgent('any-agent', false), false);
      assert.strictEqual(loader.shouldContinueAgent('any-agent', undefined), false);
    });

    it('should return true when agent is in continuation array', () => {
      assert.strictEqual(loader.shouldContinueAgent('worker', ['worker', 'reviewer']), true);
    });

    it('should return false when agent is not in continuation array', () => {
      assert.strictEqual(loader.shouldContinueAgent('tester', ['worker', 'reviewer']), false);
    });
  });

  describe('normalizeFSMConfig()', () => {
    it('should pass through array-style states unchanged', () => {
      const fsmConfig = {
        initialState: 'start',
        states: [
          { name: 'start', coordinator: 'agent1' },
          { name: 'end', coordinator: 'agent2' },
        ],
      };

      const normalized = loader.normalizeFSMConfig(fsmConfig as any);

      assert.ok(Array.isArray(normalized.states));
      assert.strictEqual(normalized.states.length, 2);
    });

    it('should convert object-style states to array-style', () => {
      const fsmConfig = {
        initialState: 'planning',
        states: {
          planning: { coordinator: 'planner' },
          implementation: { coordinator: 'implementer' },
        },
      };

      const normalized = loader.normalizeFSMConfig(fsmConfig as any);

      assert.ok(Array.isArray(normalized.states));
      assert.strictEqual(normalized.states.length, 2);

      const planningState = normalized.states.find(s => s.name === 'planning');
      assert.ok(planningState);
      assert.strictEqual(planningState.coordinator, 'planner');
    });
  });
});
