/**
 * Usage Policy Error Handling
 *
 * Detects and handles false-positive Usage Policy errors from Claude API.
 * Instead of crashing, sends ask-human messages for human intervention.
 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../shared/logger.ts';

/**
 * Pattern to detect Usage Policy errors
 * Matches: "Claude Code is unable to respond to this request, which appears to violate our Usage Policy"
 */
const USAGE_POLICY_ERROR_PATTERN = /unable to respond.*violat.*Usage Policy/i;

/**
 * Check if an error is a Usage Policy violation error
 */
export function isUsagePolicyError(error: Error | string): boolean {
  const message = typeof error === 'string' ? error : error.message;
  return USAGE_POLICY_ERROR_PATTERN.test(message);
}

/**
 * Context captured when a Usage Policy error occurs
 */
export interface UsagePolicyErrorContext {
  /** The prompt/message that triggered the error */
  triggeringPrompt: string;

  /** Recent conversation history (last 2-3 turns of output) */
  recentHistory: string[];

  /** Current agent ID (e.g., "dev/implementer") */
  agentId: string;

  /** Mesh name */
  meshName: string;

  /** Tool calls that were in progress (if any) */
  toolCallsInProgress: string[];

  /** The original error message */
  errorMessage: string;

  /** Timestamp when error occurred */
  timestamp: string;

  /** Session ID if available (for potential resume) */
  sessionId?: string;
}

/**
 * Capture diagnostic context when a Usage Policy error occurs
 */
export function captureErrorContext(
  error: Error | string,
  agentId: string,
  userPrompt: string,
  sessionOutput: string[],
  sessionId?: string | null
): UsagePolicyErrorContext {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const [meshName] = agentId.split('/');

  // Get last 2-3 outputs for context
  const recentHistory = sessionOutput.slice(-3);

  // Extract tool calls from recent output
  const toolCallsInProgress: string[] = [];
  for (const output of recentHistory) {
    const toolMatch = output.match(/\[Tools?: ([^\]]+)\]/);
    if (toolMatch) {
      toolCallsInProgress.push(toolMatch[1]);
    }
  }

  return {
    triggeringPrompt: userPrompt.slice(0, 2000), // Limit to first 2000 chars
    recentHistory,
    agentId,
    meshName: meshName || 'unknown',
    toolCallsInProgress,
    errorMessage,
    timestamp: new Date().toISOString(),
    sessionId: sessionId || undefined,
  };
}

/**
 * Options for writing the ask-human message
 */
export interface AskHumanOptions {
  /** Directory to write messages to */
  msgsDir: string;

  /** Agent ID that encountered the error */
  agentId: string;

  /** Error context */
  context: UsagePolicyErrorContext;

  /** Optional task ID for correlation */
  taskId?: string;
}

/**
 * Write an ask-human message for Usage Policy error intervention
 * Returns the filepath of the written message
 */
export function writeUsagePolicyAskHuman(options: AskHumanOptions): string {
  const { msgsDir, agentId, context, taskId } = options;

  const timestamp = Math.floor(Date.now() / 1000);
  const msgId = `usage-policy-error-${taskId || timestamp}`;
  const safeAgentId = agentId.replace('/', '-');
  const filename = `${timestamp}-ask-human-${safeAgentId}--core-core-${msgId}.md`;
  const filepath = path.join(msgsDir, filename);

  // Ensure msgsDir exists
  if (!fs.existsSync(msgsDir)) {
    fs.mkdirSync(msgsDir, { recursive: true });
  }

  // Format recent history for display
  const historySection = context.recentHistory.length > 0
    ? context.recentHistory.map((h, i) => `### Turn ${i + 1}\n\`\`\`\n${h.slice(0, 500)}${h.length > 500 ? '...' : ''}\n\`\`\``).join('\n\n')
    : '_No recent history captured_';

  // Format tool calls
  const toolsSection = context.toolCallsInProgress.length > 0
    ? context.toolCallsInProgress.map(t => `- \`${t}\``).join('\n')
    : '_No tool calls in progress_';

  const content = `---
to: core/core
from: ${agentId}
type: ask-human
msg-id: ${msgId}
headline: Usage Policy Error - Human Intervention Required
timestamp: ${context.timestamp}
status: blocked
${context.sessionId ? `session-id: ${context.sessionId}` : ''}
---

## Usage Policy Error Detected

The Claude API returned a Usage Policy violation error. This may be a **false positive** - the content being processed might have been incorrectly flagged.

### Error Message
\`\`\`
${context.errorMessage}
\`\`\`

### Agent Information
- **Agent**: \`${context.agentId}\`
- **Mesh**: \`${context.meshName}\`
- **Time**: ${context.timestamp}
${context.sessionId ? `- **Session ID**: \`${context.sessionId}\`` : ''}

### What Triggered This?

#### Prompt (truncated)
\`\`\`
${context.triggeringPrompt.slice(0, 1000)}${context.triggeringPrompt.length > 1000 ? '\n... (truncated)' : ''}
\`\`\`

#### Tool Calls In Progress
${toolsSection}

#### Recent Conversation History
${historySection}

---

## Recommended Actions

Please review the context above and choose one of the following:

1. **Retry** - If this appears to be a false positive, respond with:
   \`\`\`
   action: retry
   \`\`\`

2. **Skip** - Skip this task and continue:
   \`\`\`
   action: skip
   \`\`\`

3. **Modify Prompt** - Provide a modified version of the prompt:
   \`\`\`
   action: retry
   modified_prompt: |
     [Your modified prompt here]
   \`\`\`

4. **Abort** - Stop the mesh execution entirely:
   \`\`\`
   action: abort
   \`\`\`

---

**Note**: This error handling system exists because Claude's content filtering can sometimes produce false positives, especially when processing code that discusses security concepts, error handling, or other technical topics.
`;

  fs.writeFileSync(filepath, content);

  log.info('usage-policy-error', 'Wrote ask-human message for Usage Policy error', {
    agentId,
    filepath,
    msgId,
    sessionId: context.sessionId,
  });

  return filepath;
}

/**
 * Custom error class for Usage Policy violations
 * Wraps the original error with context for recovery
 */
export class UsagePolicyViolationError extends Error {
  public readonly context: UsagePolicyErrorContext;
  public readonly askHumanFilepath?: string;

  constructor(
    originalError: Error | string,
    context: UsagePolicyErrorContext,
    askHumanFilepath?: string
  ) {
    const message = typeof originalError === 'string' ? originalError : originalError.message;
    super(`Usage Policy Error: ${message}`);
    this.name = 'UsagePolicyViolationError';
    this.context = context;
    this.askHumanFilepath = askHumanFilepath;
  }
}

/**
 * Handle a Usage Policy error by capturing context and writing ask-human message
 *
 * @param error - The original error
 * @param agentId - Agent that encountered the error
 * @param userPrompt - The prompt that triggered the error
 * @param sessionOutput - Recent session output
 * @param msgsDir - Directory to write ask-human message
 * @param sessionId - Optional session ID for resume
 * @param taskId - Optional task ID for correlation
 *
 * @returns UsagePolicyViolationError with context and ask-human filepath
 */
export function handleUsagePolicyError(
  error: Error | string,
  agentId: string,
  userPrompt: string,
  sessionOutput: string[],
  msgsDir: string,
  sessionId?: string | null,
  taskId?: string
): UsagePolicyViolationError {
  // Capture diagnostic context
  const context = captureErrorContext(
    error,
    agentId,
    userPrompt,
    sessionOutput,
    sessionId
  );

  log.warn('usage-policy-error', 'Handling Usage Policy error', {
    agentId,
    meshName: context.meshName,
    hasSessionId: !!sessionId,
    historyLength: context.recentHistory.length,
    toolsInProgress: context.toolCallsInProgress,
  });

  // Write ask-human message
  const askHumanFilepath = writeUsagePolicyAskHuman({
    msgsDir,
    agentId,
    context,
    taskId,
  });

  return new UsagePolicyViolationError(error, context, askHumanFilepath);
}
