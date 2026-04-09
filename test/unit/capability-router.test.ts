/**
 * CapabilityRouter Unit Tests
 *
 * Tests mechanical set-coverage scoring and catalog matching.
 *
 * Responsibilities:
 * - Verify scoreMesh returns 1.0 for superset matches
 * - Verify scoreMesh returns 0 on any field mismatch
 * - Verify findBestMesh selects best match from catalog
 * - Verify findBestMesh prefers tighter fit on tiebreak
 * - Verify findBestMesh returns null when nothing qualifies
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { CapabilityDeclaration, CapabilityNeeded } from '../../src/mesh/capability/index.ts';
import { scoreMesh, findBestMesh, type CatalogEntry } from '../../src/mesh/capability/router.ts';

// -- Fixtures --

const devFull: CapabilityDeclaration = {
  domain: ['dev'],
  input: ['codebase', 'feature-request', 'spec'],
  output: ['code-changes', 'test-suite'],
  tools: ['git', 'spec-graph', 'worktree'],
  interaction: ['gate-entry', 'gate-exit'],
};

const deepResearch: CapabilityDeclaration = {
  domain: ['research'],
  input: ['question', 'url'],
  output: ['report', 'analysis'],
  tools: ['web-search', 'browser'],
  interaction: ['gate-iterative'],
};

const devLite: CapabilityDeclaration = {
  domain: ['dev'],
  input: ['codebase', 'feature-request'],
  output: ['code-changes'],
  tools: ['git'],
  interaction: ['none'],
};

// -- scoreMesh --

describe('scoreMesh', () => {
  it('returns 1.0 for perfect superset match', () => {
    const needed: CapabilityNeeded = {
      domain: ['dev'],
      input: ['codebase', 'feature-request'],
      output: ['code-changes'],
      tools: ['git'],
      interaction: ['gate-exit'],
      topology: 'sequential',
    };
    assert.strictEqual(scoreMesh(devFull, needed), 1.0);
  });

  it('returns 0 when domain mismatches', () => {
    const needed: CapabilityNeeded = {
      domain: ['research'],
      input: ['codebase'],
      output: ['code-changes'],
      tools: ['git'],
      interaction: ['none'],
      topology: 'static',
    };
    assert.strictEqual(scoreMesh(devFull, needed), 0);
  });

  it('returns 0 when needed tool missing from mesh', () => {
    const needed: CapabilityNeeded = {
      domain: ['dev'],
      input: ['codebase'],
      output: ['code-changes'],
      tools: ['git', 'web-search'],
      interaction: ['gate-exit'],
      topology: 'sequential',
    };
    assert.strictEqual(scoreMesh(devFull, needed), 0);
  });
});

// -- findBestMesh --

describe('findBestMesh', () => {
  const catalog: CatalogEntry[] = [
    { name: 'dev-full', capability: devFull },
    { name: 'deep-research', capability: deepResearch },
    { name: 'dev-lite', capability: devLite },
  ];

  it('returns best match from catalog', () => {
    const needed: CapabilityNeeded = {
      domain: ['research'],
      input: ['question'],
      output: ['report'],
      tools: ['web-search'],
      interaction: ['gate-iterative'],
      topology: 'static',
    };
    const result = findBestMesh(catalog, needed);
    assert.ok(result);
    assert.strictEqual(result.name, 'deep-research');
  });

  it('prefers tighter fit on tie (fewer excess capabilities)', () => {
    const needed: CapabilityNeeded = {
      domain: ['dev'],
      input: ['codebase', 'feature-request'],
      output: ['code-changes'],
      tools: ['git'],
      interaction: ['none'],
      topology: 'static',
    };
    // Both devFull and devLite satisfy this need.
    // devLite has 0 excess, devFull has many excess => devLite wins.
    const result = findBestMesh(catalog, needed);
    assert.ok(result);
    assert.strictEqual(result.name, 'dev-lite');
  });

  it('returns null when nothing matches', () => {
    const needed: CapabilityNeeded = {
      domain: ['narrative'],
      input: ['prompt'],
      output: ['creative-content'],
      tools: [],
      interaction: ['none'],
      topology: 'static',
    };
    const result = findBestMesh(catalog, needed);
    assert.strictEqual(result, null);
  });
});
