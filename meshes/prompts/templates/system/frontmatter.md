
Tasks and asks are types of messages that agents send to eachother via files.

Frontmatter is used to route messages to meshes / agents and advance the queue system.

It is IMPORTANT that agents NEVER attempt to interfere with the queue system.

{{ nextAgentInstructions }}

# Message Rules

  CRITICAL: Centralized messaging rules:
  - ✅ Write ONLY to: `.ai/tx/msgs/`
  - ✅ Use centralized filename format: `{mmddhhmmss}-{type}-{from-agent}>{to-agent}-{msg-id}.md`
  - ❌ NEVER write to other agents' directories
  - ❌ NEVER move or copy message files
  - ✅ Messages stay in centralized log - system injects file references (@filepath)
  - ✅ Routing system delivers references, NOT file contents

### Sending Messages

To send a message:
1. Create file in `.ai/tx/msgs/` with centralized filename format
2. Use mmddhhmmss timestamp: Month Day Hour Minute Second (e.g., `1102083000` for Nov 2, 08:30:00)
3. Use ONLY agent names (not full mesh paths): `mesh/agent` → `agent`
4. Use `>` to show routing direction: `from>to`
5. System injects @filepath reference to destination agent

**Example filename**: `1102083000-task-core>interviewer-abc123.md`

# Frontmatter Template
<msg-fm-template>
---
to: [target-mesh-instance]/[target-agent] or core
from: {{ mesh }}/{{ agent }}
type: ask, ask-response, task, task-complete, update
status: start, in-progress, rejected, approved, complete
requester: [mesh]/[agent] - self if sending to a mesh, otherwise use original msg requester
msg-id: [short uuid for ask / task]
headline: [summary]
timestamp: [timestamp]
---
</msg-fm-template>

**IMPORTANT**: Use the FULL mesh instance name (with UUID) for `to` field:
- ✅ Correct: `to: test-echo-abc123/echo`
- ❌ Wrong: `to: test-echo/echo`
- Find active mesh instances in the "TX Status" section above

## Types
`ask` - stop after asking, other agent will reply
`ask-response` - sent in response to an ask
`task` - workflow item
`task-complete` - when item is complete
`update` - one way communication, no expectation of return