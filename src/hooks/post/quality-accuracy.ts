/**
 * Quality Accuracy Post-Hook
 *
 * Validates sources and checks first-party vs second-party quality.
 */

import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { QualityIterationError } from '../errors.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
  const { AccuracyGate } = await import('../../quality/gates/accuracy.ts');
  const gate = new AccuracyGate();

  const preflight = context.qualityPreflight;
  if (!preflight) {
    log.warn('quality', 'Accuracy gate skipped - no preflight data');
    log.activity('quality:accuracy', agentId, 'SKIPPED: No preflight data');
    return;
  }

  const workerOutput = context.workerOutput;
  if (!workerOutput) {
    log.warn('quality', 'Accuracy gate skipped - no worker output');
    log.activity('quality:accuracy', agentId, 'SKIPPED: No worker output');
    return;
  }

  log.activity('quality:accuracy', agentId, 'Running accuracy verification');
  const result = await gate.evaluate(workerOutput, {}, preflight);

  log.info('quality', 'Accuracy verification', {
    passed: result.passed,
    confidence: result.confidence,
    totalSources: result.details?.totalSources,
    firstParty: result.details?.firstParty,
    secondParty: result.details?.secondParty,
  });

  const accContent = `${result.passed ? 'PASS' : 'FAIL'}: ${result.details?.totalSources || 0} sources (1st=${result.details?.firstParty || 0}, 2nd=${result.details?.secondParty || 0})`;
  log.activity('quality:accuracy', agentId, accContent);

  // Write result to sys-msgs for visibility
  utils.writeResultMessage(context, 'accuracy', result.passed, accContent, {
    totalSources: result.details?.totalSources,
    firstParty: result.details?.firstParty,
    secondParty: result.details?.secondParty,
  });

  if (!result.passed) {
    throw new QualityIterationError(result.feedback || 'Accuracy verification failed');
  }
};

export const qualityAccuracyHook: HookDefinition = {
  name: 'quality:accuracy',
  phase: 'post',
  priority: 53,
  description: 'Validates sources and checks first-party vs second-party quality',
  handler,
};
