/**
 * Messaging Protocol - Standard message format for inter-agent communication
 *
 * Injected into all mesh agent prompts to ensure consistent message handling.
 */

export const MESSAGING_PROTOCOL = `
## Messaging Protocol

Write messages to \`.ai/tx/msgs/\` with this filename format:
\`\`\`
{timestamp}-{type}-{from}--{to}-{msg-id}.md
\`\`\`

Example: \`1733901000-task-complete-brain-brain--core-core-abc123.md\`

### Message Frontmatter

\`\`\`yaml
---
to: mesh/agent           # Recipient (e.g., brain/brain, core/core)
from: mesh/agent         # Sender (your agent ID)
type: task | task-complete | ask | ask-response | ask-human
msg-id: unique-id        # For correlation
headline: Brief summary  # Human-readable
timestamp: ISO-8601      # When created
status: complete | error | blocked  # Outcome status (for routing)
command: /slash:command  # Optional: triggers slash command on recipient
---

Message body content here.

Markdown formatting supported.
\`\`\`

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| \`task\` | core → worker | Assign work |
| \`task-complete\` | worker → core/agent | Report completion with results |
| \`ask\` | agent → agent | Request information |
| \`ask-response\` | agent → agent | Provide answer |
| \`ask-human\` | worker → core | Request human input (HITL) |

### Status Field

Set \`status\` in frontmatter to indicate outcome:
- \`complete\` - Task finished successfully
- \`error\` - Task failed, include error details in body
- \`blocked\` - Cannot proceed, needs intervention

The \`status\` field determines message routing when routing tables are configured.
`;
