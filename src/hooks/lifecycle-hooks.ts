/**
 * LifecycleHooks - Backward Compatible Hook System
 *
 * Provides the same API as the original LifecycleHooks class from src/worker/hooks.ts
 * but uses the new modular hook registry under the hood.
 */

import path from 'node:path';
import { log } from '../shared/logger.ts';
import { WorktreeManager } from '../core/worktree.ts';
import type { MessageQueue } from '../queue/index.ts';
import type {
  HookContext,
  HookUtils,
  LegacyHookHandler,
  QualityHookConfig,
} from './types.ts';
import { HookRegistry } from './registry.ts';
import { createHookUtils } from './utils/hook-utils.ts';
import { registerPreHooks } from './pre/index.ts';
import { registerPostHooks } from './post/index.ts';
import {
  writeSystemFeedbackMessage,
  writeQualityResultMessage,
} from './utils/messages.ts';

/**
 * LifecycleHooks - Extensible hook system for mesh lifecycle events
 *
 * Provides pre/post hooks that can be registered and executed at key points
 * in the mesh execution lifecycle. Enables worktree management, notifications,
 * quality gates, and future extensibility for custom helper agents.
 */
export class LifecycleHooks {
  private registry: HookRegistry;
  private worktreeManager: WorktreeManager;
  private workDir: string;
  private meshesDir: string;
  private queue: MessageQueue;
  private hookUtils: HookUtils;

  constructor(workDir: string, queue: MessageQueue, meshesDir?: string) {
    this.workDir = workDir;
    this.queue = queue;
    this.meshesDir = meshesDir || path.join(workDir, 'meshes');
    this.worktreeManager = new WorktreeManager(workDir);

    // Create hook utils for dependency injection
    this.hookUtils = createHookUtils(queue, this.worktreeManager, workDir, this.meshesDir);

    // Create registry and register built-in hooks
    this.registry = new HookRegistry();
    registerPreHooks(this.registry);
    registerPostHooks(this.registry);
  }

  /**
   * Add a pre-hook handler
   * Pre-hooks run before the mesh worker starts
   * @param name Hook name (e.g., "worktree:create")
   * @param handler Hook handler function
   */
  addPreHook(name: string, handler: LegacyHookHandler): void {
    if (this.registry.has(name, 'pre')) {
      log.warn('hooks', `Pre-hook "${name}" already registered, overwriting`);
    }
    this.registry.registerLegacy(name, 'pre', handler);
    log.debug('hooks', `Registered pre-hook: ${name}`);
  }

  /**
   * Add a post-hook handler
   * Post-hooks run after the mesh worker completes
   * @param name Hook name (e.g., "worktree:cleanup", "commit:auto")
   * @param handler Hook handler function
   */
  addPostHook(name: string, handler: LegacyHookHandler): void {
    if (this.registry.has(name, 'post')) {
      log.warn('hooks', `Post-hook "${name}" already registered, overwriting`);
    }
    this.registry.registerLegacy(name, 'post', handler);
    log.debug('hooks', `Registered post-hook: ${name}`);
  }

  /**
   * Execute a list of hooks sequentially
   * Supports parameterized hooks like "quality:preflight:gates=checklist,rubric"
   * @param hookNames Array of hook names to execute
   * @param context Hook execution context
   * @param phase Hook phase ('pre' or 'post')
   */
  async executeHooks(
    hookNames: string[],
    context: HookContext,
    phase: 'pre' | 'post'
  ): Promise<void> {
    await this.registry.executeHooks(hookNames, context, phase, this.hookUtils);
  }

  /**
   * Execute pre-hooks
   * Throws error if any pre-hook fails
   */
  async executePreHooks(hookNames: string[], context: HookContext): Promise<void> {
    return this.executeHooks(hookNames, context, 'pre');
  }

  /**
   * Execute post-hooks
   * Logs errors but doesn't throw (post-hooks are best-effort)
   */
  async executePostHooks(hookNames: string[], context: HookContext): Promise<void> {
    return this.executeHooks(hookNames, context, 'post');
  }

  /**
   * Get list of registered pre-hooks
   */
  listPreHooks(): string[] {
    return this.registry.listNames('pre');
  }

  /**
   * Get list of registered post-hooks
   */
  listPostHooks(): string[] {
    return this.registry.listNames('post');
  }

  /**
   * Check if a pre-hook is registered
   */
  hasPreHook(name: string): boolean {
    return this.registry.has(name, 'pre');
  }

  /**
   * Check if a post-hook is registered
   */
  hasPostHook(name: string): boolean {
    return this.registry.has(name, 'post');
  }

  /**
   * Get the worktree manager instance
   * Useful for direct worktree operations
   */
  getWorktreeManager(): WorktreeManager {
    return this.worktreeManager;
  }

  /**
   * Get the underlying hook registry
   * For advanced use cases that need direct registry access
   */
  getRegistry(): HookRegistry {
    return this.registry;
  }

  /**
   * Get the hook utils
   * For advanced use cases that need direct utils access
   */
  getHookUtils(): HookUtils {
    return this.hookUtils;
  }

  // =============================================================================
  // Legacy Compatibility Methods
  // =============================================================================

  /**
   * Write feedback message to sys-msgs for audit trail (NOT routed to consumer)
   * This is used for quality iteration resume where we don't want the file watcher
   * to pick up the message - instead we resume the session directly.
   */
  async writeSystemFeedbackMessage(
    context: HookContext,
    agentId: string,
    taskId: string,
    feedback: string,
    iteration: number
  ): Promise<string> {
    return writeSystemFeedbackMessage(context, agentId, taskId, feedback, iteration);
  }

  /**
   * Write quality gate result to sys-msgs for audit/visibility
   * Called on both PASS and FAIL for all quality gates
   * @deprecated Use hookUtils.writeResultMessage directly
   */
  writeQualityResultMessage(
    context: HookContext,
    gate: string,
    passed: boolean,
    summary: string,
    details?: Record<string, unknown>
  ): void {
    writeQualityResultMessage(context, gate, passed, summary, details);
  }
}

// Re-export types for convenience
export type { HookContext, HookUtils, QualityHookConfig, LegacyHookHandler } from './types.ts';
