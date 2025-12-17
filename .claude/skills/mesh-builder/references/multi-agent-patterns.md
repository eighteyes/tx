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
Responses arrive in your msgs/ directory. Read from msgs/active/.

## Reporting Completion
Save completion file to msgs/:
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
1. Wait for message in msgs/
2. Read message from msgs/active/
3. Create response
4. Save to msgs/ with frontmatter

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
Agent A msgs/  → ask-msg-1.md (STAYS in A's msgs/)
Agent B receives  ← @filepath reference (file stays in A's msgs/)
Agent B msgs/  → ask-response-1.md (STAYS in B's msgs/)
Agent A receives  ← @filepath reference (file stays in B's msgs/)
(repeat for message 2, 3, etc.)

NOTE: Messages NEVER move. Only @filepath references are injected.
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

## Human-In-The-Loop (HITL) Pattern

Agent asks questions to gather requirements or clarification from a human user before proceeding with work.

### Use Case
- Requirements gathering via Q&A
- Interactive configuration
- Research topic refinement
- User preference collection
- Ambiguity resolution

### Pattern

```
Core sends task → Agent (interviewer)
Agent creates ask message → Core/User
User responds via ask-response → Agent
Agent processes response
(repeat for multiple questions)
Agent completes task → Core
```

### Config Example

```json
{
  "mesh": "hitl-3qa",
  "description": "Human-in-the-loop Q&A workflow",
  "agents": ["hitl/interviewer"],
  "entry_point": "interviewer",
  "completion_agent": "interviewer",
  "workflow_topology": "hitl"
}
```

### Agent Prompt (Interviewer)

```markdown
## Your Role
Conduct a 3-question interview to gather requirements.

## Workflow
1. Receive task from core
2. For each question:
   - Write ask message to core
   - Wait for ask-response from user
   - Record the answer
3. After 3 questions, synthesize results and send completion

## Ask Message Format
```markdown
---
to: core/core
from: hitl-3qa/interviewer
type: ask
msg-id: q1-topic-name
status: pending
requester: core/core
headline: Question 1: Topic
---
# Question 1
What are your primary concerns about [topic]?
```

## Response Format (What You Receive)
```markdown
---
to: hitl-3qa/interviewer
from: core/core
type: ask-response
msg-id: q1-topic-name
status: complete
---
# Response
[User's answer]
```

## Completion Format
```markdown
---
from: hitl-3qa/interviewer
to: core/core
type: task-complete
status: complete
---
# Interview Results
Conducted 3-question interview. Key findings:
[synthesis]
```
```

### Testing HITL with E2EWorkflow

Use `E2EWorkflow` from `lib/e2e-workflow.js` with HITL configuration:

```javascript
const workflow = new E2EWorkflow(
  'hitl-3qa',
  'interviewer',
  'spawn hitl-3qa mesh to conduct an interview about AI safety',
  {
    workflowTimeout: 120000,
    hitl: {
      enabled: true,
      autoRespond: true,
      maxQuestions: 3,
      questionTimeout: 60000,
      responses: {
        'default': 'My primary concern is...',
        'pattern:/concern|worry/i': 'My primary concern about safety...',
        'pattern:/solution|approach/i': 'The most promising approach...',
        'pattern:/priority|next/i': 'The next priority should be...'
      }
    }
  }
);

const passed = await workflow.test();
```

### HITL Configuration Options

- `enabled`: Enable HITL auto-response mode
- `autoRespond`: Automatically respond to ask messages (for testing)
- `maxQuestions`: Maximum number of questions to handle
- `questionTimeout`: Max time to wait for each question (ms)
- `responses`: Object mapping patterns to responses
  - `'default'`: Fallback response if no pattern matches
  - `'pattern:/regex/i'`: Use regex to match question content
  - Direct text matching also supported

### How HITL Auto-Response Works

1. **Background Polling**: Starts in background at test Step 2.5 (before agent receives task)
2. **Directory Watching**: Monitors `.ai/tx/mesh/{mesh-instance-id}/agents/{agent}/msgs/` for new ask messages
3. **Message Detection**: Polls every 100ms for new ask files (type: `ask`, status: `pending`)
4. **Response Matching**:
   - Reads ask message content
   - Tests against pattern regex (if specified with `pattern:/regex/i`)
   - Falls back to `default` response if no match
5. **Response Injection**:
   - Creates ask-response file in agent's msgs directory
   - Uses `@filepath` injection to make response available to agent
   - Waits 5s for agent to process response
6. **Completion**: Continues until `maxQuestions` reached or no new questions for `questionTimeout` period

### Critical Implementation Detail: Directory Path

**IMPORTANT**: Mesh instance directories include UUID suffix:
- Session name: `hitl-3qa-858fc7-interviewer`
- Mesh instance ID: `hitl-3qa-858fc7` (extracted from session name)
- Directory path: `.ai/tx/mesh/hitl-3qa-858fc7/agents/interviewer/msgs/`

**Extract mesh instance ID from session name**:
```javascript
const meshInstanceId = this.meshSession.replace(`-${this.agentName}`, '');
// "hitl-3qa-858fc7-interviewer" → "hitl-3qa-858fc7"
const agentMsgsDir = `.ai/tx/mesh/${meshInstanceId}/agents/${this.agentName}/msgs`;
```

Do NOT use static mesh name - it will miss the UUID suffix and watch wrong directory.

### Full HITL Flow Example

```markdown
# File 1: Agent asks question
---
to: core/core
from: hitl-3qa-858fc7/interviewer
type: ask
msg-id: q1-primary-concern
status: pending
requester: core/core
headline: Question 1
---
What are your primary concerns about AI safety?

# File 2: User responds
---
to: hitl-3qa-858fc7/interviewer
from: core/core
type: ask-response
msg-id: q1-primary-concern
status: complete
---
My primary concern is ensuring alignment between AI systems and human values.

# (Repeat for questions 2 and 3)

# File 7: Agent completes
---
from: hitl-3qa-858fc7/interviewer
to: core/core
type: task-complete
status: complete
---
# Interview Complete
Conducted 3-question interview about AI safety.
Key concerns: alignment, transparency, robustness.
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
- **Fix**: Debug with tmux; check msgs/active/ and msgs/

## References

- **[mesh-config-reference.md](mesh-config-reference.md)** - Config field reference
- **[agent-config-reference.md](agent-config-reference.md)** - Agent config reference
- **[prompt-templates.md](prompt-templates.md)** - Prompt templates
- **[workflows.md](workflows.md)** - Message format and routing
