

{{ routingInstructions }}

### Sending Messages

**CRITICAL**: ALL messages MUST be written to `.ai/tx/msgs/` using the FULL PATH.

### Message Filename Format

**Full path format**: `.ai/tx/msgs/{mmddhhmmss}-{type}-{from-agent}--{to-agent}-{msg-id}.md`

**Components**:
1. **Directory**: ALWAYS `.ai/tx/msgs/` (NEVER write to current directory)
2. **Timestamp**: mmddhhmmss = Month Day Hour Minute Second (e.g., `1102083000` for Nov 2, 08:30:00)
3. **Type**: Message type (task, ask, ask-response, task-complete, update)
4. **From agent**: ONLY agent name (not full mesh/agent path)
5. **To agent**: ONLY agent name (not full mesh/agent path)
6. **Message ID**: Short unique identifier

**Example FULL PATH**: `.ai/tx/msgs/1102083000-task-core--interviewer-doatask.md`

**WRONG** ❌: `1102083000-task-core--interviewer-doatask.md` (missing directory)
**WRONG** ❌: `coordinator-blocked.md` (missing directory and wrong format)
**WRONG** ❌: `./coordinator-blocked.md` (wrong directory)
**RIGHT** ✅: `.ai/tx/msgs/1102083000-task-core--interviewer-doatask.md`

### Frontmatter Template
Frontmatter is used to route messages to meshes / agents and advance the queue system.
It is IMPORTANT that agents NEVER attempt to interfere with the queue system.

1. Select an appropriate type for the message. 

<msg-fm-template>
---
to: [target-mesh-instance]/[target-agent] or core
from: {{ mesh }}/{{ agent }}
type: ask, ask-response, task, task-complete, update
status: start, in-progress, rejected, approved, complete, blocked
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
`ask` - request information, stop after asking, other agent will reply
`ask-human` - send to core, block until human responds
`ask-response` - sent in response to an ask
`task` - referring to a workflow item
`task-complete` - when item is complete
`update` - one way communication, no expectation of return