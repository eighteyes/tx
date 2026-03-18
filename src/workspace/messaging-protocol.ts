/**
 * Messaging Protocol - Standard message format for inter-agent communication
 *
 * Responsibilities:
 * - Define standard message format for all agents (MESSAGING_PROTOCOL)
 * - Define dispatcher-mode variant that omits core/core references (DISPATCHER_MESSAGING_PROTOCOL)
 *
 * Dispatcher-mode agents route through their mesh sentinel, not core/core.
 * Mentioning core/core in their protocol causes agents to bypass the sentinel.
 */

export const MESSAGING_PROTOCOL = `
## Messaging Protocol

Write messages to \`.ai/tx/msgs/\` with this filename format:
\`\`\`
{unix_epoch_seconds}-{from}--{to}-{short_id}.md
\`\`\`

To generate filenames, run this command and use its output:
\`\`\`bash
echo "$(date +%s)-{mesh-agent}--{target-mesh-agent}-$(date +%s%N | tail -c 6).md"
\`\`\`

Example output: \`1733901000-dev-worker--core-core-123456.md\`

**The filename must contain actual numbers, not shell syntax.** Run the command, then use the resulting string.

### Message Frontmatter

\`\`\`yaml
---
to: agent-name           # Same-mesh: just agent name (e.g., implementer, reviewer)
from: mesh/agent         # Always use full qualified name (e.g., dev/worker, brain/brain)
msg-id: unique-id        # Short identifier for correlation
headline: Brief summary  # Optional: human-readable
status: complete         # Optional: complete | error | blocked
---

Message body content here.
\`\`\`

### Auto-Routing

**Always use full \`mesh/agent\` addresses in \`from:\`** (e.g., \`dev/worker\`, \`brain/brain\`).

For \`to:\`, single-word names auto-route within your mesh:
- \`to: implementer\` → routes to your mesh's implementer agent
- \`to: coordinator\` → routes to your mesh's coordinator agent
- \`to: core/core\` → the human operator

### Human-in-the-Loop (HITL)

To ask the human a question, send a message to \`core/core\`:

### Status Field

Set \`status\` in frontmatter to indicate outcome:
- \`complete\` - Finished successfully
- \`error\` - Failed, include error details in body
- \`blocked\` - Cannot proceed, needs intervention
.
`;

/**
 * Dispatcher-mode messaging protocol.
 * Omits core/core references — dispatcher agents route through their sentinel.
 * The routing section (injected separately) tells agents exactly where to send.
 */
export const DISPATCHER_MESSAGING_PROTOCOL = `
## Messaging Protocol

Write messages to \`.ai/tx/msgs/\` with this filename format:
\`\`\`
{unix_epoch_seconds}-{from}--{to}-{short_id}.md
\`\`\`

To generate filenames, run this command and use its output:
\`\`\`bash
echo "$(date +%s)-{mesh-agent}--{target-mesh-agent}-$(date +%s%N | tail -c 6).md"
\`\`\`

Example output: \`1733901000-dev-worker--dev-dispatch-123456.md\`

**The filename must contain actual numbers, not shell syntax.** Run the command, then use the resulting string.

### Message Frontmatter

\`\`\`yaml
---
to: dispatch              # Always send to your mesh's dispatch sentinel
from: mesh/agent          # Always use full qualified name (e.g., dev/worker)
outcome: complete         # Required: your routing outcome
route_to: agent-name      # Optional: direct to a specific agent
msg-id: unique-id         # Short identifier for correlation
headline: Brief summary   # Optional: human-readable
---

Message body content here.
\`\`\`

### Routing

Send ALL messages to the dispatch sentinel specified in the routing section below. Set \`outcome:\` to indicate your result. The sentinel handles all routing decisions.

### Status Field

Set \`status\` in frontmatter to indicate outcome:
- \`complete\` - Finished successfully
- \`error\` - Failed, include error details in body
- \`blocked\` - Cannot proceed, needs intervention
.
`;
