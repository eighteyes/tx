---
name: building-meshes
description: Guide for designing and building mesh and agent configurations for the tx system. Use when creating new meshes, defining agent roles, or setting up multi-agent workflows. Covers configuration structure, agent design patterns, and common mesh topologies.
---

# Building Meshes

This skill provides guidance for creating meshes and agent configurations.

## Core Concepts

### What is a Mesh?

A **mesh** is a named collection of agents that work together to accomplish a goal. It defines:
- Which agents participate
- How they're organized
- What capabilities they expose
- Entry and completion points

Example: `test-ask` mesh has an `asker` and `answerer` agent that work together.

### What is an Agent?

An **agent** is a Claude instance running in a tmux session. It:
- Receives tasks via message files
- Processes work and generates output
- Sends responses via message files
- Communicates through message passing only

### Directory Structure

```
meshes/
├── mesh-configs/
│   ├── core.json              # Core orchestrator mesh
│   ├── test-ask.json          # Example: multi-agent mesh
│   └── test-echo.json         # Example: single-agent mesh
│
└── agents/
    ├── core/
    │   ├── config.json        # Core agent config
    │   └── prompt.md          # Core agent prompt
    │
    ├── test/
    │   ├── asker/
    │   │   ├── config.json
    │   │   └── prompt.md
    │   ├── answerer/
    │   │   ├── config.json
    │   │   └── prompt.md
    │   └── echo/
    │       ├── config.json
    │       └── prompt.md
    │
    └── [category]/
        └── [agent-name]/
            ├── config.json
            └── prompt.md
```

## Quick Start: Create a Mesh

### 1. Plan Your Mesh

Before writing configs, answer:
- **Name**: What's the mesh called? (e.g., `my-workflow`)
- **Agents**: How many agents? What are their roles?
- **Flow**: core → agent? agent → agent? Parallel?
- **Entry**: Which agent receives the initial task?
- **Completion**: Which agent signals when done?

### 2. Create Mesh Config

File: `meshes/mesh-configs/{mesh-name}.json`

```json
{
  "mesh": "my-workflow",
  "description": "Description of what this mesh does",
  "agents": ["category/agent1", "category/agent2"],
  "capabilities": ["ask"],
  "entry_point": "agent1",
  "completion_agent": "agent1"
}
```

See: [mesh-config-reference.md](references/mesh-config-reference.md)

### 3. Create Agent Configs

File: `meshes/agents/category/agent-name/config.json`

```json
{
  "name": "agent1",
  "description": "What this agent does",
  "capabilities": [],
  "options": {
    "model": "haiku",
    "output": "clean"
  }
}
```

See: [agent-config-reference.md](references/agent-config-reference.md)

### 4. Write Agent Prompts

File: `meshes/agents/category/agent-name/prompt.md`

#### Template Variables

The PromptBuilder automatically injects template variables into agent prompts:
- `{{ mesh }}` - The mesh instance ID (e.g., `test-echo-abc123`)
- `{{ agent }}` - The agent name

This allows dynamic path generation without hardcoding:
```markdown
Write message to `.ai/tx/mesh/{{ mesh }}/agents/{{ agent }}/msgs/`
```

#### Lightweight Test Agent Prompts

**Test agents should be SUPER LIGHTWEIGHT** - only Role and Workflow sections:

```markdown
# Role
You are an echo test agent. When you receive a task, echo it back to core.

# Workflow
1. Read the incoming task message
2. Write a response message with:
   - `to: core/core`
   - `type: task-complete`
   - Include the original task content in your response
```

**For test agents, DO NOT include:**
- Examples
- Output formats
- Detailed instructions
- Multiple sections
- Complex logic

#### Production Agent Prompts

Production agents can have full structure:

```markdown
# Agent Name

## Your Role
You are... [what you do]

## Workflow
1. Read task from inbox
2. Process the task
3. Send response to outbox

## Output Format
Save to outbox with frontmatter...
```

See: [prompt-templates.md](references/prompt-templates.md)

## Core Principles

### 1. Message-Based Communication

Agents communicate **only** via message files in directories:
- `msgs/inbox/` - Incoming tasks
- `msgs/active/` - Currently processing
- `msgs/outbox/` - Outgoing responses
- `msgs/complete/` - Completed tasks

**Never** use shared files or direct communication.

### 2. Agents Are Reactive

Agents **wait for messages**, they don't start work spontaneously:
- No "START NOW" in prompts
- Wait for task in inbox
- Process when ready
- Send response to outbox

### 3. Frontmatter Metadata

Every message file starts with YAML frontmatter:

```markdown
---
from: mesh/agent
to: recipient
type: task-complete
status: complete
timestamp: 2025-10-20T00:00:00Z
---
```

This metadata routes messages and tracks workflow state.

### 4. Mesh = Collection of Agents

A mesh is just a grouping. What matters:
- Individual agent capabilities
- Message passing between them
- Core orchestration on top

## Common Patterns

### Single Agent Mesh (Simple)

One agent handles everything:

```json
{
  "mesh": "simple-task",
  "agents": ["test/echo"],
  "entry_point": "echo",
  "completion_agent": "echo"
}
```

**Flow**: core → echo → core

### Multi-Agent Mesh (Sequential)

Multiple agents in sequence:

```json
{
  "mesh": "test-ask",
  "agents": ["test/asker", "test/answerer"],
  "entry_point": "asker",
  "completion_agent": "asker"
}
```

**Flow**: core → asker → answerer → asker → core

### Agent Options

Control Claude behavior per agent:

```json
{
  "options": {
    "model": "haiku",           // haiku, sonnet, opus
    "output": "clean"           // blank, clean, etc.
  }
}
```

## Resources

For detailed guidance:

- **[mesh-config-reference.md](references/mesh-config-reference.md)** - Complete mesh config specification
- **[agent-config-reference.md](references/agent-config-reference.md)** - Complete agent config specification
- **[prompt-templates.md](references/prompt-templates.md)** - Example prompts for different agent types
- **[workflows.md](references/workflows.md)** - Common mesh topologies and patterns

## Example: Complete Simple Mesh

### 1. Mesh Config
```json
{
  "mesh": "hello-world",
  "description": "Simple greeting agent",
  "agents": ["tutorial/greeter"],
  "entry_point": "greeter",
  "completion_agent": "greeter"
}
```

Save as: `meshes/mesh-configs/hello-world.json`

### 2. Agent Config
```json
{
  "name": "greeter",
  "description": "Greets the user",
  "capabilities": [],
  "options": {
    "model": "haiku",
    "output": "clean"
  }
}
```

Save as: `meshes/agents/tutorial/greeter/config.json`

### 3. Agent Prompt
```markdown
# Greeter Agent

## Your Role
You greet users warmly and thank them for their time.

## Workflow
1. Read the incoming message
2. Craft a warm greeting
3. Send response to core

## Output Format
Create a response file with:
---
from: hello-world/greeter
to: core
type: task-complete
status: complete
---

# Greeting
[Your warm greeting here]
```

Save as: `meshes/agents/tutorial/greeter/prompt.md`

### 4. Test It
```bash
# Spawn the mesh
tx spawn hello-world

# In Claude session, give it work:
# "Have the greeter say hello to Alice"
```

That's it! You've created a mesh.

## Example: Bidirectional Agent Communication (Ping-Pong)

A more complex pattern where two agents communicate with each other:

### Mesh Config
```json
{
  "mesh": "test-ping-pong",
  "description": "Two agents exchange ping-pong messages",
  "agents": ["test/pinger", "test/ponger"],
  "entry_point": "pinger",
  "completion_agent": "pinger",
  "workflow_topology": "bidirectional"
}
```

### Agent Flow
```
Core → Pinger → Ponger → Pinger → Core
       ↓ sends ping 1
              ↓ responds pong 1
       ↓ receives pong 1
       ↓ sends ping 2
              ↓ responds pong 2
       ↓ receives pong 2
       ↓ reports completion
                            ↓ receives result
```

### Key Patterns
- **Simple agent prompts**: Clear step-by-step instructions work better than complex workflows
- **Message-based flow**: Each exchange creates a message file with frontmatter
- **Automatic routing**: System routes messages based on frontmatter (from/to/type/status)
- **Idle sequencing**: Use tmux idle detection to wait for agent handoffs

See: [multi-agent-patterns.md](references/multi-agent-patterns.md) for more examples.

## Example: Iterative Refinement with Feedback (Worker-Reviewer)

Pattern for workflows that require multiple iterations with approval gates:

### Mesh Config
```json
{
  "mesh": "test-iterative",
  "type": "iterative",
  "agents": ["test/worker", "test/reviewer"],
  "entry_point": "worker",
  "completion_agent": "worker",
  "workflow_topology": "bidirectional"
}
```

### Agent Flow
```
Core → Worker (v1)
       ↓ sends to reviewer
              Reviewer → "needs revision"
       ↓ receives feedback
       ↓ creates v2
       ↓ sends to reviewer
              Reviewer → "approved"
       ↓ receives approval
       → Core (completion)
```

### Key Patterns
- **Version markers in content**: Put "Version 1" or "Version 2" in message body
- **Conditional responses**: Reviewer checks version and responds accordingly
- **Simple feedback signals**: Just "approved" or "needs revision" works fine
- **Message content as state**: Use message text to track progress, not complex state
- **Pseudo-antagonistic logic**: Agents can implement approval gates or QA checks

See: [multi-agent-patterns.md](references/multi-agent-patterns.md) for more examples.

## Human-In-The-Loop (HITL) Meshes

HITL meshes enable multi-round Q&A workflows where an agent interviews a human (via core) before completing a task.

### When to Use HITL

Use HITL meshes when:
- You need to gather requirements or preferences through conversation
- The task requires understanding nuanced human context
- Multiple rounds of clarification produce better outcomes
- You want to collect structured information through guided questions

### HITL Architecture Pattern

```
Core (human) → Interviewer Agent
               ↓ ask (Q1)
Core ← ────────┘
Core → ────────┐
               ↓ ask-response (A1)
               Interviewer Agent
               ↓ ask (Q2)
Core ← ────────┘
Core → ────────┐
               ↓ ask-response (A2)
               ... (repeat N times)
               Interviewer Agent
               ↓ compiles summary
               ↓ task-complete
Core ← ────────┘
```

### Example: hitl-3qa Mesh

A working HITL mesh that conducts 3 Q&A sessions before completing:

#### Mesh Config
```json
{
  "mesh": "hitl-3qa",
  "description": "Human-in-the-loop interview mesh - interviewer conducts 3 Q&A sessions with core before completing task",
  "agents": ["hitl-3qa/interviewer"],
  "capabilities": ["ask"],
  "entry_point": "interviewer",
  "completion_agent": "interviewer",
  "workflow_type": "hitl",
  "interaction_count": 3
}
```

Key fields:
- `capabilities: ["ask"]` - Essential for ask/ask-response messaging
- `workflow_type: "hitl"` - Documents that this is a human interaction mesh
- `interaction_count: 3` - Metadata about expected Q&A rounds

#### Agent Config
```json
{
  "name": "interviewer",
  "description": "Conducts structured interviews with 3 Q&A rounds",
  "capabilities": ["ask"],
  "options": {
    "model": "haiku",
    "output": "blank"
  }
}
```

Choose `haiku` for cost efficiency on interview tasks that don't require deep reasoning.

#### Agent Prompt Pattern

The interviewer prompt should:

1. **Define the workflow clearly**:
```markdown
## Workflow

1. Read incoming task from msgs folder
2. Ask Question 1 → wait for response
3. Ask Question 2 → wait for response
4. Ask Question 3 → wait for response
5. Compile interview summary
6. Send task-complete to core
```

2. **Include explicit wait instructions**:
```markdown
CRITICAL: After each question, WAIT for the response. Do NOT ask multiple questions at once.
```

3. **Specify message format for asks**:
```markdown
---
to: core/core
from: hitl-3qa/interviewer
type: ask
msg-id: hitl-qa-1
status: pending
timestamp: 2025-10-22T00:00:00Z
headline: Question 1 - [topic]
---

# Question 1: [Title]

[Your question here]
```

4. **Handle ask-responses**:
```markdown
When you receive an ask-response:
- Read the response from your msgs folder
- Extract the answer
- Continue to next question or compile summary
```

5. **Define summary compilation**:
```markdown
After 3 Q&A rounds complete:
1. Create interview-summary.md in workspace
2. Include all questions and answers
3. Synthesize key insights
4. Send task-complete to core
```

### Critical Design Decisions

#### 1. Use ask/ask-response Message Types

HITL requires bidirectional communication:
- **ask** message: Interviewer → Core (question)
- **ask-response** message: Core → Interviewer (answer)

Both must have matching `msg-id` fields for correlation.

#### 2. Enforce Sequential Processing

The prompt must emphasize waiting between rounds:
```markdown
CRITICAL: After sending an ask, you MUST wait for the corresponding ask-response
before proceeding. Do NOT send multiple asks in parallel.
```

Without this, agents may fire all questions at once.

#### 3. State Tracking via Message Counting

Instead of complex state machines, use simple counters:
```markdown
Track your progress:
- Question 1: ✅ Asked, ✅ Received response
- Question 2: ✅ Asked, ⏳ Waiting for response
- Question 3: ⏳ Pending
```

Let the agent manage state through self-documentation in its responses.

#### 4. Summary in Workspace

Save the compiled interview summary to:
```
.ai/tx/mesh/{mesh}/workspace/interview-summary.md
```

This keeps it accessible to both the agent and for testing validation.

#### 5. Single Interviewer Agent

HITL meshes typically need only one agent:
- Simpler coordination
- Easier state management
- Clear conversation flow

Multi-agent HITL meshes are possible but add complexity.

### HITL Message Flow in Detail

**Initial Task Delivery:**
```
core/core creates: task-hitl-interview.md
  → routes to: hitl-3qa/interviewer/msgs/
```

**Q&A Round 1:**
```
interviewer creates: q1-topic.md (type: ask, msg-id: hitl-qa-1)
  → routes to: core/core/msgs/
core responds: response-qa-1.md (type: ask-response, msg-id: hitl-qa-1)
  → routes to: hitl-3qa/interviewer/msgs/
```

**Q&A Round 2:**
```
interviewer creates: q2-topic.md (type: ask, msg-id: hitl-qa-2)
  → routes to: core/core/msgs/
core responds: response-qa-2.md (type: ask-response, msg-id: hitl-qa-2)
  → routes to: hitl-3qa/interviewer/msgs/
```

**Q&A Round 3:**
```
interviewer creates: q3-topic.md (type: ask, msg-id: hitl-qa-3)
  → routes to: core/core/msgs/
core responds: response-qa-3.md (type: ask-response, msg-id: hitl-qa-3)
  → routes to: hitl-3qa/interviewer/msgs/
```

**Completion:**
```
interviewer creates: interview-summary.md → workspace/
interviewer creates: task-complete.md
  → routes to: core/core/msgs/
```

### HITL Prompt Design Tips

1. **Number your questions explicitly** - Makes tracking progress easier
2. **Use descriptive msg-ids** - `hitl-qa-1`, `hitl-qa-2`, etc.
3. **Include topic in headlines** - Helps humans scan their inbox
4. **Provide context in each question** - Reference previous answers when relevant
5. **Make summary format clear** - Specify exactly what should be included
6. **Handle edge cases** - What if a response is unclear? Can the agent ask follow-ups?

### Common HITL Pitfalls

**Pitfall 1: Agent fires all questions at once**
- **Fix**: Explicit "WAIT for response" instructions in prompt
- **Fix**: Show numbered progress tracking

**Pitfall 2: msg-id mismatch between ask and ask-response**
- **Fix**: Document msg-id format clearly in prompt
- **Fix**: Show example message pairs

**Pitfall 3: Agent doesn't detect new responses**
- **Fix**: Include polling instructions: "Check your msgs folder for new ask-response files"
- **Fix**: Use filename patterns that are easy to match

**Pitfall 4: Summary missing Q&A content**
- **Fix**: Specify summary format with example structure
- **Fix**: Require all questions and answers be included verbatim

**Pitfall 5: Agent completes early**
- **Fix**: Explicitly state: "Do NOT send task-complete until all 3 Q&A rounds are done"
- **Fix**: Include completion checklist in prompt

### Testing HITL Meshes

HITL testing requires simulating human responses. See [testing-meshes](../testing-meshes/SKILL.md) skill for:
- Simulating ask-response messages
- Manual task delivery to agents
- Validating multi-round workflows
- Checking summary generation

Example test structure:
```javascript
// Wait for each question, respond, repeat
for (let i = 1; i <= 3; i++) {
  await waitForQuestion(i);
  await sendResponse(i, responses[i-1]);
  if (i < 3) await waitForNextQuestion();
}
await verifySummary();
await verifyTaskComplete();
```

### Complete HITL Example Files

**meshes/mesh-configs/hitl-3qa.json**
```json
{
  "mesh": "hitl-3qa",
  "description": "Human-in-the-loop interview mesh - interviewer conducts 3 Q&A sessions with core before completing task",
  "agents": ["hitl-3qa/interviewer"],
  "capabilities": ["ask"],
  "entry_point": "interviewer",
  "completion_agent": "interviewer",
  "workflow_type": "hitl",
  "interaction_count": 3
}
```

**meshes/agents/hitl-3qa/interviewer/config.json**
```json
{
  "name": "interviewer",
  "description": "Conducts structured interviews with 3 Q&A rounds",
  "capabilities": ["ask"],
  "options": {
    "model": "haiku",
    "output": "blank"
  }
}
```

**meshes/agents/hitl-3qa/interviewer/prompt.md**
See: `meshes/agents/hitl-3qa/interviewer/prompt.md` for complete working example

### HITL Checklist

When building HITL meshes:

- [ ] Mesh config includes `capabilities: ["ask"]`
- [ ] Agent config includes `capabilities: ["ask"]`
- [ ] Prompt specifies exact number of Q&A rounds
- [ ] Prompt shows ask message format with frontmatter
- [ ] Prompt shows ask-response message format
- [ ] Prompt emphasizes WAITING between rounds
- [ ] Prompt defines clear summary format
- [ ] Prompt includes completion checklist
- [ ] msg-id pattern is consistent and documented
- [ ] Summary saves to workspace directory
- [ ] Task-complete message goes to requester
- [ ] E2E test simulates all Q&A rounds
- [ ] E2E test validates summary generation
- [ ] E2E test validates task-complete delivery

## Next Steps

- Test with `tx spawn {mesh-name}`
- Write E2E tests using the [testing-meshes](../testing-meshes/SKILL.md) skill
- Add more agents to the mesh
- Experiment with multi-agent workflows
- Check out [multi-agent-patterns.md](references/multi-agent-patterns.md) for advanced topologies
