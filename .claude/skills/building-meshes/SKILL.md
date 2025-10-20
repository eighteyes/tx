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

## Next Steps

- Test with `tx spawn {mesh-name}`
- Write E2E tests using the [testing-meshes](../testing-meshes/SKILL.md) skill
- Add more agents to the mesh
- Experiment with multi-agent workflows
- Check out [multi-agent-patterns.md](references/multi-agent-patterns.md) for advanced topologies
