# Agent Configuration Reference

Complete specification for agent config files.

**Location**: `meshes/agents/{category}/{agent-name}/config.json`

## Required Fields

### `name`
String - Agent identifier (lowercase, alphanumeric)

```json
{
  "name": "asker"
}
```

**Rules**:
- Must match directory name
- Used in session names: `{mesh}-{name}`
- Unique within mesh (but can repeat across meshes)

## Optional Fields

### `description`
String - What this agent does

```json
{
  "description": "Sends questions to the answerer agent and logs responses"
}
```

**Best practice**: Clear statement of agent's role and responsibilities.

### `orchestrator`
Boolean - Is this an orchestrating agent?

```json
{
  "orchestrator": true
}
```

**Default**: `false`

**Rules**:
- Only `true` for the `core` agent
- Orchestrators can spawn other meshes
- Regular agents just process tasks

```json
{
  "orchestrator": true,
  "capabilities": ["search", "spawn"]
}
```

### `capabilities`
Array of strings - What this agent can do

```json
{
  "capabilities": ["ask", "format", "validate"]
}
```

**Common capabilities**:
- `ask` - Can send questions to other agents
- `search` - Can search information
- `spawn` - Can spawn meshes (orchestrators only)
- `format` - Can format output
- `validate` - Can validate data

**Rules**:
- List actual capabilities
- Used for documentation
- Empty array if no special capabilities

### `options`
Object - Claude configuration for this agent

```json
{
  "options": {
    "model": "haiku",
    "output": "clean"
  }
}
```

#### `options.model`
String - Which Claude model to use

```json
{
  "options": {
    "model": "haiku"
  }
}
```

**Options**:
- `haiku` - Smallest, fastest, cheapest (default for workers)
- `sonnet` - Balanced, good for orchestration
- `opus` - Largest, most capable, slower
- `claude-haiku-4-5-20251001` - Full model ID also works

**Best practice**:
- Use `haiku` for simple tasks (echo, validation)
- Use `sonnet` for orchestration (core, complex logic)
- Use `opus` only for very complex reasoning

#### `options.output`
String - Output style for Claude Code

```json
{
  "options": {
    "output": "clean"
  }
}
```

**Options**:
- `clean` - Focused output, less verbose
- `blank` - Minimal output
- (Other custom styles possible)

**Best practice**:
- Use `clean` for workers
- Use `blank` for orchestration (less noise)

## Full Example

```json
{
  "name": "asker",
  "description": "Test agent that sends an ask to answerer",
  "orchestrator": false,
  "capabilities": ["ask"],
  "options": {
    "model": "haiku",
    "output": "clean"
  }
}
```

## Core Agent (Special)

```json
{
  "name": "core",
  "description": "Coordinates all meshes",
  "orchestrator": true,
  "capabilities": ["search", "spawn"],
  "options": {
    "output": "blank",
    "model": "sonnet"
  }
}
```

**Rules**:
- Must have `orchestrator: true`
- Must have `capabilities: ["spawn", ...]`
- Usually uses `sonnet` model
- Created by `tx start`

## Minimal Example

```json
{
  "name": "worker"
}
```

This is valid. Everything except `name` is optional with sensible defaults.

## Comparison: Different Agent Types

### Simple Worker (Echo Task)
```json
{
  "name": "echo",
  "description": "Echoes back input with timestamp",
  "capabilities": [],
  "options": {
    "model": "haiku",
    "output": "clean"
  }
}
```

**Reasoning**: Simple task, minimal model needed, clean output for readability.

### Coordinator (Within Mesh)
```json
{
  "name": "asker",
  "description": "Coordinates with answerer, logs results",
  "capabilities": ["ask"],
  "options": {
    "model": "sonnet",
    "output": "clean"
  }
}
```

**Reasoning**: More complex logic, needs to communicate, sonnet for better reasoning.

### Orchestrator (Top Level)
```json
{
  "name": "core",
  "description": "Spawns and coordinates all meshes",
  "orchestrator": true,
  "capabilities": ["search", "spawn"],
  "options": {
    "model": "sonnet",
    "output": "blank"
  }
}
```

**Reasoning**: Complex decisions, minimal output, needs spawn capability.

## Configuration Best Practices

1. **Start with haiku for workers**
   - Faster, cheaper
   - Good for structured tasks
   - Upgrade to sonnet if needed

2. **Use sonnet for coordination**
   - Better reasoning
   - Handles complexity
   - Good balance

3. **Be specific in capabilities**
   - Helps with documentation
   - Guides implementation
   - Shows agent purpose

4. **Keep descriptions clear**
   - One sentence is often enough
   - State input and output
   - Example: "Extracts entities from text and sends to analyzer"

5. **Use output=clean by default**
   - More readable logs
   - Easier to debug
   - Switch to blank if too verbose

## Common Patterns

### Echo/Simple Response
```json
{
  "name": "echo",
  "description": "Simple echo for testing",
  "options": {"model": "haiku"}
}
```

### Question Asker
```json
{
  "name": "asker",
  "description": "Sends questions and collects answers",
  "capabilities": ["ask"],
  "options": {"model": "haiku", "output": "clean"}
}
```

### Question Answerer
```json
{
  "name": "answerer",
  "description": "Answers questions from asker",
  "options": {"model": "haiku", "output": "clean"}
}
```

### Data Processor
```json
{
  "name": "processor",
  "description": "Processes and transforms data",
  "capabilities": ["format"],
  "options": {"model": "sonnet"}
}
```

### Orchestrator/Coordinator
```json
{
  "name": "coordinator",
  "description": "Orchestrates work across multiple agents",
  "capabilities": ["ask", "format"],
  "options": {"model": "sonnet", "output": "blank"}
}
```
