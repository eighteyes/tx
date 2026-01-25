/**
 * Quality Rubric Post-Hook
 *
 * Scores worker output against rubric criteria from preflight.
 */

import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { QualityIterationError } from '../errors.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
  const { RubricGate } = await import('../../quality/gates/rubric.ts');
  const gate = new RubricGate();

  const preflight = context.qualityPreflight;
  if (!preflight) {
    log.warn('quality', 'Rubric gate skipped - no preflight data');
    log.activity('quality:rubric', agentId, 'SKIPPED: No preflight data');
    return;
  }

  const workerOutput = context.workerOutput;
  if (!workerOutput) {
    log.warn('quality', 'Rubric gate skipped - no worker output');
    log.activity('quality:rubric', agentId, 'SKIPPED: No worker output');
    return;
  }

  log.activity('quality:rubric', agentId, 'Running rubric evaluation');
  const result = await gate.evaluate(workerOutput, {}, preflight);

  log.info('quality', 'Rubric evaluation', {
    passed: result.passed,
    score: result.details?.overallScore,
    threshold: result.details?.threshold,
    criteria: result.details?.scores,
  });

  // Build detailed activity output
  const scores = result.details?.scores as Array<{ criterion: string; score: number }> | undefined;
  let rubricContent = `${result.passed ? 'PASS' : 'FAIL'}: score=${result.details?.overallScore || 0}/${result.details?.threshold || 70}`;
  if (scores && scores.length > 0) {
    const lowScores = scores.filter(s => s.score < 70).slice(0, 3);
    if (lowScores.length > 0) {
      const lowList = lowScores.map(s => `${s.criterion.slice(0, 25)}:${s.score}`).join(', ');
      rubricContent += `\n   ⚠️ Low: ${lowList}`;
    }
  }
  log.activity('quality:rubric', agentId, rubricContent);

  // Write result to sys-msgs for visibility
  utils.writeResultMessage(context, 'rubric', result.passed, rubricContent, {
    overallScore: result.details?.overallScore,
    threshold: result.details?.threshold,
  });

  if (!result.passed) {
    throw new QualityIterationError(result.feedback || 'Rubric failed');
  }
};

export const qualityRubricHook: HookDefinition = {
  name: 'quality:rubric',
  phase: 'post',
  priority: 51,
  description: 'Scores worker output against rubric criteria',
  handler,
};
