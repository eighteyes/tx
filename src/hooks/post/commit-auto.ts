/**
 * Commit Auto Post-Hook
 *
 * Spawns haiku agent to create commit for current changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../shared/logger.ts';
import { SdkRunner, type SdkRunnerConfig } from '../../worker/sdk-runner.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const commitWorkDir = context.worktreePath || utils.workDir;

  log.info('hooks', 'Spawning commit agent', {
    meshInstance: context.meshInstance,
    workDir: commitWorkDir,
  });

  // Find commit-agent prompt
  const promptPath = path.join(utils.meshesDir, 'system', 'commit-agent', 'prompt.md');
  if (!fs.existsSync(promptPath)) {
    log.error('hooks', 'Commit agent prompt not found', { path: promptPath });
    return;
  }

  // Load and inject messaging protocol
  const basePrompt = fs.readFileSync(promptPath, 'utf-8');
  const { PromptInjector } = await import('../../workspace/injector.ts');
  const injector = new PromptInjector();
  const systemPrompt = injector.injectMessagingProtocol(basePrompt);

  const runnerConfig: SdkRunnerConfig = {
    id: `commit-agent-${context.meshInstance}`,
    model: 'haiku',
    systemPrompt,
    workDir: commitWorkDir,
    msgsDir: context.msgsDir || path.join(utils.workDir, '.ai', 'tx', 'msgs'),
  };

  try {
    // Insert task message for the commit agent to process
    const commitAgentId = `commit-agent-${context.meshInstance}`;
    utils.queue.insert({
      from_agent: 'hooks/commit',
      to_agent: commitAgentId,
      type: 'task',
      payload: {
        'msg-id': `commit-task-${Date.now()}`,
        headline: 'Create commit for current changes',
        body: 'Review the current git status and create an appropriate commit for any changes.',
      },
    });

    const runner = new SdkRunner(runnerConfig, utils.queue);
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
        const reason = blockedMatch[1];
        log.warn('hooks', 'Commit blocked', {
          reason,
          meshInstance: context.meshInstance,
        });

        // Write message to core - commit failed
        writeCommitBlockedMessage(context, utils, reason, commitWorkDir);
      }
    }
  } catch (error) {
    log.error('hooks', 'Commit agent failed', {
      meshInstance: context.meshInstance,
      error: (error as Error).message,
    });

    // Write error message to core
    writeCommitErrorMessage(context, utils, error as Error, commitWorkDir);
  }
};

/**
 * Write commit blocked message to core
 */
function writeCommitBlockedMessage(
  context: HookContext,
  utils: HookUtils,
  reason: string,
  commitWorkDir: string
): void {
  const msgsDir = context.msgsDir || path.join(utils.workDir, '.ai', 'tx', 'msgs');
  const timestamp = Math.floor(Date.now() / 1000);
  const msgId = `commit-blocked-${context.meshInstance}`;
  const filename = `${timestamp}-update-hooks-commit--core-core-${msgId}.md`;
  const filepath = path.join(msgsDir, filename);

  const content = `---
to: core/core
from: hooks/commit
type: update
msg-id: ${msgId}
headline: Commit blocked - ${context.meshName}
timestamp: ${new Date().toISOString()}
---

# Commit Hook Blocked

The commit hook was unable to create a commit for mesh instance \`${context.meshInstance}\`.

**Reason**: ${reason}

**Mesh**: ${context.meshName}/${context.agentName}
**Work Directory**: ${commitWorkDir}

Please review the changes and resolve the issue manually.
`;

  fs.writeFileSync(filepath, content);
  log.info('hooks', 'Wrote commit blocked message', { filepath });
}

/**
 * Write commit error message to core
 */
function writeCommitErrorMessage(
  context: HookContext,
  utils: HookUtils,
  error: Error,
  commitWorkDir: string
): void {
  const msgsDir = context.msgsDir || path.join(utils.workDir, '.ai', 'tx', 'msgs');
  const timestamp = Math.floor(Date.now() / 1000);
  const msgId = `commit-error-${context.meshInstance}`;
  const filename = `${timestamp}-update-hooks-commit--core-core-${msgId}.md`;
  const filepath = path.join(msgsDir, filename);

  const content = `---
to: core/core
from: hooks/commit
type: update
msg-id: ${msgId}
headline: Commit hook error - ${context.meshName}
timestamp: ${new Date().toISOString()}
---

# Commit Hook Error

The commit hook encountered an error while processing mesh instance \`${context.meshInstance}\`.

**Error**: ${error.message}

**Mesh**: ${context.meshName}/${context.agentName}
**Work Directory**: ${commitWorkDir}

Please review the logs and handle this manually.
`;

  try {
    fs.writeFileSync(filepath, content);
    log.info('hooks', 'Wrote commit error message', { filepath });
  } catch (writeErr) {
    log.error('hooks', 'Failed to write commit error message', {
      error: (writeErr as Error).message,
    });
  }
}

export const commitAutoHook: HookDefinition = {
  name: 'commit:auto',
  phase: 'post',
  priority: 90, // Near end
  description: 'Spawns haiku agent to create commit for current changes',
  handler,
};
