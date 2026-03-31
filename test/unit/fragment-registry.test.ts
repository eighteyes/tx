// test/unit/fragment-registry.test.ts
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FragmentRegistry } from '../../src/prompt/fragment-registry.ts';

describe('FragmentRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frag-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads fragments from agent directory', () => {
    const fragDir = path.join(tmpDir, 'fragments');
    fs.mkdirSync(fragDir);
    fs.writeFileSync(path.join(fragDir, 'deep-dive.md'), '# Deep Dive\nAnalyze in detail.');
    fs.writeFileSync(path.join(fragDir, 'contrarian.md'), '# Contrarian\nChallenge assumptions.');

    const registry = new FragmentRegistry();
    registry.loadFromDir(fragDir);

    assert.deepEqual(registry.list(), ['contrarian', 'deep-dive']);
    assert.ok(registry.get('deep-dive')?.includes('Analyze in detail'));
  });

  it('returns null for unknown fragment', () => {
    const registry = new FragmentRegistry();
    assert.equal(registry.get('nonexistent'), null);
  });

  it('registers runtime fragments', () => {
    const registry = new FragmentRegistry();
    registry.register('custom', '# Custom\nAgent-authored fragment.');

    assert.ok(registry.get('custom')?.includes('Agent-authored'));
    assert.ok(registry.list().includes('custom'));
  });

  it('loads from multiple directories with priority', () => {
    const meshFrags = path.join(tmpDir, 'mesh-frags');
    const agentFrags = path.join(tmpDir, 'agent-frags');
    fs.mkdirSync(meshFrags);
    fs.mkdirSync(agentFrags);
    fs.writeFileSync(path.join(meshFrags, 'shared.md'), 'mesh version');
    fs.writeFileSync(path.join(agentFrags, 'shared.md'), 'agent version');

    const registry = new FragmentRegistry();
    registry.loadFromDir(meshFrags);    // lower priority
    registry.loadFromDir(agentFrags);   // higher priority (loaded second, overwrites)

    assert.equal(registry.get('shared'), 'agent version');
  });
});
