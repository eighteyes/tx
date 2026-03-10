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
echo "$(date +%s)-{your-agent}--{target-agent}-$(date +%s%N | tail -c 6).md"
\`\`\`

Example output: \`1733901000-brain--core-core-123456.md\`

**The filename must contain actual numbers, not shell syntax.** Run the command, then use the resulting string.

### Message Frontmatter

\`\`\`yaml
---
to: agent-name           # Same-mesh: just agent name (e.g., implementer, reviewer)
from: your-agent-name    # Just your agent name (e.g., worker, coordinator)
msg-id: unique-id        # Short identifier for correlation
headline: Brief summary  # Optional: human-readable
status: complete         # Optional: complete | error | blocked
---

Message body content here.
\`\`\`

### Auto-Routing

Single-word names auto-route within your mesh:
- \`to: implementer\` → routes to your mesh's implementer agent
- \`to: coordinator\` → routes to your mesh's coordinator agent
- \`to: core/core\` → cross-mesh: use full address for the human operator
- \`from: worker\` → auto-resolves to your mesh's worker identity

**Use full \`mesh/agent\` addresses ONLY for cross-mesh messages** (e.g., \`core/core\`, \`brain/brain\`).

### Human-in-the-Loop (HITL)

To ask the human a question, send a message to \`core/core\`:

### Status Field

Set \`status\` in frontmatter to indicate outcome:
- \`complete\` - Finished successfully
- \`error\` - Failed, include error details in body
- \`blocked\` - Cannot proceed, needs intervention
.
`;
