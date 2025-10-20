
{{ nextAgentInstructions }}

Tasks and asks are types of messages that agents send to eachother via files.

Frontmatter is used to route messages to meshes / agents and advance the queue system. 

It is IMPORTANT that agents NEVER attempt to interfere with the queue system.

# Message Rules

  CRITICAL: You MUST only write messages to your outbox:
  - ✅ Write to: `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/outbox/`
  - ❌ NEVER write directly to other agents' inboxes
  - The routing system handles delivery from your outbox to destination inboxes

### Sending Messages

To send a message:
1. Create file in YOUR outbox with frontmatter below:
2. The system will route it to the destination inbox

# Frontmatter Template
<msg-fm-template>
---
to: [next-agent]
from: [mesh]/[this-agent]
type: ask, ask-response, task, task-complete, update
status: start, in-progress, rejected, approved, complete
requester: [mesh]/[agent] - self if sending to a mesh, otherwise use original msg requester
msg-id: [uuid for ask or task]
headline: [summary]
timestamp: [timestamp]
---
</msg-fm-template>

## Types
`ask` - stop after asking, other agent will reply
`ask-response` - sent in response to an ask
`task` - workflow item
`task-complete` - when item is complete
`update` - one way communication, no expectation of return