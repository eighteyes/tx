# Multi-Agent Communication Patterns

Advanced patterns for agents communicating with each other (beyond simple request-response).

## Bidirectional Exchange (Ping-Pong)

Two agents exchange multiple messages back and forth.

### Use Case
- A→B→A→B message chains
- Question/answer with follow-ups
- Collaborative workflows
- Back-and-forth refinement

### Pattern

```
Core spawns mesh with 2 agents
Core sends task to Agent A
Agent A sends message 1 to Agent B
Agent B receives and responds
Agent A receives response
Agent A sends message 2 to Agent B
Agent B responds
...repeat...
Agent A sends final completion to Core
```

### Config Example

```json
{
  "mesh": "test-ping-pong",
  "description": "Bidirectional agent communication",
  "agents": ["test/pinger", "test/ponger"],
  "entry_point": "pinger",
  "completion_agent": "pinger",
  "workflow_topology": "bidirectional"
}
```

**Key points:**
- `entry_point` = agent that receives initial task
- `completion_agent` = agent that reports final result to core
- Both agents in array, can communicate freely

### Agent A (Initiator) Prompt

```markdown
## Your Role
Send multiple messages to Agent B and collect responses.

## Workflow
1. Receive task from core
2. For message N:
   - Send to Agent B
   - Wait for response
   - Record response
3. After all messages exchanged, send completion to core

## Sending Messages
Use `/ask agent-b-name "message content"`

## Receiving Responses
Responses arrive in your inbox. Read from msgs/active/.

## Reporting Completion
Save completion file to msgs/outbox/:
```markdown
---
from: mesh/agent-a
to: core
type: task-complete
status: complete
---
# Result
[summary]
```

### Agent B (Responder) Prompt

```markdown
## Your Role
Respond to each message from Agent A.

## Workflow
1. Wait for message in msgs/inbox/
2. Read message from msgs/active/
3. Create response
4. Save to msgs/outbox/ with frontmatter

## Response Format
```markdown
---
from: mesh/agent-b
to: mesh/agent-a
type: ask-response
status: complete
---
# Response
[your response]
```

### Message Files Created

```
Agent A msgs/outbox/  → ask-msg-1.md
Agent B msgs/inbox/   ← routed here
Agent B msgs/active/  ← moved here for processing
Agent B msgs/outbox/  → ask-response-1.md
Agent A msgs/inbox/   ← routed here
Agent A msgs/active/  ← moved here for processing
(repeat for message 2, 3, etc.)
```

### Full Flow Example

```markdown
# File: ask-msg-1.md (Agent A → B)
---
from: test-ping-pong/pinger
to: test-ping-pong/ponger
type: ask
status: start
---
Ping 1: Hello from pinger

# File: ask-response-1.md (Agent B → A)
---
from: test-ping-pong/ponger
to: test-ping-pong/pinger
type: ask-response
status: complete
---
Pong 1: Hello from ponger
```

## Fan-Out Pattern

One agent distributes tasks to multiple agents in parallel.

### Use Case
- Process different parts of data in parallel
- Distribute work load
- Collect results from multiple agents

### Config

```json
{
  "mesh": "analysis",
  "agents": [
    "analysis/distributor",
    "analysis/sentiment",
    "analysis/entities",
    "analysis/keywords"
  ],
  "entry_point": "distributor",
  "completion_agent": "distributor",
  "workflow_topology": "parallel"
}
```

### Flow

```
Core → Distributor
       ├→ Sentiment Agent (processes in parallel)
       ├→ Entity Agent (processes in parallel)
       └→ Keyword Agent (processes in parallel)
       ← Results collected
       → Core
```

## Iterative Refinement with Feedback Loops

Multiple iterations where one agent requests changes and approves based on versions.

### Use Case
- Approval workflows (draft → feedback → revision → approval)
- Quality gates (QA reject → fix → QA approve)
- Collaborative refinement
- Multi-pass processing

### Pattern

```
Worker submits Version 1
  ↓ Reviewer: "needs revision"
  ↓ Worker: creates Version 2
  ↓ Reviewer: "approved"
  ↓ Worker: reports completion
```

### Config

```json
{
  "mesh": "iterative-workflow",
  "type": "iterative",
  "agents": ["workflow/worker", "workflow/reviewer"],
  "entry_point": "worker",
  "completion_agent": "worker",
  "workflow_topology": "bidirectional"
}
```

### Key Implementation Details

1. **Version Markers in Message Content**
   - Include "Version 1", "Version 2", etc. in the actual message text
   - Agents read content to determine which version they're reviewing
   - Simpler than complex state tracking

2. **Conditional Response Logic**
   - Reviewer reads version number from message
   - If Version 1 → send "needs revision" feedback
   - If Version 2 → send "approved" response
   - Agents respond based on message content, not external state

3. **Simple Feedback Signals**
   - Don't overcomplicate feedback
   - "needs revision" or "approved" works fine
   - Claude understands these simple approval signals

4. **Pseudo-Antagonistic Pattern**
   - Reviewer intentionally rejects on first pass
   - Accepts on second pass (or after certain conditions)
   - Great for testing approval workflows
   - Can implement QA gates, validation checks, etc.

### Full Workflow Example

```markdown
# Message 1: Worker submits v1
---
from: iterative/worker
to: iterative/reviewer
type: ask
---
# Work Version 1
Initial draft for your review.

# Message 2: Reviewer feedback
---
from: iterative/reviewer
to: iterative/worker
type: ask-response
---
# Feedback on Version 1
This needs more work. Please revise and resubmit.

# Message 3: Worker submits v2
---
from: iterative/worker
to: iterative/reviewer
type: ask
---
# Work Version 2
Revised version based on your feedback.

# Message 4: Reviewer approval
---
from: iterative/reviewer
to: iterative/worker
type: ask-response
---
# Feedback on Version 2
Looks good! Approved.

# Message 5: Worker completion
---
from: iterative/worker
to: core
type: task-complete
---
# Iteration Complete
Completed after 2 iterations.
```

## Sequential Pipeline

Agents process data in sequence, each transforming it.

### Use Case
- Extract → Process → Validate → Format
- Multi-stage transformation
- Quality gates between stages

### Config

```json
{
  "mesh": "pipeline",
  "agents": [
    "stages/extractor",
    "stages/processor",
    "stages/validator",
    "stages/formatter"
  ],
  "entry_point": "extractor",
  "completion_agent": "formatter",
  "workflow_topology": "sequential"
}
```

### Flow

```
Core → Extractor
       ↓ (passes result)
       Processor
       ↓ (passes result)
       Validator
       ↓ (passes result if valid)
       Formatter
       ↓
       Core
```

## Best Practices for Multi-Agent Meshes

### 1. Keep Agent Prompts Simple
- One clear responsibility per agent
- Step-by-step instructions
- Explicit message formats

❌ **Bad**: "Process the data intelligently considering all factors"
✅ **Good**: "For each item: extract name, save to outbox with frontmatter"

### 2. Use Clear Frontmatter
Always include:
- `from: mesh/agent-name`
- `to: mesh/recipient`
- `type: ask` or `ask-response` or `task-complete`
- `status: start` or `complete` or `pending`

### 3. Explicit Message Filenames
Use patterns like:
- `ask-msg-1.md` - First message
- `ask-response-1.md` - Response to first message
- `task-complete.md` - Final completion

### 4. Test with E2E Tests
Use `testing-meshes` skill to validate:
- Both agents spawn
- Messages exchange correctly
- Completion reaches core
- Idle sequencing works

### 5. Validate via Tmux
Debug with:
```bash
# Watch pinger
tmux attach -t mesh-name-agent-name

# Check tmux output for messages
tmux capture-pane -t mesh-name-agent-name -p | grep -E 'inbox|outbox|complete'

# Check core
tx attach  # or tmux attach -t core
```

## Common Issues & Solutions

### Agents Not Responding
- **Cause**: Prompt too complex or unclear
- **Fix**: Simplify prompt to step-by-step instructions

### Messages Not Routed
- **Cause**: Missing or incorrect frontmatter
- **Fix**: Ensure all messages have from/to/type/status fields

### Agents Deadlocked
- **Cause**: Agent A waiting for Agent B response while Agent B waiting for next message
- **Fix**: Design prompts so Agent B completes before Agent A continues waiting

### Timeout in Tests
- **Cause**: Test timeout too short for multi-agent exchanges
- **Fix**: Increase test timeout; multi-agent takes longer

### Agent Never Completes
- **Cause**: Agent waiting for something that won't arrive
- **Fix**: Debug with tmux; check msgs/active/ and msgs/inbox/

## References

- **[mesh-config-reference.md](mesh-config-reference.md)** - Config field reference
- **[agent-config-reference.md](agent-config-reference.md)** - Agent config reference
- **[prompt-templates.md](prompt-templates.md)** - Prompt templates
- **[workflows.md](workflows.md)** - Message format and routing
