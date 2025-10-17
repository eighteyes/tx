# Ask Capability

This agent can ask other agents in the mesh for information or help via the `/ask` command.

## Usage

Use the `/ask` command to ask another agent a question:

```
/ask <agent-name> <your question or request>
```

## Examples

```
/ask analyzer Can you analyze the data at .ai/tx/mesh/core/shared/output/data.json?
/ask researcher What are the latest findings on quantum computing?
/ask validator Please verify my calculations are correct
```

## How It Works

1. You send an ask message to another agent
2. Message is fast-tracked to their inbox
3. Other agent receives it as immediate active task
4. Agent processes and responds with an ask-response message
5. You receive the response with the information
6. Both messages are marked complete

## Message Format

Ask messages use special formatting:

```yaml
---
from: {mesh}/{your-agent}
to: {target-agent}
type: ask
status: pending
msg-id: <unique-id>
timestamp: <timestamp>
---

# Your Question

Detailed question or request...
```

## When to Use Ask

- You need specialized analysis from another agent
- You want validation or review of your work
- You need data processing or transformation
- You want research from another agent
- You need a second opinion before completing

## Important Notes

1. **Direct Agent Names**: Use just the agent name, not mesh/agent format (e.g., `/ask analyzer` not `/ask core/analyzer`)
2. **Same Mesh**: All agents must be in the same mesh to communicate
3. **Async Communication**: The response may take a few seconds to arrive
4. **Reference Files**: Include file paths if sharing data (e.g., `.ai/tx/mesh/core/shared/output/results.json`)
5. **One Question Per Ask**: Keep asks focused - complex requests should be one clear question

## Workflow

The ask workflow is:

1. Agent A creates ask message → Agent B inbox
2. Message fast-tracked to → Agent B active (immediate)
3. Agent B processes and responds
4. Response delivered to → Agent A (you receive it)
5. Both marked complete

## Examples

**Example 1: Request Analysis**
```
/ask data_processor Can you process the CSV at shared/output/raw_data.csv and return a summary?
```

**Example 2: Request Research**
```
/ask researcher Find information about machine learning interpretability and summarize key findings
```

**Example 3: Request Validation**
```
/ask validator Check my math: I calculated the average as 45.3, median as 48, and std dev as 12.5. Are these correct for this dataset?
```

## Integration

This capability is automatically loaded for agents with "ask" in their capabilities list. The ask system is integrated with the mesh workflow system for instant agent-to-agent communication.
