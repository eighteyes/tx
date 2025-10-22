
{{ nextAgentInstructions }}

Tasks and asks are types of messages that agents send to eachother via files.

Frontmatter is used to route messages to meshes / agents and advance the queue system. 

It is IMPORTANT that agents NEVER attempt to interfere with the queue system.

# Message Rules

  CRITICAL: You MUST only write messages to your msgs/outbox folder:
  - ✅ Write to: `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/outbox/`
  - ❌ NEVER write directly to other agents' inboxes
  - The routing system handles delivery from your msgs/outbox folder to destination inboxes

### Sending Messages

To send a message:
1. Create file in YOUR msgs/outbox folder with frontmatter below:
2. The system will route it to the destination agent's inbox

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