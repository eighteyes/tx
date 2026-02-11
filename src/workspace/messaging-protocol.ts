/**
 * Messaging Protocol - Standard message format for inter-agent communication
 *
 * Injected into all mesh agent prompts to ensure consistent message handling.
 */

export const MESSAGING_PROTOCOL = `
## Messaging Protocol

Write messages to \`.ai/tx/msgs/\` with this filename format:
\`\`\`
{unix_epoch_seconds}-{from}--{to}-{short_id}.md
\`\`\`

To generate filenames, run this command and use its output:
\`\`\`bash
echo "$(date +%s)-{your-mesh}-{your-agent}--{target-mesh}-{target-agent}-$(date +%s%N | tail -c 6).md"
\`\`\`

Example output: \`1733901000-brain-brain--core-core-123456.md\`

**The filename must contain actual numbers, not shell syntax.** Run the command, then use the resulting string.

### Message Frontmatter

\`\`\`yaml
---
to: mesh/agent           # Recipient (e.g., brain/brain, core/core)
from: mesh/agent         # Sender — use your full address from "Your Address" above
msg-id: unique-id        # Short identifier for correlation
headline: Brief summary  # Optional: human-readable
status: complete         # Optional: complete | error | blocked
---

Message body content here.
\`\`\`

### Human-in-the-Loop (HITL)

To ask the human a question, send a message to \`core/core\`:

### Status Field

Set \`status\` in frontmatter to indicate outcome:
- \`complete\` - Finished successfully
- \`error\` - Failed, include error details in body
- \`blocked\` - Cannot proceed, needs intervention
.
`;
