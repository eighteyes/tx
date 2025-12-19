/**
 * LifecycleHooks - Extensible hook system for mesh lifecycle events
 *
 * Provides pre/post hooks that can be registered and executed at key points
 * in the mesh execution lifecycle. Enables worktree management, notifications,
 * and future extensibility for custom helper agents.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';
import { WorktreeManager } from '../core/worktree.ts';
import { SdkRunner, type SdkRunnerConfig } from './sdk-runner.ts';
import type { MessageQueue } from '../queue/index.ts';

export interface HookContext {
  meshInstance: string;
  meshName: string;
  agentName: string;
  workDir: string;
  worktreePath?: string;   // Set by worktree:create hook
  worktreeBranch?: string; // Set by worktree:create hook
  [key: string]: unknown;  // Allow additional context fields
}

export type HookHandler = (context: HookContext) => Promise<void> | void;

export interface HookMetadata {
  name: string;
  description?: string;
  phase: 'pre' | 'post';
}

export class LifecycleHooks {
  private preHooks: Map<string, HookHandler> = new Map();
  private postHooks: Map<string, HookHandler> = new Map();
  private worktreeManager: WorktreeManager;
  private workDir: string;
  private meshesDir: string;
  private queue: MessageQueue;

  constructor(workDir: string, queue: MessageQueue, meshesDir?: string) {
    this.workDir = workDir;
    this.queue = queue;
    this.meshesDir = meshesDir || path.join(workDir, 'meshes');
    this.worktreeManager = new WorktreeManager(workDir);
    this.registerBuiltinHooks();
  }

  /**
   * Register built-in hooks (v1: switch statement approach)
   */
  private registerBuiltinHooks(): void {
    // Pre-hooks
    this.addPreHook('worktree:create', async (context) => {
      log.info('hooks', 'Creating worktree', { meshInstance: context.meshInstance });
      const worktreePath = this.worktreeManager.createWorktree(context.meshInstance);
      context.worktreePath = worktreePath;

      // Get branch name from worktree info
      const worktrees = this.worktreeManager.listWorktrees();
      const worktreeInfo = worktrees.find(w => w.path === worktreePath);
      if (worktreeInfo) {
        context.worktreeBranch = worktreeInfo.branch;
      }

      log.info('hooks', 'Worktree created', {
        path: worktreePath,
        branch: context.worktreeBranch,
      });
    });

    // Post-hooks
    this.addPostHook('worktree:cleanup', async (context) => {
      if (!context.worktreePath) {
        log.warn('hooks', 'No worktree to cleanup', { meshInstance: context.meshInstance });
        return;
      }

      log.info('hooks', 'Cleaning up worktree', {
        meshInstance: context.meshInstance,
        path: context.worktreePath,
      });

      try {
        this.worktreeManager.removeWorktree(context.meshInstance, true);
        log.info('hooks', 'Worktree cleaned up', { meshInstance: context.meshInstance });
      } catch (error) {
        log.error('hooks', 'Failed to cleanup worktree', {
          meshInstance: context.meshInstance,
          error: (error as Error).message,
        });
      }
    });

    // Commit agent hook - spawns haiku agent to create commit
    this.addPostHook('commit:auto', async (context) => {
      const commitWorkDir = context.worktreePath || this.workDir;

      log.info('hooks', 'Spawning commit agent', {
        meshInstance: context.meshInstance,
        workDir: commitWorkDir,
      });

      // Find commit-agent prompt
      const promptPath = path.join(this.meshesDir, 'system', 'commit-agent', 'prompt.md');
      if (!fs.existsSync(promptPath)) {
        log.error('hooks', 'Commit agent prompt not found', { path: promptPath });
        return;
      }

      const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

      const runnerConfig: SdkRunnerConfig = {
        id: `commit-agent-${context.meshInstance}`,
        model: 'haiku',
        systemPrompt,
        workDir: commitWorkDir,
        msgsDir: path.join(this.workDir, '.ai', 'tx', 'msgs'),
      };

      try {
        const runner = new SdkRunner(runnerConfig, this.queue);
        const result = await runner.run('Create a commit for the current changes.');

        // Parse result for commit info
        if (result.output) {
          const commitMatch = result.output.match(/COMMIT:\s*(\S+)\s+(.+)/);
          const nothingMatch = result.output.match(/NOTHING_TO_COMMIT/);
          const blockedMatch = result.output.match(/BLOCKED:\s*(.+)/);

          if (commitMatch) {
            log.info('hooks', 'Commit created', {
              sha: commitMatch[1],
              message: commitMatch[2],
              meshInstance: context.meshInstance,
            });
          } else if (nothingMatch) {
            log.info('hooks', 'Nothing to commit', { meshInstance: context.meshInstance });
          } else if (blockedMatch) {
            log.warn('hooks', 'Commit blocked', {
              reason: blockedMatch[1],
              meshInstance: context.meshInstance,
            });
          }
        }
      } catch (error) {
        log.error('hooks', 'Commit agent failed', {
          meshInstance: context.meshInstance,
          error: (error as Error).message,
        });
      }
    });
  }

  /**
   * Add a pre-hook handler
   * Pre-hooks run before the mesh worker starts
   * @param name Hook name (e.g., "worktree:create")
   * @param handler Hook handler function
   */
  addPreHook(name: string, handler: HookHandler): void {
    if (this.preHooks.has(name)) {
      log.warn('hooks', `Pre-hook "${name}" already registered, overwriting`);
    }
    this.preHooks.set(name, handler);
    log.debug('hooks', `Registered pre-hook: ${name}`);
  }

  /**
   * Add a post-hook handler
   * Post-hooks run after the mesh worker completes
   * @param name Hook name (e.g., "worktree:cleanup", "commit:auto")
   * @param handler Hook handler function
   */
  addPostHook(name: string, handler: HookHandler): void {
    if (this.postHooks.has(name)) {
      log.warn('hooks', `Post-hook "${name}" already registered, overwriting`);
    }
    this.postHooks.set(name, handler);
    log.debug('hooks', `Registered post-hook: ${name}`);
  }

  /**
   * Execute a list of hooks sequentially
   * @param hookNames Array of hook names to execute
   * @param context Hook execution context
   * @param phase Hook phase ('pre' or 'post')
   */
  async executeHooks(
    hookNames: string[],
    context: HookContext,
    phase: 'pre' | 'post'
  ): Promise<void> {
    const hooks = phase === 'pre' ? this.preHooks : this.postHooks;

    for (const hookName of hookNames) {
      const handler = hooks.get(hookName);

      if (!handler) {
        log.warn('hooks', `Unknown ${phase}-hook: ${hookName}`, {
          meshInstance: context.meshInstance,
        });
        continue;
      }

      try {
        log.debug('hooks', `Executing ${phase}-hook: ${hookName}`, {
          meshInstance: context.meshInstance,
        });

        await handler(context);

        log.debug('hooks', `Completed ${phase}-hook: ${hookName}`, {
          meshInstance: context.meshInstance,
        });
      } catch (error) {
        const errorMsg = (error as Error).message;
        log.error('hooks', `Failed to execute ${phase}-hook: ${hookName}`, {
          meshInstance: context.meshInstance,
          error: errorMsg,
        });

        // For pre-hooks, propagate error to prevent worker spawn
        // For post-hooks, log but continue (don't kill worker retroactively)
        if (phase === 'pre') {
          throw new Error(`Pre-hook "${hookName}" failed: ${errorMsg}`);
        }
      }
    }
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
    return Array.from(this.preHooks.keys());
  }

  /**
   * Get list of registered post-hooks
   */
  listPostHooks(): string[] {
    return Array.from(this.postHooks.keys());
  }

  /**
   * Check if a pre-hook is registered
   */
  hasPreHook(name: string): boolean {
    return this.preHooks.has(name);
  }

  /**
   * Check if a post-hook is registered
   */
  hasPostHook(name: string): boolean {
    return this.postHooks.has(name);
  }

  /**
   * Get the worktree manager instance
   * Useful for direct worktree operations
   */
  getWorktreeManager(): WorktreeManager {
    return this.worktreeManager;
  }
}
