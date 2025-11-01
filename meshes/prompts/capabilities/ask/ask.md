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

<ask-template>
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

---

<ask-response-template>
## How to Respond

Reply by writing a file to your msgs/ directory with:

```markdown
---
from: {your-mesh}/{your-agent}
to: {original-sender}
type: ask-response
msg-id: q-something-meaningful
status: completed
timestamp: {current-time}
---

# Response

[Your answer here]
```

**Important**: Use the SAME `msg-id` from the ask message above.
</ask-response-template>
```
</ask-template>

**Location**: `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/`

## Message Types

| Type | Purpose | Who Sends |
|------|---------|-----------|
| `ask` | Question from one agent to another | Asking agent |
| `ask-response` | Answer to an ask | Answering agent |