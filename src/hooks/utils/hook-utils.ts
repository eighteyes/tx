/**
 * HookUtils Implementation
 *
 * Dependency-injected utilities available to all hooks.
 */

import path from 'node:path';
import type { MessageQueue } from '../../queue/index.ts';
import type { WorktreeManager } from '../../core/worktree.ts';
import type { HookContext, HookUtils } from '../types.ts';
import { extractRearmatter } from './rearmatter.ts';
import { writeQualityResultMessage, writeSystemFeedbackMessage } from './messages.ts';

/**
 * HookUtils implementation class
 */
export class HookUtilsImpl implements HookUtils {
  constructor(
    public readonly queue: MessageQueue,
    public readonly worktreeManager: WorktreeManager,
    public readonly workDir: string,
    public readonly meshesDir: string,
  ) {}

  /**
   * Write a quality gate result to sys-msgs for visibility
   */
  writeResultMessage(
    context: HookContext,
    gate: string,
    passed: boolean,
    summary: string,
    details?: Record<string, unknown>
  ): void {
    writeQualityResultMessage(context, gate, passed, summary, details);
  }

  /**
   * Write feedback message for quality iteration (audit trail)
   */
  async writeFeedbackMessage(
    context: HookContext,
    agentId: string,
    taskId: string,
    feedback: string,
    iteration: number
  ): Promise<string> {
    return writeSystemFeedbackMessage(context, agentId, taskId, feedback, iteration);
  }

  /**
   * Extract rearmatter (self-assessment) from worker output
   */
  extractRearmatter = extractRearmatter;
}

/**
 * Create HookUtils instance
 */
export function createHookUtils(
  queue: MessageQueue,
  worktreeManager: WorktreeManager,
  workDir: string,
  meshesDir?: string
): HookUtils {
  return new HookUtilsImpl(
    queue,
    worktreeManager,
    workDir,
    meshesDir || path.join(workDir, 'meshes')
  );
}
