/**
 * Quality Stack Unit Tests
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  QualityStack,
  createStandardStack,
  evaluatorRegistry,
  ChecklistGate,
  RubricGate,
  AdversarialGate,
  AccuracyGate,
  type PreflightOutput,
  type RearmatterData,
  type QualityStackConfig,
  type GateType,
} from '../../src/quality/index.ts';

/**
 * Create a minimal preflight output for testing
 */
function createTestPreflight(overrides: Partial<PreflightOutput> = {}): PreflightOutput {
  return {
    taskType: 'test',
    checklist: ['Item 1', 'Item 2'],
    rubric: [
      { criterion: 'Quality', weight: 0.5, description: 'Overall quality' },
      { criterion: 'Completeness', weight: 0.5, description: 'Is it complete' },
    ],
    requiredGates: ['checklist'] as GateType[],
    suggestedGates: ['rubric'] as GateType[],
    effortLevel: 'light',
    estimatedToolCalls: 5,
    ...overrides,
  };
}

/**
 * Create a minimal rearmatter for testing
 */
function createTestRearmatter(overrides: Partial<RearmatterData> = {}): RearmatterData {
  return {
    confidence: 0.8,
    grade: 'B',
    ...overrides,
  };
}

describe('Quality Stack Types', () => {
  it('should export all gate types', () => {
    const gateTypes: GateType[] = [
      'summarizer',
      'checklist',
      'rubric',
      'adversarial',
      'accuracy',
      'deterministic',
    ];
    // Just verify types are valid - this is a compile-time check
    assert.ok(gateTypes.length === 6);
  });
});

describe('Evaluator Registry', () => {
  beforeEach(() => {
    evaluatorRegistry.clear();
  });

  it('should register and retrieve evaluators', () => {
    const gate = new ChecklistGate();
    evaluatorRegistry.register('checklist', gate);

    const retrieved = evaluatorRegistry.get('checklist');
    assert.strictEqual(retrieved, gate);
  });

  it('should return undefined for unregistered gates', () => {
    const retrieved = evaluatorRegistry.get('rubric');
    assert.strictEqual(retrieved, undefined);
  });

  it('should track registered gates', () => {
    evaluatorRegistry.register('checklist', new ChecklistGate());
    evaluatorRegistry.register('rubric', new RubricGate());

    const gates = evaluatorRegistry.getRegisteredGates();
    assert.ok(gates.includes('checklist'));
    assert.ok(gates.includes('rubric'));
  });

  it('should reject mismatched gate types', () => {
    const gate = new ChecklistGate();
    assert.throws(
      () => evaluatorRegistry.register('rubric', gate),
      /gate mismatch/
    );
  });
});

describe('ChecklistGate', () => {
  it('should pass with no checklist items', async () => {
    const gate = new ChecklistGate();
    const preflight = createTestPreflight({ checklist: [] });
    const rearmatter = createTestRearmatter();

    const result = await gate.evaluate('solution', rearmatter, preflight);

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.gate, 'checklist');
  });

  it('should pass when keywords are present', async () => {
    const gate = new ChecklistGate();
    const preflight = createTestPreflight({
      checklist: ['Must include TypeScript types'],
    });
    const rearmatter = createTestRearmatter();

    const result = await gate.evaluate(
      'This solution includes TypeScript types for all functions',
      rearmatter,
      preflight
    );

    assert.strictEqual(result.passed, true);
  });

  it('should fail when keywords are missing', async () => {
    const gate = new ChecklistGate();
    const preflight = createTestPreflight({
      checklist: ['Must include TypeScript types'],
    });
    const rearmatter = createTestRearmatter();

    const result = await gate.evaluate(
      'This solution has no special features',
      rearmatter,
      preflight
    );

    assert.strictEqual(result.passed, false);
    assert.ok(result.feedback?.includes('not verified'));
  });
});

describe('RubricGate', () => {
  it('should pass with no rubric items', async () => {
    const gate = new RubricGate();
    const preflight = createTestPreflight({ rubric: [] });
    const rearmatter = createTestRearmatter();

    const result = await gate.evaluate('solution', rearmatter, preflight);

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.gate, 'rubric');
  });

  it('should calculate weighted scores', async () => {
    const gate = new RubricGate();
    const preflight = createTestPreflight({
      rubric: [
        { criterion: 'Quality', weight: 1.0, description: 'Uses TypeScript' },
      ],
    });
    const rearmatter = createTestRearmatter({ confidence: 0.9 });

    const result = await gate.evaluate(
      'This uses TypeScript with proper types',
      rearmatter,
      preflight
    );

    assert.ok(result.confidence! > 0);
    assert.ok(result.details?.overallScore !== undefined);
  });
});

describe('AdversarialGate', () => {
  it('should detect TODO markers', async () => {
    const gate = new AdversarialGate();
    const preflight = createTestPreflight();
    const rearmatter = createTestRearmatter();

    const result = await gate.evaluate(
      'This solution has a TODO: fix later',
      rearmatter,
      preflight
    );

    // Adversarial typically passes but notes concerns
    assert.strictEqual(result.gate, 'adversarial');
    assert.ok(result.details?.issues);
  });

  it('should note declared assumptions', async () => {
    const gate = new AdversarialGate();
    const preflight = createTestPreflight();
    const rearmatter = createTestRearmatter({
      assumptions: ['Assumes user has Node.js installed'],
    });

    const result = await gate.evaluate('solution', rearmatter, preflight);

    const issues = result.details?.issues as Array<{ category: string }>;
    const assumptionIssues = issues?.filter(i => i.category === 'assumption');
    assert.ok(assumptionIssues?.length > 0);
  });
});

describe('AccuracyGate', () => {
  it('should pass with no accuracy requirements', async () => {
    const gate = new AccuracyGate();
    const preflight = createTestPreflight();
    const rearmatter = createTestRearmatter();

    const result = await gate.evaluate('solution', rearmatter, preflight);

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.gate, 'accuracy');
  });

  it('should fail when sources required but none found', async () => {
    const gate = new AccuracyGate();
    const preflight = createTestPreflight({
      accuracyRequirements: {
        requireSources: true,
        preferFirstParty: true,
      },
    });
    const rearmatter = createTestRearmatter();

    const result = await gate.evaluate(
      'This solution has no sources',
      rearmatter,
      preflight
    );

    assert.strictEqual(result.passed, false);
    assert.ok(result.feedback?.includes('Sources required'));
  });

  it('should extract sources from solution text', async () => {
    const gate = new AccuracyGate();
    const preflight = createTestPreflight({
      accuracyRequirements: {
        requireSources: true,
        preferFirstParty: false,
        minSourceCount: 1,
      },
    });
    const rearmatter = createTestRearmatter();

    const result = await gate.evaluate(
      'See https://docs.example.com/api for details',
      rearmatter,
      preflight
    );

    assert.strictEqual(result.passed, true);
    assert.ok(result.details?.totalSources === 1);
  });
});

describe('QualityStack', () => {
  beforeEach(() => {
    evaluatorRegistry.clear();
  });

  it('should run stages in order', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
        { type: 'llm', gate: 'rubric', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const preflight = createTestPreflight({ checklist: [], rubric: [] });
    const rearmatter = createTestRearmatter();

    const result = await stack.run('solution', rearmatter, preflight);

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.iterations, 1);
    assert.ok(result.results.length >= 2);
  });

  it('should emit events during execution', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const preflight = createTestPreflight({ checklist: [] });
    const rearmatter = createTestRearmatter();

    const events: string[] = [];
    stack.on('iteration:start', () => events.push('iteration:start'));
    stack.on('stage:start', () => events.push('stage:start'));
    stack.on('stage:complete', () => events.push('stage:complete'));
    stack.on('complete', () => events.push('complete'));

    await stack.run('solution', rearmatter, preflight);

    assert.ok(events.includes('iteration:start'));
    assert.ok(events.includes('stage:start'));
    assert.ok(events.includes('stage:complete'));
    assert.ok(events.includes('complete'));
  });

  it('should halt on halt action', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'accuracy', criteria: 'from_preflight', failAction: 'halt' },
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 3,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const preflight = createTestPreflight({
      checklist: [],
      accuracyRequirements: {
        requireSources: true,
        preferFirstParty: true,
      },
    });
    const rearmatter = createTestRearmatter();

    const result = await stack.run('no sources here', rearmatter, preflight);

    assert.strictEqual(result.passed, false);
    // Should have stopped after accuracy gate
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].gate, 'accuracy');
  });
});

describe('createStandardStack', () => {
  beforeEach(() => {
    evaluatorRegistry.clear();
  });

  it('should create stack with default gates', () => {
    const stack = createStandardStack();
    const config = stack.getConfig();

    assert.ok(config.stages.length >= 3);
    assert.ok(config.stages.some(s => s.gate === 'checklist'));
    assert.ok(config.stages.some(s => s.gate === 'rubric'));
    assert.ok(config.stages.some(s => s.gate === 'adversarial'));
  });

  it('should create stack with specified gates', () => {
    const stack = createStandardStack(['accuracy', 'deterministic']);
    const config = stack.getConfig();

    assert.strictEqual(config.stages.length, 2);
    assert.strictEqual(config.stages[0].gate, 'accuracy');
    assert.strictEqual(config.stages[1].gate, 'deterministic');
  });
});
