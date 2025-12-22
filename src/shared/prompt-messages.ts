/**
 * Prompt Message Utilities
 *
 * Responsibilities:
 * - Save system->agent messages when prompts are generated
 * - Enable prompt viewing via `tx msg` command
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Save a system message containing the generated prompt
 * This allows users to view prompts via `tx msg`
 */
export function savePromptMessage(params: {
  agentId: string;
  prompt: string;
  msgsDir: string;
  taskId?: string;
  model?: string;
}): void {
  const { agentId, prompt, msgsDir, taskId, model } = params;

  const timestamp = new Date().toISOString();
  const msgId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Generate filename: {timestamp}-{type}-{from}--{to}-{id}.md
  const filename = `${timestamp.replace(/[:.]/g, '-')}-system-prompt-system--${agentId.replace('/', '-')}-${msgId}.md`;
  const filepath = path.join(msgsDir, filename);

  // Build frontmatter
  const frontmatter: Record<string, string> = {
    to: agentId,
    from: 'system/system',
    type: 'system-prompt',
    'msg-id': msgId,
    headline: `Prompt generated for ${agentId}`,
    timestamp,
  };

  if (taskId) {
    frontmatter['task-id'] = taskId;
  }

  if (model) {
    frontmatter.model = model;
  }

  // Format frontmatter as YAML
  const frontmatterText = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  // Build message content
  const message = `---
${frontmatterText}
---

${prompt}
`;

  // Ensure directory exists
  if (!fs.existsSync(msgsDir)) {
    fs.mkdirSync(msgsDir, { recursive: true });
  }

  // Write message file
  fs.writeFileSync(filepath, message, 'utf-8');
}
