/**
 * CapabilitySchema Unit Tests
 *
 * Tests capability enum arrays, type validation, and declaration interfaces.
 *
 * Responsibilities:
 * - Verify enum arrays contain expected values and correct lengths
 * - Verify isValidCapability accepts valid declarations
 * - Verify isValidCapability rejects unknown enum values
 * - Verify isValidCapability rejects empty required arrays
 * - Verify CapabilityNeeded includes topology field
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  DOMAIN_VALUES,
  INPUT_VALUES,
  OUTPUT_VALUES,
  TOOL_VALUES,
  INTERACTION_VALUES,
  TOPOLOGY_VALUES,
  isValidCapability,
  type CapabilityDeclaration,
  type CapabilityNeeded,
  type Topology,
} from '../../src/mesh/capability/index.ts';

describe('Capability Schema - Enum Arrays', () => {
  it('DOMAIN_VALUES has 20 entries with expected values', () => {
    assert.strictEqual(DOMAIN_VALUES.length, 20);
    const expected = [
      'dev', 'research', 'bug-finding', 'bug-fixing', 'narrative',
      'reasoning', 'review', 'qa', 'knowledge', 'design', 'media', 'meta',
      'data', 'ops', 'security', 'planning', 'documentation',
      'refactoring', 'integration', 'communication',
    ];
    for (const val of expected) {
      assert.ok(
        (DOMAIN_VALUES as readonly string[]).includes(val),
        `DOMAIN_VALUES missing "${val}"`,
      );
    }
  });

  it('INPUT_VALUES has 8 entries with expected values', () => {
    assert.strictEqual(INPUT_VALUES.length, 8);
    const expected = [
      'prompt', 'feature-request', 'codebase', 'question',
      'spec', 'url', 'bug-report', 'files',
    ];
    for (const val of expected) {
      assert.ok(
        (INPUT_VALUES as readonly string[]).includes(val),
        `INPUT_VALUES missing "${val}"`,
      );
    }
  });

  it('OUTPUT_VALUES has 11 entries with expected values', () => {
    assert.strictEqual(OUTPUT_VALUES.length, 11);
    const expected = [
      'code-changes', 'artifact', 'creative-content', 'report', 'analysis',
      'decision', 'test-suite', 'plan', 'mesh-config', 'knowledge-update', 'video',
    ];
    for (const val of expected) {
      assert.ok(
        (OUTPUT_VALUES as readonly string[]).includes(val),
        `OUTPUT_VALUES missing "${val}"`,
      );
    }
  });

  it('TOOL_VALUES has 6 entries with expected values', () => {
    assert.strictEqual(TOOL_VALUES.length, 6);
    const expected = ['git', 'spec-graph', 'mcp-playwright', 'browser', 'web-search', 'worktree'];
    for (const val of expected) {
      assert.ok(
        (TOOL_VALUES as readonly string[]).includes(val),
        `TOOL_VALUES missing "${val}"`,
      );
    }
  });

  it('INTERACTION_VALUES has 4 entries with expected values', () => {
    assert.strictEqual(INTERACTION_VALUES.length, 4);
    const expected = ['none', 'gate-entry', 'gate-exit', 'gate-iterative'];
    for (const val of expected) {
      assert.ok(
        (INTERACTION_VALUES as readonly string[]).includes(val),
        `INTERACTION_VALUES missing "${val}"`,
      );
    }
  });

  it('TOPOLOGY_VALUES has 7 entries with expected values', () => {
    assert.strictEqual(TOPOLOGY_VALUES.length, 7);
    const expected = [
      'static', 'sequential', 'parallel', 'ensemble',
      'phased', 'review-loop', 'gated-pipeline',
    ];
    for (const val of expected) {
      assert.ok(
        (TOPOLOGY_VALUES as readonly string[]).includes(val),
        `TOPOLOGY_VALUES missing "${val}"`,
      );
    }
  });
});

describe('Capability Schema - isValidCapability', () => {
  it('accepts a valid capability declaration', () => {
    const valid: CapabilityDeclaration = {
      domain: ['dev'],
      input: ['prompt'],
      output: ['code-changes'],
      tools: ['git'],
      interaction: ['none'],
    };
    assert.strictEqual(isValidCapability(valid), true);
  });

  it('accepts a valid declaration with empty tools array', () => {
    const valid: CapabilityDeclaration = {
      domain: ['research'],
      input: ['question'],
      output: ['report'],
      tools: [],
      interaction: ['none'],
    };
    assert.strictEqual(isValidCapability(valid), true);
  });

  it('rejects unknown domain value', () => {
    const invalid = {
      domain: ['dev', 'unicorn-wrangling'],
      input: ['prompt'],
      output: ['code-changes'],
      tools: [],
      interaction: ['none'],
    };
    assert.strictEqual(isValidCapability(invalid), false);
  });

  it('rejects unknown input value', () => {
    const invalid = {
      domain: ['dev'],
      input: ['telepathy'],
      output: ['code-changes'],
      tools: [],
      interaction: ['none'],
    };
    assert.strictEqual(isValidCapability(invalid), false);
  });

  it('rejects unknown output value', () => {
    const invalid = {
      domain: ['dev'],
      input: ['prompt'],
      output: ['world-peace'],
      tools: [],
      interaction: ['none'],
    };
    assert.strictEqual(isValidCapability(invalid), false);
  });

  it('rejects unknown tool value', () => {
    const invalid = {
      domain: ['dev'],
      input: ['prompt'],
      output: ['code-changes'],
      tools: ['magic-wand'],
      interaction: ['none'],
    };
    assert.strictEqual(isValidCapability(invalid), false);
  });

  it('rejects unknown interaction value', () => {
    const invalid = {
      domain: ['dev'],
      input: ['prompt'],
      output: ['code-changes'],
      tools: [],
      interaction: ['gate-quantum'],
    };
    assert.strictEqual(isValidCapability(invalid), false);
  });

  it('rejects empty domain array', () => {
    const invalid = {
      domain: [],
      input: ['prompt'],
      output: ['code-changes'],
      tools: [],
      interaction: ['none'],
    };
    assert.strictEqual(isValidCapability(invalid), false);
  });

  it('rejects empty input array', () => {
    const invalid = {
      domain: ['dev'],
      input: [],
      output: ['code-changes'],
      tools: [],
      interaction: ['none'],
    };
    assert.strictEqual(isValidCapability(invalid), false);
  });

  it('rejects empty output array', () => {
    const invalid = {
      domain: ['dev'],
      input: ['prompt'],
      output: [],
      tools: [],
      interaction: ['none'],
    };
    assert.strictEqual(isValidCapability(invalid), false);
  });

  it('rejects empty interaction array', () => {
    const invalid = {
      domain: ['dev'],
      input: ['prompt'],
      output: ['code-changes'],
      tools: [],
      interaction: [],
    };
    assert.strictEqual(isValidCapability(invalid), false);
  });

  it('rejects missing fields', () => {
    assert.strictEqual(isValidCapability({}), false);
    assert.strictEqual(isValidCapability({ domain: ['dev'] }), false);
  });

  it('rejects non-array fields', () => {
    const invalid = {
      domain: 'dev',
      input: ['prompt'],
      output: ['code-changes'],
      tools: [],
      interaction: ['none'],
    };
    assert.strictEqual(isValidCapability(invalid), false);
  });
});

describe('Capability Schema - CapabilityNeeded', () => {
  it('includes topology field alongside declaration fields', () => {
    const needed: CapabilityNeeded = {
      domain: ['dev'],
      input: ['prompt', 'codebase'],
      output: ['code-changes', 'test-suite'],
      tools: ['git'],
      interaction: ['gate-exit'],
      topology: 'sequential',
    };
    assert.strictEqual(needed.topology, 'sequential');
    assert.deepStrictEqual(needed.domain, ['dev']);
  });

  it('topology accepts all valid values', () => {
    const topologies: Topology[] = [
      'static', 'sequential', 'parallel', 'ensemble',
      'phased', 'review-loop', 'gated-pipeline',
    ];
    for (const t of topologies) {
      const needed: CapabilityNeeded = {
        domain: ['dev'],
        input: ['prompt'],
        output: ['code-changes'],
        tools: [],
        interaction: ['none'],
        topology: t,
      };
      assert.strictEqual(needed.topology, t);
    }
  });
});
