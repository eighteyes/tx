/**
 * Worktree Create Pre-Hook
 *
 * Creates a git worktree for feature isolation before worker spawn.
 */

import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  if (!context.featureName) {
    throw new Error('Worktree requires feature: featureName must be set in context');
  }

  log.info('hooks', 'Creating worktree', { featureName: context.featureName });

  const worktreePath = utils.worktreeManager.createWorktree(context.featureName);
  context.worktreePath = worktreePath;

  // Get branch name from worktree info
  const worktrees = utils.worktreeManager.listWorktrees();
  const worktreeInfo = worktrees.find(w => w.path === worktreePath);
  if (worktreeInfo) {
    context.worktreeBranch = worktreeInfo.branch;
  }

  log.info('hooks', 'Worktree created', {
    path: worktreePath,
    branch: context.worktreeBranch,
  });
};

export const worktreeCreateHook: HookDefinition = {
  name: 'worktree:create',
  phase: 'pre',
  priority: 10, // Run first to setup workspace
  description: 'Creates git worktree for feature isolation',
  handler,
};
