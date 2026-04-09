/**
 * config-loader-capability.test - Capability field on MeshConfig
 *
 * Validates that MeshConfigLoader parses the capability block from config.yaml
 * and that configs without capability still load correctly.
 *
 * Responsibilities:
 * - Verify capability block round-trips through YAML parsing
 * - Verify missing capability field yields undefined without error
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MeshConfigLoader } from '../../src/mesh/config-loader.ts';
import type { CapabilityDeclaration } from '../../src/mesh/capability/schema.ts';

const TEST_DIR = path.join(process.cwd(), '.ai', 'tmp', 'config-loader-capability-test');
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
    // Ignore cleanup errors
  }
}

function writeMesh(meshName: string, yaml: string, promptContent = '# Prompt'): void {
  const meshDir = path.join(TEST_MESHES_DIR, meshName);
  fs.mkdirSync(meshDir, { recursive: true });
  fs.writeFileSync(path.join(meshDir, 'config.yaml'), yaml);
  fs.writeFileSync(path.join(meshDir, 'prompt.md'), promptContent);
}

describe('MeshConfig capability field', () => {
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

  it('parses capability block from config.yaml', () => {
    writeMesh('cap-mesh', `
mesh: cap-mesh
description: "Mesh with capability"
agents:
  - name: worker
    model: sonnet
    prompt: prompt.md
entry_point: worker
capability:
  domain:
    - dev
    - review
  input:
    - codebase
    - prompt
  output:
    - code-changes
    - report
  tools:
    - git
  interaction:
    - none
`);

    loader.loadAll();
    const config = loader.get('cap-mesh');

    assert.ok(config, 'config should load');
    assert.ok(config.capability, 'capability field should exist');

    const cap = config.capability as CapabilityDeclaration;
    assert.deepStrictEqual(cap.domain, ['dev', 'review']);
    assert.deepStrictEqual(cap.input, ['codebase', 'prompt']);
    assert.deepStrictEqual(cap.output, ['code-changes', 'report']);
    assert.deepStrictEqual(cap.tools, ['git']);
    assert.deepStrictEqual(cap.interaction, ['none']);
  });

  it('config without capability field still loads', () => {
    writeMesh('no-cap-mesh', `
mesh: no-cap-mesh
description: "Mesh without capability"
agents:
  - name: worker
    model: sonnet
    prompt: prompt.md
entry_point: worker
`);

    loader.loadAll();
    const config = loader.get('no-cap-mesh');

    assert.ok(config, 'config should load');
    assert.strictEqual(config.capability, undefined, 'capability should be undefined');
  });
});
