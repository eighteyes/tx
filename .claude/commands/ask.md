# ask - Ask Another Agent

Send a question or request to another agent in the mesh.

## Usage

```
/ask <agent-name> <question or request>
```

## Examples

```
/ask analyzer Can you analyze the data I saved to shared/output/data.json?
/ask researcher Find the latest research on this topic: machine learning interpretability
/ask validator Check if my results are correct before I mark this task complete
```

## Behavior

- Creates an "ask" type message with unique msg-id
- Sends to target agent inbox (fast-tracked)
- Waits for agent to respond with ask-response message
- Blocks until response is available (up to timeout)
- Response contains requested information

## Message Format

The ask message is formatted as:

```yaml
---
from: {current-mesh}/{current-agent}
to: {target-agent}
type: ask
status: pending
msg-id: {unique-uuid}
timestamp: {iso-8601}
---

# Question/Request

[Your question or request here]
```

## Response

You will receive a response message:

```yaml
---
from: {current-mesh}/{target-agent}
to: {current-mesh}/{current-agent}
type: ask-response
status: completed
msg-id: {same-uuid}
timestamp: {iso-8601}
---

# Response

[Agent's answer here]
```

## Implementation Notes

- Fast-track delivery (no inbox → next → active progression)
- Agent receives ask as immediate active message
- Timeout: Check every 1 minute for response
- Response matched by msg-id
- Works across all agents in the mesh

## Related Commands

- `/tx-done` - Mark task complete
- `/tx-next` - Request next task
