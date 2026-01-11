# Mesh Configuration Reference

Comprehensive reference for mesh configuration fields in TX V4. Each field documented with source location, type, behavior, and examples.

> **Source**: Audited from codebase at `src/worker/mesh-validator.ts`, `src/worker/dispatcher.ts`, `src/worker/sdk-runner.ts`

---

## Core Identity Fields

### `mesh`
- **Type**: `string`
- **Required**: Yes
- **Values**: Any valid identifier (kebab-case recommended)
- **Behavior**: Unique mesh identifier used for routing (`{mesh}/{agent}` format), config lookup, and logging.

```yaml
mesh: research
mesh: dev-graded
mesh: narrative-engine
```

### `description`
- **Type**: `string`
- **Required**: No
- **Behavior**: Human-readable description of the mesh purpose. Used for documentation and logging.

```yaml
description: "Web research mesh: interviewer gathers requirements, sourcer finds sources"
```

### `agents`
- **Type**: `array` of `AgentConfig`
- **Required**: Yes
- **Behavior**: Defines agents in the mesh. Dispatcher spawns `SdkRunner` for each agent.

```yaml
agents:
  - name: worker
    model: opus
    prompt: prompt.md
  - name: analyst
    model: sonnet
    prompt: analyst/prompt.md
```

#### Agent Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Agent identifier (used in routing) |
| `model` | `opus\|sonnet\|haiku` | Yes | LLM model selection |
| `prompt` | string | Yes | Path to prompt.md relative to mesh directory |
| `workspace` | WorkspaceConfig | No | Per-agent workspace override |
| `mcpServers` | Record<string, McpServerConfig> | No | MCP server configurations |

### `entry_point`
- **Type**: `string`
- **Required**: No (defaults to first agent)
- **Values**: Name of an agent defined in `agents` array
- **Behavior**: Specifies which agent receives initial task messages.

```yaml
entry_point: interviewer
entry_point: worker
```

### `completion_agent`
- **Type**: `string`
- **Required**: No
- **Values**: Name of an agent defined in `agents` array
- **Behavior**: Specifies which agent signals task completion. Used for multi-agent workflows.

```yaml
completion_agent: writer
completion_agent: narrator
```

---

## Routing

### `routing`
- **Type**: `object`
- **Required**: No (required for multi-agent meshes)
- **Behavior**: Defines agent-to-agent routing rules. Injected into agent system prompts automatically.

**Format**:
```yaml
routing:
  {agent_name}:
    {status_type}:
      {target_agent}: "Reason for routing"
```

**Target values**:
- `core` → routes to `core/core`
- `{agent_name}` → routes to `{mesh}/{agent_name}`
- `{mesh}/{agent}` → fully qualified path

**Example**:
```yaml
routing:
  interviewer:
    complete:
      sourcer: "Requirements complete, ready to source information"
    blocked:
      core: "Cannot proceed - unclear research requirements"
  analyst:
    complete:
      writer: "Analysis complete"
    needs-more-data:
      sourcer: "Insufficient information"
```

---

## Intents (Intent-Based Routing)

### `intents`
- **Type**: `object`
- **Required**: No
- **Behavior**: Enables intent-based mesh selection from user input patterns.

#### `intents.patterns`
- **Type**: `array` of strings
- **Behavior**: Trigger phrases that match this mesh's purpose

```yaml
intents:
  patterns:
    - research
    - investigate
    - "find out"
    - "what's the state of"
```

#### `intents.commands`
- **Type**: `Record<string, string>`
- **Behavior**: Maps pattern keywords to slash commands

```yaml
intents:
  commands:
    build: "/know:build"
    implement: "/know:build"
    bug: "/know:bug"
```

---

## Workspace Configuration

### `workspace`
- **Type**: `object` (WorkspaceConfig) or `string` (legacy)
- **Required**: No
- **Behavior**: Defines task-scoped output directory. Injected into system prompt.

#### `workspace.path`
- **Type**: `string`
- **Default**: `.ai/tx/output/{task-id}/`
- **Values**: Path template supporting variables: `{task-id}`, `{topic}`, `{mesh}`

```yaml
workspace:
  path: ".ai/research/{topic}/"
  path: ".ai/games/{game-id}/"
```

#### `workspace.output`
- **Type**: `Record<string, string>`
- **Behavior**: Defines expected output files with descriptions

```yaml
workspace:
  output:
    report.md: "Final research report"
    sources.json: "Source references"
```

#### `workspace.create_on_init`
- **Type**: `boolean`
- **Default**: `true`
- **Behavior**: Whether to create directory on workspace initialization

#### `workspace.cleanup_on_complete`
- **Type**: `boolean`
- **Default**: `false`
- **Behavior**: Whether to delete workspace directory after task completion

---

## Quality Stack

### `graded`
- **Type**: `boolean | GateType[]`
- **Default**: `false`
- **Values**:
  - `false` - No quality evaluation
  - `true` - Pre-flight decides gates, runs all available
  - `['checklist', 'rubric']` - Only specified gates
- **Behavior**: Enables quality stack for mesh with automatic iteration on failure.

**Valid gate types**:
| Gate | Type | Description |
|------|------|-------------|
| `checklist` | LLM | Task-type specific verification |
| `rubric` | LLM | Dynamic criteria scoring from pre-flight |
| `adversarial` | LLM | Challenge assumptions, find weaknesses |
| `accuracy` | LLM | Source validation, first-party vs second-party |
| `deterministic` | Code | Run tests, lint, type checks |
| `summarizer` | LLM | Consensus from ensemble (weights by confidence) |

```yaml
graded: true

# Or selective gates:
graded:
  - checklist
  - adversarial
```

### `iteration`
- **Type**: `object`
- **Default**: `{ maxIterations: 3, onFail: 'loop' }`
- **Behavior**: Controls quality gate failure behavior

#### `iteration.maxIterations`
- **Type**: `number`
- **Default**: `3`
- **Behavior**: Maximum retry attempts before failure

#### `iteration.onFail`
- **Type**: `'loop' | 'halt'`
- **Default**: `'loop'`
- **Behavior**:
  - `loop` - Resume session with feedback, retry up to maxIterations
  - `halt` - Stop immediately with error

```yaml
graded: true
iteration:
  maxIterations: 5
  onFail: loop
```

---

## Lifecycle Hooks

### `lifecycle`
- **Type**: `object`
- **Required**: No
- **Behavior**: Explicit lifecycle hooks. Takes precedence over shorthands (`worktree`, `graded`).

#### `lifecycle.pre`
- **Type**: `string[]`
- **Behavior**: Hooks executed before worker spawn. If any fails, worker spawn is aborted.

**Available pre-hooks**:
- `worktree:create` - Create isolated git worktree
- `quality:preflight` - Run LLM preflight analysis

#### `lifecycle.post`
- **Type**: `string[]`
- **Behavior**: Hooks executed after worker completion.

**Available post-hooks**:
- `worktree:cleanup` - Remove worktree
- `commit:auto` - Spawn haiku agent to create commit
- `quality:evaluate` - Run full quality stack (legacy)
- `quality:checklist` - Individual checklist gate
- `quality:rubric` - Individual rubric gate
- `quality:adversarial` - Individual adversarial gate
- `quality:accuracy` - Individual accuracy gate
- `quality:summarizer` - Individual summarizer gate
- `quality:deterministic` - Individual deterministic gate

```yaml
lifecycle:
  pre:
    - worktree:create
    - quality:preflight
  post:
    - quality:checklist
    - quality:rubric
    - commit:auto
    - worktree:cleanup
```

**Execution flow**:
```
Pre-hooks (sequential) → Worker Execution → Post-hooks (sequential)
```

---

## Shorthand Fields

### `worktree`
- **Type**: `boolean`
- **Default**: `false`
- **Behavior**: Shorthand that expands to lifecycle hooks:
  - pre: `worktree:create`
  - post: `commit:auto`, `worktree:cleanup`

```yaml
worktree: true
```

---

## Ralph Loops (Iterative Refinement)

### `ralph_loops`
- **Type**: `object` (RalphLoopConfig)
- **Required**: No
- **Behavior**: Enables iterative agent refinement with hard resource limits and success pattern detection. Agents loop until they signal success or hit resource limits.

#### `ralph_loops.enabled`
- **Type**: `boolean`
- **Required**: Yes
- **Behavior**: Enables/disables Ralph Loops for this mesh

#### `ralph_loops.agents`
- **Type**: `array` of `RalphLoopAgentConfig`
- **Required**: Yes (if enabled)
- **Behavior**: Defines which agents use loops and their limits

**RalphLoopAgentConfig fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Agent name (must match an agent in `agents` array) |
| `max_iterations` | number | Yes | Maximum number of iterations (must be > 0) |
| `iteration_limits` | object | Yes | Resource limits per iteration |
| `success_patterns` | string[] | Yes | String patterns indicating success (case-sensitive) |

**iteration_limits fields**:
| Field | Type | Description |
|-------|------|-------------|
| `time_ms` | number | Max milliseconds per iteration (hard cutoff) |
| `tokens` | number | Max tokens per iteration (hard cutoff) |
| `cost_usd` | number | Max cost per iteration (hard cutoff) |

```yaml
ralph_loops:
  enabled: true
  agents:
    - name: ralph-haiku
      max_iterations: 3
      iteration_limits:
        time_ms: 30000      # 30 seconds max per iteration
        tokens: 50000       # 50k tokens max per iteration
        cost_usd: 0.10      # $0.10 max per iteration
      success_patterns:
        - "✓ DONE"
        - "✓ SUCCESS"
        - "✓ COMPLETE"
```

**Metadata emission**: After loop completion, metadata is added to message frontmatter:
```yaml
ralph_loop_metadata:
  iterations_completed: 3
  total_tokens: 45000
  total_cost_usd: 0.08
  total_time_ms: 50000
  success: true
  final_pattern_matched: "✓ DONE"
  limit_hit: null  # or 'iterations' | 'time' | 'tokens' | 'cost'
```

**Layered evaluation pattern**: Combine with routing to create evaluation chains:
```yaml
ralph_loops:
  enabled: true
  agents:
    - name: haiku-worker
      max_iterations: 3
      iteration_limits:
        time_ms: 30000
        tokens: 50000
        cost_usd: 0.10
      success_patterns:
        - "✓ DONE"

routing:
  haiku-worker:
    done:
      sonnet-reviewer: "Haiku complete, ready for review"
  sonnet-reviewer:
    approved:
      opus-reviewer: "Sonnet approved, final check"
    rejected:
      haiku-worker: "Sonnet rejected, refine again"
  opus-reviewer:
    approved:
      core: "All layers approved"
    rejected:
      haiku-worker: "Opus wants refinement"
```

---

## Agent Capabilities

### `toolRestriction`
- **Type**: `'unrestricted' | 'mcp-only'`
- **Default**: `'unrestricted'`
- **Behavior**: Controls agent tool access policy:
  - `unrestricted` - Full SDK tools + MCP tools (Read, Write, Bash, etc.)
  - `mcp-only` - ONLY MCP server tools, no built-in SDK tools

```yaml
toolRestriction: mcp-only
```

---

## MCP Servers (Agent-Level)

### `mcpServers`
- **Type**: `Record<string, McpServerConfig>`
- **Location**: Per-agent in `agents` array
- **Behavior**: Configures MCP servers for external tool access

```yaml
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
- `command`: Executable to run (e.g., `npx`, `node`)
- `args`: Array of command arguments
- `env`: Environment variable overrides

---

## Transparency (Rearmatter)

### `rearmatter`
- **Type**: `object`
- **Required**: No
- **Behavior**: Configures transparency/self-assessment metadata.

#### `rearmatter.enabled`
- **Type**: `boolean`
- **Default**: `false`

#### `rearmatter.fields`
- **Type**: `string[]`
- **Common fields**: `grade`, `confidence`, `status`, `gaps`, `assumptions`

#### `rearmatter.thresholds`
- **Type**: `object`
- **Sub-fields**: `confidence` (0.0-1.0), `grade` (A-F)

```yaml
rearmatter:
  enabled: true
  fields:
    - grade
    - confidence
    - status
    - gaps
  thresholds:
    confidence: 0.7
    grade: B
```

---

## Context Propagation

### `injectOriginalMessage`
- **Type**: `boolean`
- **Default**: `false`
- **Behavior**: Injects the original task message (frontmatter + body) into downstream agent prompts in multi-agent workflows. Enables downstream agents to validate their work against original requirements without parsing upstream agent output.

**Use case**: In a `dev-haiku` mesh, the sonnet validator can reference the original task to verify haiku's implementation matches the spec.

**Injection format**: Appears as `## Original Task Message` section before upstream agent output.

```yaml
mesh: dev-haiku
description: "Fast dev with validation"
injectOriginalMessage: true  # Sonnet sees original task

agents:
  - name: haiku
    model: haiku
    prompt: haiku/prompt.md
  - name: sonnet
    model: sonnet
    prompt: sonnet/prompt.md

entry_point: haiku
completion_agent: sonnet

routing:
  haiku:
    complete:
      sonnet: "Ready for validation"
```

**Note**: The entry point agent does NOT receive injection (it IS processing the original). Only downstream agents see the injected original message.

---

## System & Type Fields

### `type`
- **Type**: `'persistent' | 'ephemeral'`
- **Default**: `'ephemeral'`
- **Behavior**: Currently informational. All workers are SDK-based ephemeral.

### `system`
- **Type**: `boolean`
- **Default**: `false`
- **Behavior**: Marks mesh as a system mesh (utility meshes not for direct user invocation).

```yaml
# meshes/system/commit-agent/config.yaml
system: true
```

---

## Config Resolution Order

1. **Project meshes**: `{workDir}/meshes/{mesh}/config.yaml`
2. **Project legacy**: `{workDir}/meshes/configs/{mesh}.json`
3. **Global meshes**: `{TX_ROOT}/meshes/{mesh}/config.yaml`

Project configs override global configs with same mesh name.

---

## Prompt Resolution Order

1. **Mesh basePath**: `{meshConfig._basePath}/{agent.prompt}` (new flat structure)
2. **WorkDir relative**: `{workDir}/{agent.prompt}` (legacy)
3. **TX_ROOT fallback**: `{TX_ROOT}/{agent.prompt}`

---

## Complete Example

```yaml
mesh: dev-graded
description: "Developer mesh with grading and iteration for quality assurance"

# Quality stack
graded: true
iteration:
  maxIterations: 5
  onFail: loop

# Intent matching
intents:
  patterns:
    - build
    - implement
    - fix
  commands:
    build: "/know:build"

# Agent definitions
agents:
  - name: worker
    model: opus
    prompt: prompt.md

entry_point: worker

# Task workspace
workspace:
  path: ".ai/output/{task-id}/"

# Message routing
routing:
  worker:
    complete:
      core: "Implementation complete"
    blocked:
      core: "Need clarification or human input"
```
