/**
 * lifecycle-utils.ts - Shared lifecycle resolution for dispatcher and headless-runner
 *
 * Responsibilities:
 * - Resolve lifecycle hooks from mesh config shorthands
 * - Handle worktree: true, graded: true, and explicit lifecycle
 * - Single source of truth for lifecycle expansion logic
 */

import { type GateType, type GradedConfig } from '../quality/types.ts';

/**
 * Mesh config fields relevant to lifecycle resolution
 */
export interface LifecycleResolvableConfig {
  lifecycle?: {
    pre?: string[];
    post?: string[];
  };
  graded?: GradedConfig;
  worktree?: boolean;
  iteration?: {
    onFail?: 'stop' | 'retry';
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
 * Supports multiple shorthands that expand to lifecycle hooks:
 * - worktree: true → worktree:create + commit:auto (cleanup via /know:done)
 * - graded: true → quality:preflight + individual quality gates
 * - graded: ['checklist', 'rubric'] → quality:preflight + specific gates
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

  // graded: true/array shorthand → individual quality gate hooks
  if (config.graded) {
    pre.push('quality:preflight');

    // Determine which gates to use
    const gates: GateType[] = Array.isArray(config.graded) ? config.graded : [
      'checklist',
      'rubric',
      'adversarial',
      'accuracy',
      'summarizer',
      'deterministic',
    ];

    // Add each gate as an individual hook
    for (const gate of gates) {
      let hookName = `quality:${gate}`;

      // Only add iteration config to gates that can fail (not summarizer)
      if (gate !== 'summarizer') {
        const configParts: string[] = [];
        if (config.iteration?.onFail) {
          configParts.push(`onFail=${config.iteration.onFail}`);
        }
        if (config.iteration?.maxIterations) {
          configParts.push(`maxIterations=${config.iteration.maxIterations}`);
        }

        if (configParts.length > 0) {
          hookName += ':' + configParts.join(',');
        }
      }

      post.push(hookName);
    }
  }

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
