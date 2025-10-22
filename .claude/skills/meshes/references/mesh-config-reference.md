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
- `ephemeral` - Created for specific task, can be destroyed
- `permanent` - Long-running mesh (default)

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
