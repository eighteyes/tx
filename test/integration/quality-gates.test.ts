/**
 * Quality Gates Integration Tests
 *
 * End-to-end tests for the quality evaluation pipeline.
 *
 * Responsibilities:
 * - Verify full pipeline flow: preflight → stack → results
 * - Test gate ordering, halt behavior, and flag behavior
 * - Exercise legacy quality-gates interface
 * - Validate stack creation helpers
 * - Confirm event emission during pipeline runs
 * - Test DeterministicGate with real shell commands
 * - Test SummarizerGate with ensemble solutions
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  QualityStack,
  createStandardStack,
  createStackFromConfig,
  evaluatorRegistry,
  ChecklistGate,
  RubricGate,
  AdversarialGate,
  AccuracyGate,
  DeterministicGate,
  SummarizerGate,
  type PreflightOutput,
  type RearmatterData,
  type QualityStackConfig,
  type GateType,
  type EvalStage,
  type StackResult,
  type EnsembleSolution,
} from '../../src/quality/index.ts';

import {
  getQualityGates,
  validateQualityGates,
} from '../../src/quality-gates/index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPreflight(overrides: Partial<PreflightOutput> = {}): PreflightOutput {
  return {
    taskType: 'integration-test',
    checklist: ['Must include error handling', 'Must include TypeScript types'],
    rubric: [
      { criterion: 'Correctness', weight: 0.6, description: 'Solution produces correct TypeScript output' },
      { criterion: 'Style', weight: 0.4, description: 'Code follows consistent style conventions' },
    ],
    requiredGates: ['checklist', 'rubric'] as GateType[],
    suggestedGates: ['adversarial'] as GateType[],
    effortLevel: 'medium',
    estimatedToolCalls: 10,
    ...overrides,
  };
}

function createRearmatter(overrides: Partial<RearmatterData> = {}): RearmatterData {
  return {
    confidence: 0.85,
    grade: 'B',
    ...overrides,
  };
}

/**
 * A solution that hits keyword heuristics for checklist + rubric gates.
 */
const PASSING_SOLUTION = [
  'This implementation adds comprehensive error handling around every async call.',
  'All functions use TypeScript types and strict type annotations.',
  'The output is correct TypeScript that compiles without errors.',
  'Code follows consistent style conventions with proper formatting.',
].join('\n');

/**
 * A deliberately sparse solution that fails most heuristic checks.
 */
const FAILING_SOLUTION = 'Just do the thing.';

// ---------------------------------------------------------------------------
// 1. Full pipeline: preflight -> stack -> results
// ---------------------------------------------------------------------------

describe('Full pipeline: preflight -> stack -> results', () => {
  beforeEach(() => { evaluatorRegistry.clear(); });

  it('runs a multi-gate stack end-to-end and returns a valid StackResult', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
        { type: 'llm', gate: 'rubric', criteria: 'from_preflight', failAction: 'flag' },
        { type: 'llm', gate: 'adversarial', criteria: 'none', failAction: 'flag' },
        { type: 'llm', gate: 'accuracy', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const preflight = createPreflight();
    const rearmatter = createRearmatter();

    const result = await stack.run(PASSING_SOLUTION, rearmatter, preflight);

    // Structure assertions
    assert.strictEqual(typeof result.passed, 'boolean');
    assert.strictEqual(typeof result.iterations, 'number');
    assert.ok(Array.isArray(result.results));
    assert.ok(result.results.length >= 4, `Expected >= 4 results, got ${result.results.length}`);
    assert.strictEqual(result.iterations, 1);
    assert.strictEqual(typeof result.finalSolution, 'string');
    assert.strictEqual(typeof result.totalDuration, 'number');
    assert.ok(result.totalDuration! >= 0);

    // Each result has required fields
    for (const r of result.results) {
      assert.ok(r.gate, 'result must have gate');
      assert.strictEqual(typeof r.passed, 'boolean');
    }
  });

  it('carries the final solution through to the result', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const result = await stack.run(
      PASSING_SOLUTION,
      createRearmatter(),
      createPreflight({ checklist: [] }),
    );

    assert.strictEqual(result.finalSolution, PASSING_SOLUTION);
  });
});

// ---------------------------------------------------------------------------
// 2. Gate ordering and sequencing
// ---------------------------------------------------------------------------

describe('Gate ordering and sequencing', () => {
  beforeEach(() => { evaluatorRegistry.clear(); });

  it('executes gates in config order: checklist -> rubric -> adversarial -> accuracy', async () => {
    const order: GateType[] = ['checklist', 'rubric', 'adversarial', 'accuracy'];

    const config: QualityStackConfig = {
      preflight: true,
      stages: order.map(gate => ({
        type: 'llm' as const,
        gate,
        criteria: gate === 'adversarial' ? 'none' as const : 'from_preflight' as const,
        failAction: 'flag' as const,
      })),
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const result = await stack.run(
      PASSING_SOLUTION,
      createRearmatter(),
      createPreflight(),
    );

    // Results appear in config order
    const gateSequence = result.results.map(r => r.gate);
    assert.deepStrictEqual(gateSequence, order);
  });

  it('handles a single-gate stack', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'accuracy', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const result = await stack.run(
      PASSING_SOLUTION,
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].gate, 'accuracy');
  });
});

// ---------------------------------------------------------------------------
// 3. Halt behavior across gates
// ---------------------------------------------------------------------------

describe('Halt behavior across gates', () => {
  beforeEach(() => { evaluatorRegistry.clear(); });

  it('halts pipeline when accuracy gate with halt failAction fails', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'accuracy', criteria: 'from_preflight', failAction: 'halt' },
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
        { type: 'llm', gate: 'rubric', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 3,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const preflight = createPreflight({
      accuracyRequirements: {
        requireSources: true,
        preferFirstParty: true,
      },
    });

    const result = await stack.run('No sources here at all', createRearmatter(), preflight);

    assert.strictEqual(result.passed, false, 'Pipeline should fail');
    assert.strictEqual(result.results.length, 1, 'Should halt after first gate');
    assert.strictEqual(result.results[0].gate, 'accuracy');
    assert.strictEqual(result.results[0].passed, false);
    assert.ok(result.feedback, 'Should include feedback from the failing gate');
  });

  it('does not halt when the halting gate passes', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'accuracy', criteria: 'from_preflight', failAction: 'halt' },
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    // No accuracy requirements => accuracy gate auto-passes
    const result = await stack.run(
      PASSING_SOLUTION,
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.results.length, 2, 'Both gates should execute');
  });
});

// ---------------------------------------------------------------------------
// 4. Flag behavior (non-blocking failures)
// ---------------------------------------------------------------------------

describe('Flag behavior (non-blocking failures)', () => {
  beforeEach(() => { evaluatorRegistry.clear(); });

  it('continues through all gates when a flagged gate fails', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
        { type: 'llm', gate: 'rubric', criteria: 'from_preflight', failAction: 'flag' },
        { type: 'llm', gate: 'adversarial', criteria: 'none', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const preflight = createPreflight({
      checklist: ['Must include quantum entanglement processor'],
    });

    const result = await stack.run(FAILING_SOLUTION, createRearmatter(), preflight);

    // All three gates should have run despite checklist failure
    assert.strictEqual(result.results.length, 3);
    assert.deepStrictEqual(
      result.results.map(r => r.gate),
      ['checklist', 'rubric', 'adversarial'],
    );

    // Overall should fail because a gate failed
    assert.strictEqual(result.passed, false);

    // The checklist gate specifically should fail
    const checklistResult = result.results.find(r => r.gate === 'checklist');
    assert.strictEqual(checklistResult!.passed, false);
  });

  it('reports failure feedback when flagged gates fail', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const preflight = createPreflight({
      checklist: ['Must include quantum entanglement processor'],
    });

    const result = await stack.run(FAILING_SOLUTION, createRearmatter(), preflight);

    assert.strictEqual(result.passed, false);
    assert.ok(result.feedback, 'Should include aggregated feedback');
  });
});

// ---------------------------------------------------------------------------
// 5. Legacy quality-gates module
// ---------------------------------------------------------------------------

describe('Legacy quality-gates module (src/quality-gates/index.ts)', () => {
  it('getQualityGates("code-implementation") returns expected gate list', () => {
    const gates = getQualityGates('code-implementation');
    assert.deepStrictEqual(gates, ['checklist', 'rubric', 'adversarial', 'deterministic']);
  });

  it('getQualityGates("research") returns research gates', () => {
    const gates = getQualityGates('research');
    assert.deepStrictEqual(gates, ['accuracy', 'checklist', 'adversarial']);
  });

  it('getQualityGates returns defaults for unknown task types', () => {
    const gates = getQualityGates('unknown-type');
    assert.deepStrictEqual(gates, ['checklist', 'rubric']);
  });

  it('getQualityGates returns defaults for empty string', () => {
    const gates = getQualityGates('');
    assert.deepStrictEqual(gates, ['checklist', 'rubric']);
  });

  it('validateQualityGates always returns true (backward compat)', async () => {
    const result = await validateQualityGates('code-implementation');
    assert.strictEqual(result, true);
  });

  it('validateQualityGates returns true for unknown types too', async () => {
    const result = await validateQualityGates('nonexistent-garbage');
    assert.strictEqual(result, true);
  });
});

// ---------------------------------------------------------------------------
// 6. Stack creation helpers
// ---------------------------------------------------------------------------

describe('Stack creation helpers', () => {
  beforeEach(() => { evaluatorRegistry.clear(); });

  it('createStandardStack() produces default config with checklist + rubric + adversarial', () => {
    const stack = createStandardStack();
    const config = stack.getConfig();

    assert.strictEqual(config.stages.length, 3);
    assert.deepStrictEqual(
      config.stages.map(s => s.gate),
      ['checklist', 'rubric', 'adversarial'],
    );
    assert.strictEqual(config.maxIterations, 3);
    assert.strictEqual(config.preflight, true);
  });

  it('createStandardStack() assigns correct failActions per gate type', () => {
    const stack = createStandardStack();
    const config = stack.getConfig();

    const checklist = config.stages.find(s => s.gate === 'checklist');
    const adversarial = config.stages.find(s => s.gate === 'adversarial');

    assert.strictEqual(checklist!.failAction, 'loop');
    assert.strictEqual(adversarial!.failAction, 'flag');
  });

  it('createStandardStack(["accuracy", "deterministic"]) uses only specified gates', () => {
    const stack = createStandardStack(['accuracy', 'deterministic']);
    const config = stack.getConfig();

    assert.strictEqual(config.stages.length, 2);
    assert.strictEqual(config.stages[0].gate, 'accuracy');
    assert.strictEqual(config.stages[1].gate, 'deterministic');
  });

  it('createStandardStack sets deterministic type for deterministic gate', () => {
    const stack = createStandardStack(['deterministic']);
    const config = stack.getConfig();

    assert.strictEqual(config.stages[0].type, 'deterministic');
  });

  it('createStackFromConfig with gate array merges with preflight suggestions', () => {
    const preflight = createPreflight({
      requiredGates: ['checklist'] as GateType[],
      suggestedGates: ['adversarial'] as GateType[],
    });

    const stack = createStackFromConfig(['accuracy'] as GateType[], preflight);
    const config = stack.getConfig();

    const gates = config.stages.map(s => s.gate);
    assert.ok(gates.includes('accuracy'), 'Should include user-specified gate');
    assert.ok(gates.includes('adversarial'), 'Should include suggested gate');
  });

  it('createStackFromConfig with boolean true uses all preflight gates', () => {
    const preflight = createPreflight({
      requiredGates: ['checklist', 'rubric'] as GateType[],
      suggestedGates: ['adversarial'] as GateType[],
    });

    const stack = createStackFromConfig(true, preflight);
    const config = stack.getConfig();

    const gates = config.stages.map(s => s.gate);
    assert.ok(gates.includes('checklist'));
    assert.ok(gates.includes('rubric'));
    assert.ok(gates.includes('adversarial'));
  });

  it('createStackFromConfig produces a stack that actually runs', async () => {
    const preflight = createPreflight({
      checklist: [],
      rubric: [],
      requiredGates: ['checklist'] as GateType[],
      suggestedGates: [] as GateType[],
    });

    const stack = createStackFromConfig(true, preflight);
    const result = await stack.run(PASSING_SOLUTION, createRearmatter(), preflight);

    assert.strictEqual(typeof result.passed, 'boolean');
    assert.ok(result.results.length >= 1);
  });
});

// ---------------------------------------------------------------------------
// 7. Event emission during full pipeline run
// ---------------------------------------------------------------------------

describe('Event emission during full pipeline run', () => {
  beforeEach(() => { evaluatorRegistry.clear(); });

  it('fires events in correct order for a multi-gate stack', async () => {
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
    const events: string[] = [];

    stack.on('iteration:start', () => events.push('iteration:start'));
    stack.on('stage:start', () => events.push('stage:start'));
    stack.on('stage:complete', () => events.push('stage:complete'));
    stack.on('iteration:complete', () => events.push('iteration:complete'));
    stack.on('complete', () => events.push('complete'));

    await stack.run(PASSING_SOLUTION, createRearmatter(), createPreflight());

    // Expected: iteration:start, [stage:start, stage:complete] x2, iteration:complete, complete
    assert.deepStrictEqual(events, [
      'iteration:start',
      'stage:start', 'stage:complete',
      'stage:start', 'stage:complete',
      'iteration:complete',
      'complete',
    ]);
  });

  it('stage:start and stage:complete events carry stage data', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);

    type StageStartPayload = { stage: EvalStage; stageIndex: number };
    type StageCompletePayload = { stage: EvalStage; stageIndex: number; result: { gate: string; passed: boolean } };

    let startPayload: StageStartPayload | undefined;
    let completePayload: StageCompletePayload | undefined;

    stack.on('stage:start', (data: StageStartPayload) => { startPayload = data; });
    stack.on('stage:complete', (data: StageCompletePayload) => { completePayload = data; });

    await stack.run(PASSING_SOLUTION, createRearmatter(), createPreflight({ checklist: [] }));

    assert.ok(startPayload, 'stage:start should fire');
    assert.strictEqual(startPayload!.stage.gate, 'checklist');
    assert.strictEqual(startPayload!.stageIndex, 0);

    assert.ok(completePayload, 'stage:complete should fire');
    assert.strictEqual(completePayload!.result.gate, 'checklist');
    assert.strictEqual(typeof completePayload!.result.passed, 'boolean');
  });

  it('iteration:start carries iteration number', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);

    let iterPayload: { iteration: number } | undefined;
    stack.on('iteration:start', (data: { iteration: number }) => { iterPayload = data; });

    await stack.run(PASSING_SOLUTION, createRearmatter(), createPreflight({ checklist: [] }));

    assert.ok(iterPayload);
    assert.strictEqual(iterPayload!.iteration, 1);
  });

  it('complete event carries the final StackResult', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);

    let completeResult: StackResult | undefined;
    stack.on('complete', (data: StackResult) => { completeResult = data; });

    const result = await stack.run(PASSING_SOLUTION, createRearmatter(), createPreflight({ checklist: [] }));

    assert.ok(completeResult);
    assert.strictEqual(completeResult!.passed, result.passed);
    assert.strictEqual(completeResult!.iterations, result.iterations);
  });
});

// ---------------------------------------------------------------------------
// 8. DeterministicGate integration
// ---------------------------------------------------------------------------

describe('DeterministicGate integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    evaluatorRegistry.clear();
    tmpDir = mkdtempSync(join(tmpdir(), 'quality-det-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when shell command succeeds (exit 0)', async () => {
    const gate = new DeterministicGate({
      commands: ['echo "test passed"'],
      workDir: tmpDir,
    });

    const result = await gate.evaluate(
      'irrelevant',
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.gate, 'deterministic');
    assert.ok(result.duration! >= 0);

    const details = result.details as { passed: number; failed: number };
    assert.strictEqual(details.passed, 1);
    assert.strictEqual(details.failed, 0);
  });

  it('fails when shell command fails (exit non-zero)', async () => {
    const gate = new DeterministicGate({
      commands: ['exit 1'],
      workDir: tmpDir,
    });

    const result = await gate.evaluate(
      'irrelevant',
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.gate, 'deterministic');
  });

  it('runs multiple commands and fails if any fail', async () => {
    const gate = new DeterministicGate({
      commands: ['echo "step 1"', 'exit 1', 'echo "step 3"'],
      workDir: tmpDir,
      failFast: true,
    });

    const result = await gate.evaluate(
      'irrelevant',
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.passed, false);
    const details = result.details as { executed: number; passed: number; failed: number };
    // failFast stops after first failure - only 2 executed (echo OK, exit 1 FAIL)
    assert.strictEqual(details.executed, 2);
    assert.strictEqual(details.passed, 1);
    assert.strictEqual(details.failed, 1);
  });

  it('runs all commands when failFast is false', async () => {
    const gate = new DeterministicGate({
      commands: ['echo "step 1"', 'exit 1', 'echo "step 3"'],
      workDir: tmpDir,
      failFast: false,
    });

    const result = await gate.evaluate(
      'irrelevant',
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.passed, false);
    const details = result.details as { executed: number; passed: number; failed: number };
    assert.strictEqual(details.executed, 3);
    assert.strictEqual(details.passed, 2);
    assert.strictEqual(details.failed, 1);
  });

  it('passes with no commands configured', async () => {
    const gate = new DeterministicGate({
      commands: [],
      workDir: tmpDir,
    });

    const result = await gate.evaluate(
      'irrelevant',
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.passed, true);
  });

  it('captures stdout from successful command', async () => {
    const gate = new DeterministicGate({
      commands: ['echo "hello world"'],
      workDir: tmpDir,
    });

    const result = await gate.evaluate(
      'irrelevant',
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.passed, true);
    const details = result.details as { results: Array<{ stdout: string }> };
    assert.ok(details.results[0].stdout.includes('hello world'));
  });

  it('uses the specified workDir for command execution', async () => {
    // Create a marker file in tmpDir, verify command can read it
    writeFileSync(join(tmpDir, 'marker.txt'), 'found');

    const gate = new DeterministicGate({
      commands: ['cat marker.txt'],
      workDir: tmpDir,
    });

    const result = await gate.evaluate(
      'irrelevant',
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.passed, true);
    const details = result.details as { results: Array<{ stdout: string }> };
    assert.ok(details.results[0].stdout.includes('found'));
  });

  it('integrates DeterministicGate within a full QualityStack run', async () => {
    evaluatorRegistry.clear();

    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
        { type: 'deterministic', gate: 'deterministic', criteria: 'none', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config, {
      deterministicCommands: ['echo "all good"'],
      workDir: tmpDir,
    });

    const result = await stack.run(
      PASSING_SOLUTION,
      createRearmatter(),
      createPreflight({ checklist: [] }),
    );

    assert.strictEqual(result.results.length, 2);
    const detResult = result.results.find(r => r.gate === 'deterministic');
    assert.ok(detResult, 'Deterministic gate should appear in results');
    assert.strictEqual(detResult!.passed, true);
  });
});

// ---------------------------------------------------------------------------
// 9. SummarizerGate with ensemble solutions
// ---------------------------------------------------------------------------

describe('SummarizerGate with ensemble solutions', () => {
  beforeEach(() => { evaluatorRegistry.clear(); });

  it('passes through a single solution without summarization', async () => {
    const solutions: EnsembleSolution[] = [
      {
        workerId: 'worker-1',
        solution: 'The only solution.',
        rearmatter: { confidence: 0.9, grade: 'A' },
      },
    ];

    const gate = new SummarizerGate({ solutions });
    const result = await gate.evaluate(
      'ignored',
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.gate, 'summarizer');
    assert.strictEqual(
      (result.details as { selectedWorkerId: string }).selectedWorkerId,
      'worker-1',
    );
  });

  it('selects the highest-confidence solution from an ensemble', async () => {
    const solutions: EnsembleSolution[] = [
      {
        workerId: 'worker-low',
        solution: 'A mediocre answer with some words',
        rearmatter: { confidence: 0.3, grade: 'D' },
      },
      {
        workerId: 'worker-high',
        solution: 'A great answer with many words',
        rearmatter: { confidence: 0.95, grade: 'A' },
      },
      {
        workerId: 'worker-mid',
        solution: 'An okay answer with several words',
        rearmatter: { confidence: 0.6, grade: 'C' },
      },
    ];

    const gate = new SummarizerGate({ solutions });
    const result = await gate.evaluate(
      'ignored',
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.passed, true);
    const details = result.details as {
      solutionCount: number;
      selectedWorkerId: string;
      selectedConfidence: number;
    };
    assert.strictEqual(details.solutionCount, 3);
    assert.strictEqual(details.selectedWorkerId, 'worker-high');
    assert.strictEqual(details.selectedConfidence, 0.95);
  });

  it('notes low consensus when solutions diverge', async () => {
    const solutions: EnsembleSolution[] = [
      {
        workerId: 'worker-a',
        solution: 'Apples oranges bananas grapes watermelons',
        rearmatter: { confidence: 0.8, grade: 'B' },
      },
      {
        workerId: 'worker-b',
        solution: 'Quantum physics thermodynamics relativity entropy mechanics',
        rearmatter: { confidence: 0.7, grade: 'B' },
      },
    ];

    const gate = new SummarizerGate({ solutions, consensusThreshold: 0.9 });
    const result = await gate.evaluate(
      'ignored',
      createRearmatter(),
      createPreflight(),
    );

    assert.strictEqual(result.passed, true);
    // Low consensus should produce feedback
    assert.ok(result.feedback, 'Should note low consensus');
    assert.ok(result.feedback!.includes('similarity'), 'Feedback should mention similarity');
  });

  it('integrates SummarizerGate within a full QualityStack run', async () => {
    evaluatorRegistry.clear();

    const solutions: EnsembleSolution[] = [
      {
        workerId: 'w1',
        solution: 'First solution with error handling and TypeScript types',
        rearmatter: { confidence: 0.7, grade: 'B' },
      },
      {
        workerId: 'w2',
        solution: 'Second solution with error handling and TypeScript types',
        rearmatter: { confidence: 0.9, grade: 'A' },
      },
    ];

    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'summarizer', criteria: 'none', failAction: 'halt' },
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config, { ensembleSolutions: solutions });
    const result = await stack.run(
      PASSING_SOLUTION,
      createRearmatter(),
      createPreflight({ checklist: [] }),
    );

    assert.strictEqual(result.results.length, 2);
    const sumResult = result.results.find(r => r.gate === 'summarizer');
    assert.ok(sumResult);
    assert.strictEqual(sumResult!.passed, true);
  });
});

// ---------------------------------------------------------------------------
// Cross-gate interaction: adversarial sees prior evals
// ---------------------------------------------------------------------------

describe('Cross-gate interaction: adversarial sees prior evals', () => {
  beforeEach(() => { evaluatorRegistry.clear(); });

  it('adversarial gate receives prior eval results for challenge analysis', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'accuracy', criteria: 'from_preflight', failAction: 'flag' },
        { type: 'llm', gate: 'adversarial', criteria: 'none', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const preflight = createPreflight({
      accuracyRequirements: {
        requireSources: true,
        preferFirstParty: true,
      },
    });

    // Solution will fail accuracy (no sources) but pipeline continues (flag)
    const result = await stack.run(
      'A solution with no references',
      createRearmatter({ assumptions: ['User has internet'] }),
      preflight,
    );

    // Both gates should have run
    assert.strictEqual(result.results.length, 2);

    // Adversarial should see the accuracy failure and flag it
    const adversarialResult = result.results.find(r => r.gate === 'adversarial');
    assert.ok(adversarialResult);
    const issues = (adversarialResult!.details as { issues: Array<{ category: string }> }).issues;
    // Should have issues from both assumptions and (possibly) prior eval analysis
    assert.ok(issues.length > 0, 'Adversarial should identify issues');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  beforeEach(() => { evaluatorRegistry.clear(); });

  it('handles empty stages array gracefully', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const result = await stack.run(PASSING_SOLUTION, createRearmatter(), createPreflight());

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.results.length, 0);
    assert.strictEqual(result.iterations, 1);
  });

  it('skips unregistered gate types without crashing', async () => {
    evaluatorRegistry.clear(); // Ensure nothing registered

    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        // Summarizer not registered (no ensembleSolutions), should be skipped
        { type: 'llm', gate: 'summarizer', criteria: 'none', failAction: 'flag' },
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'flag' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    // Construct without options so summarizer is not registered
    const stack = new QualityStack(config);
    const result = await stack.run(
      PASSING_SOLUTION,
      createRearmatter(),
      createPreflight({ checklist: [] }),
    );

    // Summarizer skipped, checklist ran
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].gate, 'checklist');
  });

  it('respects maxIterations=1 and does not loop', async () => {
    const config: QualityStackConfig = {
      preflight: true,
      stages: [
        { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'loop' },
      ],
      maxIterations: 1,
      evalChain: false,
    };

    const stack = new QualityStack(config);
    const preflight = createPreflight({
      checklist: ['Must include quantum entanglement processor'],
    });

    const result = await stack.run(FAILING_SOLUTION, createRearmatter(), preflight);

    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.iterations, 1);
  });
});
