/**
 * Quality Preflight Pre-Hook
 *
 * Runs LLM-based preflight analysis to determine quality gates
 * before worker execution.
 */

import { log } from '../../shared/logger.ts';
import { createPreflightGate } from '../../quality/index.ts';
import type { GateType } from '../../quality/types.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';
import { runHeuristicPreflight } from '../utils/quality-utils.ts';

const handler = async (context: HookContext, _utils: HookUtils): Promise<void> => {
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
  const taskId = context.taskId || `${agentId}-${Date.now()}`;
  const taskBody = context.taskBody || '';

  log.info('hooks', 'Running quality preflight', { agentId, taskId });
  log.activity('quality:preflight', agentId, 'Starting preflight analysis');

  try {
    // Try LLM-based preflight
    const preflightGate = createPreflightGate();
    const preflight = await preflightGate.analyze(taskBody);

    // Apply gates from context config if provided
    const gates = (context.qualityGates as GateType[] | undefined) || ['checklist', 'rubric'];
    preflight.requiredGates = gates;

    // Store in context for quality:evaluate to use
    context.qualityPreflight = preflight;
    context.qualityIteration = context.qualityIteration || 1;
    context.qualityMaxIterations = context.qualityMaxIterations || 5;
    context.qualityOnFail = context.qualityOnFail || 'loop';

    log.info('hooks', 'Quality preflight complete', {
      agentId,
      taskId,
      taskType: preflight.taskType,
      checklistItems: preflight.checklist.length,
      rubricItems: preflight.rubric.length,
      requiredGates: preflight.requiredGates,
      suggestedGates: preflight.suggestedGates,
    });
    log.activity('quality:preflight', agentId, `Preflight COMPLETE: ${preflight.taskType}, gates=[${preflight.requiredGates.join(',')}]`);
  } catch (error) {
    log.warn('hooks', 'LLM preflight failed, falling back to heuristics', {
      agentId,
      taskId,
      error: (error as Error).message,
    });
    log.activity('quality:preflight', agentId, `Preflight fallback to heuristics: ${(error as Error).message}`);

    // Fallback to heuristic preflight
    const preflight = runHeuristicPreflight(
      taskBody,
      (context.qualityGates as GateType[] | undefined) || ['checklist', 'rubric']
    );
    context.qualityPreflight = preflight;
    context.qualityIteration = context.qualityIteration || 1;
    context.qualityMaxIterations = context.qualityMaxIterations || 5;
    context.qualityOnFail = context.qualityOnFail || 'loop';
    log.activity('quality:preflight', agentId, `Preflight COMPLETE (heuristic): ${preflight.taskType}, gates=[${preflight.requiredGates.join(',')}]`);
  }
};

export const qualityPreflightHook: HookDefinition = {
  name: 'quality:preflight',
  phase: 'pre',
  priority: 50, // After worktree setup
  description: 'Runs LLM-based preflight analysis to determine quality gates',
  handler,
};
