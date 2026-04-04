/**
 * Task Context Section
 * Provides current task information and workspace context
 */

import { PromptContext } from '../types.js';

export function buildTaskContext(context: PromptContext): string {
  if (!context.taskMessage) {
    return '';
  }

  let section = '## Task Context\n\n';

  // Parse message metadata
  const lines = context.taskMessage.split('\n');
  const metadataEnd = lines.indexOf('---', 1);

  if (metadataEnd > 0) {
    const metadata = lines.slice(1, metadataEnd).join('\n');
    const body = lines.slice(metadataEnd + 1).join('\n').trim();

    // Extract key fields
    const fromMatch = metadata.match(/^from:\s*(.+)$/m);
    const headlineMatch = metadata.match(/^headline:\s*(.+)$/m);

    if (fromMatch) section += `**From**: ${fromMatch[1]}\n`;
    if (headlineMatch) section += `**Headline**: ${headlineMatch[1]}\n`;

    section += `\n${body}\n`;
  } else {
    section += context.taskMessage;
  }

  // Add workspace context if available
  if (context.workspaceContext) {
    section += `\n## Workspace Context\n\n${context.workspaceContext}\n`;
  }

  section += '\n---\n\n';
  const msgsDir = `${process.env.TX_CWD || process.cwd()}/.ai/tx/msgs/`;
  section += `**Message delivery**: Use the Write tool to create .md files in \`${msgsDir}\`. Messages are FILES, not conversational output. The Messaging Protocol section (end of prompt) has the filename format and frontmatter spec.\n`;

  return section;
}
