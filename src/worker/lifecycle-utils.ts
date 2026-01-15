/**
 * lifecycle-utils.ts - Shared lifecycle resolution for dispatcher and headless-runner
 *
 * Responsibilities:
 * - Resolve lifecycle hooks from mesh config shorthands
 * - Handle worktree: true and explicit lifecycle
 * - Single source of truth for lifecycle expansion logic
 */

/**
 * Mesh config fields relevant to lifecycle resolution
 */
export interface LifecycleResolvableConfig {
  lifecycle?: {
    pre?: string[];
    post?: string[];
  };
  worktree?: boolean;
  iteration?: {
    onFail?: 'stop' | 'retry' | 'loop' | 'halt';
    maxIterations?: number;
  };
}

/**
 * Resolved lifecycle hooks
 */
export interface ResolvedLifecycle {
  pre: string[];
  post: string[];
}

/**
 * Resolve lifecycle hooks from config
 * Supports shorthands that expand to lifecycle hooks:
 * - worktree: true → worktree:create + commit:auto (cleanup via /know:done)
 * Explicit lifecycle overrides all shorthands
 */
export function resolveLifecycle(config: LifecycleResolvableConfig): ResolvedLifecycle | undefined {
  // Explicit lifecycle takes precedence
  if (config.lifecycle) {
    return {
      pre: config.lifecycle.pre || [],
      post: config.lifecycle.post || [],
    };
  }

  // Build lifecycle from shorthands
  const pre: string[] = [];
  const post: string[] = [];

  // worktree: true shorthand
  // NOTE: worktree:cleanup is NOT automatic - user runs /know:done to merge and cleanup
  if (config.worktree) {
    pre.unshift('worktree:create');  // worktree first
    post.push('commit:auto');        // commit changes, but KEEP worktree for review
  }

  // Only return if we have any hooks
  if (pre.length > 0 || post.length > 0) {
    return { pre, post };
  }

  return undefined;
}
