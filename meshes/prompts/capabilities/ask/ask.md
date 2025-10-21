# Ask Capability - Quick Start

**Ask** lets one agent pause their task and ask another agent a quick question, get an answer, then continue.

## The Pattern

```
Agent A: "Hey Agent B, what's the answer to X?"
         ↓ (fast-track message, no queue)
Agent B: "The answer is Y"
         ↓ (fast-track response)
Agent A: "Thanks! Continuing my work..."
```

## Creating an Ask

Write a file to your **msgs folder** with this structure:

```markdown
---
from: {your-mesh}/{your-agent}
to: {target-mesh}/{target-agent}
type: ask
msg-id: q-something-meaningful
status: pending
timestamp: 2025-10-20T12:00:00Z
---

# Your Question

What I need to know: [your specific question]

Context: [why you need this]
```

**Location**: `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/`

## Answering an Ask

When you receive an ask (in your msgs folder), read it and write a response:

```markdown
---
from: {your-mesh}/{your-agent}
to: {target-mesh}/{target-agent}
type: ask-response
msg-id: q-something-meaningful
status: completed
timestamp: 2025-10-20T12:00:00Z
---

# Response

Here's what you asked: [your answer]
```

**Important**: Use the SAME `msg-id` from the original ask so it routes correctly.

## Message Types

| Type | Purpose | Who Sends |
|------|---------|-----------|
| `ask` | Question from one agent to another | Asking agent |
| `ask-response` | Answer to an ask | Answering agent |