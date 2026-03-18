// test/unit/fragment-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

    expect(registry.list()).toEqual(['contrarian', 'deep-dive']);
    expect(registry.get('deep-dive')).toContain('Analyze in detail');
  });

  it('returns null for unknown fragment', () => {
    const registry = new FragmentRegistry();
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('registers runtime fragments', () => {
    const registry = new FragmentRegistry();
    registry.register('custom', '# Custom\nAgent-authored fragment.');

    expect(registry.get('custom')).toContain('Agent-authored');
    expect(registry.list()).toContain('custom');
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

    expect(registry.get('shared')).toBe('agent version');
  });
});
