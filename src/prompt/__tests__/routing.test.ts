/**
 * Routing Section tests
 *
 * Tests routing injection into agent prompts.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { buildRoutingSection, injectRoutingInstructions } from '../sections/routing.js';

test('buildRoutingSection - should build routing section with single destination', () => {
    const routing = {
      complete: {
        reviewer: 'Work complete, ready for review',
      },
    };

    const section = buildRoutingSection(routing, 'dev');

    assert.ok(section.includes('## Message Routing'));
    // Same-mesh agents use short names (no mesh prefix)
    assert.ok(section.includes('`reviewer`'));
    assert.ok(section.includes('Work complete, ready for review'));
});

test('buildRoutingSection - should flatten multiple categories into destination list', () => {
    const routing = {
      complete: {
        reviewer: 'Ready for review',
      },
      error: {
        core: 'Error occurred',
      },
      blocked: {
        planner: 'Needs clarification',
      },
    };

    const section = buildRoutingSection(routing, 'dev');

    // Same-mesh agents use short names
    assert.ok(section.includes('`reviewer`'));
    // 'core' maps to cross-mesh 'core/core'
    assert.ok(section.includes('core/core'));
    assert.ok(section.includes('`planner`'));
    // Categories should NOT appear in output
    assert.ok(!section.includes('Status'));
});

test('buildRoutingSection - should dedupe destinations and collect reasons', () => {
    const routing = {
      ask: {
        reviewer: 'Ask for review',
      },
      'ask-response': {
        reviewer: 'Review response',
      },
    };

    const section = buildRoutingSection(routing, 'dev');

    // Single destination entry with both reasons
    assert.ok(section.includes('`reviewer`'));
    assert.ok(section.includes('Ask for review'));
    assert.ok(section.includes('Review response'));
});

test('buildRoutingSection - should handle multiple destinations per category', () => {
    const routing = {
      complete: {
        reviewer: 'For code review',
        tester: 'For testing',
      },
    };

    const section = buildRoutingSection(routing, 'dev');

    assert.ok(section.includes('`reviewer`'));
    assert.ok(section.includes('`tester`'));
    assert.ok(section.includes('For code review'));
    assert.ok(section.includes('For testing'));
});

test('buildRoutingSection - should handle core destination specially', () => {
    const routing = {
      complete: {
        core: 'Return to core',
      },
    };

    const section = buildRoutingSection(routing, 'dev');

    assert.ok(section.includes('core/core'));
    assert.ok(!section.includes('dev/core'));
});

test('buildRoutingSection - should preserve fully qualified agent paths', () => {
    const routing = {
      complete: {
        'other-mesh/agent': 'Cross-mesh routing',
      },
    };

    const section = buildRoutingSection(routing, 'dev');

    assert.ok(section.includes('other-mesh/agent'));
    assert.ok(!section.includes('dev/other-mesh/agent'));
});

test('buildRoutingSection - should include instructions about frontmatter', () => {
    const routing = {
      complete: { reviewer: 'Done' },
    };

    const section = buildRoutingSection(routing, 'dev');

    assert.ok(section.includes('`to` field'));
    assert.ok(section.includes('frontmatter'));
});

test('buildRoutingSection - should include ONLY these destinations constraint', () => {
    const routing = {
      complete: { reviewer: 'Done' },
    };

    const section = buildRoutingSection(routing, 'dev');

    assert.ok(section.includes('ONLY these destinations'));
});

test('buildRoutingSection - should include auto-routing note', () => {
    const routing = {
      complete: { reviewer: 'Done' },
    };

    const section = buildRoutingSection(routing, 'dev');

    assert.ok(section.includes('auto-route'));
    assert.ok(section.includes('cross-mesh'));
});

test('injectRoutingInstructions - should inject routing into system prompt', () => {
    const systemPrompt = '# Test Agent\n\nYou are a test agent.';
    const routing = {
      complete: {
        reviewer: 'Work complete',
      },
    };

    const result = injectRoutingInstructions(systemPrompt, routing, 'dev');

    assert.ok(result.startsWith('# Test Agent'));
    assert.ok(result.includes('## Message Routing'));
    assert.ok(result.includes('`reviewer`'));
});

test('injectRoutingInstructions - should return original prompt when routing is empty', () => {
    const systemPrompt = '# Test Agent\n\nYou are a test agent.';
    const routing = {};

    const result = injectRoutingInstructions(systemPrompt, routing, 'dev');

    assert.strictEqual(result, systemPrompt);
});

test('injectRoutingInstructions - should return original prompt when routing is undefined', () => {
    const systemPrompt = '# Test Agent\n\nYou are a test agent.';

    // @ts-expect-error - testing undefined case
    const result = injectRoutingInstructions(systemPrompt, undefined, 'dev');

    assert.strictEqual(result, systemPrompt);
});
