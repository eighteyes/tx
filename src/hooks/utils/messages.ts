/**
 * Hook Message Utilities
 *
 * Functions for writing quality results and feedback messages to sys-msgs.
 * These messages are for audit/visibility and don't trigger the consumer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../shared/logger.ts';
import type { HookContext } from '../types.ts';

/**
 * Ensure a directory exists, creating it if necessary
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Get the sys-msgs directory from msgsDir
 */
function getSysMsgsDir(msgsDir: string): string {
  return path.join(path.dirname(msgsDir), 'sys-msgs');
}

/**
 * Write quality gate result to sys-msgs for audit/visibility
 * Called on both PASS and FAIL for all quality gates
 */
export function writeQualityResultMessage(
  context: HookContext,
  gate: string,
  passed: boolean,
  summary: string,
  details?: Record<string, unknown>
): void {
  const msgsDir = context.msgsDir;
  if (!msgsDir) return;

  const sysMsgsDir = getSysMsgsDir(msgsDir);
  ensureDir(sysMsgsDir);

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
 * Write feedback message to sys-msgs for audit trail (NOT routed to consumer)
 * This is used for quality iteration resume where we don't want the file watcher
 * to pick up the message - instead we resume the session directly.
 */
export async function writeSystemFeedbackMessage(
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

  const sysMsgsDir = getSysMsgsDir(msgsDir);
  ensureDir(sysMsgsDir);

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
 * Write feedback message to worker for quality iteration (legacy - writes to msgs/)
 * @deprecated Use SystemMessageWriter via context.systemWriter or writeSystemFeedbackMessage for session resume flow
 */
export async function writeFeedbackMessage(
  context: HookContext,
  agentId: string,
  taskId: string,
  feedback: string,
  iteration: number
): Promise<void> {
  const body = `## Quality Stack Feedback

The previous attempt did not pass quality evaluation. Please address the following feedback and try again:

${feedback}

---

**Iteration**: ${iteration}
**Action**: Review the feedback above and improve your solution.`;

  if (context.systemWriter) {
    context.systemWriter.write({
      to: agentId,
      from: 'core/core',
      type: 'task',
      headline: `Quality feedback - iteration ${iteration}`,
      body,
    });
    return;
  }

  const msgsDir = context.msgsDir;
  if (!msgsDir) {
    log.warn('hooks', 'No msgsDir in context, cannot write feedback message');
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const msgId = `quality-feedback-${taskId}-${iteration}`;
  const filename = `${timestamp}-task-core--${agentId.replace('/', '-')}-${msgId}.md`;
  const filepath = path.join(msgsDir, filename);
  const content = `---\nto: ${agentId}\nfrom: core/core\ntype: task\nmsg-id: ${msgId}\nheadline: Quality feedback - iteration ${iteration}\ntimestamp: ${new Date().toISOString()}\n---\n\n${body}\n`;
  fs.writeFileSync(filepath, content);
  log.info('hooks', 'Wrote quality feedback message (fallback)', { agentId, taskId, iteration });
}
