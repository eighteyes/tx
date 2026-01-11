/**
 * Ralph Loops Configuration Validation Tests
 *
 * Tests ralph_loops configuration parsing and validation in mesh configs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MeshValidator } from '../mesh-validator.ts';

describe('MeshValidator - ralph_loops', () => {
  it('should accept valid ralph_loops configuration', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            max_iterations: 3,
            iteration_limits: {
              time_ms: 30000,
              tokens: 50000,
              cost_usd: 0.10
            },
            success_patterns: ['✓ DONE', '✓ SUCCESS']
          }
        ]
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, true, `Expected valid, got errors: ${result.errors.join(', ')}`);
    assert.strictEqual(result.errors.length, 0);
  });

  it('should reject ralph_loops with missing enabled field', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        agents: []
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('ralph_loops.enabled is required')));
  });

  it('should reject ralph_loops with non-boolean enabled', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: 'true',
        agents: []
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('ralph_loops.enabled must be a boolean')));
  });

  it('should reject ralph_loops with missing agents array', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('ralph_loops.agents is required')));
  });

  it('should reject ralph_loops with empty agents array', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: []
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('ralph_loops.agents cannot be empty')));
  });

  it('should reject ralph_loops agent config with invalid agent name', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'unknown-agent',
            max_iterations: 3,
            iteration_limits: {
              time_ms: 30000,
              tokens: 50000,
              cost_usd: 0.10
            },
            success_patterns: ['✓ DONE']
          }
        ]
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("'unknown-agent' not found in mesh agents")));
  });

  it('should reject ralph_loops with missing max_iterations', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            iteration_limits: {
              time_ms: 30000,
              tokens: 50000,
              cost_usd: 0.10
            },
            success_patterns: ['✓ DONE']
          }
        ]
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('max_iterations is required')));
  });

  it('should reject ralph_loops with max_iterations <= 0', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            max_iterations: 0,
            iteration_limits: {
              time_ms: 30000,
              tokens: 50000,
              cost_usd: 0.10
            },
            success_patterns: ['✓ DONE']
          }
        ]
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('max_iterations must be > 0')));
  });

  it('should reject ralph_loops with missing iteration_limits', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            max_iterations: 3,
            success_patterns: ['✓ DONE']
          }
        ]
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('iteration_limits is required')));
  });

  it('should reject ralph_loops with incomplete iteration_limits', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            max_iterations: 3,
            iteration_limits: {
              time_ms: 30000,
              tokens: 50000
              // missing cost_usd
            },
            success_patterns: ['✓ DONE']
          }
        ]
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('cost_usd is required')));
  });

  it('should reject ralph_loops with negative iteration_limits', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            max_iterations: 3,
            iteration_limits: {
              time_ms: -1000,
              tokens: 50000,
              cost_usd: 0.10
            },
            success_patterns: ['✓ DONE']
          }
        ]
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('time_ms must be > 0')));
  });

  it('should reject ralph_loops with missing success_patterns', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            max_iterations: 3,
            iteration_limits: {
              time_ms: 30000,
              tokens: 50000,
              cost_usd: 0.10
            }
          }
        ]
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('success_patterns is required')));
  });

  it('should reject ralph_loops with empty success_patterns', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            max_iterations: 3,
            iteration_limits: {
              time_ms: 30000,
              tokens: 50000,
              cost_usd: 0.10
            },
            success_patterns: []
          }
        ]
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('success_patterns cannot be empty')));
  });

  it('should reject ralph_loops with non-string success_patterns', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            max_iterations: 3,
            iteration_limits: {
              time_ms: 30000,
              tokens: 50000,
              cost_usd: 0.10
            },
            success_patterns: ['✓ DONE', 123, true]
          }
        ]
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('success_patterns[1] must be a string')));
  });

  it('should warn about unknown ralph_loops fields', () => {
    const config = {
      mesh: 'ralph-test',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'prompt.md' }
      ],
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            max_iterations: 3,
            iteration_limits: {
              time_ms: 30000,
              tokens: 50000,
              cost_usd: 0.10
            },
            success_patterns: ['✓ DONE'],
            unknown_field: 'value'
          }
        ],
        unknown_top_level: 'value'
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, true); // Warnings don't block validity
    assert.ok(result.warnings.some(w => w.includes("unknown field 'unknown_field'")));
    assert.ok(result.warnings.some(w => w.includes("unknown field 'unknown_top_level'")));
  });

  it('should validate complex ralph_loops config from example mesh', () => {
    const config = {
      mesh: 'ralph-ice-cream',
      description: 'Iterative refinement with resource limits and layered evaluation',
      agents: [
        { name: 'ralph-haiku', model: 'haiku', prompt: 'ralph-haiku.md' },
        { name: 'sonnet-reviewer', model: 'sonnet', prompt: 'sonnet-reviewer.md' },
        { name: 'opus-reviewer', model: 'opus', prompt: 'opus-reviewer.md' }
      ],
      entry_point: 'ralph-haiku',
      ralph_loops: {
        enabled: true,
        agents: [
          {
            name: 'ralph-haiku',
            max_iterations: 3,
            iteration_limits: {
              time_ms: 30000,
              tokens: 50000,
              cost_usd: 0.10
            },
            success_patterns: ['✓ DONE', '✓ SUCCESS', '✓ COMPLETE']
          }
        ]
      },
      routing: {
        'ralph-haiku': {
          done: { 'sonnet-reviewer': 'Ralph haiku complete, ready for review' },
          limit: { core: 'Ralph hit resource limit without success' }
        },
        'sonnet-reviewer': {
          approved: { 'opus-reviewer': 'Sonnet approved, final check by opus' },
          rejected: { 'ralph-haiku': 'Sonnet rejected haiku work, refine again' }
        },
        'opus-reviewer': {
          approved: { core: 'Work complete and approved by all layers' },
          rejected: { 'ralph-haiku': 'Opus wants refinement, back to haiku' }
        }
      },
      workspace: {
        path: '.ai/output/{task-id}/'
      }
    };

    const result = MeshValidator.validate(config);
    assert.strictEqual(result.valid, true, `Expected valid, got errors: ${result.errors.join(', ')}`);
    assert.strictEqual(result.errors.length, 0);
  });
});
