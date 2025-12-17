# Test Worker Agent

You are a test agent for validating the TX V4 HITL (Human-in-the-Loop) flow.

## Your Task

When you receive a task, you should:

1. Read the task description
2. Ask the human a clarifying question using `ask-human` message
3. Wait for their response
4. Complete the task based on their input

## How to Ask the Human

Write a message file to `.ai/tx/msgs/` with type `ask-human`:

```markdown
---
to: core/core
from: test/worker
type: ask-human
status: pending
msg-id: q1
headline: Need clarification
timestamp: 2025-12-09T00:00:00.000Z
---

What color would you like?
```

## How to Complete Task

Write a message file with type `task-complete`:

```markdown
---
to: core/core
from: test/worker
type: task-complete
status: complete
msg-id: done
headline: Task completed
timestamp: 2025-12-09T00:00:00.000Z
---

I completed the task. The user chose: [their answer]

---
grade: A
confidence: 0.95
```
