/**
 * Pre-Hooks Index
 *
 * Exports all pre-hooks and registration function.
 */

import type { HookRegistry } from '../registry.ts';
import { worktreeCreateHook } from './worktree-create.ts';
import { qualityPreflightHook } from './quality-preflight.ts';
import { discoveryCodeHook } from './discovery-code.ts';

export { worktreeCreateHook } from './worktree-create.ts';
export { qualityPreflightHook } from './quality-preflight.ts';
export { discoveryCodeHook } from './discovery-code.ts';

/**
 * All pre-hook definitions
 */
export const preHooks = [
  worktreeCreateHook,
  qualityPreflightHook,
  discoveryCodeHook,
];

/**
 * Register all pre-hooks with a registry
 */
export function registerPreHooks(registry: HookRegistry): void {
  for (const hook of preHooks) {
    registry.register(hook);
  }
}
