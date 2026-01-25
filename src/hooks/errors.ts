/**
 * Hook System Errors
 *
 * Quality error classes for hook execution and quality gates.
 * These errors are caught by the dispatcher for special handling.
 */

/**
 * Thrown when a quality check fails and iteration is needed
 * The dispatcher will re-spawn the worker with feedback
 */
export class QualityIterationError extends Error {
  constructor(public feedback: string) {
    super('Quality iteration required');
    this.name = 'QualityIterationError';
  }
}

/**
 * Thrown when a quality check fails and should halt immediately
 * No retry - the task fails
 */
export class QualityHaltError extends Error {
  constructor(public feedback: string) {
    super('Quality check halted');
    this.name = 'QualityHaltError';
  }
}

/**
 * Thrown when max quality iterations have been exhausted
 * The task has failed after all retry attempts
 */
export class QualityExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QualityExhaustedError';
  }
}

/**
 * Thrown when a hook is not found in the registry
 */
export class HookNotFoundError extends Error {
  constructor(hookName: string, phase: 'pre' | 'post') {
    super(`Hook not found: ${hookName} (${phase})`);
    this.name = 'HookNotFoundError';
  }
}

/**
 * Thrown when a pre-hook fails (prevents worker spawn)
 */
export class PreHookFailedError extends Error {
  constructor(hookName: string, cause: Error) {
    super(`Pre-hook "${hookName}" failed: ${cause.message}`);
    this.name = 'PreHookFailedError';
    this.cause = cause;
  }
}

/**
 * Check if an error is a quality error that should be propagated
 */
export function isQualityError(error: unknown): error is QualityIterationError | QualityHaltError | QualityExhaustedError {
  return (
    error instanceof QualityIterationError ||
    error instanceof QualityHaltError ||
    error instanceof QualityExhaustedError
  );
}
