/**
 * Unit tests for FragmentRegistry
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { FragmentRegistry } from '../fragment-registry.ts';

const TEST_DIR = path.join(process.cwd(), '.test-fragments');

beforeEach(() => {
  // Create test directory
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
});

afterEach(() => {
  // Cleanup test directory
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('FragmentRegistry', () => {
  it('empty registry', () => {
    const registry = new FragmentRegistry();

    assert.strictEqual(registry.count(), 0);
    assert.deepStrictEqual(registry.list(), []);
    assert.strictEqual(registry.has('nonexistent'), false);
    assert.strictEqual(registry.resolve('nonexistent'), null);
  });

  it('load from mesh config', () => {
    const registry = new FragmentRegistry();

    registry.load(
      {
        fragments: {
          'test-fragment': 'Fragment content from mesh config',
        },
      },
      {},
      undefined,
      undefined
    );

    assert.strictEqual(registry.count(), 1);
    assert.strictEqual(registry.has('test-fragment'), true);

    const fragment = registry.resolve('test-fragment');
    assert.notStrictEqual(fragment, null);
    assert.strictEqual(fragment?.name, 'test-fragment');
    assert.strictEqual(fragment?.content, 'Fragment content from mesh config');
    assert.strictEqual(fragment?.source, 'mesh-config');
    assert.strictEqual(fragment?.description, null);
  });

  it('load from agent config', () => {
    const registry = new FragmentRegistry();

    registry.load(
      {},
      {
        fragments: {
          'agent-fragment': 'Fragment from agent config',
        },
      },
      undefined,
      undefined
    );

    const fragment = registry.resolve('agent-fragment');
    assert.strictEqual(fragment?.source, 'agent-config');
  });

  it('priority - agent config overrides mesh config', () => {
    const registry = new FragmentRegistry();

    registry.load(
      {
        fragments: {
          'same-name': 'Mesh version',
        },
      },
      {
        fragments: {
          'same-name': 'Agent version',
        },
      },
      undefined,
      undefined
    );

    const fragment = registry.resolve('same-name');
    assert.strictEqual(fragment?.content, 'Agent version');
    assert.strictEqual(fragment?.source, 'agent-config');
  });

  it('load from mesh directory', () => {
    const meshDir = path.join(TEST_DIR, 'mesh-fragments');
    fs.mkdirSync(meshDir, { recursive: true });

    // Create fragment file
    fs.writeFileSync(path.join(meshDir, 'dir-fragment.md'), 'Fragment from directory');

    const registry = new FragmentRegistry();
    registry.load({}, {}, meshDir, undefined);

    const fragment = registry.resolve('dir-fragment');
    assert.strictEqual(fragment?.content, 'Fragment from directory');
    assert.strictEqual(fragment?.source, 'mesh-dir');
  });

  it('load from agent directory', () => {
    const agentDir = path.join(TEST_DIR, 'agent-fragments');
    fs.mkdirSync(agentDir, { recursive: true });

    fs.writeFileSync(path.join(agentDir, 'agent-dir.md'), 'Fragment from agent dir');

    const registry = new FragmentRegistry();
    registry.load({}, {}, undefined, agentDir);

    const fragment = registry.resolve('agent-dir');
    assert.strictEqual(fragment?.source, 'agent-dir');
  });

  it('priority - agent dir overrides mesh dir', () => {
    const meshDir = path.join(TEST_DIR, 'mesh-fragments');
    const agentDir = path.join(TEST_DIR, 'agent-fragments');

    fs.mkdirSync(meshDir, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });

    fs.writeFileSync(path.join(meshDir, 'shared.md'), 'Mesh directory version');
    fs.writeFileSync(path.join(agentDir, 'shared.md'), 'Agent directory version');

    const registry = new FragmentRegistry();
    registry.load({}, {}, meshDir, agentDir);

    const fragment = registry.resolve('shared');
    assert.strictEqual(fragment?.content, 'Agent directory version');
    assert.strictEqual(fragment?.source, 'agent-dir');
  });

  it('YAML frontmatter with description', () => {
    const meshDir = path.join(TEST_DIR, 'mesh-fragments');
    fs.mkdirSync(meshDir, { recursive: true });

    const fragmentContent = `---
description: This is a test fragment with metadata
---
Fragment body content here`;

    fs.writeFileSync(path.join(meshDir, 'with-meta.md'), fragmentContent);

    const registry = new FragmentRegistry();
    registry.load({}, {}, meshDir, undefined);

    const fragment = registry.resolve('with-meta');
    assert.strictEqual(fragment?.description, 'This is a test fragment with metadata');
    assert.strictEqual(fragment?.content, 'Fragment body content here');
  });

  it('runtime registration (highest priority)', () => {
    const registry = new FragmentRegistry();

    registry.load(
      {
        fragments: {
          'dynamic': 'Config version',
        },
      },
      {},
      undefined,
      undefined
    );

    // Runtime registration should override
    registry.register('dynamic', 'Runtime version', 'Runtime description');

    const fragment = registry.resolve('dynamic');
    assert.strictEqual(fragment?.content, 'Runtime version');
    assert.strictEqual(fragment?.source, 'runtime');
    assert.strictEqual(fragment?.description, 'Runtime description');
  });

  it('size limit enforcement', () => {
    const registry = new FragmentRegistry();

    // Create fragment larger than 50KB
    const largeContent = 'x'.repeat(51 * 1024);

    assert.throws(() => {
      registry.register('large', largeContent);
    }, /exceeds size limit/);
  });

  it('size limit enforced on directory load', () => {
    const meshDir = path.join(TEST_DIR, 'mesh-fragments');
    fs.mkdirSync(meshDir, { recursive: true });

    // Create fragment file larger than 50KB
    const largeContent = 'x'.repeat(51 * 1024);
    fs.writeFileSync(path.join(meshDir, 'too-large.md'), largeContent);

    const registry = new FragmentRegistry();
    registry.load({}, {}, meshDir, undefined);

    // Should skip the large file
    assert.strictEqual(registry.has('too-large'), false);
    assert.strictEqual(registry.count(), 0);
  });

  it('list all fragments', () => {
    const registry = new FragmentRegistry();

    registry.load(
      {
        fragments: {
          'frag1': 'Content 1',
          'frag2': 'Content 2',
        },
      },
      {
        fragments: {
          'frag3': 'Content 3',
        },
      },
      undefined,
      undefined
    );

    const list = registry.list();
    assert.strictEqual(list.length, 3);

    const names = list.map((f) => f.name).sort();
    assert.deepStrictEqual(names, ['frag1', 'frag2', 'frag3']);
  });

  it('clear all fragments', () => {
    const registry = new FragmentRegistry();

    registry.register('test', 'content');
    assert.strictEqual(registry.count(), 1);

    registry.clear();
    assert.strictEqual(registry.count(), 0);
    assert.strictEqual(registry.has('test'), false);
  });

  it('handles missing directories gracefully', () => {
    const registry = new FragmentRegistry();
    const nonExistentDir = path.join(TEST_DIR, 'does-not-exist');

    // Should not throw
    assert.doesNotThrow(() => {
      registry.load({}, {}, nonExistentDir, nonExistentDir);
    });

    assert.strictEqual(registry.count(), 0);
  });

  it('ignores non-.md files in directories', () => {
    const meshDir = path.join(TEST_DIR, 'mesh-fragments');
    fs.mkdirSync(meshDir, { recursive: true });

    fs.writeFileSync(path.join(meshDir, 'fragment.md'), 'Valid fragment');
    fs.writeFileSync(path.join(meshDir, 'readme.txt'), 'Should be ignored');
    fs.writeFileSync(path.join(meshDir, 'config.json'), '{}');

    const registry = new FragmentRegistry();
    registry.load({}, {}, meshDir, undefined);

    assert.strictEqual(registry.count(), 1);
    assert.strictEqual(registry.has('fragment'), true);
    assert.strictEqual(registry.has('readme'), false);
    assert.strictEqual(registry.has('config'), false);
  });
});
