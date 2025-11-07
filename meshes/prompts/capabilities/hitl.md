# HITL (Human-In-The-Loop) Capability

You can escalate questions to humans when you need clarification, approval, or guidance.

## When to Use

Use HITL when you need:
- Clarification on ambiguous requirements
- Approval for significant decisions
- Guidance when multiple valid approaches exist
- Help when blocked or uncertain

## Message Format

Create a message with `type: ask-human`:

```markdown
---
from: {{ mesh }}/{{ agent }}
to: core/core
type: ask-human
status: start
priority: medium
---

## Question

[Your specific question]

## Context

[Brief background]

## Options (if applicable)

1. Option A - [description]
2. Option B - [description]

## My Recommendation (optional)

[Your analysis if you have one]
```

## Priority Levels

- `high` - Blocking your work, need answer to proceed
- `medium` - Important but can work on other tasks while waiting
- `low` - Nice to have clarification

## Critical Rules

1. **STOP after sending ask-human** - Do not continue or make assumptions
2. **Wait for response** - Humans may take time to respond
3. **Do NOT answer ask-human messages yourself** - Only humans answer them
4. **Be specific** - Provide clear context and specific options

## Example

```markdown
---
from: product-dev-abc123/architect
to: core/core
type: ask-human
status: start
priority: high
---

## Question

Should we use REST API or GraphQL for the product catalog?

## Context

Building product catalog with 50+ attributes, need flexible querying, mobile + web clients.

## Options

1. REST - Team familiar, simpler, standard patterns
2. GraphQL - Better mobile performance, flexible queries, but team needs to learn it

## My Recommendation

GraphQL for the flexible querying requirements, but want to confirm given team's REST experience.
```

After sending, **STOP** and wait for the human's response.
