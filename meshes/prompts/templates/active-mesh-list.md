# Active Meshes and Agents

This is a list of currently active meshes and agents in the system. You can ask questions to any agent listed below using the Ask capability.

## Available Agents

**Format for asking**: When you create an ask message, use the format `{mesh}/{agent}` for the `to` field.

{{activeMeshList}}

### No Active Agents

If no agents are listed above, there are no other active meshes or agents to ask questions to. You'll need to spawn agents first using `tx spawn {mesh} {agent}`.

## How to Ask a Question

1. Write a message file with:
   - `to: {mesh}/{agent}` (pick an agent from the list above)
   - `type: ask`
   - `msg-id: q-something-meaningful`

2. Save it to your `msgs/` directory

3. The ask will be delivered fast-track to the other agent

4. Wait for their response (they'll write an ask-response with the same msg-id)

## Example

```markdown
---
from: research/searcher
to: research/analyzer
type: ask
msg-id: q-verify-sources
status: pending
timestamp: 2025-10-20T12:00:00Z
---

# Question

I found 10 sources about climate change. Can you verify that at least 5 are peer-reviewed?

Context: I need confidence that our sources are reliable before proceeding.
```
