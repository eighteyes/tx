/**
 * Test 8: Mesh Validator
 *
 * Tests the MeshValidator for mesh configuration validation.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { MeshValidator, type MeshConfigSchema } from '../../src/worker/mesh-validator.ts';

describe('V4 Mesh Validator Test', () => {
  describe('validate - required fields', () => {
    test('should fail if config is not an object', () => {
      const result = MeshValidator.validate(null);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes('must be a JSON object'));
    });

    test('should fail if config is an array', () => {
      const result = MeshValidator.validate([]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes('must be a JSON object'));
    });

    test('should fail if mesh field is missing', () => {
      const result = MeshValidator.validate({ agents: [] });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("Missing required field 'mesh'")));
    });

    test('should fail if agents field is missing', () => {
      const result = MeshValidator.validate({ mesh: 'test' });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("Missing required field 'agents'")));
    });

    test('should fail if agents is not an array', () => {
      const result = MeshValidator.validate({ mesh: 'test', agents: 'not-array' });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("must be an array")));
    });

    test('should fail if agents array is empty', () => {
      const result = MeshValidator.validate({ mesh: 'test', agents: [] });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Agents array is empty')));
    });
  });

  describe('validate - valid configs', () => {
    test('should accept minimal valid config', () => {
      const config: MeshConfigSchema = {
        mesh: 'test',
        agents: [
          { name: 'worker', model: 'haiku', prompt: 'prompts/worker.md' }
        ]
      };
      const result = MeshValidator.validate(config);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.ok(result.config);
    });

    test('should accept full config with all optional fields', () => {
      // Config with extra unknown fields that validator accepts but are not in schema
      const config = {
        mesh: 'test',
        description: 'Test mesh description',
        agents: [
          { name: 'worker', model: 'sonnet', prompt: 'prompts/worker.md' }
        ],
        entry_point: 'worker',
        completion_agent: 'worker',
        type: 'ephemeral',
        auto_despawn: true,
        keepalive: false,
        grace_period_ms: 5000,
        topology: 'static',
        brain: false,
        capabilities: ['research'],
        routing: {
          worker: {
            complete: { core: 'Task complete' }
          }
        },
        rearmatter: {
          enabled: true,
          fields: ['grade', 'confidence']
        }
      };
      const result = MeshValidator.validate(config);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });

    test('should auto-set entry_point for single-agent mesh', () => {
      const config: MeshConfigSchema = {
        mesh: 'test',
        agents: [
          { name: 'worker', model: 'haiku', prompt: 'prompts/worker.md' }
        ]
      };
      const result = MeshValidator.validate(config);
      assert.strictEqual(result.valid, true);
      // Single-agent meshes auto-default entry_point, so no warning
      assert.ok(!result.warnings.some(w => w.includes('No entry_point specified')));
      // Config should have entry_point auto-set
      assert.strictEqual(result.config?.entry_point, 'worker');
    });

    test('should warn about missing entry_point for multi-agent mesh', () => {
      const config: MeshConfigSchema = {
        mesh: 'test',
        agents: [
          { name: 'worker1', model: 'haiku', prompt: 'prompts/worker.md' },
          { name: 'worker2', model: 'haiku', prompt: 'prompts/worker.md' }
        ],
        routing: {
          worker1: { complete: { worker2: 'Continue' } },
          worker2: { complete: { core: 'Done' } }
        }
      };
      const result = MeshValidator.validate(config);
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes('No entry_point specified')));
    });
  });

  describe('validate - agent validation', () => {
    test('should fail if agent is missing name', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ model: 'haiku', prompt: 'test.md' }]
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("missing required field 'name'")));
    });

    test('should fail if agent is missing model', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', prompt: 'test.md' }]
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("missing required field 'model'")));
    });

    test('should fail if agent model is invalid', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'gpt-4', prompt: 'test.md' }]
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('must be one of [opus, sonnet, haiku]')));
    });

    test('should fail if agent has neither prompt nor command', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku' }]
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("must have at least one of 'prompt' or 'command'")));
    });

    test('should accept agent with command but no prompt', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', command: '/know:build' }]
      });
      assert.strictEqual(result.valid, true);
    });

    test('should accept agent with both prompt and command', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md', command: '/know:build' }]
      });
      assert.strictEqual(result.valid, true);
    });

    test('should fail on duplicate agent names', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [
          { name: 'worker', model: 'haiku', prompt: 'test.md' },
          { name: 'worker', model: 'sonnet', prompt: 'test2.md' }
        ]
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("duplicate agent name 'worker'")));
    });

    test('should warn about unknown agent fields', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md', unknownField: true }]
      });
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes("Unknown field 'unknownField'")));
    });
  });

  describe('validate - entry_point validation', () => {
    test('should fail if entry_point does not match an agent', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        entry_point: 'nonexistent'
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("entry_point 'nonexistent' not found")));
    });

    test('should accept valid entry_point', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        entry_point: 'worker'
      });
      assert.strictEqual(result.valid, true);
    });
  });

  describe('validate - routing validation', () => {
    test('should warn about routing for unknown agent', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        routing: {
          unknown: { complete: { core: 'Done' } }
        }
      });
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes("references unknown agent 'unknown'")));
    });

    test('should warn about routing to unknown target agent', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        routing: {
          worker: { complete: { unknown: 'Route to unknown' } }
        }
      });
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes("references unknown target 'unknown'")));
    });

    test('should accept routing to core', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        routing: {
          worker: { complete: { core: 'Done' } }
        }
      });
      assert.strictEqual(result.valid, true);
      assert.ok(!result.warnings.some(w => w.includes("references unknown target 'core'")));
    });
  });

  describe('validate - rearmatter validation', () => {
    test('should fail if rearmatter is not an object', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        rearmatter: 'invalid'
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('rearmatter must be an object')));
    });

    test('should fail if rearmatter.enabled is not boolean', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        rearmatter: { enabled: 'yes' }
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('rearmatter.enabled must be a boolean')));
    });

    test('should fail if rearmatter.fields is not an array', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        rearmatter: { fields: 'grade' }
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('rearmatter.fields must be an array')));
    });

    test('should accept arbitrary rearmatter fields without warnings', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        rearmatter: { fields: ['outcome_table', 'trait_pressure', 'custom_field'] }
      });
      assert.strictEqual(result.valid, true);
      // No warnings about unknown fields - meshes can define domain-specific rearmatter
      assert.ok(!result.warnings.some(w => w.includes("Unknown rearmatter field")));
    });

    test('should fail if confidence threshold is out of range', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        rearmatter: { thresholds: { confidence: 1.5 } }
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('must be between 0.0 and 1.0')));
    });

    test('should fail if grade threshold is invalid', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        rearmatter: { thresholds: { grade: 'X' } }
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('must be one of [A, B, C, D, F]')));
    });

    test('should accept valid rearmatter config', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        rearmatter: {
          enabled: true,
          fields: ['grade', 'confidence', 'gaps'],
          thresholds: { confidence: 0.8, grade: 'B' }
        }
      });
      assert.strictEqual(result.valid, true);
    });
  });

  describe('validate - field type validation', () => {
    test('should warn if type is invalid enum value', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        type: 'invalid' as any
      });
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes("must be one of [persistent, ephemeral]")));
    });

    test('should warn if grace_period_ms is out of range', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        grace_period_ms: 100000
      });
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes("must be <= 60000")));
    });

    test('should warn about unknown top-level fields', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        unknownTopLevel: 'value'
      });
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes("Unknown field 'unknownTopLevel'")));
    });
  });

  describe('validate - FSM and routing dependency', () => {
    test('should fail if FSM exists without routing', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        fsm: {
          initial: 'start',
          states: {
            start: {
              agents: ['worker']
            }
          },
          scripts: {}
        }
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("FSM requires 'routing' configuration")));
    });

    test('should pass if FSM exists with routing', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        routing: {
          worker: {
            complete: {
              worker: 'Continue work'
            }
          }
        },
        fsm: {
          initial: 'start',
          states: {
            start: {
              agents: ['worker']
            }
          },
          scripts: {}
        }
      });
      assert.strictEqual(result.valid, true);
    });

    test('should pass if routing exists without FSM', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }],
        routing: {
          worker: {
            complete: {
              worker: 'Continue work'
            }
          }
        }
      });
      assert.strictEqual(result.valid, true);
    });
  });

  describe('validateAll', () => {
    test('should validate multiple configs', () => {
      const configs = new Map<string, unknown>();
      configs.set('valid', {
        mesh: 'valid',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }]
      });
      configs.set('invalid', {
        mesh: 'invalid',
        agents: []  // Empty agents - invalid
      });

      const result = MeshValidator.validateAll(configs, { silent: true });
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.totalErrors, 1);
      assert.ok(result.results.get('valid')?.valid);
      assert.ok(!result.results.get('invalid')?.valid);
    });
  });

  describe('validate - multi-agent routing validation', () => {
    test('should fail if multi-agent mesh has no routing', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [
          { name: 'worker1', model: 'haiku', prompt: 'test.md' },
          { name: 'worker2', model: 'haiku', prompt: 'test.md' }
        ]
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Multi-agent mesh missing routing configuration')));
    });

    test('should pass if multi-agent mesh has routing', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [
          { name: 'worker1', model: 'haiku', prompt: 'test.md' },
          { name: 'worker2', model: 'haiku', prompt: 'test.md' }
        ],
        routing: {
          worker1: { complete: { worker2: 'Continue' } },
          worker2: { complete: { core: 'Done' } }
        }
      });
      assert.strictEqual(result.valid, true);
    });

    test('should warn if agent has no routing in multi-agent mesh', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [
          { name: 'worker1', model: 'haiku', prompt: 'test.md' },
          { name: 'worker2', model: 'haiku', prompt: 'test.md' }
        ],
        routing: {
          worker1: { complete: { core: 'Done' } }
          // worker2 has no routing
        }
      });
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes("Agent 'worker2' has no routing configuration")));
    });

    test('should not require routing for single-agent mesh', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [{ name: 'worker', model: 'haiku', prompt: 'test.md' }]
      });
      assert.strictEqual(result.valid, true);
      assert.ok(!result.errors.some(e => e.includes('routing')));
    });
  });

  describe('validate - FSM state agent routing', () => {
    test('should not warn about ensemble agents without routing', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [
          { name: 'coordinator', model: 'haiku', prompt: 'test.md' },
          { name: 'reviewer1', model: 'sonnet', prompt: 'test.md' },
          { name: 'reviewer2', model: 'sonnet', prompt: 'test.md' },
          { name: 'synthesizer', model: 'sonnet', prompt: 'test.md' }
        ],
        routing: {
          coordinator: { complete: { core: 'Subtasks created' } },
          synthesizer: { complete: { core: 'Done' } }
          // reviewer1 and reviewer2 have no routing - but they're ensemble agents
        },
        fsm: {
          initial: 'start',
          states: {
            start: {
              agents: ['coordinator'],
              exit: { default: 'review' }
            },
            review: {
              type: 'ensemble',
              ensemble: {
                agents: ['reviewer1', 'reviewer2'],
                aggregation: 'concat'
              },
              exit: { default: 'synthesize' }
            },
            synthesize: {
              agents: ['synthesizer'],
              exit: { default: 'complete' }
            },
            complete: {
              agents: ['core']
            }
          },
          scripts: {}
        }
      });
      assert.strictEqual(result.valid, true);
      // Should not warn about reviewer1 or reviewer2 - they're ensemble agents
      assert.ok(!result.warnings.some(w => w.includes("reviewer1") && w.includes("no routing")));
      assert.ok(!result.warnings.some(w => w.includes("reviewer2") && w.includes("no routing")));
    });

    test('should warn about normal state agents without routing', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [
          { name: 'coordinator', model: 'haiku', prompt: 'test.md' },
          { name: 'processor', model: 'sonnet', prompt: 'test.md' },
          { name: 'finalizer', model: 'sonnet', prompt: 'test.md' }
        ],
        routing: {
          coordinator: { complete: { processor: 'Hand off' } },
          finalizer: { complete: { core: 'Done' } }
          // processor has no routing but is used in normal state
        },
        fsm: {
          initial: 'start',
          states: {
            start: {
              agents: ['coordinator'],
              exit: { default: 'process' }
            },
            process: {
              agents: ['processor'],  // Normal state, not ensemble
              exit: { default: 'finalize' }
            },
            finalize: {
              agents: ['finalizer'],
              exit: { default: 'complete' }
            },
            complete: {
              agents: ['core']
            }
          },
          scripts: {}
        }
      });
      assert.strictEqual(result.valid, true);
      // Should warn about processor - it's a normal state agent without routing
      assert.ok(result.warnings.some(w => w.includes("processor") && w.includes("no routing")));
    });

    test('should handle ensemble with single agent + count pattern', () => {
      const result = MeshValidator.validate({
        mesh: 'test',
        agents: [
          { name: 'coordinator', model: 'haiku', prompt: 'test.md' },
          { name: 'worker', model: 'sonnet', prompt: 'test.md' },
          { name: 'synthesizer', model: 'sonnet', prompt: 'test.md' }
        ],
        routing: {
          coordinator: { complete: { core: 'Subtasks created' } },
          synthesizer: { complete: { core: 'Done' } }
          // worker has no routing - but it's used as ensemble agent with count
        },
        fsm: {
          initial: 'start',
          states: {
            start: {
              agents: ['coordinator'],
              exit: { default: 'work' }
            },
            work: {
              type: 'ensemble',
              ensemble: {
                agent: 'worker',  // Single agent spawned multiple times
                count: 3,
                aggregation: 'concat'
              },
              exit: { default: 'synthesize' }
            },
            synthesize: {
              agents: ['synthesizer'],
              exit: { default: 'complete' }
            },
            complete: {
              agents: ['core']
            }
          },
          scripts: {}
        }
      });
      assert.strictEqual(result.valid, true);
      // Should not warn about worker - it's an ensemble agent
      assert.ok(!result.warnings.some(w => w.includes("worker") && w.includes("no routing")));
    });
  });
});
