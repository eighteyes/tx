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
# Required fields
to: mesh/agent           # Recipient (e.g., brain/brain, core/core)
from: mesh/agent         # Sender (your agent ID)
type: task | task-complete | ask | ask-response | ask-human
msg-id: unique-id        # For correlation

# Common fields
headline: Brief summary  # Human-readable
timestamp: ISO-8601      # When created
status: complete | error | blocked  # Outcome status (for routing)

# Optional fields
command: /slash:command  # Triggers slash command on recipient
feature: feature-name    # For worktree-enabled meshes
session-id: abc123       # Resume existing session (continuation)
model: haiku | sonnet | opus  # Override agent's default model
priority: high | normal | low  # Message priority (default: normal)
headless: true           # Run without prompt injection (queue only)
in-reply-to: original-msg-id   # REQUIRED for ask-response - correlates to original ask
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

### Ask/Response Correlation (CRITICAL)

**When responding to an \`ask\`, include \`in-reply-to\` with the original ask's msg-id.**

\`\`\`yaml
# Original ask (from coordinator)
---
to: mesh/editor
from: mesh/coordinator
type: ask
msg-id: turn17-review      # ← Note this ID
---

# Your response - use in-reply-to to correlate
---
to: mesh/coordinator
from: mesh/editor
type: ask-response
msg-id: turn17-review-response   # Can be unique
in-reply-to: turn17-review       # ← MUST match original ask's msg-id
---
\`\`\`

The system tracks ask/response pairs by \`in-reply-to\`. Missing or wrong values cause:
- Response rejected as "unknown ask"
- Sender marked as "not responding"
- Potential session termination

**Always include \`in-reply-to\` in ask-response messages.**

### Status Field

Set \`status\` in frontmatter to indicate outcome:
- \`complete\` - Task finished successfully
- \`error\` - Task failed, include error details in body
- \`blocked\` - Cannot proceed, needs intervention

The \`status\` field determines message routing when routing tables are configured.

### Ask-Human Flow (CRITICAL)

When you write an \`ask-human\` message:
1. Your session PAUSES until the human responds
2. DO NOT write \`task-complete\` until you receive \`ask-response\`
3. The system will resume your session with the response

**VIOLATION**: Writing task-complete with pending asks = protocol error

### Recovery Channels (system/*)

Agents can request state guidance by writing to system channels:

| Channel | Purpose |
|---------|---------|
| \`system/help\` | Request state guidance (deliberate) |
| \`system/stuck\` | Declare inability to proceed (deliberate) |
| \`system/*\` | Any other system target (accidental - still handled) |

**Response**: \`type: guidance\` message with:
- Current FSM state and valid exits
- Pending asks that must be resolved
- Worker status and await state
- Suggested next action

**Escalation**: After 3 requests in 60s, escalates to \`core/core\` as \`ask-human\`.

**Example deliberate help request**:
\`\`\`yaml
---
to: system/help
from: narrative-engine/coordinator
type: ask
msg-id: help-123
headline: Need guidance
---

I'm confused about what to do next. My ask to the player hasn't been answered.
\`\`\`

**Example guidance response**:
\`\`\`yaml
---
to: narrative-engine/coordinator
from: system/recovery
type: guidance
msg-id: guidance-123456
in-reply-to: help-123
---

## Current State

| Property | Value |
|----------|-------|
| FSM State | \`awaiting-response\` |
| Worker Status | \`awaiting\` |
| Pending Asks | 1 |

## Suggested Action

Await response to 1 pending ask(s) before sending task-complete.
\`\`\`
`;
