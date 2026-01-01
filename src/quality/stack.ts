/**
 * QualityStack Orchestrator
 *
 * Orchestrates evaluation stages in order, handling pass/fail/loop/halt logic.
 */

import { EventEmitter } from 'node:events';
import type {
  QualityStackConfig,
  EvalStage,
  EvalResult,
  StackResult,
  PreflightOutput,
  RearmatterData,
  GateType,
  GATE_ORDER,
} from './types.ts';
import { evaluatorRegistry, getEvaluator } from './registry.ts';
import { log } from '../shared/logger.ts';

// Import and register all gates
import { ChecklistGate } from './gates/checklist.ts';
import { RubricGate } from './gates/rubric.ts';
import { AdversarialGate } from './gates/adversarial.ts';
import { AccuracyGate } from './gates/accuracy.ts';
import { SummarizerGate, type EnsembleSolution } from './gates/summarizer.ts';
import { DeterministicGate, type DeterministicGateConfig } from './gates/deterministic.ts';

/**
 * QualityStack events
 */
export interface QualityStackEvents {
  'stage:start': { stage: EvalStage; stageIndex: number };
  'stage:complete': { stage: EvalStage; stageIndex: number; result: EvalResult };
  'iteration:start': { iteration: number };
  'iteration:complete': { iteration: number; passed: boolean };
  'complete': StackResult;
}

/**
 * Options for running the quality stack
 */
export interface QualityStackOptions {
  /** Ensemble solutions (for summarizer gate) */
  ensembleSolutions?: EnsembleSolution[];
  /** Working directory (for deterministic gate) */
  workDir?: string;
  /** Commands to run (for deterministic gate) */
  deterministicCommands?: string[];
}

/**
 * QualityStack orchestrator
 *
 * Runs evaluation stages in order, with support for:
 * - Stage sequencing with pass/fail/loop/halt
 * - Iteration loops on failure
 * - Eval chain (adversarial sees prior evals)
 * - Event emission for monitoring
 */
export class QualityStack extends EventEmitter {
  private config: QualityStackConfig;
  private options: QualityStackOptions;

  constructor(config: QualityStackConfig, options: QualityStackOptions = {}) {
    super();
    this.config = config;
    this.options = options;

    // Initialize gates with any provided options
    this.initializeGates();
  }

  /**
   * Initialize and register gate instances
   */
  private initializeGates(): void {
    // Register basic gates (no special config needed)
    if (!evaluatorRegistry.has('checklist')) {
      evaluatorRegistry.register('checklist', new ChecklistGate());
    }
    if (!evaluatorRegistry.has('rubric')) {
      evaluatorRegistry.register('rubric', new RubricGate());
    }
    if (!evaluatorRegistry.has('adversarial')) {
      evaluatorRegistry.register('adversarial', new AdversarialGate());
    }
    if (!evaluatorRegistry.has('accuracy')) {
      evaluatorRegistry.register('accuracy', new AccuracyGate());
    }

    // Register summarizer if we have ensemble solutions
    if (this.options.ensembleSolutions && this.options.ensembleSolutions.length > 0) {
      evaluatorRegistry.register('summarizer', new SummarizerGate({
        solutions: this.options.ensembleSolutions,
      }));
    }

    // Register deterministic if we have commands
    if (this.options.deterministicCommands && this.options.workDir) {
      evaluatorRegistry.register('deterministic', new DeterministicGate({
        commands: this.options.deterministicCommands,
        workDir: this.options.workDir,
      }));
    }
  }

  /**
   * Run the quality stack on a solution
   */
  async run(
    solution: string,
    rearmatter: RearmatterData,
    preflight: PreflightOutput
  ): Promise<StackResult> {
    const startTime = Date.now();
    let currentSolution = solution;
    let iteration = 0;
    const allResults: EvalResult[] = [];

    while (iteration < this.config.maxIterations) {
      iteration++;
      this.emit('iteration:start', { iteration });

      log.info('quality-stack', `Starting iteration ${iteration}/${this.config.maxIterations}`);

      const iterationResults: EvalResult[] = [];
      let iterationPassed = true;
      let needsLoop = false;
      let feedback = '';

      // Run each stage in order
      for (let i = 0; i < this.config.stages.length; i++) {
        const stage = this.config.stages[i];

        this.emit('stage:start', { stage, stageIndex: i });

        // Get the evaluator for this gate
        const evaluator = getEvaluator(stage.gate);
        if (!evaluator) {
          log.warn('quality-stack', `No evaluator for gate: ${stage.gate}, skipping`);
          continue;
        }

        // Determine prior evals to pass
        // Adversarial always sees prior evals (hardcoded behavior)
        const priorEvals = stage.gate === 'adversarial'
          ? [...allResults, ...iterationResults]
          : undefined;

        // Run evaluation
        const result = await evaluator.evaluate(
          currentSolution,
          rearmatter,
          preflight,
          priorEvals
        );

        iterationResults.push(result);
        this.emit('stage:complete', { stage, stageIndex: i, result });

        log.info('quality-stack', `Stage ${stage.gate}: ${result.passed ? 'PASS' : 'FAIL'}`, {
          confidence: result.confidence,
          duration: result.duration,
        });

        // Handle failure based on failAction
        if (!result.passed) {
          switch (stage.failAction) {
            case 'halt':
              // Stop immediately
              log.warn('quality-stack', `Stage ${stage.gate} failed with halt action`);
              allResults.push(...iterationResults);
              return this.buildResult(
                false,
                allResults,
                iteration,
                currentSolution,
                result.feedback,
                startTime
              );

            case 'loop':
              // Mark for re-run
              needsLoop = true;
              iterationPassed = false;
              if (result.feedback) {
                feedback = feedback ? `${feedback}\n\n${result.feedback}` : result.feedback;
              }
              break;

            case 'flag':
              // Continue but mark overall as failed
              iterationPassed = false;
              if (result.feedback) {
                feedback = feedback ? `${feedback}\n\n${result.feedback}` : result.feedback;
              }
              break;
          }
        }
      }

      allResults.push(...iterationResults);
      this.emit('iteration:complete', { iteration, passed: iterationPassed });

      // If all stages passed, we're done
      if (iterationPassed) {
        return this.buildResult(true, allResults, iteration, currentSolution, undefined, startTime);
      }

      // If no stages require loop, we're done (failed)
      if (!needsLoop) {
        return this.buildResult(false, allResults, iteration, currentSolution, feedback, startTime);
      }

      // Need to loop - log and continue
      log.info('quality-stack', `Iteration ${iteration} failed, feedback collected for re-run`);

      // In a real implementation, we would send feedback back to the worker
      // and get a new solution. For now, we just track the iterations.
      // The caller is responsible for handling the loop.
      if (iteration < this.config.maxIterations) {
        log.info('quality-stack', 'Exiting with loop request - caller should re-run with feedback');
        return this.buildResult(false, allResults, iteration, currentSolution, feedback, startTime);
      }
    }

    // Exhausted iterations
    return this.buildResult(
      false,
      allResults,
      iteration,
      currentSolution,
      'Max iterations reached without passing',
      startTime
    );
  }

  /**
   * Build a StackResult
   */
  private buildResult(
    passed: boolean,
    results: EvalResult[],
    iterations: number,
    finalSolution: string,
    feedback: string | undefined,
    startTime: number
  ): StackResult {
    const result: StackResult = {
      passed,
      results,
      iterations,
      finalSolution,
      feedback,
      totalDuration: Date.now() - startTime,
    };

    this.emit('complete', result);
    return result;
  }

  /**
   * Get configuration
   */
  getConfig(): QualityStackConfig {
    return { ...this.config };
  }
}

/**
 * Create a quality stack with standard gates
 */
export function createStandardStack(
  requiredGates: GateType[] = [],
  options: QualityStackOptions = {}
): QualityStack {
  const stages: EvalStage[] = [];

  // Add required gates in standard order
  const gatesToAdd = requiredGates.length > 0
    ? requiredGates
    : ['checklist', 'rubric', 'adversarial'] as GateType[];

  for (const gate of gatesToAdd) {
    stages.push({
      type: gate === 'deterministic' ? 'deterministic' : 'llm',
      gate,
      criteria: gate === 'adversarial' ? 'none' : 'from_preflight',
      failAction: gate === 'adversarial' ? 'flag' : 'loop',
    });
  }

  return new QualityStack(
    {
      preflight: true,
      stages,
      maxIterations: 3,
      evalChain: false,
    },
    options
  );
}

/**
 * Create a quality stack from graded config
 */
export function createStackFromConfig(
  graded: boolean | GateType[],
  preflight: PreflightOutput,
  options: QualityStackOptions = {}
): QualityStack {
  // Combine required and suggested gates
  let gates: GateType[];

  if (Array.isArray(graded)) {
    // User specified gates + preflight suggestions
    gates = [...new Set([...graded, ...preflight.suggestedGates])];
  } else {
    // Use all gates from preflight
    gates = [...new Set([...preflight.requiredGates, ...preflight.suggestedGates])];
  }

  return createStandardStack(gates, options);
}
