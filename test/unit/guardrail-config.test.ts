/**
 * GuardrailConfig Unit Tests
 *
 * Tests the guardrail threshold resolution chain, including:
 * - max_mesh_messages limit resolution
 * - Mode (strict/warning) resolution for max_mesh_messages
 * - Override chain: mesh-local > global mesh > global > default
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { GuardrailConfig } from '../../src/worker/guardrail-config.ts';

describe('GuardrailConfig - max_mesh_messages', () => {
  let testDir: string;
  let configDir: string;
  let configPath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-guardrail-test-'));
    configDir = path.join(testDir, '.ai', 'tx', 'data');
    fs.mkdirSync(configDir, { recursive: true });
    configPath = path.join(configDir, 'config.yaml');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should return null (unlimited) by default when no config exists', () => {
    const guardrails = new GuardrailConfig(testDir);
    const result = guardrails.getMaxMeshMessages('test-mesh');
    assert.strictEqual(result, null, 'Should return null when no config exists');
  });

  it('should resolve global max_mesh_messages as a number', () => {
    fs.writeFileSync(configPath, `
guardrails:
  max_mesh_messages: 100
`);
    const guardrails = new GuardrailConfig(testDir);
    const result = guardrails.getMaxMeshMessages('any-mesh');
    assert.strictEqual(result, 100, 'Should resolve global numeric limit');
  });

  it('should resolve global max_mesh_messages from object form', () => {
    fs.writeFileSync(configPath, `
guardrails:
  max_mesh_messages:
    limit: 50
    strict: true
    warning: false
`);
    const guardrails = new GuardrailConfig(testDir);
    const result = guardrails.getMaxMeshMessages('any-mesh');
    assert.strictEqual(result, 50, 'Should extract limit from object form');
  });

  it('should resolve mesh-specific override over global', () => {
    fs.writeFileSync(configPath, `
guardrails:
  max_mesh_messages: 100
  meshes:
    test-mesh:
      max_mesh_messages: 25
`);
    const guardrails = new GuardrailConfig(testDir);

    const testMeshResult = guardrails.getMaxMeshMessages('test-mesh');
    assert.strictEqual(testMeshResult, 25, 'Mesh-specific should override global');

    const otherMeshResult = guardrails.getMaxMeshMessages('other-mesh');
    assert.strictEqual(otherMeshResult, 100, 'Other mesh should use global');
  });

  it('should resolve mesh-local guardrails over global config', () => {
    fs.writeFileSync(configPath, `
guardrails:
  max_mesh_messages: 100
  meshes:
    test-mesh:
      max_mesh_messages: 50
`);
    const guardrails = new GuardrailConfig(testDir);

    // Register mesh-local guardrails (simulating mesh config.yaml)
    guardrails.registerMesh('test-mesh', {
      max_mesh_messages: 10,
    } as any);

    const result = guardrails.getMaxMeshMessages('test-mesh');
    assert.strictEqual(result, 10, 'Mesh-local should override global config');
  });

  it('should handle null limit in object form as unlimited', () => {
    fs.writeFileSync(configPath, `
guardrails:
  max_mesh_messages:
    limit: null
    strict: true
`);
    const guardrails = new GuardrailConfig(testDir);
    // null limit in object = continue chain, eventually hits default (null)
    const result = guardrails.getMaxMeshMessages('any-mesh');
    assert.strictEqual(result, null, 'null limit should resolve to unlimited');
  });
});

describe('GuardrailConfig - max_mesh_messages mode resolution', () => {
  let testDir: string;
  let configDir: string;
  let configPath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-guardrail-mode-test-'));
    configDir = path.join(testDir, '.ai', 'tx', 'data');
    fs.mkdirSync(configDir, { recursive: true });
    configPath = path.join(configDir, 'config.yaml');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should return default mode when no config exists', () => {
    const guardrails = new GuardrailConfig(testDir);
    const mode = guardrails.getMode('max_mesh_messages', 'test-mesh');
    assert.strictEqual(mode.strict, false, 'Default strict should be false');
    assert.strictEqual(mode.warning, true, 'Default warning should be true');
  });

  it('should resolve global mode settings', () => {
    fs.writeFileSync(configPath, `
guardrails:
  max_mesh_messages:
    limit: 100
    strict: true
    warning: false
`);
    const guardrails = new GuardrailConfig(testDir);
    const mode = guardrails.getMode('max_mesh_messages', 'any-mesh');
    assert.strictEqual(mode.strict, true, 'Should resolve global strict');
    assert.strictEqual(mode.warning, false, 'Should resolve global warning');
  });

  it('should resolve mesh-specific mode over global', () => {
    fs.writeFileSync(configPath, `
guardrails:
  max_mesh_messages:
    strict: false
    warning: true
  meshes:
    test-mesh:
      max_mesh_messages:
        strict: true
        warning: false
`);
    const guardrails = new GuardrailConfig(testDir);
    const mode = guardrails.getMode('max_mesh_messages', 'test-mesh');
    assert.strictEqual(mode.strict, true, 'Mesh-specific strict should override');
    assert.strictEqual(mode.warning, false, 'Mesh-specific warning should override');
  });

  it('should resolve mesh-local mode over global config', () => {
    fs.writeFileSync(configPath, `
guardrails:
  max_mesh_messages:
    strict: true
    warning: false
`);
    const guardrails = new GuardrailConfig(testDir);

    // Register mesh-local guardrails with different mode
    guardrails.registerMesh('test-mesh', {
      max_mesh_messages: {
        limit: 10,
        strict: false,
        warning: true,
      },
    } as any);

    const mode = guardrails.getMode('max_mesh_messages', 'test-mesh');
    assert.strictEqual(mode.strict, false, 'Mesh-local strict should override');
    assert.strictEqual(mode.warning, true, 'Mesh-local warning should override');
  });

  it('should resolve strict and warning independently from different sources', () => {
    fs.writeFileSync(configPath, `
guardrails:
  max_mesh_messages:
    strict: true
  meshes:
    test-mesh:
      max_mesh_messages:
        warning: false
`);
    const guardrails = new GuardrailConfig(testDir);

    // Mesh-specific only sets warning, global sets strict
    const mode = guardrails.getMode('max_mesh_messages', 'test-mesh');
    assert.strictEqual(mode.warning, false, 'Should get warning from mesh-specific');
    assert.strictEqual(mode.strict, true, 'Should get strict from global');
  });
});
