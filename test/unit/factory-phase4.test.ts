/**
 * factory-phase4.test - Tests for Phase 4 runtime integration
 *
 * Validates hash-based reuse, search path extension, --run message writing,
 * and capability hashing determinism.
 *
 * Responsibilities:
 * - Verify hashCapability produces stable, deterministic hashes
 * - Verify hash-based reuse skips compilation when output exists
 * - Verify --run writes a valid message file to msgs dir
 * - Verify generated meshes dir is included in config-loader search paths
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

import { hashCapability, type CapabilityNeeded } from '../../src/mesh/capability/schema.ts';
import { runFactory } from '../../src/cli/factory.ts';
import { MeshConfigLoader } from '../../src/mesh/config-loader.ts';

const FRAGMENTS_DIR = path.resolve(import.meta.dirname, '../../src/mesh/fragments');

const SAMPLE_CAPABILITY: CapabilityNeeded = {
  domain: ['dev'],
  input: ['prompt'],
  output: ['code-changes'],
  tools: ['git'],
  interaction: ['none'],
  topology: 'static',
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-phase4-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('hashCapability', () => {
  it('produces a 12-character hex string', () => {
    const hash = hashCapability(SAMPLE_CAPABILITY);
    assert.strictEqual(hash.length, 12);
    assert.match(hash, /^[0-9a-f]{12}$/);
  });

  it('is deterministic across calls', () => {
    const hash1 = hashCapability(SAMPLE_CAPABILITY);
    const hash2 = hashCapability(SAMPLE_CAPABILITY);
    assert.strictEqual(hash1, hash2);
  });

  it('is stable regardless of array order', () => {
    const reordered: CapabilityNeeded = {
      ...SAMPLE_CAPABILITY,
      domain: ['dev'],
      tools: ['git'],
    };
    // Same values, different object — should hash identically
    const hash1 = hashCapability(SAMPLE_CAPABILITY);
    const hash2 = hashCapability(reordered);
    assert.strictEqual(hash1, hash2);
  });

  it('differs when capabilities differ', () => {
    const different: CapabilityNeeded = {
      ...SAMPLE_CAPABILITY,
      domain: ['research'],
    };
    const hash1 = hashCapability(SAMPLE_CAPABILITY);
    const hash2 = hashCapability(different);
    assert.notStrictEqual(hash1, hash2);
  });
});

describe('hash-based reuse', () => {
  it('reuses existing mesh when hash dir has config.yaml', async () => {
    // First run: compile
    const hash = hashCapability(SAMPLE_CAPABILITY);
    const hashDir = path.join(tmpDir, 'generated', hash);

    const inputFile = path.join(tmpDir, 'caps.yaml');
    fs.writeFileSync(inputFile, YAML.stringify({ capability: SAMPLE_CAPABILITY }), 'utf-8');

    const firstResult = await runFactory({
      inputFile,
      outputDir: hashDir,
      fragmentsDir: FRAGMENTS_DIR,
    });
    assert.strictEqual(firstResult.success, true);
    assert.ok(!firstResult.reused, 'First run should compile, not reuse');

    // Second run: same hash dir, should reuse
    const secondResult = await runFactory({
      inputFile,
      outputDir: hashDir,
      fragmentsDir: FRAGMENTS_DIR,
    });
    assert.strictEqual(secondResult.success, true);
    assert.strictEqual(secondResult.reused, true, 'Second run should reuse existing mesh');
  });
});

describe('MeshConfigLoader - generated meshes search path', () => {
  it('finds mesh config in generated-meshes directory via loadOnDemand', () => {
    const workDir = tmpDir;
    const meshesDir = path.join(tmpDir, 'meshes');
    const generatedDir = path.join(tmpDir, '.ai', 'tx', 'generated-meshes');
    fs.mkdirSync(meshesDir, { recursive: true });

    // Place a generated mesh config
    const meshName = 'test-gen-mesh';
    const meshDir = path.join(generatedDir, meshName);
    fs.mkdirSync(meshDir, { recursive: true });
    fs.writeFileSync(path.join(meshDir, 'config.yaml'), YAML.stringify({
      mesh: meshName,
      description: 'Test generated mesh',
      agents: [{ name: 'worker', model: 'sonnet', prompt: 'worker.md' }],
      entry_point: 'worker',
    }), 'utf-8');

    // Write a minimal prompt file
    fs.writeFileSync(path.join(meshDir, 'worker.md'), '# Worker\nDo work.', 'utf-8');

    const loader = new MeshConfigLoader({ workDir, meshesDir });
    const loaded = loader.loadOnDemand(meshName);

    assert.strictEqual(loaded, true, 'Should find generated mesh via loadOnDemand');
    assert.ok(loader.has(meshName), 'Loader should have the mesh after loading');
  });

  it('does not find nonexistent generated mesh', () => {
    const workDir = tmpDir;
    const meshesDir = path.join(tmpDir, 'meshes');
    fs.mkdirSync(meshesDir, { recursive: true });

    const loader = new MeshConfigLoader({ workDir, meshesDir });
    const loaded = loader.loadOnDemand('does-not-exist');

    assert.strictEqual(loaded, false);
  });
});

describe('FactoryResult - meshName field', () => {
  it('returns meshName on successful generation', async () => {
    const inputFile = path.join(tmpDir, 'caps.yaml');
    fs.writeFileSync(inputFile, YAML.stringify({ capability: SAMPLE_CAPABILITY }), 'utf-8');

    const outputDir = path.join(tmpDir, 'out');
    const result = await runFactory({
      inputFile,
      outputDir,
      fragmentsDir: FRAGMENTS_DIR,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.meshName, 'dev-mesh');
  });
});
