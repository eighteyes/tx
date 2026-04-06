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
mesh: dev-quality
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
| `model` | `opus\|sonnet\|haiku` | Yes* | LLM model (*defaults to `haiku` if `load` set, else `sonnet`) |
| `prompt` | string | Yes* | Path to prompt.md relative to mesh directory (*at least one of `prompt` or `command` required) |
| `command` | string | No | Slash command to prepend (e.g. `/know:build`). Alternative to `prompt` — at least one required. |
| `workspace` | WorkspaceConfig | No | Per-agent workspace override |
| `mcpServers` | Record<string, McpServerConfig> | No | MCP server configurations |
| `load` | string[] | No | Files to preload into context (globs supported) |
| `checkpoint` | boolean \| `'start'` \| `'end'` | No | Save session state for forking (`true`/`'start'`: after init, `'end'`: after completion) |
| `fork_from` | string | No | Fork from another agent's checkpoint |
| `thinking` | boolean | No | Extended thinking (default: true). Set `false` to disable. |
| `max_turns` | number | No | API round-trip limit per invocation |
| `max_messages` | number | No | Outbound message limit per invocation |

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

### `routing_mode`
- **Type**: `'agent' | 'dispatcher' | 'static' | 'manifest' | 'free'`
- **Required**: No (defaults to `agent`)
- **Behavior**: Controls how agents are sequenced within a mesh.

**Static routing** — ordered chain, worker exit fires next agent:
```yaml
routing_mode: static
routing:
  - preprocessor
  - analyzer
  - reporter
```
- `routing[0]` is entry point (overrides `entry_point`)
- `routing[last]` is implicit completion agent
- No inter-agent messaging — agents do their work and exit
- On error: chain halts, error surfaces to `core/core`
- Routing resolved at mesh load time, not runtime

**Dispatcher routing format**:
```yaml
routing_mode: dispatcher
routing:
  agent-a: agent-b                    # linear — always routes to agent-b
  agent-b:                            # branch — outcome determines target
    approved: agent-c
    needs_work: agent-a
    default: agent-c
  # agent-c: (absent) = terminal      # routes to core/core on complete
```

**Fan-out / Fan-in** — array with trailing options object:
```yaml
routing:
  planner: [reviewer-a, reviewer-b, reviewer-c, { discuss: true, complete: synthesizer }]
```

| Option | Type | Description |
|--------|------|-------------|
| `complete` | string | Join agent — gated until all fan-out members send `outcome: complete` |
| `discuss` | boolean | Enable peer messaging via `outcome: discuss` + `route_to: peer` |

Fan-out members get implicit routing — no individual entries needed. Type detection: string = linear, object = branch, array = fan-out, absent = terminal.

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

## Lifecycle Hooks

### `lifecycle`
- **Type**: `object`
- **Required**: No
- **Behavior**: Explicit lifecycle hooks for pre/post worker execution. Takes precedence over `worktree` shorthand.

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
- `brain-update` - Analyze work and document insights (side-effects, opportunities, tech debt)
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
    - brain-update      # Document insights after commit
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

## Documentation Fields

### `playbook_notes`
- **Type**: `string` (multiline)
- **Required**: No
- **Behavior**: Design rationale and architectural documentation embedded in the config. Explains WHY the mesh is built this way. Not processed by the system - purely for human/AI maintainers.

**Purpose**: Preserve design intent, document alignment with principles/patterns, explain architectural choices.

**When to use**:
- Mesh follows specific methodology or playbook (e.g., Ralph, ensemble patterns)
- Complex FSM or routing logic that benefits from explanation
- Novel patterns that future maintainers should understand
- Trade-offs or constraints that informed design decisions

**Example**:
```yaml
playbook_notes: |
  Ralph Playbook Implementation:

  Context Efficiency:
  - Prompts compressed from ~250 lines to ~40 lines (84% reduction)
  - Decision trees replace narrative instruction

  Autonomous Operation:
  - Agents control routing via success_signal
  - Clear "when to PASS" guidance prevents endless loops

  Backpressure:
  - Iteration limits enforce finite loops
  - Quality gates provide objective criteria
```

**Related**: For runtime operational guidance, use `AGENTS.md` in the mesh directory (loaded by agents during execution).

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

## Task Distribution

### `task_distribution`
- **Type**: `object`
- **Required**: No
- **Behavior**: Spawner/subagent pattern for parallel task execution. Alternative to FSM ensemble states.

#### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `spawner` | string | Agent that splits task into subtasks |
| `subagents` | string[] | Agents that execute subtasks |
| `reviewer` | string | Agent that combines results |
| `distribution_strategy` | string | How to split work |

#### Distribution Strategies

| Strategy | Description |
|----------|-------------|
| `equal` | Split evenly across subagents |
| `weighted` | Assign based on agent capabilities |
| `adaptive` | Dynamic based on task complexity |
| `custom` | Use `distribution_prompt` for custom logic |

#### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `distribution_prompt` | string | - | Custom split instructions (required for `custom` strategy) |
| `subtask_count` | number | - | Fixed number of subtasks |
| `timeout_ms` | number | - | Timeout for all subtasks |
| `allow_partial_failure` | boolean | false | Continue with partial results |

**Example**:
```yaml
task_distribution:
  spawner: coordinator
  subagents: [analyst-1, analyst-2, analyst-3]
  reviewer: synthesizer
  distribution_strategy: equal
  timeout_ms: 300000
  allow_partial_failure: true
```

**vs Ensemble**: Task distribution splits work into parts; ensemble runs same task in parallel.

---

## Additional Config Fields

### `brain`
- **Type**: `boolean`
- **Default**: `false`
- **Behavior**: Enables brain-update lifecycle hook for documenting insights.

### `capabilities`
- **Type**: `string[]`
- **Required**: No
- **Behavior**: Tags for agent capability matching. Used for intent-based routing.

```yaml
capabilities:
  - code-review
  - refactoring
```

### `config`
- **Type**: `object`
- **Required**: No
- **Behavior**: Arbitrary mesh-specific settings. Not processed by core system.

```yaml
config:
  custom_setting: value
  domain_specific:
    nested: true
```

### `idle_timeout_minutes`
- **Type**: `number | false`
- **Default**: System default
- **Behavior**: How long idle workers stay alive. `false` disables timeout.

```yaml
idle_timeout_minutes: 30    # 30 minute timeout
idle_timeout_minutes: false # No timeout
```

### `clear-before`
- **Type**: `boolean`
- **Default**: `false`
- **Behavior**: Clear existing state before mesh run. Removes suspended sessions and pending asks.

### `turn_workspace`
- **Type**: `object`
- **Required**: No
- **Behavior**: Custom workspace configuration for turn-based workflows.

```yaml
turn_workspace:
  template: ".ai/games/{game-id}/turn-{turn}/"
  schema:
    turn: number
    board: string
```

### `persistence`
- **Type**: `boolean | string[]`
- **Default**: `false`
- **Behavior**: Sessions persist across mesh runs. When `true`, all agents persist. Array specifies which agents.

```yaml
persistence: true                    # All agents persist
persistence: [coordinator, worker]   # Only these agents persist
```

### `continuation`
- **Type**: `boolean | string[]`
- **Default**: `true`
- **Behavior**: Controls whether agent conversation IDs are saved and reused across dispatches within a mesh run. The default (`true`) is the natural behavior — sessions persist. Set `false` to force cold starts (fresh conversation every dispatch).

The main use case for `continuation: false` is enabling `checkpoint`/`fork_from`, which needs isolated session snapshots that live sessions prevent.

```yaml
continuation: true                   # Default — sessions reuse naturally
continuation: false                  # Force cold starts (needed for fork_from)
continuation: [worker]               # Only worker reuses sessions
```

### `routing_fallback` (DEPRECATED)
- **Type**: `string`
- **Required**: No
- **Deprecated**: Use `guardrails.routing_error.routing_fallback` instead.
- **Behavior**: Global fallback agent when edge iteration limits are hit. Migrated to `guardrails.routing_error` at load time.

```yaml
# Deprecated:
routing_fallback: coordinator

# Preferred:
guardrails:
  routing_error:
    routing_fallback: coordinator
```

### `routing_retry_max` (DEPRECATED)
- **Type**: `number`
- **Required**: No
- **Deprecated**: Use `guardrails.routing_error.routing_retry_max` instead.
- **Behavior**: Max messages on any routing edge per turn before fallback. Migrated to `guardrails.routing_error` at load time.

```yaml
# Deprecated:
routing_retry_max: 5

# Preferred:
guardrails:
  routing_error:
    routing_retry_max: 5
```

### `manifest_enforcement`
- **Type**: `object`
- **Required**: No
- **Behavior**: Artifact validation settings for manifest-declared files. Controls pre-dispatch read validation and post-completion write validation.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pre_validation` | boolean | `true` | Check reads exist before dispatching agent |
| `post_validation` | boolean | `true` | Check writes exist after agent completes |
| `max_retry` | number | `2` | Resume agent N times before failing (strict only) |
| `strict` | boolean | `false` | Block dispatch / retry+halt on failure |
| `warning` | boolean | `true` | Log warning on failure (non-strict) |

```yaml
manifest_enforcement:
  post_validation: true   # Check writes exist after agent completes
  pre_validation: true    # Check reads exist before dispatching
  max_retry: 2            # Resume agent N times before failing
  strict: false           # false = allow + warn; true = block/retry
  warning: true           # Log warning on validation failure
```

### `max_mesh_messages`
- **Type**: `number` or `{ strict?: boolean; warning?: boolean; limit?: number }`
- **Required**: No
- **Default**: null (no limit)
- **Behavior**: Mesh-wide cap on total messages across all agents in a mesh run. When the limit is reached:
  - Strict mode: kills all active workers in the mesh
  - Warning mode: logs and allows mesh to continue

**Resolution**: Top-level `max_mesh_messages` in mesh config takes priority. Falls back to `guardrails.max_mesh_messages` chain (mesh > global > default).

Resets when a new turn starts (entry_point receives a task).

```yaml
# Simple form
max_mesh_messages: 50

# Object form with mode control
max_mesh_messages:
  strict: true
  warning: true
  limit: 50
```

### `stop_on_first_complete`
- **Type**: `boolean`
- **Default**: `true`
- **Behavior**: When `true`, the mesh completes as soon as the first boundary agent sends a completion signal. Set `false` for fan-in exit nodes where all agents must finish before the mesh completes.

```yaml
# Default: first completion signal ends the mesh
stop_on_first_complete: true

# Fan-in: wait for all boundary agents
stop_on_first_complete: false
```

### `check_queue_on_complete`
- **Type**: `boolean`
- **Default**: `true`
- **Behavior**: When `true`, defers mesh shutdown if the queue still has pending messages when a completion signal arrives. For iterative meshes where an early complete signal may have pending work in the queue — ensures all queued work drains before shutdown.

```yaml
# Default: check queue before shutting down
check_queue_on_complete: true

# Immediate shutdown on completion (skip queue drain)
check_queue_on_complete: false
```

### `load_claude_md`
- **Type**: `boolean`
- **Default**: `true`
- **Behavior**: When `true`, the project-level `CLAUDE.md` is loaded into the agent's system prompt as the first section. Looks for `CLAUDE.md` or `.claude/CLAUDE.md` in the working directory. Only loads project-level files — never the user's global `~/.claude/CLAUDE.md`.

```yaml
# Default: project CLAUDE.md is loaded into agent prompts
load_claude_md: true

# Disable for meshes that should not inherit project instructions
load_claude_md: false
```

**When to disable**: Meshes that operate independently of project conventions, or when CLAUDE.md instructions conflict with mesh agent behavior.

### `autoInjectManifestFiles`
- **Type**: `boolean`
- **Required**: No
- **Default**: `true`
- **Behavior**: When enabled, files declared in `manifest[].reads` for an agent are automatically preloaded into the agent's context (merged with explicit `load` field). Individual manifest entries can override this with `autoInject: false`.

```yaml
# Disable auto-injection for the entire mesh
autoInjectManifestFiles: false

# Per-entry override in manifest
manifest:
  - id: config.yaml
    reads: [worker]
    writes: []
    autoInject: false  # Skip this file even if mesh-level is true
```

---

## Iteration Control

### `iteration`
- **Type**: `object`
- **Default**: `{ maxIterations: 3, onFail: 'loop' }`
- **Behavior**: Controls quality gate failure behavior (used with quality hooks)

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
iteration:
  maxIterations: 5
  onFail: loop
```

---

## File Preload

### `load` (Agent Field)
- **Type**: `string[]`
- **Required**: No
- **Behavior**: Files matching patterns are read and injected into the agent's system prompt before execution.

**Features**:
- Glob patterns supported (`*.md`, `src/**/*.ts`)
- Files over 200KB are skipped with warning
- `node_modules/` and `.git/` auto-excluded
- Model defaults to `haiku` when `load` is set (cheap preloaders)

```yaml
agents:
  - name: preloader
    model: haiku        # Defaults to haiku when load is set
    prompt: prompt.md
    load:
      - "package.json"  # Exact file
      - "*.md"          # Glob pattern
      - "src/**/*.ts"   # Recursive glob
```

**Use cases**:
- Virtual "setup" agents that preload project context
- Checkpoint entry points that establish shared context
- Cheap haiku agents that read files before expensive opus agents work

---

## Extended Thinking

### `thinking` (Agent Field)
- **Type**: `boolean`
- **Default**: `true`
- **Behavior**: Controls extended thinking for the agent. When `true` (default), extended thinking is enabled — the model can reason internally before responding. Set `false` to disable extended thinking by setting `maxThinkingTokens: 0` on the SDK query.

**When to disable**: Fast-path agents where thinking overhead isn't justified (preloaders, simple routers, haiku agents with trivial tasks).

```yaml
agents:
  - name: preloader
    model: haiku
    prompt: preload.md
    load: ["package.json"]
    thinking: false   # Skip thinking for cheap preload agent

  - name: worker
    model: opus
    prompt: worker.md
    thinking: true    # Default — extended thinking enabled
```

---

## Session Forking

Share conversation context between agents via checkpoints.

### `checkpoint` (Agent Field)
- **Type**: `boolean | 'start' | 'end'`
- **Default**: `false`
- **Behavior**: Saves the agent's session state for forking by other agents.
  - `true` or `'start'`: Checkpoint captured after agent initialization (before work). Forks get the agent's initial context.
  - `'end'`: Checkpoint captured after agent completion. Forks get the agent's full conversation history including work output.

### `fork_from` (Agent Field)
- **Type**: `string`
- **Required**: No
- **Values**: Name of another agent in the mesh
- **Behavior**: Loads the specified agent's checkpoint sessionId as the starting session. The forked agent continues from the checkpoint's conversation history.

```yaml
agents:
  - name: setup
    model: haiku
    prompt: setup.md
    load: ["package.json"]
    checkpoint: true      # Save session for forking

  - name: worker-a
    model: sonnet
    prompt: worker.md
    fork_from: setup      # Fork from setup's checkpoint

  - name: worker-b
    model: opus
    prompt: worker.md
    fork_from: setup      # Same checkpoint, different agent
```

**Behavior**:
- Works across models (haiku checkpoint → opus fork)
- Forked agents see full conversation history from checkpoint
- Checkpoints are scoped to mesh name (concurrent runs may share checkpoints)

**Use cases**:
- Skip redundant prework (preload once, fork many)
- Share established context across parallel workers
- Model escalation with preserved context

---

## Parallel Execution

Fork from entry, run agents concurrently, join at exit.

### `parallelism`
- **Type**: `array` of `ParallelBlock`
- **Required**: No
- **Behavior**: Defines parallel execution blocks with fork/join semantics.

#### ParallelBlock Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agents` | string[] | Yes | Agents to run in parallel |
| `entry` | string | Yes | Fork point (auto-gets `checkpoint: true`) |
| `exit` | string | Yes | Sync gate (waits for all parallel agents) |
| `timeout` | number | No | Max wait time in milliseconds |
| `on_partial` | `continue\|abort` | No | Behavior on partial failure (default: `continue`) |

```yaml
agents:
  - name: preload
    model: haiku
    prompt: preload.md
    load: ["package.json"]
    # checkpoint: true auto-added

  - name: analyst
    model: sonnet
    prompt: analyst.md
    # fork_from: preload auto-added

  - name: reviewer
    model: sonnet
    prompt: reviewer.md

  - name: critic
    model: sonnet
    prompt: critic.md

  - name: synthesizer
    model: sonnet
    prompt: synthesizer.md

parallelism:
  - agents: [analyst, reviewer, critic]
    entry: preload        # Fork point (gets checkpoint: true)
    exit: synthesizer     # Sync gate (waits for all)
    timeout: 300000       # Optional: 5 min timeout
    on_partial: continue  # continue | abort on partial failure
```

**Flow**:
```
preload (entry)
    │ checkpoint
    ├─────┼─────┐
    ▼     ▼     ▼
analyst reviewer critic  (parallel, forked from preload)
    │     │     │
    └─────┼─────┘
          ▼
    synthesizer (exit, gated until all complete)
```

**Auto-wiring**:
- Entry agent gets `checkpoint: true` automatically
- Parallel agents get `fork_from: entry` automatically
- Exit agent is gated until ALL parallel agents complete

**Routing requirement**: Parallel agents must route to exit agent:
```yaml
routing:
  preload:
    complete:
      analyst: "Ready for analysis"
  analyst:
    complete:
      synthesizer: "Analysis done"
  reviewer:
    complete:
      synthesizer: "Review done"
  critic:
    complete:
      synthesizer: "Critique done"
  synthesizer:
    complete:
      core: "Synthesis complete"
```

**vs FSM Ensemble**:

| Feature | `parallelism:` | FSM `ensemble:` |
|---------|---------------|-----------------|
| Fork context | Yes (checkpoint) | No |
| Result aggregation | No (just sync) | Yes (concat/vote/etc) |
| Gating | Exit gated | FSM state transition |
| Use case | Parallel work, shared context | Same task, multiple perspectives |

---

## Complete Example

```yaml
mesh: dev-quality
description: "Developer mesh with quality hooks for output validation"

# Lifecycle hooks for quality gates
lifecycle:
  pre:
    - quality:preflight
  post:
    - quality:checklist
    - quality:rubric
    - commit:auto

# Iteration control for quality retry
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
