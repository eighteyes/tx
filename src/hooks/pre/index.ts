/**
 * Pre-Hooks Index
 *
 * Exports all pre-hooks and registration function.
 */

import type { HookRegistry } from '../registry.ts';
import { worktreeCreateHook } from './worktree-create.ts';
import { qualityPreflightHook } from './quality-preflight.ts';
import { statusInjectionHook } from './status-injection.ts';

export { worktreeCreateHook } from './worktree-create.ts';
export { qualityPreflightHook } from './quality-preflight.ts';
export { statusInjectionHook } from './status-injection.ts';

/**
 * All pre-hook definitions
 */
export const preHooks = [
  statusInjectionHook,  // Priority 10: Inject state early
  worktreeCreateHook,   // Priority 40: Create worktree
  qualityPreflightHook, // Priority 50: Quality analysis
];

/**
 * Register all pre-hooks with a registry
 */
export function registerPreHooks(registry: HookRegistry): void {
  for (const hook of preHooks) {
    registry.register(hook);
  }
}
