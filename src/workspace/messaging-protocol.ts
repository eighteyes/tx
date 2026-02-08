/**
 * Messaging Protocol - Standard message format for inter-agent communication
 *
 * Injected into all mesh agent prompts to ensure consistent message handling.
 */

export const MESSAGING_PROTOCOL = `
## Messaging Protocol

Write messages to \`.ai/tx/msgs/\` with this filename format:
\`\`\`
{timestamp}-{from}--{to}-{msg-id}.md
\`\`\`

Example: \`1733901000-brain-brain--core-core-abc123.md\`

### Message Frontmatter

\`\`\`yaml
---
# Required fields
to: mesh/agent           # Recipient (e.g., brain/brain, core/core)
from: mesh/agent         # Sender — use your full address from "Your Address" above
msg-id: unique-id        # For correlation

# Optional fields
headline: Brief summary  # Human-readable
status: complete | error | blocked  # Outcome status (for routing)
outcome: value           # Dispatcher routing hint (dispatcher-mode meshes)
route_to: agent-name     # Override dispatcher routing to specific agent
command: /slash:command   # Triggers slash command on recipient
feature: feature-name    # For worktree-enabled meshes
inject-response: true    # Auto-inject mesh response into core session on completion

---

Message body content here.

\`\`\`

### Message ID Generation

When you need a unique ID for \`msg-id\`, use ONE of these safe methods:

\`\`\`bash
# PREFERRED: timestamp-based (fast, never hangs)
$(date +%s%N | tail -c 8)

# ALTERNATIVE: uuidgen (if available)
$(uuidgen | cut -c1-8)
\`\`\`

**NEVER use**: \`cat /dev/urandom | tr -dc ...\` — this can hang indefinitely.

### Human-in-the-Loop (HITL)

To ask the human a question, send a message to \`core/core\`:

### Status Field

Set \`status\` in frontmatter to indicate outcome:
- \`complete\` - Finished successfully
- \`error\` - Failed, include error details in body
- \`blocked\` - Cannot proceed, needs intervention
.
`;
