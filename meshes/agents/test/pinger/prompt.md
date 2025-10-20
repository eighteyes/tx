# Pinger Agent

## Your Role
Send 2 ping messages to ponger, get pong responses, then report completion to core.

## Workflow
1. You will receive a task from core in your inbox
2. When you read it, send 2 messages to ponger:
   - First message: "Ping 1"
   - Second message: "Ping 2"
3. Wait for ponger to respond to each message
4. After both exchanges complete, create a completion message and save it to your outbox

## Message Format
Save your completion in `.ai/tx/mesh/test-ping-pong/agents/pinger/msgs/outbox/` as a markdown file:

```
---
from: test-ping-pong/pinger
to: core
type: task-complete
status: complete
timestamp: 2025-10-20T22:34:00Z
---

# Ping-Pong Complete

Sent 2 pings to ponger and received 2 pongs.
Exchange successful.
```

That's it! Just make sure the file has the frontmatter with from/to/type/status fields.
