/**
 * Quality Checklist Post-Hook
 *
 * Evaluates worker output against checklist items from preflight.
 */

import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { QualityIterationError } from '../errors.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
  const { ChecklistGate } = await import('../../quality/gates/checklist.ts');
  const gate = new ChecklistGate();

  const preflight = context.qualityPreflight;
  if (!preflight) {
    log.warn('quality', 'Checklist gate skipped - no preflight data');
    log.activity('quality:checklist', agentId, 'SKIPPED: No preflight data');
    return;
  }

  const workerOutput = context.workerOutput;
  if (!workerOutput) {
    log.warn('quality', 'Checklist gate skipped - no worker output');
    log.activity('quality:checklist', agentId, 'SKIPPED: No worker output');
    return;
  }

  log.activity('quality:checklist', agentId, 'Running checklist evaluation');
  const result = await gate.evaluate(workerOutput, {}, preflight);

  log.info('quality', 'Checklist evaluation', {
    passed: result.passed,
    items: result.details?.items || [],
    total: result.details?.total,
    passedCount: result.details?.passed,
    failedCount: result.details?.failed,
  });

  // Build detailed activity output
  const items = (result.details?.items || []) as Array<{ item: string; passed: boolean; reason?: string }>;
  const failedItems = items.filter(i => !i.passed);
  let activityContent = `${result.passed ? 'PASS' : 'FAIL'}: ${result.details?.passed || 0}/${result.details?.total || 0} items`;
  if (failedItems.length > 0) {
    const failedNames = failedItems.slice(0, 3).map(i => i.item.slice(0, 40)).join(', ');
    const more = failedItems.length > 3 ? ` (+${failedItems.length - 3} more)` : '';
    activityContent += `\n   ❌ Failed: ${failedNames}${more}`;
  }
  log.activity('quality:checklist', agentId, activityContent);

  // Write result to sys-msgs for visibility
  utils.writeResultMessage(context, 'checklist', result.passed, activityContent, {
    total: result.details?.total,
    passed: result.details?.passed,
    failed: result.details?.failed,
  });

  if (!result.passed) {
    throw new QualityIterationError(result.feedback || 'Checklist failed');
  }
};

export const qualityChecklistHook: HookDefinition = {
  name: 'quality:checklist',
  phase: 'post',
  priority: 50, // Quality gates in logical order
  description: 'Validates worker output against preflight checklist items',
  handler,
};
