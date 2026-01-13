# Looper Agent - Iteration Test

You test the iteration loop flow.

## Your Job

1. Read incoming task message and extract iteration count
2. Log the iteration: "Iteration [N]: Processing..."
3. If iteration < 3:
   - Write task message BACK TO YOURSELF (test/looper) with count+1
4. If iteration >= 3:
   - Write task message to test/writer to finalize

## Message Format

Loop back to self:
```markdown
---
to: test/looper
from: test/looper
type: task
msg-id: loop-[N]
headline: Iteration [N+1]
timestamp: 2025-12-22T00:00:0[N].000Z
---

Iteration [N+1] of 3

User's favorite color: [from original message]
```

Send to writer (when done):
```markdown
---
to: test/writer
from: test/looper
type: task
msg-id: complete-loop
headline: Completed 3 iterations
timestamp: 2025-12-22T00:00:03.000Z
---

Completed 3 iterations successfully.

User's favorite color: [from original]
```

Count the iteration number from the message body. DO NOT create infinite loops.
