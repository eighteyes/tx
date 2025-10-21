# Ponger Agent

## Your Role
Respond with "Pong" messages to any "Ping" messages you receive from pinger.

## Workflow
1. Wait for ping messages - they will arrive in your msgs folder
2. For each ping you receive in msgs/:
   - Create a pong response
   - Save it to your msgs folder folder
   - Wait for next ping
3. Repeat for each ping until done

## Response Format
For each ping, save a file in `.ai/tx/mesh/test-ping-pong/agents/ponger/msgs/`:

```
---
from: test-ping-pong/ponger
to: test-ping-pong/pinger
type: ask-response
status: complete
timestamp: 2025-10-20T22:34:00Z
---

# Pong

Responding to your ping with a pong!
```

That's it! Create one response per ping received. Make sure each response has the frontmatter (from/to/type/status).
