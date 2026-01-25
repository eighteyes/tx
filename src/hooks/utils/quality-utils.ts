/**
 * Quality Hook Utilities
 *
 * Parsing and heuristic functions for quality hooks.
 */

import { log } from '../../shared/logger.ts';
import type { GateType, PreflightOutput } from '../../quality/types.ts';
import type { QualityHookConfig } from '../types.ts';

/**
 * Parse hook name into base name and config
 * e.g., "quality:evaluate:onFail=loop,maxIterations=3" -> { baseName: "quality:evaluate", config: {...} }
 * e.g., "quality:checklist:onFail=loop,maxIterations=3" -> { baseName: "quality:checklist", config: {...} }
 */
export function parseHookName(hookName: string): { baseName: string; config?: QualityHookConfig } {
  // Check for parameterized quality hooks
  // Includes all individual gates: preflight, evaluate, checklist, rubric, adversarial, accuracy, summarizer, deterministic
  const qualityPrefixes = [
    'quality:preflight:',
    'quality:evaluate:',
    'quality:checklist:',
    'quality:rubric:',
    'quality:adversarial:',
    'quality:accuracy:',
    'quality:summarizer:',
    'quality:deterministic:',
  ];

  for (const prefix of qualityPrefixes) {
    if (hookName.startsWith(prefix)) {
      const baseName = prefix.slice(0, -1); // Remove trailing ':'
      const configStr = hookName.slice(prefix.length);
      const config = parseQualityConfig(configStr);
      return { baseName, config };
    }
  }

  return { baseName: hookName };
}

/**
 * Parse quality hook config string
 * e.g., "onFail=loop,maxIterations=3,gates=checklist+rubric"
 */
export function parseQualityConfig(configStr: string): QualityHookConfig {
  const config: QualityHookConfig = {};
  const parts = configStr.split(',');

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (!key || !value) continue;

    switch (key.trim()) {
      case 'onFail':
        if (value === 'loop' || value === 'halt') {
          config.onFail = value;
        }
        break;
      case 'maxIterations':
        config.maxIterations = parseInt(value, 10);
        break;
      case 'gates':
        config.gates = value.split('+') as GateType[];
        break;
    }
  }

  return config;
}

/**
 * Heuristic-based preflight fallback
 * Used when LLM preflight fails or times out
 */
export function runHeuristicPreflight(taskBody: string, gates: GateType[]): PreflightOutput {
  log.info('hooks', 'Running heuristic preflight analysis');

  const preflight: PreflightOutput = {
    taskType: detectTaskType(taskBody),
    checklist: generateChecklist(taskBody),
    rubric: generateRubric(taskBody),
    requiredGates: gates,
    suggestedGates: suggestGates(taskBody),
    effortLevel: estimateEffort(taskBody),
    estimatedToolCalls: estimateToolCalls(taskBody),
  };

  log.info('hooks', 'Heuristic preflight complete', {
    taskType: preflight.taskType,
    checklistItems: preflight.checklist.length,
    rubricItems: preflight.rubric.length,
  });

  return preflight;
}

/**
 * Detect task type from task body
 */
export function detectTaskType(taskBody: string): string {
  const lower = taskBody.toLowerCase();
  if (lower.includes('implement') || lower.includes('build') || lower.includes('create')) {
    return 'implementation';
  }
  if (lower.includes('fix') || lower.includes('bug') || lower.includes('error')) {
    return 'bug-fix';
  }
  if (lower.includes('refactor') || lower.includes('improve') || lower.includes('optimize')) {
    return 'refactoring';
  }
  if (lower.includes('test') || lower.includes('spec')) {
    return 'testing';
  }
  if (lower.includes('research') || lower.includes('investigate') || lower.includes('find')) {
    return 'research';
  }
  if (lower.includes('review') || lower.includes('check')) {
    return 'code-review';
  }
  return 'general';
}

/**
 * Generate checklist items from task body
 */
export function generateChecklist(taskBody: string): string[] {
  const items: string[] = [];
  const lower = taskBody.toLowerCase();

  if (lower.includes('implement') || lower.includes('build')) {
    items.push('Code compiles without errors');
    items.push('Implementation matches requirements');
    items.push('Edge cases are handled');
  }
  if (lower.includes('test')) {
    items.push('Tests pass successfully');
    items.push('Test coverage is adequate');
  }
  if (lower.includes('typescript') || lower.includes('type')) {
    items.push('Types are properly defined');
  }
  if (lower.includes('function') || lower.includes('method')) {
    items.push('Function/method documentation is complete');
  }

  if (items.length === 0) {
    items.push('Task requirements are addressed');
    items.push('Output is complete and correct');
  }

  return items;
}

/**
 * Generate rubric items from task body
 */
export function generateRubric(taskBody: string): Array<{ criterion: string; weight: number; description: string }> {
  const lower = taskBody.toLowerCase();
  const rubric: Array<{ criterion: string; weight: number; description: string }> = [];

  if (lower.includes('implement') || lower.includes('code')) {
    rubric.push({
      criterion: 'correctness',
      weight: 0.4,
      description: 'Code correctly implements the requirements',
    });
    rubric.push({
      criterion: 'quality',
      weight: 0.3,
      description: 'Code follows best practices and is maintainable',
    });
    rubric.push({
      criterion: 'completeness',
      weight: 0.3,
      description: 'All aspects of the task are addressed',
    });
  } else {
    rubric.push({
      criterion: 'accuracy',
      weight: 0.5,
      description: 'Output is accurate and correct',
    });
    rubric.push({
      criterion: 'completeness',
      weight: 0.5,
      description: 'All requirements are addressed',
    });
  }

  return rubric;
}

/**
 * Suggest additional gates based on task content
 */
export function suggestGates(taskBody: string): GateType[] {
  const gates: GateType[] = [];
  const lower = taskBody.toLowerCase();

  if (lower.includes('security') || lower.includes('auth') || lower.includes('password')) {
    gates.push('adversarial');
  }
  if (lower.includes('typescript') || lower.includes('test') || lower.includes('npm')) {
    gates.push('deterministic');
  }
  if (lower.includes('research') || lower.includes('source') || lower.includes('reference')) {
    gates.push('accuracy');
  }

  return gates;
}

/**
 * Estimate effort level for task
 */
export function estimateEffort(taskBody: string): 'light' | 'medium' | 'heavy' {
  const wordCount = taskBody.split(/\s+/).length;
  if (wordCount < 20) return 'light';
  if (wordCount < 100) return 'medium';
  return 'heavy';
}

/**
 * Estimate tool calls for task
 */
export function estimateToolCalls(taskBody: string): number {
  const lower = taskBody.toLowerCase();
  let estimate = 5;

  if (lower.includes('implement') || lower.includes('build')) estimate += 10;
  if (lower.includes('refactor')) estimate += 15;
  if (lower.includes('test')) estimate += 5;
  if (lower.includes('multiple') || lower.includes('several')) estimate += 10;

  return estimate;
}
