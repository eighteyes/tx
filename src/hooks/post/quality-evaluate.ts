/**
 * Quality Evaluate Post-Hook
 *
 * Runs quality stack on worker output (backward compatibility hook).
 * Executes the full quality evaluation pipeline.
 */

import { log } from '../../shared/logger.ts';
import { createStackFromConfig } from '../../quality/index.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { QualityIterationError, QualityHaltError, QualityExhaustedError } from '../errors.ts';
import { writeFeedbackMessage } from '../utils/messages.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
  const taskId = context.taskId || `${agentId}-${Date.now()}`;

  // Get preflight from context (set by quality:preflight)
  const preflight = context.qualityPreflight;
  if (!preflight) {
    log.warn('hooks', 'No preflight found, skipping quality evaluation', { agentId });
    return;
  }

  // Get worker output from context
  const workerOutput = context.workerOutput;
  if (!workerOutput) {
    log.warn('hooks', 'No worker output found, skipping quality evaluation', { agentId });
    return;
  }

  const iteration = context.qualityIteration || 1;
  const maxIterations = context.qualityMaxIterations || 5;
  const onFail = context.qualityOnFail || 'loop';

  log.info('hooks', 'Running quality evaluation', {
    agentId,
    taskId,
    iteration,
    gates: [...preflight.requiredGates, ...preflight.suggestedGates],
  });
  const allGates = [...preflight.requiredGates, ...preflight.suggestedGates];
  log.activity('quality:evaluate', agentId, `Starting evaluation (iteration ${iteration}/${maxIterations}): gates=[${allGates.join(',')}]`);

  // Create quality stack from config
  const stack = createStackFromConfig(
    [...preflight.requiredGates, ...preflight.suggestedGates],
    preflight,
    { workDir: context.workDir }
  );

  // Extract rearmatter from solution
  const rearmatter = utils.extractRearmatter(workerOutput);

  // Run the stack
  const result = await stack.run(workerOutput, rearmatter, preflight);

  log.info('hooks', 'Quality stack complete', {
    agentId,
    taskId,
    iteration,
    passed: result.passed,
  });
  log.activity('quality:evaluate', agentId, `Stack complete: ${result.passed ? 'PASS' : 'FAIL'} (iteration ${iteration}/${maxIterations})`);

  if (!result.passed) {
    // Quality check failed
    if (onFail === 'halt') {
      log.warn('hooks', 'Quality stack HALT - stopping immediately', {
        agentId,
        taskId,
        feedback: result.feedback,
      });
      log.activity('quality:evaluate', agentId, `HALT: Quality check failed - ${result.feedback || 'No feedback'}`);
      throw new QualityHaltError(result.feedback || 'Quality check failed');
    }

    // LOOP: Check if we can retry
    if (iteration < maxIterations) {
      log.info('hooks', 'Quality stack FAIL - iteration loop', {
        agentId,
        taskId,
        iteration,
        maxIterations,
        feedback: result.feedback,
      });
      log.activity('quality:evaluate', agentId, `LOOP: Iteration ${iteration}/${maxIterations} failed - requesting re-run`);

      // Update iteration count in context
      context.qualityIteration = iteration + 1;

      // Write feedback message for re-run
      if (result.feedback && context.msgsDir) {
        await writeFeedbackMessage(context, agentId, taskId, result.feedback, iteration + 1);
        log.activity('quality:feedback', agentId, `Feedback written for iteration ${iteration + 1}`);
      }

      // Signal to dispatcher to re-spawn worker
      throw new QualityIterationError(result.feedback || 'Quality check failed');
    }

    // Max iterations exhausted
    log.warn('hooks', 'Quality stack exhausted max iterations', {
      agentId,
      taskId,
      iterations: iteration,
      maxIterations,
    });
    log.activity('quality:evaluate', agentId, `EXHAUSTED: Max iterations (${maxIterations}) reached without passing`);
    throw new QualityExhaustedError(`Max iterations (${maxIterations}) reached`);
  }

  log.info('hooks', 'Quality evaluation PASSED', {
    agentId,
    taskId,
    iterations: iteration,
  });
  log.activity('quality:evaluate', agentId, `PASS: Quality evaluation complete after ${iteration} iteration(s)`);
};

export const qualityEvaluateHook: HookDefinition = {
  name: 'quality:evaluate',
  phase: 'post',
  priority: 40, // Legacy - runs before individual gates
  description: 'Runs full quality stack on worker output',
  handler,
};
