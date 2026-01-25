/**
 * LifecycleHooks - Re-export shim for backward compatibility
 *
 * @deprecated Import from '../hooks/index.ts' instead
 *
 * This file re-exports the new modular hook system for backward compatibility.
 * The original 1524-line implementation has been refactored into src/hooks/.
 *
 * Migration path:
 * - OLD: import { LifecycleHooks, QualityIterationError } from './hooks.ts';
 * - NEW: import { LifecycleHooks, QualityIterationError } from '../hooks/index.ts';
 */

// Re-export main class
export { LifecycleHooks } from '../hooks/lifecycle-hooks.ts';

// Re-export error classes
export {
  QualityIterationError,
  QualityHaltError,
  QualityExhaustedError,
} from '../hooks/errors.ts';

// Re-export types for backward compatibility
export type {
  HookContext,
  QualityHookConfig,
  LegacyHookHandler as HookHandler,
  HookMetadata,
} from '../hooks/types.ts';
