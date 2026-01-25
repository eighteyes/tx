/**
 * Quality Summarizer Post-Hook
 *
 * Summarizes ensemble results (informational only, cannot fail).
 */

import { log } from '../../shared/logger.ts';
import type { PreflightOutput } from '../../quality/types.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
  const { SummarizerGate } = await import('../../quality/gates/summarizer.ts');

  const workerOutput = context.workerOutput;
  if (!workerOutput) {
    log.warn('quality', 'Summarizer gate skipped - no worker output');
    log.activity('quality:summarizer', agentId, 'SKIPPED: No worker output');
    return;
  }

  log.activity('quality:summarizer', agentId, 'Generating summary');

  // Summarizer works with ensemble solutions, but in single-worker mode
  // we just create a single solution entry
  const gate = new SummarizerGate({
    solutions: [{
      workerId: context.agentId || 'unknown',
      solution: workerOutput,
      rearmatter: utils.extractRearmatter(workerOutput),
    }],
  });

  const result = await gate.evaluate(workerOutput, {}, {} as PreflightOutput);

  log.info('quality', 'Summary generated', {
    solutionCount: result.details?.solutionCount,
    selectedWorkerId: result.details?.selectedWorkerId,
    selectedConfidence: result.details?.selectedConfidence,
    avgSimilarity: result.details?.avgSimilarity,
  });

  const sumContent = `Summary complete: ${result.details?.solutionCount || 1} solution(s), confidence=${result.details?.selectedConfidence || 0}`;
  log.activity('quality:summarizer', agentId, sumContent);

  // Write result to sys-msgs for visibility
  utils.writeResultMessage(context, 'summarizer', true, sumContent, {
    solutionCount: result.details?.solutionCount,
    selectedConfidence: result.details?.selectedConfidence,
  });

  // Summarizer is informational only - does not throw on failure
};

export const qualitySummarizerHook: HookDefinition = {
  name: 'quality:summarizer',
  phase: 'post',
  priority: 60, // After evaluation gates
  description: 'Summarizes ensemble results (informational only)',
  handler,
};
