# Mesh Configuration Reference

Complete specification for mesh config files.

**Location**: `meshes/mesh-configs/{mesh-name}.json`

## Required Fields

### `mesh`
String - Mesh identifier (lowercase, alphanumeric, hyphens)

```json
{
  "mesh": "test-ask"
}
```

**Rules**:
- Must be unique
- Used in session names: `{mesh}-{agent}`
- Must match directory/file naming

### `agents`
Array of strings - Which agents participate

```json
{
  "agents": [
    "test/asker",
    "test/answerer",
    "category/agent-name"
  ]
}
```

**Format**: `{category}/{agent-name}`
- `category` - Grouping (e.g., `test`, `production`)
- `agent-name` - Agent identifier

**Rules**:
- Must have at least 1 agent
- Must correspond to directories in `meshes/agents/`
- Order doesn't matter (all agents available to each other)

## Optional Fields

### `description`
String - Human-readable description

```json
{
  "description": "Multi-agent Q&A workflow: asker sends questions to answerer"
}
```

**Best practice**: Clear, concise explanation of mesh purpose.

### `capabilities`
Array of strings - Capabilities this mesh exposes

```json
{
  "capabilities": ["ask", "search"]
}
```

**Common capabilities**:
- `ask` - Can ask other agents questions
- `search` - Can search information
- `spawn` - Can spawn other meshes (usually core only)

**Rules**:
- List only what this mesh does, not agent capabilities
- Used for mesh discovery

### `entry_point`
String - Which agent receives initial task

```json
{
  "entry_point": "asker"
}
```

**Default**: First agent in array

**Rules**:
- Must be an agent name (not full path)
- Typically the agent that coordinates work
- Only used for documentation/planning

### `completion_agent`
String - Which agent signals when mesh is done

```json
{
  "completion_agent": "asker"
}
```

**Default**: Same as entry_point

**Rules**:
- Must be an agent name
- Typically sends final response to core
- Helps with workflow completion detection

### `type`
String - Mesh lifecycle type

```json
{
  "type": "ephemeral"
}
```

**Options**:
- `ephemeral` - Created for specific task, agents timeout when idle, mesh auto-cleans on completion
- `persistent` - Long-running mesh, agents never timeout

### `idle_timeout_minutes`
Number or false - Override system idle timeout for this mesh (ephemeral only)

```json
{
  "type": "ephemeral",
  "idle_timeout_minutes": false
}
```

**Options**:
- **number** - Custom timeout in minutes (e.g., `30` for 30 minutes)
- **false** - Disable idle timeout (agents never killed, but mesh still auto-cleans on completion)
- **undefined** - Use system default (10 minutes)

**When to use**:
- Set to `false` for iterative workflows where agents wait between iterations
- Use custom number (e.g., `30`) for long-running tasks
- Only applies to `ephemeral` meshes (persistent meshes never timeout regardless)

**Example - Iterative research mesh**:
```json
{
  "mesh": "deep-research",
  "type": "ephemeral",
  "idle_timeout_minutes": false,
  "completion_agent": "writer"
}
```

Agents in researcher ⟷ disprover loop won't timeout during iterations. Mesh still auto-cleans when writer completes.

### `workflow_topology`
String - How agents communicate (documentation)

```json
{
  "workflow_topology": "sequential"
}
```

**Options**:
- `sequential` - Agent1 → Agent2 → Agent3
- `parallel` - Multiple agents work independently
- `fan-out-in` - One agent broadcasts, multiple respond
- `bidirectional` - Agents exchange multiple messages

### `routing`
Object - Defines valid status types and routing destinations for agents

```json
{
  "routing": {
    "agent-name": {
      "status-type": {
        "destination-agent": "Human-readable description of when to use this route"
      }
    }
  }
}
```

**IMPORTANT**: Multi-agent meshes SHOULD have routing tables. Single-agent meshes do NOT need routing.

**Purpose**:
- Guides agents on which status types to use based on work outcomes
- Defines valid destination agents for each status
- Injected into agent prompts as "Routing Rules" section
- Can enforce routing with `topology: "static"`

**Status Types**:
- **NOT preset** - Use whatever makes sense for the agent and situation
- **Common patterns**: `complete`, `blocked`, `ask`, `needs-clarification`, `low-confidence`, etc.
- **Completion agents** - Should always route `complete` status to `core`

**Example - Sequential workflow**:
```json
{
  "mesh": "test-ask",
  "agents": ["test/asker", "test/answerer"],
  "routing": {
    "asker": {
      "ask": {
        "answerer": "Question ready to send to answerer"
      },
      "complete": {
        "core": "Answer received and task complete"
      }
    },
    "answerer": {
      "complete": {
        "asker": "Answer ready to send back"
      }
    }
  }
}
```

**Example - Branching decisions**:
```json
{
  "routing": {
    "researcher": {
      "complete": {
        "disprover": "Theory synthesized - ready for critical review"
      },
      "low-confidence": {
        "disprover": "Confidence below 95% - needs critical review"
      },
      "blocked": {
        "core": "Cannot synthesize - insufficient analysis"
      }
    }
  }
}
```

**Example - Multiple destinations** (choose one):
```json
{
  "routing": {
    "coordinator": {
      "distribute": {
        "worker1": "Distribute task to worker 1",
        "worker2": "Distribute task to worker 2",
        "worker3": "Distribute task to worker 3"
      },
      "complete": {
        "core": "All work complete"
      }
    }
  }
}
```

**How it works**:
1. System generates routing instructions from table
2. Instructions injected into agent prompt as "## Routing Rules" section
3. Agent chooses appropriate status based on work outcome
4. Agent sets `type:` field in message frontmatter to chosen status
5. If mesh has `topology: "static"`, routing is validated against table

**What agents see in prompts**:
```markdown
## Routing Rules

Choose the appropriate status based on your work outcome:

### Status: `complete`

**When:** Theory synthesized - ready for critical review
**Routes to:** `disprover`

### Status: `blocked`

**When:** Cannot synthesize - insufficient analysis
**Routes to:** `core`
```

**Best Practices**:
- Define status types that match agent's actual work outcomes
- Provide clear "when" descriptions for each route
- Always route completion agent's `complete` status to `core`
- Use descriptive status names (not just `status1`, `status2`)
- Consider edge cases: blocked, error, needs-help

### `topology`
String - Routing enforcement mode

```json
{
  "topology": "static"
}
```

**Options**:
- `static` - Enforce routing table (messages validated against routing rules)
- `dynamic` (or omitted) - No enforcement (routing table is guidance only)

**Use `static` when**:
- You want to prevent agents from routing incorrectly
- Workflow has strict sequencing requirements
- Security or safety requires controlled message flow

## Full Example

```json
{
  "mesh": "test-ask",
  "description": "Test ask/answer workflow - asker sends ask to answerer, then reports to core",
  "type": "ephemeral",
  "agents": ["test/asker", "test/answerer"],
  "entry_point": "asker",
  "completion_agent": "asker",
  "capabilities": ["ask"],
  "workflow_topology": "sequential"
}
```

## Core Mesh (Special)

The `core` mesh is special:

```json
{
  "mesh": "core",
  "description": "Core/brain mesh - entry point for TX Watch",
  "agents": ["core"]
}
```

**Rules**:
- Always exists
- Single `core` agent
- Orchestrator for all other meshes
- Created by `tx start`

## Minimal Example

```json
{
  "mesh": "simple",
  "agents": ["category/agent"]
}
```

This is valid. Everything else is optional.

## Naming Conventions

- **Mesh names**: lowercase, hyphens (e.g., `test-ask`, `my-workflow`)
- **Categories**: lowercase (e.g., `test`, `production`, `demo`)
- **Agent names**: lowercase (e.g., `asker`, `echo`, `worker`)
- **Full paths**: `category/agent-name` (e.g., `test/asker`)

## Common Patterns

### Single-Agent Mesh
```json
{
  "mesh": "echo",
  "agents": ["test/echo"],
  "entry_point": "echo",
  "completion_agent": "echo"
}
```

### Multi-Agent Sequential
```json
{
  "mesh": "pipeline",
  "agents": ["stage/extractor", "stage/processor", "stage/validator"],
  "entry_point": "extractor",
  "completion_agent": "validator"
}
```

### Multi-Agent Parallel
```json
{
  "mesh": "analysis",
  "agents": ["analysis/sentiment", "analysis/entities", "analysis/keywords"],
  "workflow_topology": "parallel"
}
```

### Multi-Category
```json
{
  "mesh": "production",
  "agents": ["core/dispatcher", "workers/worker1", "workers/worker2", "output/formatter"],
  "entry_point": "dispatcher",
  "completion_agent": "formatter"
}
```
