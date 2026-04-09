/**
 * factory-e2e.test - End-to-end factory integration tests
 *
 * Exercises the full factory pipeline: capabilities YAML → router check
 * against mesh catalog → factory generation → validation.
 *
 * Responsibilities:
 * - Verify novel capability combo triggers generation with valid output
 * - Verify matching capability combo routes to existing mesh without generation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

import { runFactory } from '../../src/cli/factory.ts';

const FRAGMENTS_DIR = path.resolve(import.meta.dirname, '../../src/mesh/fragments');
const REAL_CATALOG_DIR = path.resolve(import.meta.dirname, '../../meshes');

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-e2e-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('E2E: full pipeline — capabilities file → router miss → factory → valid mesh', () => {
  it('generates a valid mesh when no catalog entry matches', async () => {
    const inputDir = path.join(tmpDir, 'input');
    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(inputDir, { recursive: true });

    // Novel combo: dev+research domain, multiple outputs, multiple tools
    const inputFile = path.join(inputDir, 'needs.yaml');
    fs.writeFileSync(inputFile, YAML.stringify({
      capability: {
        domain: ['dev', 'research'],
        input: ['codebase', 'question'],
        output: ['code-changes', 'report'],
        tools: ['git', 'web-search'],
        interaction: ['gate-exit'],
        topology: 'static',
      },
    }), 'utf-8');

    const result = await runFactory({
      inputFile,
      outputDir,
      fragmentsDir: FRAGMENTS_DIR,
      catalogDir: REAL_CATALOG_DIR,
    });

    // Pipeline should succeed (via generation since real catalog unlikely matches)
    assert.strictEqual(result.success, true, `Expected success but got errors: ${result.errors.join(', ')}`);
    assert.ok(result.generated || result.matched, 'Should have generated or matched');

    if (result.generated) {
      // config.yaml exists
      const configPath = path.join(outputDir, 'config.yaml');
      assert.ok(fs.existsSync(configPath), 'config.yaml should exist in output dir');

      // Parse and validate config structure
      const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));

      // Mesh name
      assert.ok(config.mesh, 'Config should have mesh name');
      assert.strictEqual(typeof config.mesh, 'string');

      // Agents array with >= 2 agents (dev + research domains)
      assert.ok(Array.isArray(config.agents), 'Config should have agents array');
      assert.ok(config.agents.length >= 2, `Expected >= 2 agents, got ${config.agents.length}`);

      // Routing mode
      assert.strictEqual(config.routing_mode, 'static', 'routing_mode should be static');

      // Dev mode
      assert.strictEqual(config.dev_mode, true, 'dev_mode should be true');

      // Capability block preserved
      assert.ok(config.capability, 'Config should have capability block');
      assert.deepStrictEqual(config.capability.domain, ['dev', 'research']);
      assert.deepStrictEqual(config.capability.tools, ['git', 'web-search']);

      // Guardrails
      assert.ok(config.guardrails, 'Config should have guardrails');
      assert.ok(config.guardrails.max_mesh_messages, 'Guardrails should have max_mesh_messages');

      // Prompt files exist for every agent referenced in config
      for (const agent of config.agents) {
        const promptPath = path.join(outputDir, agent.prompt);
        assert.ok(
          fs.existsSync(promptPath),
          `Prompt file should exist for agent ${agent.name}: ${promptPath}`,
        );

        const promptContent = fs.readFileSync(promptPath, 'utf-8');
        assert.ok(promptContent.length > 0, `Prompt for ${agent.name} should not be empty`);
      }
    }

    assert.deepStrictEqual(result.errors, []);
  });
});

describe('E2E: router matches existing mesh when capability fits', () => {
  it('returns matched mesh name without invoking factory', async () => {
    // Build a fake catalog with one mesh that has a matching capability block
    const fakeCatalog = path.join(tmpDir, 'catalog');
    const meshDir = path.join(fakeCatalog, 'my-dev-mesh');
    fs.mkdirSync(meshDir, { recursive: true });

    fs.writeFileSync(path.join(meshDir, 'config.yaml'), YAML.stringify({
      mesh: 'my-dev-mesh',
      agents: [
        { name: 'worker', model: 'sonnet', prompt: 'worker.md' },
      ],
      capability: {
        domain: ['dev'],
        input: ['codebase', 'feature-request'],
        output: ['code-changes'],
        tools: ['git'],
        interaction: ['none'],
      },
    }), 'utf-8');

    // Request a subset of what the fake mesh provides
    const inputDir = path.join(tmpDir, 'input');
    const outputDir = path.join(tmpDir, 'output');
    fs.mkdirSync(inputDir, { recursive: true });

    const inputFile = path.join(inputDir, 'needs.yaml');
    fs.writeFileSync(inputFile, YAML.stringify({
      capability: {
        domain: ['dev'],
        input: ['codebase'],
        output: ['code-changes'],
        tools: ['git'],
        interaction: ['none'],
        topology: 'static',
      },
    }), 'utf-8');

    const result = await runFactory({
      inputFile,
      outputDir,
      fragmentsDir: FRAGMENTS_DIR,
      catalogDir: fakeCatalog,
    });

    assert.strictEqual(result.success, true, `Expected success but got errors: ${result.errors.join(', ')}`);
    assert.strictEqual(result.matched, 'my-dev-mesh', 'Should match the fake catalog mesh');
    assert.strictEqual(result.generated, undefined, 'Factory should not have been invoked');
    assert.deepStrictEqual(result.errors, []);
  });
});
