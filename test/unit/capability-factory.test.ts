/**
 * CapabilityFactory Unit Tests
 *
 * Tests the factory compiler that assembles mesh files from capability needs.
 *
 * Responsibilities:
 * - Verify single-domain compilation produces valid static mesh config
 * - Verify multi-domain compilation produces one agent per domain
 * - Verify prompt files are generated with substance for each agent
 * - Verify validation passes on factory output
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MeshFactory, type CompileResult } from '../../src/mesh/capability/factory.ts';
import type { CapabilityNeeded } from '../../src/mesh/capability/schema.ts';

const FRAGMENTS_DIR = path.resolve(import.meta.dirname, '../../src/mesh/fragments');

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-factory-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MeshFactory - Single-domain static mesh', () => {
  it('generates config.yaml with routing_mode static and dev_mode true', () => {
    const factory = new MeshFactory(FRAGMENTS_DIR);
    const needed: CapabilityNeeded = {
      domain: ['dev'],
      input: ['prompt'],
      output: ['code-changes'],
      tools: ['git'],
      interaction: ['none'],
      topology: 'static',
    };

    const result: CompileResult = factory.compile(needed, tmpDir);

    assert.strictEqual(result.success, true, `Expected success but got errors: ${result.errors.join(', ')}`);
    assert.ok(fs.existsSync(result.configPath), 'config.yaml should exist');

    const configRaw = fs.readFileSync(result.configPath, 'utf-8');
    assert.ok(configRaw.includes('routing_mode: static'), 'config should have routing_mode: static');
    assert.ok(configRaw.includes('dev_mode: true'), 'config should have dev_mode: true');
  });
});

describe('MeshFactory - Multi-domain agent generation', () => {
  it('generates one agent per domain value', () => {
    const factory = new MeshFactory(FRAGMENTS_DIR);
    const needed: CapabilityNeeded = {
      domain: ['dev', 'research'],
      input: ['prompt'],
      output: ['code-changes', 'report'],
      tools: ['git', 'web-search'],
      interaction: ['none'],
      topology: 'static',
    };

    const result: CompileResult = factory.compile(needed, tmpDir);

    assert.strictEqual(result.success, true, `Expected success but got errors: ${result.errors.join(', ')}`);
    assert.ok(result.agents.length >= 2, `Expected at least 2 agents, got ${result.agents.length}`);
    assert.ok(result.agents.some(a => a.includes('dev')), 'Should have agent with dev in name');
    assert.ok(result.agents.some(a => a.includes('research')), 'Should have agent with research in name');
  });
});

describe('MeshFactory - Prompt file generation', () => {
  it('generates prompt.md for each agent with substance', () => {
    const factory = new MeshFactory(FRAGMENTS_DIR);
    const needed: CapabilityNeeded = {
      domain: ['dev', 'research'],
      input: ['prompt'],
      output: ['code-changes', 'report'],
      tools: ['git', 'web-search'],
      interaction: ['gate-exit'],
      topology: 'static',
    };

    const result: CompileResult = factory.compile(needed, tmpDir);

    assert.strictEqual(result.success, true, `Expected success but got errors: ${result.errors.join(', ')}`);

    for (const agentName of result.agents) {
      const promptPath = path.join(tmpDir, agentName, 'prompt.md');
      assert.ok(fs.existsSync(promptPath), `prompt.md should exist for ${agentName}`);

      const content = fs.readFileSync(promptPath, 'utf-8');
      assert.ok(content.length > 100, `prompt.md for ${agentName} should have >100 chars, got ${content.length}`);
    }
  });
});

describe('MeshFactory - Validation passes', () => {
  it('compiled mesh passes validateGeneratedMesh', () => {
    const factory = new MeshFactory(FRAGMENTS_DIR);
    const needed: CapabilityNeeded = {
      domain: ['dev'],
      input: ['prompt'],
      output: ['code-changes'],
      tools: ['git'],
      interaction: ['none'],
      topology: 'static',
    };

    const result: CompileResult = factory.compile(needed, tmpDir);

    assert.strictEqual(result.success, true, `Expected success but got errors: ${result.errors.join(', ')}`);
    assert.strictEqual(result.validation.valid, true, `Expected valid but got errors: ${result.validation.errors.join(', ')}`);
    assert.deepStrictEqual(result.errors, []);
  });
});
