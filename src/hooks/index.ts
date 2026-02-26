/**
 * Hooks System - Public API
 *
 * Modular hook system for mesh lifecycle events.
 * Provides pre/post hooks with priority-based execution, dependency injection,
 * and async initialization support.
 */

// Main classes
export { LifecycleHooks } from './lifecycle-hooks.ts';
export { HookRegistry, hookRegistry } from './registry.ts';

// Types
export type {
  HookContext,
  HookUtils,
  HookHandler,
  LegacyHookHandler,
  HookDefinition,
  HookMetadata,
  QualityHookConfig,
  GateType,
  PreflightOutput,
  RearmatterData,
} from './types.ts';

// Errors
export {
  QualityIterationError,
  QualityHaltError,
  QualityExhaustedError,
  HookNotFoundError,
  PreHookFailedError,
  isQualityError,
} from './errors.ts';

// Utils
export { createHookUtils, HookUtilsImpl } from './utils/hook-utils.ts';
export { extractRearmatter } from './utils/rearmatter.ts';
export {
  writeQualityResultMessage,
  writeSystemFeedbackMessage,
  writeFeedbackMessage,
} from './utils/messages.ts';
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
} from './utils/quality-utils.ts';

// Pre-hooks
export { registerPreHooks, preHooks } from './pre/index.ts';
export { worktreeCreateHook } from './pre/worktree-create.ts';
export { qualityPreflightHook } from './pre/quality-preflight.ts';
export { discoveryCodeHook } from './pre/discovery-code.ts';

// Post-hooks
export { registerPostHooks, postHooks } from './post/index.ts';
export { worktreeCleanupHook } from './post/worktree-cleanup.ts';
export { qualityEvaluateHook } from './post/quality-evaluate.ts';
export { qualityChecklistHook } from './post/quality-checklist.ts';
export { qualityRubricHook } from './post/quality-rubric.ts';
export { qualityAdversarialHook } from './post/quality-adversarial.ts';
export { qualityAccuracyHook } from './post/quality-accuracy.ts';
export { qualitySummarizerHook } from './post/quality-summarizer.ts';
export { qualityAiLinterHook } from './post/ai-linter/index.ts';
export { qualityDeterministicHook } from './post/quality-deterministic.ts';
export { commitAutoHook } from './post/commit-auto.ts';
export { brainUpdateHook } from './post/brain-update.ts';
export { validationCodeHook } from './post/validation-code.ts';
