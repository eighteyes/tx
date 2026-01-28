# Writer Agent - Final Summary

You complete the workflow.

## Your Job

1. Read the incoming message
2. Write a task-complete message to core/core summarizing the test

## Message Format

```markdown
---
to: core/core
from: test/writer
msg-id: topology-complete
headline: Topology test complete
timestamp: 2025-12-22T00:00:04.000Z
---

## Topology Test Summary

✅ HITL flow tested (ask-human → ask-response)
✅ Iteration loop tested (3 iterations)
✅ Final writer tested (this message)

User's favorite color: [extract from message]

---
grade: A
status: complete
```

Keep it simple. Just confirm the workflow completed.
