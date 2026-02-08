/**
 * Manifest Auto-Inject Unit Tests
 *
 * Tests the manifest auto-inject feature for preloading files:
 * - Mesh-level autoInjectManifestFiles setting (default: true)
 * - Entry-level autoInject override
 * - Integration with preload logic
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { MeshConfigLoader } from '../../src/mesh/config-loader.ts';

describe('Manifest Auto-Inject Configuration', () => {
  let testDir: string;
  let meshesDir: string;
  let originalTxRoot: string | undefined;

  beforeEach(() => {
    // Save and clear TX_ROOT to prevent loading global meshes
    originalTxRoot = process.env.TX_ROOT;
    delete process.env.TX_ROOT;

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-manifest-inject-test-'));
    meshesDir = path.join(testDir, 'meshes');
    fs.mkdirSync(path.join(meshesDir, 'test-mesh'), { recursive: true });
  });

  afterEach(() => {
    // Restore TX_ROOT
    if (originalTxRoot !== undefined) {
      process.env.TX_ROOT = originalTxRoot;
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should default autoInjectManifestFiles to undefined (treated as true)', () => {
    // Write minimal config without autoInjectManifestFiles
    // Manifest entries need both reads and writes to pass validation
    fs.writeFileSync(
      path.join(meshesDir, 'test-mesh', 'config.yaml'),
      `
mesh: test-mesh
description: Test mesh
agents:
  - name: worker
    model: haiku
    prompt: You are a test worker.
manifest:
  - id: data.json
    reads: [worker]
    writes: [worker]
`
    );

    const loader = new MeshConfigLoader({ workDir: testDir, meshesDir });
    loader.loadAll();
    const config = loader.get('test-mesh');

    assert.ok(config, 'Mesh config should be loaded');
    // When not specified, autoInjectManifestFiles is undefined
    // The dispatcher code treats undefined as true via: config.autoInjectManifestFiles !== false
    assert.strictEqual(
      config.autoInjectManifestFiles,
      undefined,
      'autoInjectManifestFiles should be undefined (default)'
    );
  });

  it('should parse autoInjectManifestFiles: false', () => {
    fs.writeFileSync(
      path.join(meshesDir, 'test-mesh', 'config.yaml'),
      `
mesh: test-mesh
description: Test mesh
autoInjectManifestFiles: false
agents:
  - name: worker
    model: haiku
    prompt: You are a test worker.
manifest:
  - id: data.json
    reads: [worker]
    writes: [worker]
`
    );

    const loader = new MeshConfigLoader({ workDir: testDir, meshesDir });
    loader.loadAll();
    const config = loader.get('test-mesh');

    assert.ok(config, 'Mesh config should be loaded');
    assert.strictEqual(
      config.autoInjectManifestFiles,
      false,
      'autoInjectManifestFiles should be false'
    );
  });

  it('should parse autoInjectManifestFiles: true explicitly', () => {
    fs.writeFileSync(
      path.join(meshesDir, 'test-mesh', 'config.yaml'),
      `
mesh: test-mesh
description: Test mesh
autoInjectManifestFiles: true
agents:
  - name: worker
    model: haiku
    prompt: You are a test worker.
manifest:
  - id: data.json
    reads: [worker]
    writes: [worker]
`
    );

    const loader = new MeshConfigLoader({ workDir: testDir, meshesDir });
    loader.loadAll();
    const config = loader.get('test-mesh');

    assert.ok(config, 'Mesh config should be loaded');
    assert.strictEqual(
      config.autoInjectManifestFiles,
      true,
      'autoInjectManifestFiles should be true'
    );
  });

  it('should parse entry-level autoInject override', () => {
    fs.writeFileSync(
      path.join(meshesDir, 'test-mesh', 'config.yaml'),
      `
mesh: test-mesh
description: Test mesh with entry-level overrides
autoInjectManifestFiles: true
agents:
  - name: worker
    model: haiku
    prompt: You are a test worker.
manifest:
  - id: auto-inject.json
    reads: [worker]
    writes: [worker]
  - id: no-inject.json
    reads: [worker]
    writes: [worker]
    autoInject: false
  - id: explicit-inject.json
    reads: [worker]
    writes: [worker]
    autoInject: true
`
    );

    const loader = new MeshConfigLoader({ workDir: testDir, meshesDir });
    loader.loadAll();
    const config = loader.get('test-mesh');

    assert.ok(config, 'Mesh config should be loaded');
    assert.ok(config.manifest, 'Manifest should exist');
    assert.strictEqual(config.manifest.length, 3, 'Should have 3 manifest entries');

    // First entry: no autoInject specified (uses mesh default)
    assert.strictEqual(
      config.manifest[0].autoInject,
      undefined,
      'First entry should have undefined autoInject'
    );

    // Second entry: explicit autoInject: false
    assert.strictEqual(
      config.manifest[1].autoInject,
      false,
      'Second entry should have autoInject: false'
    );

    // Third entry: explicit autoInject: true
    assert.strictEqual(
      config.manifest[2].autoInject,
      true,
      'Third entry should have autoInject: true'
    );
  });

  it('should handle entry-level override when mesh-level is false', () => {
    fs.writeFileSync(
      path.join(meshesDir, 'test-mesh', 'config.yaml'),
      `
mesh: test-mesh
description: Test mesh with mesh-level disabled
autoInjectManifestFiles: false
agents:
  - name: worker
    model: haiku
    prompt: You are a test worker.
manifest:
  - id: no-inject.json
    reads: [worker]
    writes: [worker]
  - id: force-inject.json
    reads: [worker]
    writes: [worker]
    autoInject: true
`
    );

    const loader = new MeshConfigLoader({ workDir: testDir, meshesDir });
    loader.loadAll();
    const config = loader.get('test-mesh');

    assert.ok(config, 'Mesh config should be loaded');
    assert.strictEqual(
      config.autoInjectManifestFiles,
      false,
      'Mesh-level should be false'
    );

    // Entry with explicit autoInject: true overrides mesh-level false
    assert.strictEqual(
      config.manifest![1].autoInject,
      true,
      'Entry-level autoInject should override mesh-level'
    );
  });
});

describe('Manifest Auto-Inject Logic', () => {
  it('should correctly evaluate shouldAutoInject logic', () => {
    // Test the logic used in dispatcher.ts:
    // const shouldAutoInject = entry.autoInject !== undefined ? entry.autoInject : meshAutoInject;

    const testCases = [
      // [meshAutoInject, entry.autoInject, expected shouldAutoInject]
      { meshDefault: true, entryOverride: undefined, expected: true },
      { meshDefault: true, entryOverride: false, expected: false },
      { meshDefault: true, entryOverride: true, expected: true },
      { meshDefault: false, entryOverride: undefined, expected: false },
      { meshDefault: false, entryOverride: true, expected: true },
      { meshDefault: false, entryOverride: false, expected: false },
    ];

    for (const { meshDefault, entryOverride, expected } of testCases) {
      const shouldAutoInject =
        entryOverride !== undefined ? entryOverride : meshDefault;
      assert.strictEqual(
        shouldAutoInject,
        expected,
        `meshDefault=${meshDefault}, entryOverride=${entryOverride} should yield ${expected}`
      );
    }
  });

  it('should correctly evaluate mesh default from config', () => {
    // Test the logic: const meshAutoInject = meshConfig.autoInjectManifestFiles !== false;

    const testCases = [
      { configValue: undefined, expected: true },
      { configValue: true, expected: true },
      { configValue: false, expected: false },
    ];

    for (const { configValue, expected } of testCases) {
      const meshAutoInject = configValue !== false;
      assert.strictEqual(
        meshAutoInject,
        expected,
        `configValue=${configValue} should yield meshAutoInject=${expected}`
      );
    }
  });
});
