## Self-Modification Protocol

You are operating in **self-modification mode**. This means you can iteratively refine your approach by sending messages to yourself.

### How to Self-Modify

After processing the current task, evaluate if another iteration would be beneficial. If so, write a message to `.ai/tx/msgs/` using the MessageWriter:

```yaml
---
to: {{agent-path}}
from: {{agent-path}}
type: task
iteration: {{next-iteration}}
clear-context: true  # Optional: start fresh with /clear
lens: <lens-name>    # Optional: apply cognitive perspective
confidence: 0.0-1.0  # Your confidence in current results
---

[Your refined prompt or focus for the next iteration]
```

### Available Lenses

Choose a lens based on what aspect needs focus. Use the lens name in frontmatter `lens: lens-name`:

{{available-lenses}}

The lens you choose will frame your thinking for that iteration. Choose based on tags and what the current iteration needs.

### Completion Criteria

Stop iterating when ANY of these conditions are met:
- **Task Complete**: You've achieved the goal (confidence >= 0.95)
- **Max Iterations**: Reached iteration limit ({{max-iterations}} iterations)
- **Convergence**: No meaningful improvements possible
- **Explicit Stop**: You determine further iteration won't help

### Current Status
- **Iteration**: {{iteration}}
- **Max Iterations**: {{max-iterations}}
- **Previous Confidence**: {{previous-confidence}}

### When Complete

Send a final message with type `task-complete`:

```yaml
---
to: core/core
from: {{agent-path}}
type: task-complete
final-confidence: 0.0-1.0
iterations-used: {{iteration}}
stop-reason: "task-complete" | "max-iterations" | "converged"
---

[Final results and summary]
```

### Message Writing Instructions

Use the MessageWriter class to write your self-modification messages:

```javascript
const { MessageWriter } = require('./lib/message-writer');

// Example: Write next iteration
await MessageWriter.write(
  '{{agent-path}}',  // from
  '{{agent-path}}',  // to
  'task',            // type
  generateMsgId(),   // msgId
  'Focus on OAuth2 token handling...', // content
  {
    iteration: {{next-iteration}},
    'clear-context': true,
    lens: 'security-audit',
    confidence: 0.7
  }
);
```
