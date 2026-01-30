/**
 * Mesh Manifest Validation Tests
 *
 * Validates MeshValidator.validateManifest cross-references manifest file
 * entries against routing to verify files are available when agents need them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeshValidator } from '../../src/worker/mesh-validator.ts';

/** Helper: build a minimal agents array */
const agents = (...names: string[]) =>
  names.map(name => ({ name, model: 'sonnet', prompt: 'p.md' }));

/** Helper: workspace config with locations */
const workspaceWith = (locations: Record<string, string>) => ({
  path: '.ai/games/',
  locations,
});

describe('validateManifest', () => {
  it('valid manifest passes', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'draft.md', description: 'Working draft', location: 'workspace', reads: ['editor'], writes: ['writer'] },
    ];
    const routing = {
      writer: { task: { editor: 'Review draft' } },
      editor: { 'task-complete': { core: 'Done' } },
    };

    MeshValidator.validateManifest(workflow, routing, agents('writer', 'editor'), errors, warnings, '',
      workspaceWith({ workspace: './turns/' }));
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.join(', ')}`);
    assert.equal(warnings.length, 0, `Unexpected warnings: ${warnings.join(', ')}`);
  });

  it('unknown agent in reads → error', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'f.md', reads: ['ghost'], writes: ['writer'] },
    ];

    MeshValidator.validateManifest(workflow, null, agents('writer'), errors, warnings, '');
    assert.ok(errors.some(e => e.includes("unknown agent 'ghost'")), `Expected unknown agent error, got: ${errors}`);
  });

  it('unknown agent in writes → error', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'f.md', reads: ['writer'], writes: ['ghost'] },
    ];

    MeshValidator.validateManifest(workflow, null, agents('writer'), errors, warnings, '');
    assert.ok(errors.some(e => e.includes("unknown agent 'ghost'")), `Expected unknown agent error, got: ${errors}`);
  });

  it('file with readers but zero writers → error', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'orphan.md', reads: ['reader'], writes: [] },
    ];

    MeshValidator.validateManifest(workflow, null, agents('reader'), errors, warnings, '');
    assert.ok(errors.some(e => e.includes('has readers but no writers')), `Expected no-writers error, got: ${errors}`);
  });

  it('persistent file with readers but zero writers → no error (pre-existing)', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'template.yaml', persistent: true, reads: ['reader'], writes: [] },
    ];

    MeshValidator.validateManifest(workflow, null, agents('reader'), errors, warnings, '');
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.join(', ')}`);
  });

  it('duplicate manifest id → error', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'dup.md', reads: [], writes: ['a'] },
      { id: 'dup.md', reads: [], writes: ['a'] },
    ];

    MeshValidator.validateManifest(workflow, null, agents('a'), errors, warnings, '');
    assert.ok(errors.some(e => e.includes("duplicate manifest id 'dup.md'")), `Expected duplicate id error, got: ${errors}`);
  });

  it('reader without writer predecessor in routing → warning', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'data.md', location: 'workspace', reads: ['reader'], writes: ['writer'] },
    ];
    const routing = {
      writer: { task: { core: 'Done' } },
      reader: { task: { core: 'Done' } },
    };

    MeshValidator.validateManifest(workflow, routing, agents('writer', 'reader'), errors, warnings, '');
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.join(', ')}`);
    assert.ok(warnings.some(w => w.includes("reader 'reader' has no writer predecessor")), `Expected predecessor warning, got: ${warnings}`);
  });

  it('self-read-after-write is valid', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'prose.md', location: 'workspace', reads: ['narrator'], writes: ['narrator'] },
    ];
    const routing = {
      narrator: { 'task-complete': { core: 'Done' } },
    };

    MeshValidator.validateManifest(workflow, routing, agents('narrator'), errors, warnings, '');
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.join(', ')}`);
    assert.equal(warnings.length, 0, `Unexpected warnings: ${warnings.join(', ')}`);
  });

  it('persistent files skip ordering checks', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // reader has no writer predecessor, but persistent: true → no warning
    const workflow = [
      { id: 'state.yaml', location: 'campaign', persistent: true, reads: ['reader'], writes: ['writer'] },
    ];
    const routing = {
      writer: { task: { core: 'Done' } },
      reader: { task: { core: 'Done' } },
    };

    MeshValidator.validateManifest(workflow, routing, agents('writer', 'reader'), errors, warnings, '');
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.join(', ')}`);
    assert.equal(warnings.length, 0, `Unexpected warnings: ${warnings.join(', ')}`);
  });

  it('no routing → structural checks only (no ordering warnings)', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'data.md', reads: ['reader'], writes: ['writer'] },
    ];

    MeshValidator.validateManifest(workflow, undefined, agents('writer', 'reader'), errors, warnings, '');
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.join(', ')}`);
    assert.equal(warnings.length, 0, `Unexpected warnings: ${warnings.join(', ')}`);
  });

  it('transitive predecessor resolves correctly', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'chain.md', location: 'workspace', reads: ['c'], writes: ['a'] },
    ];
    const routing = {
      a: { task: { b: 'Step 2' } },
      b: { task: { c: 'Step 3' } },
      c: { 'task-complete': { core: 'Done' } },
    };

    MeshValidator.validateManifest(workflow, routing, agents('a', 'b', 'c'), errors, warnings, '');
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.join(', ')}`);
    assert.equal(warnings.length, 0, `Unexpected warnings: ${warnings.join(', ')}`);
  });

  it('description must be a string if present', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'f.md', description: 42, reads: [], writes: ['a'] },
    ];

    MeshValidator.validateManifest(workflow, null, agents('a'), errors, warnings, '');
    assert.ok(errors.some(e => e.includes('description must be a string')), `Expected description error, got: ${errors}`);
  });

  it('persistent must be a boolean if present', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'f.md', persistent: 'yes', reads: [], writes: ['a'] },
    ];

    MeshValidator.validateManifest(workflow, null, agents('a'), errors, warnings, '');
    assert.ok(errors.some(e => e.includes('persistent must be a boolean')), `Expected persistent error, got: ${errors}`);
  });

  it('unknown location warns when workspace.locations defined', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'f.md', location: 'narnia', reads: [], writes: ['a'] },
    ];

    MeshValidator.validateManifest(workflow, null, agents('a'), errors, warnings, '',
      workspaceWith({ workspace: './turns/', game: './games/' }));
    assert.ok(warnings.some(w => w.includes("location 'narnia' not defined")), `Expected location warning, got: ${warnings}`);
  });

  it('known location passes when workspace.locations defined', () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const workflow = [
      { id: 'f.md', location: 'game', reads: [], writes: ['a'] },
    ];

    MeshValidator.validateManifest(workflow, null, agents('a'), errors, warnings, '',
      workspaceWith({ workspace: './turns/', game: './games/' }));
    assert.equal(errors.length, 0, `Unexpected errors: ${errors.join(', ')}`);
    assert.equal(warnings.length, 0, `Unexpected warnings: ${warnings.join(', ')}`);
  });

  it('integrates via validate() when manifest present', () => {
    const result = MeshValidator.validate({
      mesh: 'test-mesh',
      agents: [
        { name: 'writer', model: 'sonnet', prompt: 'w.md' },
      ],
      manifest: [
        { id: 'out.md', description: 'Output file', reads: ['writer'], writes: ['writer'] },
      ],
    });
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });
});
