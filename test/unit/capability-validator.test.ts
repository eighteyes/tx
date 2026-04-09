/**
 * CapabilityValidator Unit Tests
 *
 * Tests static analysis of generated mesh configs before execution.
 *
 * Responsibilities:
 * - Verify valid static mesh passes all checks
 * - Verify orphaned agents flagged in non-static routing
 * - Verify missing dev_mode produces warning
 * - Verify missing guardrails per agent produces error
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  validateGeneratedMesh,
  type ValidationResult,
} from '../../src/mesh/capability/validator.ts';

describe('Capability Validator - Valid static mesh', () => {
  it('passes all checks with valid static config', () => {
    const config = {
      mesh: 'test-static',
      routing_mode: 'static',
      agents: [
        { name: 'alpha', model: 'sonnet', prompt: 'alpha/prompt.md' },
        { name: 'beta', model: 'sonnet', prompt: 'beta/prompt.md' },
      ],
      routing: ['alpha', 'beta'],
      dev_mode: true,
      capability: {
        domain: ['dev'],
        input: ['prompt'],
        output: ['code-changes'],
        tools: [],
        interaction: ['none'],
      },
      guardrails: {
        agents: {
          alpha: { max_turns: 10 },
          beta: { max_turns: 10 },
        },
      },
    };

    const result: ValidationResult = validateGeneratedMesh(config);
    assert.strictEqual(result.valid, true, `Expected valid but got errors: ${result.errors.join(', ')}`);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.warnings.length, 0);
  });
});

describe('Capability Validator - Orphaned agent (non-static)', () => {
  it('flags agent with no outbound route as dead end', () => {
    const config = {
      mesh: 'test-orphan',
      agents: [
        { name: 'a', model: 'sonnet', prompt: 'a/prompt.md' },
        { name: 'b', model: 'sonnet', prompt: 'b/prompt.md' },
      ],
      entry_point: 'a',
      routing: {
        a: {
          complete: { b: 'Hand off to b' },
        },
        // b has no outbound routing — dead end
      },
      dev_mode: true,
      capability: { domain: ['dev'] },
      guardrails: {
        agents: {
          a: { max_turns: 10 },
          b: { max_turns: 10 },
        },
      },
    };

    const result = validateGeneratedMesh(config);
    assert.strictEqual(result.valid, false);
    const deadEndError = result.errors.find(e => e.includes('b') && e.includes('outbound'));
    assert.ok(deadEndError, `Expected dead-end error for agent 'b', got: ${result.errors.join('; ')}`);
  });
});

describe('Capability Validator - Missing dev_mode', () => {
  it('warns when dev_mode is not set', () => {
    const config = {
      mesh: 'test-no-devmode',
      routing_mode: 'static',
      agents: [
        { name: 'solo', model: 'sonnet', prompt: 'solo/prompt.md' },
      ],
      routing: ['solo'],
      capability: { domain: ['dev'] },
      guardrails: {
        agents: {
          solo: { max_turns: 10 },
        },
      },
    };

    const result = validateGeneratedMesh(config);
    const devModeWarning = result.warnings.find(w => w.includes('dev_mode'));
    assert.ok(devModeWarning, `Expected dev_mode warning, got warnings: ${result.warnings.join('; ')}`);
  });
});

describe('Capability Validator - Missing guardrails', () => {
  it('errors when agent missing from guardrails.agents', () => {
    const config = {
      mesh: 'test-no-guardrails',
      routing_mode: 'static',
      agents: [
        { name: 'a', model: 'sonnet', prompt: 'a/prompt.md' },
        { name: 'b', model: 'sonnet', prompt: 'b/prompt.md' },
      ],
      routing: ['a', 'b'],
      dev_mode: true,
      capability: { domain: ['dev'] },
      guardrails: {
        agents: {
          a: { max_turns: 10 },
          // b is missing
        },
      },
    };

    const result = validateGeneratedMesh(config);
    assert.strictEqual(result.valid, false);
    const guardrailError = result.errors.find(e => e.includes('b') && e.includes('max_turns'));
    assert.ok(guardrailError, `Expected guardrail error for agent 'b', got: ${result.errors.join('; ')}`);
  });
});

describe('Capability Validator - Route targets', () => {
  it('errors when routing targets reference non-existent agent', () => {
    const config = {
      mesh: 'test-bad-target',
      agents: [
        { name: 'a', model: 'sonnet', prompt: 'a/prompt.md' },
      ],
      entry_point: 'a',
      routing: {
        a: {
          complete: { ghost: 'Send to non-existent agent' },
        },
      },
      dev_mode: true,
      capability: { domain: ['dev'] },
      guardrails: {
        agents: {
          a: { max_turns: 10 },
        },
      },
    };

    const result = validateGeneratedMesh(config);
    assert.strictEqual(result.valid, false);
    const targetError = result.errors.find(e => e.includes('ghost'));
    assert.ok(targetError, `Expected invalid target error for 'ghost', got: ${result.errors.join('; ')}`);
  });

  it('allows core and core/core as valid route targets', () => {
    const config = {
      mesh: 'test-core-target',
      agents: [
        { name: 'a', model: 'sonnet', prompt: 'a/prompt.md' },
      ],
      entry_point: 'a',
      routing: {
        a: {
          complete: { core: 'Done' },
          'ask-human': { 'core/core': 'Need human input' },
        },
      },
      dev_mode: true,
      capability: { domain: ['dev'] },
      guardrails: {
        agents: {
          a: { max_turns: 10 },
        },
      },
    };

    const result = validateGeneratedMesh(config);
    assert.strictEqual(result.valid, true, `Expected valid but got errors: ${result.errors.join(', ')}`);
  });
});

describe('Capability Validator - Static routing reachability', () => {
  it('errors when static routing array references non-existent agent', () => {
    const config = {
      mesh: 'test-static-bad',
      routing_mode: 'static',
      agents: [
        { name: 'a', model: 'sonnet', prompt: 'a/prompt.md' },
      ],
      routing: ['a', 'phantom'],
      dev_mode: true,
      capability: { domain: ['dev'] },
      guardrails: {
        agents: {
          a: { max_turns: 10 },
        },
      },
    };

    const result = validateGeneratedMesh(config);
    assert.strictEqual(result.valid, false);
    const reachError = result.errors.find(e => e.includes('phantom'));
    assert.ok(reachError, `Expected reachability error for 'phantom', got: ${result.errors.join('; ')}`);
  });
});

describe('Capability Validator - Missing capability block', () => {
  it('warns when capability is missing', () => {
    const config = {
      mesh: 'test-no-cap',
      routing_mode: 'static',
      agents: [
        { name: 'solo', model: 'sonnet', prompt: 'solo/prompt.md' },
      ],
      routing: ['solo'],
      dev_mode: true,
      guardrails: {
        agents: {
          solo: { max_turns: 10 },
        },
      },
    };

    const result = validateGeneratedMesh(config);
    const capWarning = result.warnings.find(w => w.includes('capability'));
    assert.ok(capWarning, `Expected capability warning, got warnings: ${result.warnings.join('; ')}`);
  });
});
