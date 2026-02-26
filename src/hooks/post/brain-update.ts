/**
 * Brain Update Post-Hook
 *
 * Sends work summary to brain mesh for analysis.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
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

    // Extract rearmatter (self-assessment) from worker output
    let rearmatterSection = '';
    if (context.workerOutput) {
      const rearmatter = utils.extractRearmatter(context.workerOutput);
      if (Object.keys(rearmatter).length > 0) {
        rearmatterSection = `## Agent Self-Assessment (Rearmatter)
${rearmatter.confidence !== undefined ? `- **Confidence**: ${rearmatter.confidence}` : ''}
${rearmatter.grade ? `- **Grade**: ${rearmatter.grade}` : ''}
${rearmatter.toolCalls ? `- **Tool Calls**: ${rearmatter.toolCalls}` : ''}
${rearmatter.assumptions?.length ? `- **Assumptions**:\n${rearmatter.assumptions.map(a => `  - ${a}`).join('\n')}` : ''}
${rearmatter.limitations?.length ? `- **Limitations**:\n${rearmatter.limitations.map(l => `  - ${l}`).join('\n')}` : ''}
`.trim();
      }

      // Extract YAML rearmatter block if present (---\nkey: value\n---)
      const yamlMatch = context.workerOutput.match(/\n---\n([\s\S]*?)\n---\s*$/);
      if (yamlMatch) {
        rearmatterSection += `\n\n## Structured Rearmatter\n\`\`\`yaml\n${yamlMatch[1].trim()}\n\`\`\``;
      }
    }

    // Read scratch space files if they exist (working-notes.md, decisions.md)
    let scratchSpace = '';
    const workspacePath = context.workDir ? path.join(context.workDir, '.ai', 'output', context.meshName || '', context.taskId || '') : null;

    if (workspacePath) {
      const workingNotesPath = path.join(workspacePath, 'working-notes.md');
      const decisionsPath = path.join(workspacePath, 'decisions.md');

      if (fs.existsSync(workingNotesPath)) {
        const notes = fs.readFileSync(workingNotesPath, 'utf-8');
        if (notes.trim()) {
          scratchSpace += `## Working Notes\n${notes.trim()}\n\n`;
        }
      }

      if (fs.existsSync(decisionsPath)) {
        const decisions = fs.readFileSync(decisionsPath, 'utf-8');
        if (decisions.trim()) {
          scratchSpace += `## Decisions\n${decisions.trim()}\n\n`;
        }
      }
    }

    // Build task message for brain
    const taskBody = `# Work Analysis Request

## Task Context
- **Task ID**: ${context.taskId || 'unknown'}
- **Agent**: ${context.agentName || 'unknown'}
- **Mesh**: ${context.meshName || 'unknown'}

## Work Summary
${workSummary}

${rearmatterSection ? `${rearmatterSection}\n` : ''}
${scratchSpace ? `${scratchSpace}` : ''}
## Git Diff
\`\`\`diff
${gitDiff}
\`\`\`

---

Analyze these changes and document in your workspace:
- **Learnings**: Patterns, insights, and knowledge worth preserving
- **Side Effects**: Unintended consequences, breaking changes, performance/security implications
- **Opportunities**: Refactoring, generalization, related features to add
- **Tech Debt**: TODOs, missing error handling, testing gaps, code smells

Update BRAIN.md with any critical learnings that should persist across sessions.
`;

    // Insert task message for brain mesh
    if (context.systemWriter) {
      context.systemWriter.write({
        to: 'brain/brain',
        from: 'core/core',
        type: 'task',
        headline: `Analyze completed work - ${context.meshName}/${context.agentName}`,
        body: taskBody,
      });
    } else {
      const timestamp = Math.floor(Date.now() / 1000);
      const msgId = `brain-update-${context.taskId || Date.now()}`;
      const filename = `${timestamp}-task-core-core--brain-brain-${msgId}.md`;
      const filepath = path.join(context.msgsDir || path.join(utils.workDir, '.ai', 'tx', 'msgs'), filename);
      const content = `---\nto: brain/brain\nfrom: core/core\ntype: task\nmsg-id: ${msgId}\nheadline: Analyze completed work - ${context.meshName}/${context.agentName}\ntimestamp: ${new Date().toISOString()}\n---\n\n${taskBody}\n`;
      fs.writeFileSync(filepath, content);
    }
    log.info('hooks', 'Brain update message sent', { meshInstance: context.meshInstance });

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
