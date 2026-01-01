/**
 * LifecycleHooks - Extensible hook system for mesh lifecycle events
 *
 * Provides pre/post hooks that can be registered and executed at key points
 * in the mesh execution lifecycle. Enables worktree management, notifications,
 * quality gates, and future extensibility for custom helper agents.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';
import { WorktreeManager } from '../core/worktree.ts';
import { SdkRunner, type SdkRunnerConfig } from './sdk-runner.ts';
import type { MessageQueue } from '../queue/index.ts';
import {
  createStackFromConfig,
  createPreflightGate,
  type GradedConfig,
  type GateType,
  type PreflightOutput,
  type StackResult,
  type RearmatterData,
} from '../quality/index.ts';

/**
 * Quality hook configuration parsed from hook string
 * e.g., "quality:evaluate:onFail=loop,maxIterations=3"
 */
export interface QualityHookConfig {
  gates?: GateType[];
  onFail?: 'loop' | 'halt';
  maxIterations?: number;
}

/**
 * Custom error types for quality hook failures
 */
export class QualityIterationError extends Error {
  constructor(public feedback: string) {
    super('Quality iteration required');
    this.name = 'QualityIterationError';
  }
}

export class QualityHaltError extends Error {
  constructor(public feedback: string) {
    super('Quality check halted');
    this.name = 'QualityHaltError';
  }
}

export class QualityExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QualityExhaustedError';
  }
}

export interface HookContext {
  meshInstance: string;
  meshName: string;
  agentName: string;
  workDir: string;
  worktreePath?: string;   // Set by worktree:create hook
  worktreeBranch?: string; // Set by worktree:create hook

  // Quality context (set by quality:preflight, used by quality:evaluate)
  qualityPreflight?: PreflightOutput;
  qualityIteration?: number;
  qualityMaxIterations?: number;
  qualityOnFail?: 'loop' | 'halt';

  // Task context
  agentId?: string;
  taskId?: string;
  taskBody?: string;

  // Worker output (set before post-hooks)
  workerOutput?: string;

  // Session ID for resume (captured from worker completion)
  sessionId?: string;

  // Message directory for feedback messages
  msgsDir?: string;

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

    // Quality preflight hook - runs before worker spawn
    this.addPreHook('quality:preflight', async (context) => {
      await this.executeQualityPreflightHook(context);
    });

    // Quality evaluate hook - runs after worker completion (backward compatibility)
    this.addPostHook('quality:evaluate', async (context) => {
      await this.executeQualityEvaluateHook(context);
    });

    // Individual quality gate hooks
    this.addPostHook('quality:checklist', async (context) => {
      await this.executeChecklistHook(context);
    });

    this.addPostHook('quality:rubric', async (context) => {
      await this.executeRubricHook(context);
    });

    this.addPostHook('quality:adversarial', async (context) => {
      await this.executeAdversarialHook(context);
    });

    this.addPostHook('quality:accuracy', async (context) => {
      await this.executeAccuracyHook(context);
    });

    this.addPostHook('quality:summarizer', async (context) => {
      await this.executeSummarizerHook(context);
    });

    this.addPostHook('quality:deterministic', async (context) => {
      await this.executeDeterministicHook(context);
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
        // Insert task message for the commit agent to process
        const commitAgentId = `commit-agent-${context.meshInstance}`;
        this.queue.insert({
          from_agent: 'hooks/commit',
          to_agent: commitAgentId,
          type: 'task',
          payload: {
            'msg-id': `commit-task-${Date.now()}`,
            headline: 'Create commit for current changes',
            body: 'Review the current git status and create an appropriate commit for any changes.',
          },
        });

        const runner = new SdkRunner(runnerConfig, this.queue);
        const result = await runner.run();

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
    log.info('hooks', `Starting ${phase}-hook execution`, {
      hookNames,
      meshInstance: context.meshInstance,
      agentId: context.agentId,
    });

    const hooks = phase === 'pre' ? this.preHooks : this.postHooks;

    for (const hookName of hookNames) {
      // Parse parameterized hooks: "quality:preflight:gates=checklist,rubric"
      const { baseName, config } = this.parseHookName(hookName);

      // Apply config to context for quality hooks
      if (baseName.startsWith('quality:') && config) {
        if (config.gates) {
          context.qualityGates = config.gates;
        }
        if (config.onFail) {
          context.qualityOnFail = config.onFail;
        }
        if (config.maxIterations) {
          context.qualityMaxIterations = config.maxIterations;
        }
      }

      const handler = hooks.get(baseName);

      if (!handler) {
        log.warn('hooks', `Unknown ${phase}-hook: ${baseName}`, {
          meshInstance: context.meshInstance,
        });
        continue;
      }

      try {
        log.debug('hooks', `Executing ${phase}-hook: ${baseName}`, {
          meshInstance: context.meshInstance,
          config,
        });

        await handler(context);

        log.debug('hooks', `Completed ${phase}-hook: ${baseName}`, {
          meshInstance: context.meshInstance,
        });
      } catch (error) {
        // Propagate quality iteration errors for the dispatcher to handle
        if (error instanceof QualityIterationError ||
            error instanceof QualityHaltError ||
            error instanceof QualityExhaustedError) {
          throw error;
        }

        const errorMsg = (error as Error).message;
        log.error('hooks', `Failed to execute ${phase}-hook: ${baseName}`, {
          meshInstance: context.meshInstance,
          error: errorMsg,
        });

        // For pre-hooks, propagate error to prevent worker spawn
        // For post-hooks, log but continue (don't kill worker retroactively)
        if (phase === 'pre') {
          throw new Error(`Pre-hook "${baseName}" failed: ${errorMsg}`);
        }
      }
    }
  }

  /**
   * Parse hook name into base name and config
   * e.g., "quality:evaluate:onFail=loop,maxIterations=3" -> { baseName: "quality:evaluate", config: {...} }
   * e.g., "quality:checklist:onFail=loop,maxIterations=3" -> { baseName: "quality:checklist", config: {...} }
   */
  private parseHookName(hookName: string): { baseName: string; config?: QualityHookConfig } {
    // Check for parameterized quality hooks
    // Includes all individual gates: preflight, evaluate, checklist, rubric, adversarial, accuracy, summarizer, deterministic
    const qualityPrefixes = [
      'quality:preflight:',
      'quality:evaluate:',
      'quality:checklist:',
      'quality:rubric:',
      'quality:adversarial:',
      'quality:accuracy:',
      'quality:summarizer:',
      'quality:deterministic:',
    ];
    for (const prefix of qualityPrefixes) {
      if (hookName.startsWith(prefix)) {
        const baseName = prefix.slice(0, -1); // Remove trailing ':'
        const configStr = hookName.slice(prefix.length);
        const config = this.parseQualityConfig(configStr);
        return { baseName, config };
      }
    }

    return { baseName: hookName };
  }

  /**
   * Parse quality hook config string
   * e.g., "onFail=loop,maxIterations=3,gates=checklist,rubric"
   */
  private parseQualityConfig(configStr: string): QualityHookConfig {
    const config: QualityHookConfig = {};
    const parts = configStr.split(',');

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (!key || !value) continue;

      switch (key.trim()) {
        case 'onFail':
          if (value === 'loop' || value === 'halt') {
            config.onFail = value;
          }
          break;
        case 'maxIterations':
          config.maxIterations = parseInt(value, 10);
          break;
        case 'gates':
          config.gates = value.split('+') as GateType[];
          break;
      }
    }

    return config;
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

  // =============================================================================
  // Quality Hook Implementation
  // =============================================================================

  /**
   * Execute quality:preflight hook
   * Runs LLM-based preflight analysis to determine quality gates
   */
  private async executeQualityPreflightHook(context: HookContext): Promise<void> {
    const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
    const taskId = context.taskId || `${agentId}-${Date.now()}`;
    const taskBody = context.taskBody || '';

    log.info('hooks', 'Running quality preflight', { agentId, taskId });
    log.activity('quality:preflight', agentId, 'Starting preflight analysis');

    try {
      // Try LLM-based preflight
      const preflightGate = createPreflightGate();
      const preflight = await preflightGate.analyze(taskBody);

      // Apply gates from context config if provided
      const gates = (context.qualityGates as GateType[] | undefined) || ['checklist', 'rubric'];
      preflight.requiredGates = gates;

      // Store in context for quality:evaluate to use
      context.qualityPreflight = preflight;
      context.qualityIteration = context.qualityIteration || 1;
      context.qualityMaxIterations = context.qualityMaxIterations || 5;
      context.qualityOnFail = context.qualityOnFail || 'loop';

      log.info('hooks', 'Quality preflight complete', {
        agentId,
        taskId,
        taskType: preflight.taskType,
        checklistItems: preflight.checklist.length,
        rubricItems: preflight.rubric.length,
        requiredGates: preflight.requiredGates,
        suggestedGates: preflight.suggestedGates,
      });
      log.activity('quality:preflight', agentId, `Preflight COMPLETE: ${preflight.taskType}, gates=[${preflight.requiredGates.join(',')}]`);
    } catch (error) {
      log.warn('hooks', 'LLM preflight failed, falling back to heuristics', {
        agentId,
        taskId,
        error: (error as Error).message,
      });
      log.activity('quality:preflight', agentId, `Preflight fallback to heuristics: ${(error as Error).message}`);

      // Fallback to heuristic preflight
      const preflight = this.runHeuristicPreflight(
        taskBody,
        (context.qualityGates as GateType[] | undefined) || ['checklist', 'rubric']
      );
      context.qualityPreflight = preflight;
      context.qualityIteration = context.qualityIteration || 1;
      context.qualityMaxIterations = context.qualityMaxIterations || 5;
      context.qualityOnFail = context.qualityOnFail || 'loop';
      log.activity('quality:preflight', agentId, `Preflight COMPLETE (heuristic): ${preflight.taskType}, gates=[${preflight.requiredGates.join(',')}]`);
    }
  }

  /**
   * Execute quality:evaluate hook
   * Runs quality stack on worker output
   */
  private async executeQualityEvaluateHook(context: HookContext): Promise<void> {
    const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
    const taskId = context.taskId || `${agentId}-${Date.now()}`;

    // Get preflight from context (set by quality:preflight)
    const preflight = context.qualityPreflight;
    if (!preflight) {
      log.warn('hooks', 'No preflight found, skipping quality evaluation', { agentId });
      return;
    }

    // Get worker output from context
    const workerOutput = context.workerOutput;
    if (!workerOutput) {
      log.warn('hooks', 'No worker output found, skipping quality evaluation', { agentId });
      return;
    }

    const iteration = context.qualityIteration || 1;
    const maxIterations = context.qualityMaxIterations || 5;
    const onFail = context.qualityOnFail || 'loop';

    log.info('hooks', 'Running quality evaluation', {
      agentId,
      taskId,
      iteration,
      gates: [...preflight.requiredGates, ...preflight.suggestedGates],
    });
    const allGates = [...preflight.requiredGates, ...preflight.suggestedGates];
    log.activity('quality:evaluate', agentId, `Starting evaluation (iteration ${iteration}/${maxIterations}): gates=[${allGates.join(',')}]`);

    // Create quality stack from config
    const stack = createStackFromConfig(
      [...preflight.requiredGates, ...preflight.suggestedGates],
      preflight,
      { workDir: context.workDir }
    );

    // Extract rearmatter from solution
    const rearmatter = this.extractRearmatter(workerOutput);

    // Run the stack
    const result = await stack.run(workerOutput, rearmatter, preflight);

    log.info('hooks', 'Quality stack complete', {
      agentId,
      taskId,
      iteration,
      passed: result.passed,
    });
    log.activity('quality:evaluate', agentId, `Stack complete: ${result.passed ? 'PASS' : 'FAIL'} (iteration ${iteration}/${maxIterations})`);

    if (!result.passed) {
      // Quality check failed
      if (onFail === 'halt') {
        log.warn('hooks', 'Quality stack HALT - stopping immediately', {
          agentId,
          taskId,
          feedback: result.feedback,
        });
        log.activity('quality:evaluate', agentId, `HALT: Quality check failed - ${result.feedback || 'No feedback'}`);
        throw new QualityHaltError(result.feedback || 'Quality check failed');
      }

      // LOOP: Check if we can retry
      if (iteration < maxIterations) {
        log.info('hooks', 'Quality stack FAIL - iteration loop', {
          agentId,
          taskId,
          iteration,
          maxIterations,
          feedback: result.feedback,
        });
        log.activity('quality:evaluate', agentId, `LOOP: Iteration ${iteration}/${maxIterations} failed - requesting re-run`);

        // Update iteration count in context
        context.qualityIteration = iteration + 1;

        // Write feedback message for re-run
        if (result.feedback && context.msgsDir) {
          await this.writeFeedbackMessage(context, agentId, taskId, result.feedback, iteration + 1);
          log.activity('quality:feedback', agentId, `Feedback written for iteration ${iteration + 1}`);
        }

        // Signal to dispatcher to re-spawn worker
        throw new QualityIterationError(result.feedback || 'Quality check failed');
      }

      // Max iterations exhausted
      log.warn('hooks', 'Quality stack exhausted max iterations', {
        agentId,
        taskId,
        iterations: iteration,
        maxIterations,
      });
      log.activity('quality:evaluate', agentId, `EXHAUSTED: Max iterations (${maxIterations}) reached without passing`);
      throw new QualityExhaustedError(`Max iterations (${maxIterations}) reached`);
    }

    log.info('hooks', 'Quality evaluation PASSED', {
      agentId,
      taskId,
      iterations: iteration,
    });
    log.activity('quality:evaluate', agentId, `PASS: Quality evaluation complete after ${iteration} iteration(s)`);
  }

  // =============================================================================
  // Individual Quality Gate Hook Handlers
  // =============================================================================

  /**
   * Execute quality:checklist hook
   * Evaluates worker output against checklist items
   */
  private async executeChecklistHook(context: HookContext): Promise<void> {
    const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
    const { ChecklistGate } = await import('../quality/gates/checklist.ts');
    const gate = new ChecklistGate();

    const preflight = context.qualityPreflight;
    if (!preflight) {
      log.warn('quality', 'Checklist gate skipped - no preflight data');
      log.activity('quality:checklist', agentId, 'SKIPPED: No preflight data');
      return;
    }

    const workerOutput = context.workerOutput;
    if (!workerOutput) {
      log.warn('quality', 'Checklist gate skipped - no worker output');
      log.activity('quality:checklist', agentId, 'SKIPPED: No worker output');
      return;
    }

    log.activity('quality:checklist', agentId, 'Running checklist evaluation');
    const result = await gate.evaluate(workerOutput, {}, preflight);

    log.info('quality', 'Checklist evaluation', {
      passed: result.passed,
      items: result.details?.items || [],
      total: result.details?.total,
      passedCount: result.details?.passed,
      failedCount: result.details?.failed,
    });

    // Build detailed activity output
    const items = (result.details?.items || []) as Array<{ item: string; passed: boolean; reason?: string }>;
    const failedItems = items.filter(i => !i.passed);
    let activityContent = `${result.passed ? 'PASS' : 'FAIL'}: ${result.details?.passed || 0}/${result.details?.total || 0} items`;
    if (failedItems.length > 0) {
      const failedNames = failedItems.slice(0, 3).map(i => i.item.slice(0, 40)).join(', ');
      const more = failedItems.length > 3 ? ` (+${failedItems.length - 3} more)` : '';
      activityContent += `\n   ❌ Failed: ${failedNames}${more}`;
    }
    log.activity('quality:checklist', agentId, activityContent);

    // Write result to sys-msgs for visibility
    this.writeQualityResultMessage(context, 'checklist', result.passed, activityContent, {
      total: result.details?.total,
      passed: result.details?.passed,
      failed: result.details?.failed,
    });

    if (!result.passed) {
      throw new QualityIterationError(result.feedback || 'Checklist failed');
    }
  }

  /**
   * Execute quality:rubric hook
   * Scores worker output against rubric criteria
   */
  private async executeRubricHook(context: HookContext): Promise<void> {
    const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
    const { RubricGate } = await import('../quality/gates/rubric.ts');
    const gate = new RubricGate();

    const preflight = context.qualityPreflight;
    if (!preflight) {
      log.warn('quality', 'Rubric gate skipped - no preflight data');
      log.activity('quality:rubric', agentId, 'SKIPPED: No preflight data');
      return;
    }

    const workerOutput = context.workerOutput;
    if (!workerOutput) {
      log.warn('quality', 'Rubric gate skipped - no worker output');
      log.activity('quality:rubric', agentId, 'SKIPPED: No worker output');
      return;
    }

    log.activity('quality:rubric', agentId, 'Running rubric evaluation');
    const result = await gate.evaluate(workerOutput, {}, preflight);

    log.info('quality', 'Rubric evaluation', {
      passed: result.passed,
      score: result.details?.overallScore,
      threshold: result.details?.threshold,
      criteria: result.details?.scores,
    });

    // Build detailed activity output
    const scores = result.details?.scores as Array<{ criterion: string; score: number }> | undefined;
    let rubricContent = `${result.passed ? 'PASS' : 'FAIL'}: score=${result.details?.overallScore || 0}/${result.details?.threshold || 70}`;
    if (scores && scores.length > 0) {
      const lowScores = scores.filter(s => s.score < 70).slice(0, 3);
      if (lowScores.length > 0) {
        const lowList = lowScores.map(s => `${s.criterion.slice(0, 25)}:${s.score}`).join(', ');
        rubricContent += `\n   ⚠️ Low: ${lowList}`;
      }
    }
    log.activity('quality:rubric', agentId, rubricContent);

    // Write result to sys-msgs for visibility
    this.writeQualityResultMessage(context, 'rubric', result.passed, rubricContent, {
      overallScore: result.details?.overallScore,
      threshold: result.details?.threshold,
    });

    if (!result.passed) {
      throw new QualityIterationError(result.feedback || 'Rubric failed');
    }
  }

  /**
   * Execute quality:adversarial hook
   * Challenges worker output by looking for flaws and edge cases
   */
  private async executeAdversarialHook(context: HookContext): Promise<void> {
    const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
    const { AdversarialGate } = await import('../quality/gates/adversarial.ts');
    const gate = new AdversarialGate();

    const preflight = context.qualityPreflight;
    if (!preflight) {
      log.warn('quality', 'Adversarial gate skipped - no preflight data');
      log.activity('quality:adversarial', agentId, 'SKIPPED: No preflight data');
      return;
    }

    const workerOutput = context.workerOutput;
    if (!workerOutput) {
      log.warn('quality', 'Adversarial gate skipped - no worker output');
      log.activity('quality:adversarial', agentId, 'SKIPPED: No worker output');
      return;
    }

    log.activity('quality:adversarial', agentId, 'Running adversarial critique');
    const result = await gate.evaluate(workerOutput, {}, preflight);

    log.info('quality', 'Adversarial critique', {
      passed: result.passed,
      confidence: result.confidence,
      issues: result.details?.issues || [],
      critical: result.details?.critical,
      major: result.details?.major,
      minor: result.details?.minor,
    });

    // Build detailed activity output
    const critical = (result.details?.critical as number) || 0;
    const major = (result.details?.major as number) || 0;
    const minor = (result.details?.minor as number) || 0;
    const issueCount = critical + major + minor;
    let advContent = `${result.passed ? 'PASS' : 'FAIL'}: ${issueCount} issues (critical=${critical}, major=${major}, minor=${minor})`;
    const issues = result.details?.issues as Array<{ severity: string; description: string }> | undefined;
    if (issues && issues.length > 0 && !result.passed) {
      const criticalIssues = issues.filter(i => i.severity === 'critical').slice(0, 2);
      if (criticalIssues.length > 0) {
        const issueList = criticalIssues.map(i => i.description.slice(0, 50)).join('; ');
        advContent += `\n   🚨 Critical: ${issueList}`;
      }
    }
    log.activity('quality:adversarial', agentId, advContent);

    // Write result to sys-msgs for visibility
    this.writeQualityResultMessage(context, 'adversarial', result.passed, advContent, {
      critical,
      major,
      minor,
      confidence: result.confidence,
    });

    if (!result.passed) {
      throw new QualityIterationError(result.feedback || 'Adversarial critique failed');
    }
  }

  /**
   * Execute quality:accuracy hook
   * Validates sources and checks first-party vs second-party quality
   */
  private async executeAccuracyHook(context: HookContext): Promise<void> {
    const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
    const { AccuracyGate } = await import('../quality/gates/accuracy.ts');
    const gate = new AccuracyGate();

    const preflight = context.qualityPreflight;
    if (!preflight) {
      log.warn('quality', 'Accuracy gate skipped - no preflight data');
      log.activity('quality:accuracy', agentId, 'SKIPPED: No preflight data');
      return;
    }

    const workerOutput = context.workerOutput;
    if (!workerOutput) {
      log.warn('quality', 'Accuracy gate skipped - no worker output');
      log.activity('quality:accuracy', agentId, 'SKIPPED: No worker output');
      return;
    }

    log.activity('quality:accuracy', agentId, 'Running accuracy verification');
    const result = await gate.evaluate(workerOutput, {}, preflight);

    log.info('quality', 'Accuracy verification', {
      passed: result.passed,
      confidence: result.confidence,
      totalSources: result.details?.totalSources,
      firstParty: result.details?.firstParty,
      secondParty: result.details?.secondParty,
    });
    const accContent = `${result.passed ? 'PASS' : 'FAIL'}: ${result.details?.totalSources || 0} sources (1st=${result.details?.firstParty || 0}, 2nd=${result.details?.secondParty || 0})`;
    log.activity('quality:accuracy', agentId, accContent);

    // Write result to sys-msgs for visibility
    this.writeQualityResultMessage(context, 'accuracy', result.passed, accContent, {
      totalSources: result.details?.totalSources,
      firstParty: result.details?.firstParty,
      secondParty: result.details?.secondParty,
    });

    if (!result.passed) {
      throw new QualityIterationError(result.feedback || 'Accuracy verification failed');
    }
  }

  /**
   * Execute quality:summarizer hook
   * Summarizes ensemble results (informational only, cannot fail)
   */
  private async executeSummarizerHook(context: HookContext): Promise<void> {
    const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
    const { SummarizerGate } = await import('../quality/gates/summarizer.ts');

    const workerOutput = context.workerOutput;
    if (!workerOutput) {
      log.warn('quality', 'Summarizer gate skipped - no worker output');
      log.activity('quality:summarizer', agentId, 'SKIPPED: No worker output');
      return;
    }

    log.activity('quality:summarizer', agentId, 'Generating summary');

    // Summarizer works with ensemble solutions, but in single-worker mode
    // we just create a single solution entry
    const gate = new SummarizerGate({
      solutions: [{
        workerId: context.agentId || 'unknown',
        solution: workerOutput,
        rearmatter: this.extractRearmatter(workerOutput),
      }],
    });

    const result = await gate.evaluate(workerOutput, {}, {} as PreflightOutput);

    log.info('quality', 'Summary generated', {
      solutionCount: result.details?.solutionCount,
      selectedWorkerId: result.details?.selectedWorkerId,
      selectedConfidence: result.details?.selectedConfidence,
      avgSimilarity: result.details?.avgSimilarity,
    });
    const sumContent = `Summary complete: ${result.details?.solutionCount || 1} solution(s), confidence=${result.details?.selectedConfidence || 0}`;
    log.activity('quality:summarizer', agentId, sumContent);

    // Write result to sys-msgs for visibility
    this.writeQualityResultMessage(context, 'summarizer', true, sumContent, {
      solutionCount: result.details?.solutionCount,
      selectedConfidence: result.details?.selectedConfidence,
    });

    // Summarizer is informational only - does not throw on failure
  }

  /**
   * Execute quality:deterministic hook
   * Runs tests, lint, type checks via shell commands
   */
  private async executeDeterministicHook(context: HookContext): Promise<void> {
    const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
    const { DeterministicGate } = await import('../quality/gates/deterministic.ts');

    // Get commands from context or use defaults
    const commands = (context.deterministicCommands as string[]) || [];

    // If no commands configured, log and pass
    if (commands.length === 0) {
      log.info('quality', 'Deterministic checks', {
        passed: true,
        reason: 'No commands configured',
      });
      log.activity('quality:deterministic', agentId, 'SKIPPED: No commands configured');
      return;
    }

    log.activity('quality:deterministic', agentId, `Running ${commands.length} check(s): ${commands.join(', ')}`);

    const gate = new DeterministicGate({
      commands,
      workDir: context.worktreePath || context.workDir,
    });

    const result = await gate.evaluate('', {}, {} as PreflightOutput);

    log.info('quality', 'Deterministic checks', {
      passed: result.passed,
      commands: result.details?.commands,
      executed: result.details?.executed,
      passedCount: result.details?.passed,
      failedCount: result.details?.failed,
    });

    // Build detailed activity output
    const cmdResults = result.details?.commands as Array<{ command: string; passed: boolean; output?: string }> | undefined;
    let detContent = `${result.passed ? 'PASS' : 'FAIL'}: ${result.details?.passed || 0}/${result.details?.executed || 0} commands`;
    if (cmdResults && !result.passed) {
      const failedCmds = cmdResults.filter(c => !c.passed).slice(0, 2);
      if (failedCmds.length > 0) {
        const failedList = failedCmds.map(c => c.command.slice(0, 30)).join(', ');
        detContent += `\n   💥 Failed: ${failedList}`;
      }
    }
    log.activity('quality:deterministic', agentId, detContent);

    // Write result to sys-msgs for visibility
    this.writeQualityResultMessage(context, 'deterministic', result.passed, detContent, {
      executed: result.details?.executed,
      passed: result.details?.passed,
      failed: result.details?.failed,
    });

    if (!result.passed) {
      throw new QualityIterationError(result.feedback || 'Deterministic checks failed');
    }
  }

  /**
   * Heuristic-based preflight fallback
   * Used when LLM preflight fails or times out
   */
  private runHeuristicPreflight(taskBody: string, gates: GateType[]): PreflightOutput {
    log.info('hooks', 'Running heuristic preflight analysis');

    const preflight: PreflightOutput = {
      taskType: this.detectTaskType(taskBody),
      checklist: this.generateChecklist(taskBody),
      rubric: this.generateRubric(taskBody),
      requiredGates: gates,
      suggestedGates: this.suggestGates(taskBody),
      effortLevel: this.estimateEffort(taskBody),
      estimatedToolCalls: this.estimateToolCalls(taskBody),
    };

    log.info('hooks', 'Heuristic preflight complete', {
      taskType: preflight.taskType,
      checklistItems: preflight.checklist.length,
      rubricItems: preflight.rubric.length,
    });

    return preflight;
  }

  /**
   * Detect task type from task body
   */
  private detectTaskType(taskBody: string): string {
    const lower = taskBody.toLowerCase();
    if (lower.includes('implement') || lower.includes('build') || lower.includes('create')) {
      return 'implementation';
    }
    if (lower.includes('fix') || lower.includes('bug') || lower.includes('error')) {
      return 'bug-fix';
    }
    if (lower.includes('refactor') || lower.includes('improve') || lower.includes('optimize')) {
      return 'refactoring';
    }
    if (lower.includes('test') || lower.includes('spec')) {
      return 'testing';
    }
    if (lower.includes('research') || lower.includes('investigate') || lower.includes('find')) {
      return 'research';
    }
    if (lower.includes('review') || lower.includes('check')) {
      return 'code-review';
    }
    return 'general';
  }

  /**
   * Generate checklist items from task body
   */
  private generateChecklist(taskBody: string): string[] {
    const items: string[] = [];
    const lower = taskBody.toLowerCase();

    if (lower.includes('implement') || lower.includes('build')) {
      items.push('Code compiles without errors');
      items.push('Implementation matches requirements');
      items.push('Edge cases are handled');
    }
    if (lower.includes('test')) {
      items.push('Tests pass successfully');
      items.push('Test coverage is adequate');
    }
    if (lower.includes('typescript') || lower.includes('type')) {
      items.push('Types are properly defined');
    }
    if (lower.includes('function') || lower.includes('method')) {
      items.push('Function/method documentation is complete');
    }

    if (items.length === 0) {
      items.push('Task requirements are addressed');
      items.push('Output is complete and correct');
    }

    return items;
  }

  /**
   * Generate rubric items from task body
   */
  private generateRubric(taskBody: string): Array<{ criterion: string; weight: number; description: string }> {
    const lower = taskBody.toLowerCase();
    const rubric: Array<{ criterion: string; weight: number; description: string }> = [];

    if (lower.includes('implement') || lower.includes('code')) {
      rubric.push({
        criterion: 'correctness',
        weight: 0.4,
        description: 'Code correctly implements the requirements',
      });
      rubric.push({
        criterion: 'quality',
        weight: 0.3,
        description: 'Code follows best practices and is maintainable',
      });
      rubric.push({
        criterion: 'completeness',
        weight: 0.3,
        description: 'All aspects of the task are addressed',
      });
    } else {
      rubric.push({
        criterion: 'accuracy',
        weight: 0.5,
        description: 'Output is accurate and correct',
      });
      rubric.push({
        criterion: 'completeness',
        weight: 0.5,
        description: 'All requirements are addressed',
      });
    }

    return rubric;
  }

  /**
   * Suggest additional gates based on task content
   */
  private suggestGates(taskBody: string): GateType[] {
    const gates: GateType[] = [];
    const lower = taskBody.toLowerCase();

    if (lower.includes('security') || lower.includes('auth') || lower.includes('password')) {
      gates.push('adversarial');
    }
    if (lower.includes('typescript') || lower.includes('test') || lower.includes('npm')) {
      gates.push('deterministic');
    }
    if (lower.includes('research') || lower.includes('source') || lower.includes('reference')) {
      gates.push('accuracy');
    }

    return gates;
  }

  /**
   * Estimate effort level for task
   */
  private estimateEffort(taskBody: string): 'light' | 'medium' | 'heavy' {
    const wordCount = taskBody.split(/\s+/).length;
    if (wordCount < 20) return 'light';
    if (wordCount < 100) return 'medium';
    return 'heavy';
  }

  /**
   * Estimate tool calls for task
   */
  private estimateToolCalls(taskBody: string): number {
    const lower = taskBody.toLowerCase();
    let estimate = 5;

    if (lower.includes('implement') || lower.includes('build')) estimate += 10;
    if (lower.includes('refactor')) estimate += 15;
    if (lower.includes('test')) estimate += 5;
    if (lower.includes('multiple') || lower.includes('several')) estimate += 10;

    return estimate;
  }

  /**
   * Extract rearmatter (self-assessment) from worker output
   */
  private extractRearmatter(solution: string): RearmatterData {
    const rearmatter: RearmatterData = {};

    const confidenceMatch = solution.match(/confidence[:\s]+(\d*\.?\d+)/i);
    if (confidenceMatch) {
      rearmatter.confidence = parseFloat(confidenceMatch[1]);
    }

    const gradeMatch = solution.match(/grade[:\s]+([A-F])/i);
    if (gradeMatch) {
      rearmatter.grade = gradeMatch[1];
    }

    const toolMatches = solution.match(/\[Tools?:/gi);
    if (toolMatches) {
      rearmatter.toolCalls = toolMatches.length;
    }

    return rearmatter;
  }

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
    const msgsDir = context.msgsDir;
    if (!msgsDir) {
      log.warn('hooks', 'No msgsDir in context, cannot write feedback message');
      return '';
    }

    // Write to sys-msgs instead of msgs to avoid triggering consumer
    const sysMsgsDir = path.join(path.dirname(msgsDir), 'sys-msgs');

    // Ensure sys-msgs directory exists
    if (!fs.existsSync(sysMsgsDir)) {
      fs.mkdirSync(sysMsgsDir, { recursive: true });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const msgId = `quality-feedback-${taskId}-${iteration}`;
    const filename = `${timestamp}-feedback-${agentId.replace('/', '-')}-${msgId}.md`;
    const filepath = path.join(sysMsgsDir, filename);

    const content = `---
to: ${agentId}
from: quality/stack
type: feedback
msg-id: ${msgId}
headline: Quality feedback - iteration ${iteration}
timestamp: ${new Date().toISOString()}
session-id: ${context.sessionId || 'unknown'}
---

## Quality Stack Feedback

The previous attempt did not pass quality evaluation. Please address the following feedback and try again:

${feedback}

---

**Iteration**: ${iteration}
**Action**: Review the feedback above and improve your solution.
`;

    fs.writeFileSync(filepath, content);
    log.info('hooks', 'Wrote system feedback message (audit)', { agentId, taskId, iteration, filepath });
    return filepath;
  }

  /**
   * Write quality gate result to sys-msgs for audit/visibility
   * Called on both PASS and FAIL for all quality gates
   */
  private writeQualityResultMessage(
    context: HookContext,
    gate: string,
    passed: boolean,
    summary: string,
    details?: Record<string, unknown>
  ): void {
    const msgsDir = context.msgsDir;
    if (!msgsDir) return;

    const sysMsgsDir = path.join(path.dirname(msgsDir), 'sys-msgs');
    if (!fs.existsSync(sysMsgsDir)) {
      fs.mkdirSync(sysMsgsDir, { recursive: true });
    }

    const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const msgId = `quality-${gate}-${context.taskId || Date.now()}`;
    const filename = `${timestamp}-${gate}-${agentId.replace('/', '-')}-${passed ? 'pass' : 'fail'}.md`;
    const filepath = path.join(sysMsgsDir, filename);

    const detailsYaml = details
      ? Object.entries(details)
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join('\n')
      : '';

    const content = `---
to: ${agentId}
from: quality/${gate}
type: ${passed ? 'quality-pass' : 'quality-fail'}
msg-id: ${msgId}
headline: ${gate} ${passed ? 'PASS' : 'FAIL'}
timestamp: ${new Date().toISOString()}
---

## Quality Gate: ${gate}

**Result**: ${passed ? '✅ PASS' : '❌ FAIL'}

${summary}
${detailsYaml ? `\n---\n${detailsYaml}` : ''}
`;

    fs.writeFileSync(filepath, content);
    log.debug('hooks', `Wrote quality result message`, { gate, passed, filepath });
  }

  /**
   * Write feedback message to worker for quality iteration (legacy - writes to msgs/)
   * @deprecated Use writeSystemFeedbackMessage for session resume flow
   */
  private async writeFeedbackMessage(
    context: HookContext,
    agentId: string,
    taskId: string,
    feedback: string,
    iteration: number
  ): Promise<void> {
    const msgsDir = context.msgsDir;
    if (!msgsDir) {
      log.warn('hooks', 'No msgsDir in context, cannot write feedback message');
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const msgId = `quality-feedback-${taskId}-${iteration}`;
    const filename = `${timestamp}-task-core--${agentId.replace('/', '-')}-${msgId}.md`;
    const filepath = path.join(msgsDir, filename);

    const content = `---
to: ${agentId}
from: core/core
type: task
msg-id: ${msgId}
headline: Quality feedback - iteration ${iteration}
timestamp: ${new Date().toISOString()}
---

## Quality Stack Feedback

The previous attempt did not pass quality evaluation. Please address the following feedback and try again:

${feedback}

---

**Iteration**: ${iteration}
**Action**: Review the feedback above and improve your solution.
`;

    fs.writeFileSync(filepath, content);
    log.info('hooks', 'Wrote quality feedback message', { agentId, taskId, iteration, filepath });
  }
}
