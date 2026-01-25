/**
 * Worktree Cleanup Post-Hook
 *
 * Cleans up git worktree after worker completion.
 */

import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  if (!context.worktreePath) {
    log.warn('hooks', 'No worktree to cleanup', { meshInstance: context.meshInstance });
    return;
  }

  log.info('hooks', 'Cleaning up worktree', {
    meshInstance: context.meshInstance,
    path: context.worktreePath,
  });

  try {
    utils.worktreeManager.removeWorktree(context.meshInstance, true);
    log.info('hooks', 'Worktree cleaned up', { meshInstance: context.meshInstance });
  } catch (error) {
    log.error('hooks', 'Failed to cleanup worktree', {
      meshInstance: context.meshInstance,
      error: (error as Error).message,
    });
  }
};

export const worktreeCleanupHook: HookDefinition = {
  name: 'worktree:cleanup',
  phase: 'post',
  priority: 80, // After quality, before commit
  description: 'Cleans up git worktree after worker completion',
  handler,
};
