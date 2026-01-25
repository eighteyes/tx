/**
 * Brain Update Post-Hook
 *
 * Sends work summary to brain mesh for analysis.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../types.ts';

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const brainWorkDir = context.worktreePath || utils.workDir;

  log.info('hooks', 'Sending work analysis to brain mesh', {
    meshInstance: context.meshInstance,
    workDir: brainWorkDir,
  });

  try {
    // Get git diff and work summary
    const { execSync } = await import('node:child_process');

    let gitDiff = '';
    let workSummary = '';

    try {
      // Get staged changes if any, otherwise get all changes
      gitDiff = execSync('git diff --cached', { cwd: brainWorkDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      if (!gitDiff.trim()) {
        gitDiff = execSync('git diff HEAD', { cwd: brainWorkDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      }
    } catch (error) {
      log.warn('hooks', 'Failed to get git diff', {
        error: (error as Error).message,
      });
      gitDiff = '(Unable to retrieve git diff)';
    }

    // Extract work summary from worker output if available
    if (context.workerOutput) {
      const summaryMatch = context.workerOutput.match(/## Summary\s+([\s\S]*?)(?=\n##|\n---|\n\[|$)/i);
      workSummary = summaryMatch ? summaryMatch[1].trim() : context.workerOutput.slice(0, 500);
    } else {
      workSummary = context.taskBody || '(No task description available)';
    }

    // Build task message for brain
    const taskBody = `# Work Analysis Request

## Task Context
- **Task ID**: ${context.taskId || 'unknown'}
- **Agent**: ${context.agentName || 'unknown'}
- **Mesh**: ${context.meshName || 'unknown'}

## Work Summary
${workSummary}

## Git Diff
\`\`\`diff
${gitDiff}
\`\`\`

---

Analyze these changes and document in your workspace:
- **Side Effects**: Unintended consequences, breaking changes, performance/security implications
- **Opportunities**: Refactoring, generalization, related features to add
- **Tech Debt**: TODOs, missing error handling, testing gaps, code smells
`;

    // Insert task message for brain mesh
    const timestamp = Math.floor(Date.now() / 1000);
    const msgId = `brain-update-${context.taskId || Date.now()}`;
    const filename = `${timestamp}-task-core-core--brain-brain-${msgId}.md`;
    const filepath = path.join(context.msgsDir || path.join(utils.workDir, '.ai', 'tx', 'msgs'), filename);

    const content = `---
to: brain/brain
from: core/core
type: task
msg-id: ${msgId}
headline: Analyze completed work - ${context.meshName}/${context.agentName}
timestamp: ${new Date().toISOString()}
---

${taskBody}
`;

    fs.writeFileSync(filepath, content);
    log.info('hooks', 'Brain update message sent', {
      meshInstance: context.meshInstance,
      filepath,
    });

  } catch (error) {
    log.error('hooks', 'Brain update hook failed', {
      meshInstance: context.meshInstance,
      error: (error as Error).message,
    });
  }
};

export const brainUpdateHook: HookDefinition = {
  name: 'brain-update',
  phase: 'post',
  priority: 100, // Last - for analysis
  description: 'Sends work summary to brain mesh for analysis',
  handler,
};
