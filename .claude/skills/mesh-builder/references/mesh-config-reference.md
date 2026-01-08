# Mesh Configuration Reference

Complete specification for mesh config files.

**Location**: `meshes/{mesh-name}/config.yaml`

**Format**: YAML (preferred) or JSON (legacy)

## Required Fields

### `mesh`
String - Mesh identifier (lowercase, alphanumeric, hyphens)

```yaml
mesh: test-ask
```

**Rules**:
- Must be unique
- Used in session names: `{mesh}-{agent}`
- Must match directory naming

### `agents`
Array of agent objects - Which agents participate

```yaml
agents:
  - name: asker
    model: sonnet
    prompt: asker/prompt.md
  - name: answerer
    model: haiku
    prompt: answerer/prompt.md
```

**Agent fields**:
- `name` (required): Agent identifier
- `model` (required): `opus`, `sonnet`, or `haiku`
- `prompt` (required): Path to prompt file (relative to mesh directory)
- `workspace` (optional): Agent-level workspace config
- `mcpServers` (optional): MCP server configuration (see below)

**Rules**:
- Must have at least 1 agent
- Prompt paths are relative to the mesh directory
- Order matters only for default entry_point (first agent)

### `mcpServers` (Agent-Level)
Object - MCP servers to spawn alongside an agent

```yaml
# Example from meshes/protagents/meet/config.yaml
agents:
  - name: scheduler
    model: sonnet
    prompt: scheduler/prompt.md
    mcpServers:
      gcal:
        command: npx
        args:
          - gcal-mcp
```

**MCP server fields**:
- Server name (e.g., `gcal`): User-defined identifier
  - `command` (required): Executable to run
  - `args` (optional): Array of command arguments

**Multiple MCP servers**:
```yaml
agents:
  - name: assistant
    model: sonnet
    prompt: prompt.md
    mcpServers:
      gcal:
        command: npx
        args: [gcal-mcp]
      slack:
        command: npx
        args: [slack-mcp]
```

**Use cases**:
- Calendar access (gcal-mcp, outlook-mcp)
- Messaging integrations (slack-mcp, teams-mcp)
- Data sources (postgres-mcp, mongodb-mcp)
- File system access (fs-mcp)

## Optional Fields

### `description`
String - Human-readable description

```yaml
description: "Multi-agent Q&A workflow: asker sends questions to answerer"
```

**Best practice**: Clear, concise explanation of mesh purpose.

### `intents`
Object - Intent-based routing for auto-selecting meshes

```yaml
intents:
  patterns:
    - research
    - investigate
    - "find out"
    - "what's the state of"
  commands:
    research: "/know:research"
    "add feature": "/know:add"
```

**Fields**:
- `patterns`: Keywords that trigger this mesh
- `commands`: Map patterns to slash commands

**Use case**: Core agent uses intents to automatically route tasks to appropriate meshes.

### `entry_point`
String - Which agent receives initial task

```yaml
entry_point: asker
```

**Default**: First agent in array

**Rules**:
- Must be an agent name (not full path)
- Typically the agent that coordinates work

### `completion_agent`
String - Which agent signals when mesh is done

```yaml
completion_agent: writer
```

**Default**: Same as entry_point

**Rules**:
- Must be an agent name
- Typically sends final response to core
- Helps with workflow completion detection

### `type`
String - Mesh lifecycle type

```yaml
type: ephemeral
```

**Options**:
- `ephemeral` - Created for specific task, agents timeout when idle, mesh auto-cleans on completion
- `persistent` - Long-running mesh, agents never timeout

### `idle_timeout_minutes`
Number or false - Override system idle timeout for this mesh (ephemeral only)

```yaml
type: ephemeral
idle_timeout_minutes: false
```

**Options**:
- **number** - Custom timeout in minutes (e.g., `30` for 30 minutes)
- **false** - Disable idle timeout (agents never killed, but mesh still auto-cleans on completion)
- **undefined** - Use system default (10 minutes)

**When to use**:
- Set to `false` for iterative workflows where agents wait between iterations
- Use custom number (e.g., `30`) for long-running tasks
- Only applies to `ephemeral` meshes (persistent meshes never timeout regardless)

### `workflow_topology`
String - How agents communicate (documentation)

```yaml
workflow_topology: sequential
```

**Options**:
- `sequential` - Agent1 → Agent2 → Agent3
- `parallel` - Multiple agents work independently
- `fan-out-in` - One agent broadcasts, multiple respond
- `bidirectional` - Agents exchange multiple messages

### `workspace`
Object or String - Workspace output configuration

```yaml
# Object format (preferred)
workspace:
  path: ".ai/research/{topic}/"
  create_on_init: true
  cleanup_on_complete: false

# Legacy string format (still supported)
workspace: ".ai/research/{topic}/"
```

**Object fields**:
- `path`: Path template (can include `{task-id}`, `{topic}`, etc.)
- `create_on_init`: Create directory on initialization (default: true)
- `cleanup_on_complete`: Clean up on task completion (default: false)
- `output`: Map of filename → description for expected outputs

### `rearmatter`
Object - Transparency metadata configuration

```yaml
rearmatter:
  enabled: true
  fields:
    - grade
    - confidence
    - status
    - iteration
    - gaps
  thresholds:
    confidence: 0.95
    grade: "B"
```

**Valid fields**:
- `grade` - Letter grade (A-F) for quality assessment
- `confidence` - Numeric confidence score (0.0-1.0)
- `speculation` - Degree of speculation in the response
- `gaps` - Known information gaps
- `assumptions` - Key assumptions made
- `status` - Current status (e.g., 'in-progress', 'complete')
- `iteration` - Iteration number for iterative workflows

### `routing`
Object - Defines valid status types and routing destinations for agents

```yaml
routing:
  asker:
    ask:
      answerer: "Question ready to send to answerer"
    complete:
      core: "Answer received and task complete"
  answerer:
    complete:
      asker: "Answer ready to send back"
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

**Example - Branching decisions**:
```yaml
routing:
  researcher:
    complete:
      writer: "Theory validated - confidence threshold met"
    low-confidence:
      disprover: "Confidence below 95% - needs critical review"
    blocked:
      core: "Cannot synthesize - insufficient analysis"
```

**How Routing Is Injected**:

When an agent has routing configured, the SDK runner injects routing instructions into the task prompt. For example, the `interviewer` agent in the research mesh receives:

```markdown
## Routing Instructions

When complete, route based on outcome:

**complete** → research/sourcer
Write task message to: research/sourcer
Reason: Requirements complete, ready to source information

**blocked** → core/core
Write task message to: core/core
Reason: Cannot proceed - unclear research requirements
```

Agents without routing config receive the default instruction: "When done, write a task-complete message to core/core."

### `topology`
String - Routing enforcement mode

```yaml
topology: static
```

**Options**:
- `static` - Enforce routing table (messages validated against routing rules)
- `dynamic` (or omitted) - No enforcement (routing table is guidance only)

**Use `static` when**:
- You want to prevent agents from routing incorrectly
- Workflow has strict sequencing requirements
- Security or safety requires controlled message flow

### `system`
Boolean - Mark as a system mesh

```yaml
system: true
```

System meshes are internal meshes used by TX itself (e.g., commit-agent).

### `worktree`
Boolean - Enable git worktree isolation

```yaml
worktree: true
```

When enabled, the mesh runs in an isolated git worktree with automatic commit and cleanup.

### `lifecycle`
Object - Pre/post hooks for mesh lifecycle

```yaml
lifecycle:
  pre:
    - "worktree:create"
  post:
    - "commit:auto"
    - "worktree:cleanup"
```

**Available hooks**:
- `worktree:create` - Create isolated git worktree
- `commit:auto` - Auto-commit changes
- `worktree:cleanup` - Remove worktree after completion

### `continuation`
Boolean or Array - Session persistence across worker spawns

```yaml
# All agents persist sessions
continuation: true

# Specific agents only
continuation:
  - coordinator
  - narrator

# No persistence (default - omit field)
```

**Options**:
- `true` - All agents in mesh persist their Claude session across spawns
- `string[]` - Only listed agent names persist sessions
- Omitted/`false` - Each spawn starts fresh (no session reuse)

**Use cases**:
- Coordinator-only: State machine remembers prior turns
- All agents: Full conversation memory across turns (can cause context bloat)
- None: Stateless workers (state tracked in files instead)

**Behavior**:
- When enabled, agent's Claude session ID is stored in SQLite
- On next spawn, session is resumed (full conversation context preserved)
- Sessions stored per-agent using key `{mesh}/{agent}`

### `config`
Object - Custom mesh-specific configuration

```yaml
config:
  confidence_threshold: 0.95
  max_iterations: 3
```

Used for mesh-specific settings that agents can reference.

## Full Example (from deep-research mesh)

```yaml
# meshes/deep-research/config.yaml
mesh: deep-research
description: "Multi-agent deep research with iterative confidence loop: interviewer gathers requirements, sourcer finds sources, analyst analyzes, researcher synthesizes theories, disprover critiques until 95% confidence, writer creates final report"
type: ephemeral
idle_timeout_minutes: false

agents:
  - name: interviewer
    model: sonnet
    prompt: interviewer/prompt.md
  - name: sourcer
    model: sonnet
    prompt: sourcer/prompt.md
  - name: analyst
    model: sonnet
    prompt: analyst/prompt.md
  - name: researcher
    model: opus
    prompt: researcher/prompt.md
  - name: disprover
    model: opus
    prompt: disprover/prompt.md
  - name: writer
    model: sonnet
    prompt: writer/prompt.md

entry_point: interviewer
completion_agent: writer

routing:
  interviewer:
    complete:
      sourcer: "Requirements gathered, ready to source information"
    blocked:
      core: "Cannot proceed - unclear research requirements"
  sourcer:
    complete:
      analyst: "Sources collected and ready for analysis"
    blocked:
      core: "Cannot source - technical issues or unclear topic"
  analyst:
    complete:
      researcher: "Analysis complete - hypotheses formulated and ready for theory synthesis"
    needs-more-data:
      sourcer: "Insufficient information - need additional sources"
    blocked:
      core: "Cannot analyze - conflicting or unclear data"
  researcher:
    complete:
      writer: "Theory validated - confidence threshold met, ready for final synthesis"
    low-confidence:
      disprover: "Confidence below 95% - needs critical review"
    blocked:
      core: "Cannot synthesize - insufficient analysis or conflicting evidence"
  disprover:
    complete:
      analyst: "Critical review complete - counterpoints identified for refinement"
    high-confidence:
      writer: "Theory validated - confidence threshold met, ready for final synthesis"
    blocked:
      core: "Cannot critique - insufficient evidence or unclear theory"
  writer:
    complete:
      core: "Research complete and saved to workspace"
    needs-clarification:
      analyst: "Need more context or clearer analysis"
    blocked:
      core: "Cannot write - insufficient material or unclear direction"

workspace:
  path: ".ai/research/{topic}/"

config:
  confidence_threshold: 0.95
  max_iterations: 3

rearmatter:
  enabled: true
  fields:
    - grade
    - confidence
    - status
    - iteration
    - gaps
```

**Note the iterative confidence loop**: researcher → disprover → analyst → researcher (loops until 95% confidence achieved).

## Core Mesh (Special)

The `core` mesh is special and created by `tx start`:

```yaml
mesh: core
description: "Core/brain mesh - entry point for TX"
agents:
  - name: core
    model: opus
    prompt: core/prompt.md
```

**Rules**:
- Always exists
- Single `core` agent
- Orchestrator for all other meshes

## Minimal Example

```yaml
mesh: simple
agents:
  - name: worker
    model: haiku
    prompt: prompt.md
entry_point: worker
```

This is valid. Everything else is optional.

## Naming Conventions

- **Mesh names**: lowercase, hyphens (e.g., `test-ask`, `my-workflow`)
- **Agent names**: lowercase (e.g., `asker`, `echo`, `worker`)
- **Agent IDs**: `{mesh}/{agent}` (e.g., `research/interviewer`)

## Common Patterns

### Single-Agent Mesh
```yaml
mesh: echo
agents:
  - name: worker
    model: haiku
    prompt: prompt.md
entry_point: worker
```

### Multi-Agent Sequential
```yaml
mesh: pipeline
agents:
  - name: extractor
    model: sonnet
    prompt: extractor/prompt.md
  - name: processor
    model: sonnet
    prompt: processor/prompt.md
  - name: validator
    model: haiku
    prompt: validator/prompt.md
entry_point: extractor
completion_agent: validator
routing:
  extractor:
    complete:
      processor: "Data extracted"
  processor:
    complete:
      validator: "Processing complete"
  validator:
    complete:
      core: "Pipeline finished"
```

### Multi-Agent with HITL
```yaml
mesh: dev
agents:
  - name: worker
    model: opus
    prompt: prompt.md
entry_point: worker
routing:
  worker:
    complete:
      core: "Task complete"
    blocked:
      core: "Need human input"
    ask:
      brain: "Need project knowledge"
```

### Agent with MCP Integration
```yaml
# meshes/protagents/meet/config.yaml
mesh: meet
description: "Meeting coordination agent using Google Calendar MCP"
type: ephemeral

agents:
  - name: scheduler
    model: sonnet
    prompt: scheduler/prompt.md
    mcpServers:
      gcal:
        command: npx
        args:
          - gcal-mcp

entry_point: scheduler
completion_agent: scheduler

routing:
  scheduler:
    complete:
      core: "Meeting scheduled successfully"
    blocked:
      core: "Need clarification or unable to schedule"
    confused:
      core: "Unclear request - need human input"

rearmatter:
  enabled: true
  fields:
    - status
    - meeting_time
    - attendees
```
