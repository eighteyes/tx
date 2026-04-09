/**
 * FragmentLoader Unit Tests
 *
 * Tests loading YAML prompt fragments from disk and querying by ID.
 *
 * Responsibilities:
 * - Verify domain fragments load with expected sections
 * - Verify tool fragments load with expected sections
 * - Verify interaction fragments load with expected sections
 * - Verify missing fragments return null
 * - Verify listAll returns all loaded fragment IDs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { FragmentLoader } from '../../src/mesh/capability/fragment-loader.ts';
import type { PromptFragment } from '../../src/mesh/capability/fragment-loader.ts';

const FRAGMENTS_DIR = path.resolve(
  import.meta.dirname,
  '../../src/mesh/fragments',
);

describe('FragmentLoader', () => {
  it('loads a domain fragment by id (domain/dev)', () => {
    const loader = new FragmentLoader(FRAGMENTS_DIR);
    const frag = loader.get('domain/dev');

    assert.ok(frag, 'domain/dev fragment should exist');
    assert.strictEqual(frag.id, 'domain/dev');
    assert.ok(frag.sections.identity, 'should have identity section');
    assert.ok(Array.isArray(frag.sections['anti-patterns']), 'anti-patterns should be array');
    assert.ok(Array.isArray(frag.sections['error-architecture']), 'error-architecture should be array');
    assert.ok(Array.isArray(frag.sections['workflow-phases']), 'workflow-phases should be array');
  });

  it('loads a tool fragment by id (tools/git)', () => {
    const loader = new FragmentLoader(FRAGMENTS_DIR);
    const frag = loader.get('tools/git');

    assert.ok(frag, 'tools/git fragment should exist');
    assert.strictEqual(frag.id, 'tools/git');
    assert.ok(frag.sections.capabilities, 'should have capabilities section');
    assert.ok(frag.sections.constraints, 'should have constraints section');
  });

  it('loads an interaction fragment by id (interaction/gate-exit)', () => {
    const loader = new FragmentLoader(FRAGMENTS_DIR);
    const frag = loader.get('interaction/gate-exit');

    assert.ok(frag, 'interaction/gate-exit fragment should exist');
    assert.strictEqual(frag.id, 'interaction/gate-exit');
    assert.ok(frag.sections.constraints, 'should have constraints section');
  });

  it('returns null for missing fragment', () => {
    const loader = new FragmentLoader(FRAGMENTS_DIR);
    const frag = loader.get('domain/teleportation');

    assert.strictEqual(frag, null);
  });

  it('listAll returns all loaded fragment IDs', () => {
    const loader = new FragmentLoader(FRAGMENTS_DIR);
    const ids = loader.listAll();

    assert.ok(ids.includes('domain/dev'), 'should include domain/dev');
    assert.ok(ids.includes('domain/research'), 'should include domain/research');
    assert.ok(ids.includes('tools/git'), 'should include tools/git');
    assert.ok(ids.includes('tools/web-search'), 'should include tools/web-search');
    assert.ok(ids.includes('interaction/gate-exit'), 'should include interaction/gate-exit');
    assert.ok(ids.includes('interaction/none'), 'should include interaction/none');
    assert.ok(ids.includes('topology/merge'), 'should include topology/merge');
    assert.ok(ids.length >= 7, `should have at least 7 fragments, got ${ids.length}`);
  });
});
