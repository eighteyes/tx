# Workflow Patterns & Message Specifications

Common mesh patterns and detailed message specification.

## Message Format Specification

### Message File Naming

```
YYMMDDHHMM-[shortname].md
```

**Example**: `2510201800-initial-task.md`

**Format**:
- `YY` - Year (25 = 2025)
- `MM` - Month (10 = October)
- `DD` - Day (20)
- `HH` - Hour (18)
- `MM` - Minute (00)
- `[shortname]` - Description (no spaces, hyphens ok)

### Frontmatter Specification

Every message file starts with YAML frontmatter:

```markdown
---
to: mesh/agent OR agent (within mesh) OR mesh (single-agent)
from: mesh/this-agent
type: ask | ask-response | task | task-complete | update
status: start | in-progress | rejected | approved
msg-id: {uuid or identifier}
timestamp: {ISO timestamp}
---
```

**Fields**:

| Field | Type | Required | Example |
|-------|------|----------|---------|
| `to` | String | Yes | `test-ask/asker` OR `asker` OR `test-ask` |
| `from` | String | Yes | `core/core` |
| `type` | Enum | Yes | `task`, `task-complete`, `ask`, `ask-response` |
| `status` | Enum | Yes | `start`, `in-progress`, `complete`, `rejected` |
| `msg-id` | String | Yes | UUID or short identifier |
| `timestamp` | String | Optional | ISO 8601 timestamp |

**Message Types**:

- `task` - A task to be performed (core → agent)
- `task-complete` - Task completed response (agent → core)
- `ask` - Question sent to another agent (agent → agent)
- `ask-response` - Answer to a question (agent → agent)
- `update` - Status update during work

**Recipient Patterns**:

```markdown
# Full path (always works)
to: test-ask/asker

# Agent name only (within same mesh)
to: answerer

# Mesh name only (single-agent mesh)
to: test-echo
```

### Message Content

After frontmatter, add markdown content:

```markdown
---
from: core/core
to: test-ask/asker
type: task
status: start
msg-id: task-001
---

# Task: Ask Questions

Ask these 5 questions to the answerer:
1. What is 2 + 2?
2. What is the capital of France?
3. ...
```

## Common Workflow Patterns

### Pattern 1: Simple Linear Workflow

```
core → agent → core
```

**Flow**:
1. Core sends task to agent
2. Agent processes
3. Agent sends completion back to core

**Mesh Config**:
```json
{
  "mesh": "simple",
  "agents": ["test/echo"],
  "type": "linear"
}
```

**Messages**:
```
[1] core → echo (type: task)
[2] echo → core (type: task-complete)
```

### Pattern 2: Sequential Multi-Agent

```
core → agent1 → agent2 → agent1 → core
```

**Flow**:
1. Core sends to agent1
2. Agent1 sends questions to agent2 via `/ask`
3. Agent2 responds
4. Agent1 collects and sends to core

**Mesh Config**:
```json
{
  "mesh": "multi",
  "agents": ["stage/asker", "stage/answerer"],
  "entry_point": "asker",
  "type": "linear"
}
```

**Messages**:
```
[1] core → asker (type: task)
[2] asker → answerer (type: ask)
[3] answerer → asker (type: ask-response)
[4] asker → core (type: task-complete)
```

### Pattern 3: Parallel Processing

```
core → agent1, agent2, agent3 (parallel)
    ↓
results collected
    ↓
core
```

**Use case**: Multiple agents process different parts in parallel.

**Mesh Config**:
```json
{
  "mesh": "parallel",
  "agents": ["worker/a", "worker/b", "worker/c"],
  "type": "linear",
  "workflow_topology": "parallel"
}
```

**Note**: Core orchestrator needed to track parallel completions.

### Pattern 4: Iterative/Feedback Loop

```
core → agent (iteration 1)
    ↓
    Feedback
    ↓
core → agent (iteration 2)
```

**Use case**: Refinement based on feedback.

**Mesh Config**:
```json
{
  "mesh": "iterative",
  "agents": ["refiner"],
  "type": "iterative",
  "options": {
    "maxIterations": 3
  }
}
```

### Pattern 5: Persistent Service

```
core → agent (stays running)
    ↓
Processes multiple tasks
    ↓
(never ends)
```

**Mesh Config**:
```json
{
  "mesh": "service",
  "agents": ["service/handler"],
  "type": "persistent"
}
```

## Message Flow Examples

### Example 1: Simple Echo

**Setup**: Single agent mesh that echoes input

**Messages**:

```markdown
# Message 1: Task from Core
File: 2510201800-echo-task.md
---
from: core/core
to: echo
type: task
status: start
msg-id: task-echo-001
---

Echo this message: "Hello World"
```

```markdown
# Message 2: Response to Core
File: 2510201801-echo-response.md
---
from: test-echo/echo
to: core
type: task-complete
status: complete
msg-id: task-echo-001
---

# Echo Complete

Original: "Hello World"
Echoed at: 2025-10-20T18:01:00Z
Status: ✅ Complete
```

### Example 2: Ask/Answer Pattern

**Setup**: Asker and answerer agents

**Messages**:

```markdown
# Message 1: Task from Core
File: 2510201800-ask-task.md
---
from: core/core
to: test-ask/asker
type: task
status: start
msg-id: task-ask-001
---

Ask the answerer: "What is 2 + 2?"
```

```markdown
# Message 2: Question from Asker
File: 2510201801-q1.md
---
from: test-ask/asker
to: answerer
type: ask
status: start
msg-id: ask-001
---

What is 2 + 2?
```

```markdown
# Message 3: Answer from Answerer
File: 2510201802-a1.md
---
from: test-ask/answerer
to: asker
type: ask-response
status: complete
msg-id: ask-001
---

The answer is 4.
```

```markdown
# Message 4: Completion from Asker
File: 2510201803-completion.md
---
from: test-ask/asker
to: core
type: task-complete
status: complete
msg-id: task-ask-001
---

# Results

Question: "What is 2 + 2?"
Answer: "4"
Status: ✅ CORRECT
```

## Routing Rules

### Within Same Mesh

**Option 1: Use agent name only**
```markdown
to: answerer
```

**Option 2: Use full path**
```markdown
to: test-ask/answerer
```

Both work. Use short form within mesh, full form across meshes.

### Across Meshes

**Must use full path**:
```markdown
from: mesh-a/agent-a
to: mesh-b/agent-b
```

### Single-Agent Mesh

Can use mesh name directly:
```markdown
to: test-echo
```

Equivalent to:
```markdown
to: test-echo/echo
```

## Design Patterns

### Agent Coordination Pattern

**When to use**: Multiple agents need to work together

```json
{
  "mesh": "coordination",
  "agents": ["coord/orchestrator", "workers/worker1", "workers/worker2"],
  "entry_point": "orchestrator"
}
```

Orchestrator sends tasks to workers, collects results.

### Pipeline Pattern

**When to use**: Sequential processing stages

```json
{
  "mesh": "pipeline",
  "agents": ["stages/extract", "stages/process", "stages/format"],
  "workflow_topology": "sequential"
}
```

Extract → Process → Format chain.

### Fan-Out Pattern

**When to use**: Distribute work to many agents

```json
{
  "mesh": "fanout",
  "agents": ["distributor", "worker1", "worker2", "worker3", "worker4"],
  "entry_point": "distributor"
}
```

Distributor sends different tasks to each worker in parallel.

### Validation Pattern

**When to use**: Check quality before moving forward

```json
{
  "mesh": "validated-pipeline",
  "agents": ["process/worker", "validate/checker", "output/formatter"],
  "type": "linear",
  "workflow_topology": "sequential"
}
```

Worker → Checker → Formatter

## Best Practices

1. **Be explicit with frontmatter** - Always include all fields, even if optional
2. **Use msg-id for tracking** - Helps correlate related messages
3. **Include timestamp** - Helps with debugging timing issues
4. **Keep messages focused** - One message per task/question
5. **Use clear filenames** - Names should indicate message purpose
6. **Document your mesh topology** - Add `workflow_topology` field for clarity
