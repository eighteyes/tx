/**
 * StaticRouter tests
 *
 * Responsibilities:
 * - Test static chain resolution: next agent from current position
 * - Test chain boundary detection (first, last, single)
 * - Test error on invalid agent name
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { StaticRouter } from '../static-router.ts';

describe('StaticRouter', () => {
  test('resolves next agent in chain', () => {
    const router = new StaticRouter('test-mesh', ['agent-a', 'agent-b', 'agent-c']);
    const next = router.next('agent-a');
    assert.deepStrictEqual(next, {
      target: 'test-mesh/agent-b',
      source: 'static',
      index: 1,
    });
  });

  test('returns null for last agent (chain complete)', () => {
    const router = new StaticRouter('test-mesh', ['agent-a', 'agent-b', 'agent-c']);
    const next = router.next('agent-c');
    assert.strictEqual(next, null);
  });

  test('returns null for single-agent chain', () => {
    const router = new StaticRouter('test-mesh', ['solo']);
    const next = router.next('solo');
    assert.strictEqual(next, null);
  });

  test('throws on unknown agent name', () => {
    const router = new StaticRouter('test-mesh', ['agent-a', 'agent-b']);
    assert.throws(() => router.next('ghost'), /not found in static chain/);
  });

  test('entryAgent returns first agent', () => {
    const router = new StaticRouter('test-mesh', ['agent-a', 'agent-b']);
    assert.strictEqual(router.entryAgent(), 'agent-a');
  });

  test('completionAgent returns last agent', () => {
    const router = new StaticRouter('test-mesh', ['agent-a', 'agent-b', 'agent-c']);
    assert.strictEqual(router.completionAgent(), 'agent-c');
  });

  test('isLast identifies final agent', () => {
    const router = new StaticRouter('test-mesh', ['agent-a', 'agent-b']);
    assert.strictEqual(router.isLast('agent-a'), false);
    assert.strictEqual(router.isLast('agent-b'), true);
  });

  test('chain returns full ordered list', () => {
    const router = new StaticRouter('test-mesh', ['a', 'b', 'c']);
    assert.deepStrictEqual(router.chain(), ['a', 'b', 'c']);
  });
});
