/**
 * Hook Utilities Index
 *
 * Exports all utility functions and classes for hooks.
 */

export { HookUtilsImpl, createHookUtils } from './hook-utils.ts';
export { extractRearmatter } from './rearmatter.ts';
export {
  writeQualityResultMessage,
  writeSystemFeedbackMessage,
  writeFeedbackMessage,
} from './messages.ts';
export {
  parseHookName,
  parseQualityConfig,
  runHeuristicPreflight,
  detectTaskType,
  generateChecklist,
  generateRubric,
  suggestGates,
  estimateEffort,
  estimateToolCalls,
} from './quality-utils.ts';
