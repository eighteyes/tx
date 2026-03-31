/**
 * DispatchRouter Unit Tests
 *
 * Tests routing resolution for dispatcher-mode meshes:
 * linear, branch, terminal, override, escalation, injection context.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { DispatchRouter } from '../../src/worker/dispatch-router.ts';

const MESH = 'test-mesh';
const AGENTS = ['entry', 'reviewer', 'writer', 'editor', 'finalizer'];

const ROUTING = {
  entry: 'reviewer',                        // linear
  reviewer: {                               // branch
    approved: 'writer',
    needs_work: 'editor',
    default: 'writer',
  },
  editor: 'reviewer',                       // linear (loop back)
  writer: 'finalizer',                      // linear
  // finalizer: absent = terminal
};

describe('DispatchRouter', () => {
  const router = new DispatchRouter(MESH, ROUTING, AGENTS);

  describe('resolve - linear routing', () => {
    test('resolves linear route for entry agent', () => {
      const result = router.resolve('entry', 'done');
      assert.ok(result);
      assert.strictEqual(result.target, 'test-mesh/reviewer');
      assert.strictEqual(result.source, 'linear');
    });

    test('resolves linear route regardless of outcome', () => {
      const result = router.resolve('editor', 'anything');
      assert.ok(result);
      assert.strictEqual(result.target, 'test-mesh/reviewer');
      assert.strictEqual(result.source, 'linear');
    });
  });

  describe('resolve - branch routing', () => {
    test('resolves branch route with matching outcome', () => {
      const result = router.resolve('reviewer', 'approved');
      assert.ok(result);
      assert.strictEqual(result.target, 'test-mesh/writer');
      assert.strictEqual(result.source, 'branch');
      assert.strictEqual(result.outcome, 'approved');
    });

    test('resolves branch route with alternate outcome', () => {
      const result = router.resolve('reviewer', 'needs_work');
      assert.ok(result);
      assert.strictEqual(result.target, 'test-mesh/editor');
      assert.strictEqual(result.source, 'branch');
    });

    test('falls back to default when outcome not found', () => {
      const result = router.resolve('reviewer', 'unknown_outcome');
      assert.ok(result);
      assert.strictEqual(result.target, 'test-mesh/writer');
      assert.strictEqual(result.source, 'branch');
      assert.strictEqual(result.usedDefault, true);
    });

    test('falls back to default when outcome missing', () => {
      const result = router.resolve('reviewer');
      assert.ok(result);
      assert.strictEqual(result.target, 'test-mesh/writer');
      assert.strictEqual(result.usedDefault, true);
    });
  });

  describe('resolve - terminal agent', () => {
    test('terminal agent with outcome: complete routes to core/core', () => {
      const result = router.resolve('finalizer', 'complete');
      assert.ok(result);
      assert.strictEqual(result.target, 'core/core');
      assert.strictEqual(result.source, 'terminal');
    });

    test('terminal agent with non-complete outcome still routes to core', () => {
      const result = router.resolve('finalizer', 'error');
      assert.ok(result);
      assert.strictEqual(result.target, 'core/core');
      assert.strictEqual(result.source, 'terminal');
    });
  });

  describe('resolve - escalation', () => {
    test('outcome: escalate always routes to core/core', () => {
      const result = router.resolve('reviewer', 'escalate');
      assert.ok(result);
      assert.strictEqual(result.target, 'core/core');
      assert.strictEqual(result.source, 'escalate');
    });

    test('escalation works from any agent', () => {
      const result = router.resolve('entry', 'escalate');
      assert.ok(result);
      assert.strictEqual(result.target, 'core/core');
      assert.strictEqual(result.source, 'escalate');
    });
  });

  describe('resolve - route_to override', () => {
    test('valid route_to overrides normal routing', () => {
      const result = router.resolve('entry', 'done', 'editor');
      assert.ok(result);
      assert.strictEqual(result.target, 'test-mesh/editor');
      assert.strictEqual(result.source, 'override');
    });

    test('invalid route_to returns null', () => {
      const result = router.resolve('entry', 'done', 'nonexistent');
      assert.strictEqual(result, null);
    });
  });

  describe('resolve - branch without default', () => {
    test('returns null when no match and no default', () => {
      const noDefaultRouting = {
        agent: { yes: 'target-a', no: 'target-b' },
      };
      const r = new DispatchRouter('m', noDefaultRouting, ['agent', 'target-a', 'target-b']);
      const result = r.resolve('agent', 'maybe');
      assert.strictEqual(result, null);
    });
  });

  describe('resolve - core target', () => {
    test('string "core" resolves to core/core', () => {
      const coreRouting = { agent: 'core' };
      const r = new DispatchRouter('m', coreRouting, ['agent']);
      const result = r.resolve('agent', 'done');
      assert.ok(result);
      assert.strictEqual(result.target, 'core/core');
      assert.strictEqual(result.source, 'linear');
    });

    test('branch value "core" resolves to core/core', () => {
      const coreRouting = { agent: { done: 'core' } };
      const r = new DispatchRouter('m', coreRouting, ['agent']);
      const result = r.resolve('agent', 'done');
      assert.ok(result);
      assert.strictEqual(result.target, 'core/core');
    });
  });

  describe('resolve - "complete" keyword (core alias)', () => {
    test('linear "complete" resolves to core/core', () => {
      const routing = { agent: 'complete' };
      const r = new DispatchRouter('m', routing, ['agent']);
      const result = r.resolve('agent', 'done');
      assert.ok(result);
      assert.strictEqual(result.target, 'core/core');
      assert.strictEqual(result.source, 'linear');
    });

    test('branch value "complete" resolves to core/core', () => {
      const routing = { reviewer: { pass: 'complete', fail: 'worker' } };
      const r = new DispatchRouter('m', routing, ['reviewer', 'worker']);
      const result = r.resolve('reviewer', 'pass');
      assert.ok(result);
      assert.strictEqual(result.target, 'core/core');
      assert.strictEqual(result.source, 'branch');
    });

    test('branch default "complete" resolves to core/core', () => {
      const routing = { reviewer: { pass: 'worker', default: 'complete' } };
      const r = new DispatchRouter('m', routing, ['reviewer', 'worker']);
      const result = r.resolve('reviewer', 'unknown');
      assert.ok(result);
      assert.strictEqual(result.target, 'core/core');
      assert.strictEqual(result.usedDefault, true);
    });

    test('dev-tdd pattern: refactor_pass: complete routes to core/core', () => {
      const routing = {
        red: 'reviewer',
        green: 'reviewer',
        refactor: 'reviewer',
        reviewer: {
          red_pass: 'green',
          green_pass: 'refactor',
          refactor_pass: 'complete',
          needs_work: 'red',
        },
      };
      const agents = ['red', 'green', 'refactor', 'reviewer'];
      const r = new DispatchRouter('dev-tdd', routing, agents);
      const result = r.resolve('reviewer', 'refactor_pass');
      assert.ok(result);
      assert.strictEqual(result.target, 'core/core');
      assert.strictEqual(result.source, 'branch');
    });

    test('fan-out "complete" in agents list resolves to core/core', () => {
      const routing = {
        coordinator: ['worker-a', 'complete', { complete: 'synthesizer', fan_in: 'batch' as const }],
      };
      const agents = ['coordinator', 'worker-a', 'synthesizer'];
      const r = new DispatchRouter('m', routing, agents);
      const result = r.resolve('coordinator', 'done');
      assert.ok(result);
      assert.ok(result.targets);
      assert.ok(result.targets.includes('core/core'));
      assert.strictEqual(result.targets[1], 'core/core');
    });
  });

  describe('isTerminal', () => {
    test('absent agent is terminal', () => {
      assert.strictEqual(router.isTerminal('finalizer'), true);
    });

    test('present agent is not terminal', () => {
      assert.strictEqual(router.isTerminal('entry'), false);
    });
  });

  describe('getValidOutcomes', () => {
    test('returns null for linear agent (any outcome)', () => {
      assert.strictEqual(router.getValidOutcomes('entry'), null);
    });

    test('returns outcome list for branch agent (excludes default)', () => {
      const outcomes = router.getValidOutcomes('reviewer');
      assert.ok(outcomes);
      assert.ok(outcomes.includes('approved'));
      assert.ok(outcomes.includes('needs_work'));
      assert.ok(!outcomes.includes('default'));
    });

    test('returns empty array for terminal agent', () => {
      const outcomes = router.getValidOutcomes('finalizer');
      assert.ok(outcomes);
      assert.strictEqual(outcomes.length, 0);
    });
  });

  describe('getInjectionContext', () => {
    test('returns correct context for branch agent', () => {
      const ctx = router.getInjectionContext('reviewer');
      assert.strictEqual(ctx.sentinel, 'test-mesh/dispatch');
      assert.ok(ctx.validOutcomes);
      assert.ok(ctx.validOutcomes.includes('approved'));
      assert.strictEqual(ctx.isTerminal, false);
      // reviewer routes to: writer (approved/default) and editor (needs_work) = 2 reachable agents
      assert.strictEqual(ctx.availableAgents.length, 2);
    });

    test('returns correct context for terminal agent', () => {
      const ctx = router.getInjectionContext('finalizer');
      assert.strictEqual(ctx.isTerminal, true);
      assert.ok(ctx.validOutcomes);
      assert.strictEqual(ctx.validOutcomes.length, 0);
    });

    test('returns correct context for linear agent', () => {
      const ctx = router.getInjectionContext('entry');
      assert.strictEqual(ctx.validOutcomes, null);
      assert.strictEqual(ctx.isTerminal, false);
    });
  });
});
