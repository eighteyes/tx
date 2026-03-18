/**
 * ManifestResolver Unit Tests
 *
 * Tests resolveManifestEligibility() and formatDeadlockMessage()
 * for filesystem-driven agent orchestration.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveManifestEligibility,
  formatDeadlockMessage,
} from '../../src/worker/manifest-resolver.ts';
import type { ManifestPathContext } from '../../src/worker/manifest-validator.ts';
import type { ManifestEntry } from '../../src/worker/mesh-validator.ts';

// Test fixtures
let tmpDir: string;
let pathContext: ManifestPathContext;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-resolver-test-'));
  const wsDir = path.join(tmpDir, 'workspace');
  fs.mkdirSync(wsDir, { recursive: true });
  pathContext = {
    workDir: tmpDir,
    wsLocations: { workspace: 'workspace' },
    wsBase: 'workspace',
    varMap: {},
  };
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function writeFile(name: string, content = 'test') {
  fs.writeFileSync(path.join(tmpDir, 'workspace', name), content);
}

// Simple 3-agent pipeline: architect → narrator → editor
const pipelineManifest: ManifestEntry[] = [
  { id: 'decomposition.yaml', reads: ['narrator'], writes: ['architect'] },
  { id: 'draft.md', reads: ['editor'], writes: ['narrator'] },
  { id: 'final.md', reads: [], writes: ['editor'] },
];

describe('resolveManifestEligibility — Basic pipeline', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('should find agent with no reads as eligible at start', () => {
    const result = resolveManifestEligibility(
      pipelineManifest,
      ['architect', 'narrator', 'editor'],
      new Set(),
      new Set(),
      pathContext,
    );
    assert.deepEqual(result.eligible, ['architect']);
    assert.equal(result.deadlock, false);
  });

  it('should find narrator eligible after architect writes decomposition.yaml', () => {
    writeFile('decomposition.yaml');
    const decompositionPath = path.join(tmpDir, 'workspace', 'decomposition.yaml');

    const result = resolveManifestEligibility(
      pipelineManifest,
      ['architect', 'narrator', 'editor'],
      new Set(['architect']),
      new Set([decompositionPath]),
      pathContext,
    );
    assert.deepEqual(result.eligible, ['narrator']);
    assert.equal(result.deadlock, false);
  });

  it('should find editor eligible after narrator writes draft.md', () => {
    writeFile('decomposition.yaml');
    writeFile('draft.md');
    const decompositionPath = path.join(tmpDir, 'workspace', 'decomposition.yaml');
    const draftPath = path.join(tmpDir, 'workspace', 'draft.md');

    const result = resolveManifestEligibility(
      pipelineManifest,
      ['architect', 'narrator', 'editor'],
      new Set(['architect', 'narrator']),
      new Set([decompositionPath, draftPath]),
      pathContext,
    );
    assert.deepEqual(result.eligible, ['editor']);
    assert.equal(result.deadlock, false);
  });

  it('should return no eligible when all agents completed', () => {
    writeFile('decomposition.yaml');
    writeFile('draft.md');
    writeFile('final.md');
    const allPaths = new Set([
      path.join(tmpDir, 'workspace', 'decomposition.yaml'),
      path.join(tmpDir, 'workspace', 'draft.md'),
      path.join(tmpDir, 'workspace', 'final.md'),
    ]);

    const result = resolveManifestEligibility(
      pipelineManifest,
      ['architect', 'narrator', 'editor'],
      new Set(['architect', 'narrator', 'editor']),
      allPaths,
      pathContext,
    );
    assert.deepEqual(result.eligible, []);
    assert.equal(result.deadlock, false);
  });

  it('should not re-include completed agents', () => {
    writeFile('decomposition.yaml');
    const decompositionPath = path.join(tmpDir, 'workspace', 'decomposition.yaml');

    const result = resolveManifestEligibility(
      pipelineManifest,
      ['architect', 'narrator', 'editor'],
      new Set(['architect']),
      new Set([decompositionPath]),
      pathContext,
    );
    // architect is completed, should not appear
    assert.ok(!result.eligible.includes('architect'));
  });
});

describe('resolveManifestEligibility — Parallel eligibility', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('should return multiple eligible agents when reads are independent', () => {
    // Two agents that both read from architect but don't depend on each other
    const parallelManifest: ManifestEntry[] = [
      { id: 'plan.yaml', reads: ['reviewer-a', 'reviewer-b'], writes: ['architect'] },
      { id: 'review-a.md', reads: [], writes: ['reviewer-a'] },
      { id: 'review-b.md', reads: [], writes: ['reviewer-b'] },
    ];

    writeFile('plan.yaml');
    const planPath = path.join(tmpDir, 'workspace', 'plan.yaml');

    const result = resolveManifestEligibility(
      parallelManifest,
      ['architect', 'reviewer-a', 'reviewer-b'],
      new Set(['architect']),
      new Set([planPath]),
      pathContext,
    );
    assert.deepEqual(result.eligible.sort(), ['reviewer-a', 'reviewer-b']);
    assert.equal(result.deadlock, false);
  });
});

describe('resolveManifestEligibility — Deadlock detection', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('should detect deadlock when reads are unsatisfied', () => {
    // narrator needs decomposition.yaml but architect already completed without writing it
    const result = resolveManifestEligibility(
      pipelineManifest,
      ['architect', 'narrator', 'editor'],
      new Set(['architect']),
      new Set(), // architect completed but nothing in writtenFiles
      pathContext,
    );
    // architect is done, narrator can't read decomposition.yaml, editor can't read draft.md
    assert.equal(result.deadlock, true);
    assert.deepEqual(result.eligible, []);
    assert.ok(result.diagnostics);
    assert.equal(result.diagnostics!.length, 2); // narrator + editor stuck
  });

  it('should detect circular dependency deadlock', () => {
    const circularManifest: ManifestEntry[] = [
      { id: 'a.txt', reads: ['agent-b'], writes: ['agent-a'] },
      { id: 'b.txt', reads: ['agent-a'], writes: ['agent-b'] },
    ];

    const result = resolveManifestEligibility(
      circularManifest,
      ['agent-a', 'agent-b'],
      new Set(),
      new Set(),
      pathContext,
    );
    assert.equal(result.deadlock, true);
    assert.deepEqual(result.eligible, []);
  });
});

describe('resolveManifestEligibility — Directory entries', () => {
  beforeEach(() => setup());
  afterEach(() => teardown());

  it('should treat existing directory as satisfied read', () => {
    const dirManifest: ManifestEntry[] = [
      { id: 'output/', reads: ['consumer'], writes: ['producer'] },
      { id: 'result.md', reads: [], writes: ['consumer'] },
    ];

    // Create the directory
    fs.mkdirSync(path.join(tmpDir, 'workspace', 'output'), { recursive: true });
    const dirPath = path.join(tmpDir, 'workspace', 'output/');

    const result = resolveManifestEligibility(
      dirManifest,
      ['producer', 'consumer'],
      new Set(['producer']),
      new Set([dirPath]),
      pathContext,
    );
    assert.ok(result.eligible.includes('consumer'));
  });

  it('should skip directory entries in writes-incomplete check', () => {
    const dirManifest: ManifestEntry[] = [
      { id: 'output/', reads: [], writes: ['producer'] },
      { id: 'output/file.txt', reads: [], writes: ['producer'] },
    ];

    // producer has written the file but directory entry should be skipped
    const filePath = path.join(tmpDir, 'workspace', 'output/file.txt');

    const result = resolveManifestEligibility(
      dirManifest,
      ['producer'],
      new Set(),
      new Set(), // nothing in writtenFiles yet
      pathContext,
    );
    // producer should be eligible because output/file.txt is not in writtenFiles
    assert.ok(result.eligible.includes('producer'));
  });
});

describe('formatDeadlockMessage', () => {
  it('should format deadlock with missing reads', () => {
    const result = {
      eligible: [],
      deadlock: true,
      diagnostics: [
        { agent: 'narrator', missingReads: ['decomposition.yaml'] },
        { agent: 'editor', missingReads: ['draft.md'] },
      ],
    };
    const msg = formatDeadlockMessage(result);
    assert.ok(msg.includes('Manifest deadlock: 2 agents stuck'));
    assert.ok(msg.includes('narrator: missing reads [decomposition.yaml]'));
    assert.ok(msg.includes('editor: missing reads [draft.md]'));
  });

  it('should return empty string for non-deadlock', () => {
    const result = { eligible: ['architect'], deadlock: false };
    const msg = formatDeadlockMessage(result);
    assert.equal(msg, '');
  });

  it('should handle single agent deadlock', () => {
    const result = {
      eligible: [],
      deadlock: true,
      diagnostics: [{ agent: 'lonely', missingReads: ['input.txt'] }],
    };
    const msg = formatDeadlockMessage(result);
    assert.ok(msg.includes('1 agent stuck'));
  });
});
