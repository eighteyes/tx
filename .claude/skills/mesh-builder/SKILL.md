---
name: mesh-builder
description: Build TX V4 meshes - agent configs, prompts, routing. Use for new meshes, agent roles, or multi-agent workflows. Triggers - mesh, routing, agents, multi-agent, config.yaml
---

# Mesh Builder

Build meshes (agent workflows) for TX V4.

## Core Philosophy: Earn Your Keep

**Start with the minimum. Add only what the mesh actually needs.**

Every config option added is complexity that can break. The default question for each field is: **"Does this mesh fail without it?"** If no — leave it out.

### Config Options and When They're Warranted

| Option | Warranted when... | Default |
|--------|-------------------|---------|
| `dev_mode: true` | Testing a new mesh end-to-end before committing to full model costs | Omit |
| `fsm:` | Routing depends on computed state/counters/file presence — NOT agent judgment | Omit |
| `parallelism:` | Agents truly run in parallel and need a sync gate | Omit |
| `routing_mode: dispatcher` | Fan-out to N parallel workers is the core mechanic | Omit |
| `type: persistent` / `auto_despawn: false` | Mesh must survive indefinitely (daemon pattern) | Omit |
| `continuation: false` | You explicitly need cold starts for isolation | Omit (continuation is default-on) |
| `lifecycle:` hooks | Quality gates or auto-commits are genuinely required | Omit |
| `workspace:` | Agents need structured file workspace management | Omit |
| `checkpoint:` / `fork_from:` | Multiple agents need shared prior context | Omit |
| `load:` | Files must be in context before any work starts | Omit |
| `ensemble:` | Same task, multiple perspectives, aggregated output | Omit |
| `injectOriginalMessage:` | Downstream agents truly need the original task | Omit |
| `rearmatter:` | FSM routing depends on self-assessment scores | Omit |
| `guardrails:` | Custom limits differ from system defaults | Omit |

**The minimal working mesh:**
```yaml
mesh: my-mesh
description: "What it does"
agents:
  - name: worker
    model: sonnet
    prompt: worker.md
entry_point: worker
```
This is complete. Everything else is optional and should be justified.

### Common Over-Engineering Patterns to Avoid

- **Orchestrator doing implementation work** — add `orchestrator: true` to enforce routing-only (Read + Write msgs-only). System-level enforcement beats prompt instructions.
- **FSM + orchestrator that handles all routing** — pick one. If orchestrator routes, drop FSM.
- **`type: persistent` on a mesh that runs once** — persistent is for daemons only.
- **`lifecycle:` hooks "just in case"** — add when quality gates are actually required.
- **`parallelism:` on 2 agents** — just route them sequentially, parallelism overhead isn't worth it.
- **`checkpoint:/fork_from:` when agents don't share context** — preloading context agents don't need wastes tokens.
- **Ensemble with 1 agent** — that's just a regular agent.

## Dev Mode — Cheap Workflow Testing

```yaml
dev_mode: true  # Forces ALL agents to haiku regardless of config
```

**Enable when:** You've built a new mesh and want to test the routing, workflow, and agent coordination end-to-end before paying for sonnet/opus runs. Haiku is fast and cheap — use it to validate the plumbing works before the real thing.

**Enable for:**
- First run of any new mesh (always test with dev_mode first)
- Debugging routing issues (agent A → B → C flow)
- Validating FSM state transitions
- Testing ask-human and HITL flows
- Any mesh with 4+ agents where a full run would be expensive

**Disable when:**
- The workflow is confirmed working and you need quality output
- Haiku's reasoning is insufficient for the task (complex synthesis, conflict resolution, architectural decisions)
- Running in production

**Never commit `dev_mode: true`** — it's a testing flag. Remove it before the mesh is considered production-ready. If you see it in a mesh config, that mesh hasn't been signed off yet.

```yaml
# ✅ Testing a new mesh
dev_mode: true
agents:
  - name: synthesizer
    model: opus   # ignored — all agents become haiku in dev_mode

# ✅ Production — remove dev_mode entirely
agents:
  - name: synthesizer
    model: opus   # now respected
```

## Quick Start

```bash
# Test prompt output before deploying
tx prompt <mesh> <agent>              # View built prompt with injected protocol
tx prompt narrative-engine narrator   # Example
tx prompt dev --raw                   # Raw output, no metadata
```

## Documentation

| Topic | Location |
|-------|----------|
| Config fields | `docs/mesh-config.md` |
| FSM (state tracking) | `.ai/docs/mesh-fsm-config.md` |
| Available meshes | `docs/meshes.md` |
| Message format | `docs/message-format.md` |

## Minimal Config

```yaml
mesh: example
description: "What this mesh does"

agents:
  - name: worker
    model: sonnet       # opus | sonnet | haiku
    prompt: prompt.md

entry_point: worker
```

## Command Agents

Agents can invoke slash commands instead of (or in addition to) prompt files. The command is prepended to the user prompt when processing messages.

```yaml
agents:
  - name: builder
    model: opus
    command: "/know:build"
    prompt: builder/prompt.md  # optional extra context

  - name: reviewer
    model: sonnet
    command: "/know:review"
    # no prompt needed - command expands to full workflow
```

**Precedence:**
1. Message frontmatter `command:` (highest)
2. Agent config `command:` (default)
3. No command (just prompt as system prompt)

Requires `settingSources: ['project']` (already enabled by default).

### Command Template Interpolation

Commands support `{key}` template tokens that resolve from the message payload at runtime. Use this to pass dynamic values (like feature names) through the mesh pipeline.

```yaml
agents:
  - name: prebuild
    model: haiku
    command: "/know:prebuild {feature}"   # {feature} replaced from payload

  - name: builder
    model: opus
    command: "/know:build {feature}"      # same token, resolved per-message
```

**Resolution rules:**
- `{key}` matches `msg.payload[key]` — if present, replaced with the string value
- Unresolved tokens stay as literal text (no silent failures, no crashes)
- Payload values come from message frontmatter (e.g., `feature: auth-system`)

**Propagation:** Upstream agents must include the key in their completion message frontmatter for downstream agents to receive it. The consumer maps frontmatter fields to `payload` automatically.

```
User message:  feature: auth  → prebuild gets "/know:prebuild auth"
Prebuild msg:  feature: auth  → builder gets "/know:build auth"
```

## Writing Prompts

Focus on **workflow only**.

### System Auto-Injects (DO NOT WRITE IN PROMPTS):
- ❌ Message protocol (frontmatter schema, message types, paths format)
- ❌ Routing instructions (how to write messages to other agents)
- ❌ Rearmatter format (success_signal, grade, confidence fields)
- ❌ Workspace structure and paths (auto-injected from config.yaml)
- ❌ Message file naming conventions
- ❌ Tool availability and usage instructions (system provides)

### Write ONLY:
- ✅ Agent role and mandate
- ✅ Workflow steps (what to do, when)
- ✅ Decision trees and logic
- ✅ Domain-specific guidance
- ✅ Quality gates and success criteria

```markdown
# {Agent Name}

You are the {role} agent.

## Workflow
1. Read incoming task
2. {Work steps}
3. Signal completion when finished
```

### Prompt Template Tokens

Prompts can embed `{key}` template tokens that are replaced with resolved values at runtime, **before** any section injection. This lets agents reference dynamic paths inline rather than relying on injected context sections.

**Built-in tokens** (always available when workspace is resolved):
- `{workspace}` → absolute path to the resolved workspace directory

**Example usage in prompt:**
```markdown
## Phase 0: Inventory
ls {workspace}/prose-draft.md
cat {workspace}/context.yaml
```

At runtime, if workspace resolves to `/project/.ai/games/my-game/campaigns/campaign-1/turns/turn-35`, the prompt becomes:
```markdown
## Phase 0: Inventory
ls /project/.ai/games/my-game/campaigns/campaign-1/turns/turn-35/prose-draft.md
cat /project/.ai/games/my-game/campaigns/campaign-1/turns/turn-35/context.yaml
```

**Rules:**
- Tokens that don't appear in the prompt are no-ops (safe for all meshes)
- Unresolved tokens (no matching key) are left as-is (no silent failures)
- Replacement happens via `PromptInjector.replaceTemplateTokens()` before workspace section injection
- The `injectWorkspace()` method automatically replaces `{workspace}` — no caller changes needed

**Dynamic workspace resolution** via `workspace.variables` + `workspace.locations`:

When the workspace config declares `variables` and `locations`, the dispatcher resolves template variables from a source file (e.g., `session.yaml`) and uses the resolved `workspace` location as the workspace directory. This enables per-turn or per-session dynamic paths.

```yaml
workspace:
  path: ".ai/games/"               # Static fallback
  variables:
    source: ".ai/tx/my-mesh/session.yaml"  # Fixed path (no chicken-and-egg)
    mapping:
      game-id: game_id             # {game-id} → session.game_id
      campaign-id: campaign_id     # {campaign-id} → session.campaign_id
      N: turn                      # {N} → session.turn
  locations:
    session: ".ai/tx/my-mesh"
    game: ".ai/games/{game-id}"
    campaign: ".ai/games/{game-id}/campaigns/{campaign-id}"
    workspace: ".ai/games/{game-id}/campaigns/{campaign-id}/turns/turn-{N}"
```

**Resolution priority** (dispatcher):
1. FSM context `$workspace` variable (highest — gates use this)
2. Resolved `workspace` location from manifest variables (per-turn path)
3. Static workspace config (`workspace.path`)
4. Default: `.ai/tx/workspaces/<mesh-name>`

Falls back gracefully: if the source file is missing or variables don't resolve, unresolved `{tokens}` remain and the static fallback is used instead.

## Agent Boundaries (CRITICAL for Coordinators)

Haiku agents are eager helpers. Without explicit boundaries, they'll do work meant for other agents. Use `<boundaries>` blocks to constrain behavior.

**Problem**: A haiku coordinator sees domain context (file formats, workflow goals) and decides to "help" by doing the creative work itself instead of routing.

**Solution**: Explicit DO NOT / ONLY lists that name WHO does each task.

```markdown
<role>
Route tasks. Validate state. Forward to specialists.
You are a ROUTER. You do NOT create content.
</role>

<boundaries>
DO NOT:
- Write output files (worker does that)
- Analyze input data (analyst does that)
- Make domain decisions (specialist does that)
- Read file contents beyond checking existence

ONLY:
- Read session state for routing decisions
- Check file EXISTENCE (ls), never CONTENTS (cat)
- Write routing messages to other agents
- Write ask-human when blocked
</boundaries>
```

**Key principles:**
- State WHO does the forbidden work: "(worker does that)"
- Separate existence checks from content reads
- Add "If you find yourself doing X, STOP" guardrails
- Keep domain knowledge minimal - coordinators route, they don't understand

## Phase Coordinators Pattern

For complex pipelines, use **one haiku coordinator per phase** instead of one monolithic coordinator.

**Problem**: A single coordinator managing many phases accumulates too much context and state. It becomes complex, error-prone, and harder to debug.

**Solution**: Split into discrete phase coordinators, each with single responsibility.

**Before (monolithic):**
```yaml
agents:
  - name: coordinator
    model: haiku
    prompt: coordinator/prompt.md  # 400 lines, manages 6 phases
```

**After (phase-based):**
```yaml
agents:
  - name: entry
    model: haiku
    prompt: coordinator/entry.md        # Routes based on state

  - name: init-coord
    model: haiku
    prompt: coordinator/init-coord.md   # Sets up workspace, routes to prep

  - name: prep-coord
    model: haiku
    prompt: coordinator/prep-coord.md   # Fan-out/fan-in for prep agents

  - name: work-coord
    model: haiku
    prompt: coordinator/work-coord.md   # Dispatches workers, routes to validate
```

**Benefits:**
- Each coordinator has ~50-80 lines (vs 400+)
- Single responsibility per agent
- Easier to debug (which phase failed?)
- State validation at phase boundaries
- Boundaries are clearer per-phase

**Pattern:**
```
entry → phase-1-coord → phase-2-coord → ... → completion-coord
              ↓               ↓
         specialists     specialists
```

**Each phase coordinator:**
1. Receives task from previous coordinator
2. Does its ONE job (setup, dispatch, validate, etc.)
3. Updates shared session state
4. Routes to next coordinator

**Shared state**: Use session.yaml that all coordinators read/write. Each coordinator preserves ALL fields when updating.

## Multi-Agent Routing

```yaml
routing:
  agent-a:
    complete:
      agent-b: "Handoff reason"
    blocked:
      core: "Need intervention"
```

See `docs/mesh-config.md` for full routing reference.

## Dispatcher Routing (Opt-in)

Centralized routing where agents write to a sentinel address and the dispatcher resolves targets from config.

```yaml
routing_mode: dispatcher
routing:
  agent-a: agent-b               # linear — always routes to agent-b
  agent-b:                        # branch — outcome determines target
    approved: agent-c
    needs_work: agent-a
    default: agent-c
  # agent-c: (absent) = terminal agent → routes to core/core on complete
```

**Fan-out / Fan-in**: Array value with trailing options object for parallel dispatch:
```yaml
routing_mode: dispatcher
routing:
  planner: [reviewer-a, reviewer-b, reviewer-c, { discuss: true, complete: synthesizer, fan_in: batch }]
```

- `complete: agent` — join agent, gated until all fan-out members send `outcome: complete`
- `discuss: true` — members can peer-message via `outcome: discuss` + `route_to: peer`
- `fan_in: batch|queue|drain` — controls how messages are delivered to the join agent (default: `batch`)
- `transform: summarize` — optional haiku pre-pass to compress responses before delivery
- Fan-out members get implicit routing (no individual entries needed)
- Members send `outcome: complete` to signal done, `outcome: discuss` + `route_to:` for peer chat

**Fan-in delivery modes** (`fan_in`):

| Mode | Behavior |
|------|----------|
| `batch` (default) | Gate until all complete, deliver all responses in one combined message |
| `queue` | Current OAOM serial delivery (N cold worker starts) |
| `drain` | Deliver immediately; inject into running join worker via session resume |

**Transform** (`transform`):

| Value | Behavior |
|-------|----------|
| `summarize` | Haiku pre-pass compresses response(s) before delivery to join agent |

| fan_in | transform | Result |
|--------|-----------|--------|
| batch | — | Gate until all complete, deliver all in one worker |
| batch | summarize | Gate, haiku-compress all responses into one, deliver |
| queue | — | Serial OAOM (N cold starts) |
| queue | summarize | Each message haiku-compressed before its worker run |
| drain | — | Inject each response into running join worker |
| drain | summarize | Each response haiku-compressed then injected |

Agents receive prompt instructions to write `to: mesh/dispatch` with `outcome:` in frontmatter. Override with `route_to:` for explicit targeting. Reserved `outcome: escalate` routes to human.

Fan-out members with `discuss: true` receive a peer list in their prompt. They use `outcome: discuss` + `route_to: peer-name` for peer-to-peer messaging within the group.

Type detection: string value = linear, object value = branch, array value = fan-out, absent = terminal.

## Common Patterns

**Session reuse** (default behavior): `continuation: true` is the default — sessions persist naturally. Set `continuation: false` to force cold starts (needed for `checkpoint`/`fork_from` isolation).

**Persistent mesh (no shutdown on complete)**: For meshes that loop perpetually and report status without dying:
```yaml
completion_agents:
  - weaver
stop_on_first_complete: false   # Completion signal is informational, mesh continues
check_queue_on_complete: true   # (default) Queue-aware for future use
```

| stop_on_first_complete | check_queue_on_complete | Behavior |
|---|---|---|
| true (default) | true (default) | Stop on complete, wait for queue to drain first |
| true | false | Stop immediately on complete (legacy behavior) |
| false | true | Informational complete, mesh continues running |
| false | false | True daemon mode, mesh never stops on complete |

**MCP tools only**: `toolRestriction: mcp-only`

**Quality hooks**: Use explicit `lifecycle:` hooks for quality evaluation:
```yaml
lifecycle:
  pre:
    - quality:preflight
  post:
    - quality:checklist
    - quality:rubric
```

**FSM state tracking**: `fsm:` block for system-managed state variables and logic. Only use when routing depends on computed state, counters, or file presence — not agent judgment. If an orchestrator handles all routing anyway, FSM is redundant. See FSM decision guide below.

**Parallel execution**: `parallelism:` block for fork/join semantics (see Parallel Execution section below), or `ensemble: { type: parallel }` for FSM states

**CRITICAL - FSM Entry Routing**: Entry agents in FSM ensemble meshes MUST fan out to ALL ensemble workers. FSM observes these messages to track state, but explicit routing triggers the workers.
```yaml
routing:
  entry:
    complete:
      worker-1: "Spawn worker 1"  # ✅ CORRECT - Fan out to all workers
      worker-2: "Spawn worker 2"
      worker-3: "Spawn worker 3"
      # core: "..."                # ❌ WRONG - Workers never spawn!
```

**Original task injection**: `injectOriginalMessage: true` - Injects original task into downstream agents

**Design documentation**: `playbook_notes:` - Embed architectural rationale in config (replaces separate READMEs)

**Self-assessment metadata**: `rearmatter:` - Agent outputs self-assessment fields (grade, confidence, status) for FSM routing decisions

**Lifecycle hooks**: Auto-commit, brain insights, quality gates

```yaml
lifecycle:
  post:
    - commit:auto    # Auto-commit changes
    - brain-update   # Document insights
```

Available hooks: `worktree:create`, `commit:auto`, `brain-update`, `quality:*`. See `docs/mesh-config.md`.

## File Preload

Dump files into agent context before execution. Useful for preloading context without manual reads.

```yaml
agents:
  - name: preloader
    model: haiku        # Model defaults to haiku when load is set
    prompt: prompt.md
    load:
      - "package.json"  # Exact file
      - "*.md"          # Glob pattern
      - "src/**/*.ts"   # Recursive glob
```

**Behavior:**
- Files matched by glob patterns are read and injected into system prompt
- Files over 200KB are skipped with warning
- `node_modules/` and `.git/` are auto-excluded
- Model defaults to `haiku` when `load` is set (cheap preloaders)

**Use cases:**
- Virtual "setup" agents that preload project context
- Checkpoint entry points that establish shared context
- Cheap haiku agents that read files before expensive opus agents work

## Session Forking

Share conversation context between agents via checkpoints.

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

**Behavior:**
- `checkpoint: true` saves the agent's sessionId on completion
- `fork_from: agent-name` loads that checkpoint as the starting session
- Forked agents continue from the checkpoint's conversation history
- Works across models (haiku checkpoint → opus fork)

**Use cases:**
- Skip redundant prework (preload once, fork many)
- Share established context across parallel workers
- Model escalation with preserved context

## Parallel Execution

Fork from entry, run agents concurrently, join at exit.

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

**Flow:**
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

**Auto-wiring:**
- Entry agent gets `checkpoint: true` automatically
- Parallel agents get `fork_from: entry` automatically
- Exit agent is gated until ALL parallel agents complete

**Routing:** Parallel agents must route to exit agent:
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

**vs FSM Ensemble:**
| Feature | `parallelism:` | FSM `ensemble:` |
|---------|---------------|-----------------|
| Fork context | Yes (checkpoint) | No |
| Result aggregation | No (just sync) | Yes (concat/vote/etc) |
| Gating | Exit gated | FSM state transition |
| Use case | Parallel work, shared context | Same task, multiple perspectives |

## FSM (State Tracking)

Add `fsm:` block to track state and provide context to agents.

**IMPORTANT**: If you use FSM, you must also define `routing:` configuration. Routes can exist without FSM, but FSM cannot exist without routes.

### When to Use FSM — Decision Guide

**Default assumption: do NOT use FSM.** Pure message routing handles the majority of meshes cleanly. Only add FSM when the routing itself cannot be handled by agent judgment.

**Use FSM when ALL of these are true:**
- Routing decisions depend on **computed state, counters, or file presence** — not agent judgment
- State must survive between **completely separate TX sessions** (cold restart)
- You need **arithmetic operations** to drive routing (e.g., `turn: turn + 1`, loop N times then exit)
- Or you need **deterministic gate conditions** independent of agent output (e.g., "only proceed if file X exists")

**Real examples that warrant FSM:**
- Narrative engine tracking turn number across days-long campaigns
- Loop mesh that runs exactly N iterations before exiting (counter drives routing)
- Ensemble with a gate that only fires when ALL N output files are present on disk
- Multi-session workflow that must resume in the exact right state after a cold restart

**Do NOT use FSM when:**
- An orchestrator agent already handles all routing decisions — if every state routes back to orchestrator anyway, the orchestrator IS the state machine. Drop the FSM.
- The workflow is linear or near-linear: `A → B → C → D`
- Loops can be tracked by the agent itself (validator counting its own attempts in the message body)
- Fan-out/fan-in is the need — use dispatcher routing with fan-out array syntax instead
- HITL is the need — use `ask-human` messages directly, no FSM state required
- "What phase are we in?" can be answered by reading the last message — that's not a state machine problem

**The key test:** *If you'd trust an orchestrator agent to route correctly based on incoming messages, you don't need FSM. FSM is for when routing must be mechanical and cannot rely on agent judgment.*

**Red flags that you're over-engineering with FSM:**
- Every FSM state has only one non-error exit that always fires (just use routing)
- All states route back to an orchestrator agent anyway (orchestrator is doing the state management, FSM is redundant)
- The FSM context tracks values the orchestrator could just pass in message bodies
- You added FSM because the workflow "felt complex" — complexity alone is not a reason

**Sequential workflow:**
```yaml
fsm:
  initial: init

  context:
    turn: 0
    workspace: null

  states:
    init:
      agents: [coordinator]
      entry:
        set:
          turn: "$((turn + 1))"
          workspace: "/path/to/turn-$turn"
      exit:
        default: awaiting_work

    awaiting_work:
      agents: [worker]
      exit:
        when:
          - condition: signal == "PASS"
            target: complete
        default: awaiting_work

  scripts: {}
```

**Parallel workflow (ensemble):**
```yaml
routing:
  # Ensemble agents need explicit routing
  rev-1:
    complete:
      synthesizer: "Review 1 complete"
  rev-2:
    complete:
      synthesizer: "Review 2 complete"
  rev-3:
    complete:
      synthesizer: "Review 3 complete"

fsm:
  initial: parallel_review

  states:
    parallel_review:
      ensemble:
        type: parallel          # Required: type inside ensemble block
        agents: [rev-1, rev-2, rev-3]
        aggregation: concat
      exit:
        set:
          results: "$ENSEMBLE_OUTPUT"
        default: synthesize

  scripts: {}
```

**Agents receive injected context:**
```markdown
## FSM Context
state: awaiting_work
turn: 5
workspace: /path/to/turn-5
```

See `docs/mesh-fsm-config.md` for:
- Exit-based routing (when/run/default)
- Ensemble states (parallel execution)
- Self-loops and iteration tracking
- Gates and validation

## Documentation

**`playbook_notes` in config.yaml** (for maintainers)
- Design rationale and architectural decisions
- WHY the mesh is built this way
- Alignment with methodologies/patterns
- Not injected into prompts

**Example:**
```yaml
playbook_notes: |
  This mesh implements the Ralph pattern from ClaytonFarr/ralph-playbook.
  Uses layered quality refinement: haiku drafts, sonnet reviews, opus finalizes.
```

## Task Distribution Pattern

Alternative to ensemble for splitting work across agents:

```yaml
task_distribution:
  spawner: coordinator      # Agent that splits the task
  subagents: [worker-1, worker-2, worker-3]
  reviewer: synthesizer     # Agent that combines results
  distribution_strategy: equal  # equal | weighted | adaptive | custom
  subtask_count: 5          # Optional fixed count
  timeout_ms: 300000        # 5 minute timeout
  allow_partial_failure: true
```

**When to use task_distribution vs ensemble:**
| Pattern | Task Distribution | Ensemble |
|---------|------------------|----------|
| Task | Split into parts | Same task |
| Agents | Different subtasks | Same analysis |
| Output | Combined portions | Aggregated views |

## Aggregation Strategies

For ensemble `aggregation` field:

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `concat` | Join all outputs | Comprehensive review |
| `deduplicate` | Remove duplicate findings | Code analysis |
| `voting` | Majority opinion wins | Consensus decisions |
| `consensus` | Require agreement | High-stakes choices |
| `custom` | Use custom prompt | Domain-specific |

## Deprecated Patterns

**AVOID these patterns:**

| Pattern | Replacement | Reason |
|---------|-------------|--------|
| `state.type: ensemble` | `state.ensemble: { type: parallel }` | Old FSM syntax |
| `state.subtask: true` | Explicit ensemble routing | Implicit behavior |
| `workspace: "string"` | `workspace: { path: "..." }` | Object format preferred |

## Agent Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Agent identifier |
| `model` | string | yes* | `opus` / `sonnet` / `haiku` (*defaults to `haiku` if `load` set, else `sonnet`) |
| `prompt` | string | one of prompt/command | Path to prompt file |
| `command` | string | one of prompt/command | Slash command (e.g., `/know:build`). Supports `{key}` interpolation from payload. |
| `workspace` | object | no | Per-agent workspace config |
| `mcpServers` | object | no | MCP server configurations |
| `description` | string | no | Agent documentation |
| `load` | array | no | Files to preload into context (globs supported) |
| `checkpoint` | boolean | no | Save session state on completion for forking |
| `fork_from` | string | no | Fork from another agent's checkpoint |
| `thinking` | boolean | no | Extended thinking (default: true). Set `false` to disable. |
| `max_turns` | number | no | API round-trip limit per invocation |
| `max_messages` | number | no | Outbound message limit per invocation |
| `orchestrator` | boolean | no | Restrict to Read + Write(msgs only). For coordinator agents that route, not implement. |

## Additional Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `dev_mode` | boolean | Force all agents to haiku for cheap workflow testing. Remove before production. |
| `brain` | boolean | Enable brain-update insights |
| `capabilities` | array | Agent capability tags |
| `config` | object | Custom mesh-specific settings |
| `idle_timeout_minutes` | number/false | Idle timeout (false=disabled) |
| `clear-before` | boolean | Clear state before run |
| `turn_workspace` | object | Turn-based game workspace |
| `parallelism` | array | Parallel execution blocks (see Parallel Execution) |
| `persistence` | boolean/array | Session persistence across mesh runs |
| `routing_fallback` | string | **DEPRECATED** — use `guardrails.routing_error.routing_fallback` |
| `routing_retry_max` | number | **DEPRECATED** — use `guardrails.routing_error.routing_retry_max` |
| `manifest_enforcement` | object | Artifact validation settings |
| `max_mesh_messages` | number/object | Mesh-wide message cap (guardrail) |
| `autoInjectManifestFiles` | boolean | Auto-preload manifest reads (default: true) |

## Route Validation

Verify all `ask` relationships have matching `ask-response` routes back.

**Rule**: If agent A asks agent B, then B must have an `ask-response` route back to A.

**Manual check:**
1. List all `ask` relationships: `A → asks → B`
2. List all `ask-response` routes: `B → responds-to → [X, Y, Z]`
3. For each ask, verify the target can respond to the sender

**Common mistakes:**
- Coordinator asks worker, but worker only responds to a different coordinator
- Agent added to `ask` list but `ask-response` not updated
- Indirect flows (A → B → C → A) mistaken for direct flows

**Example mismatch:**
```yaml
# validator asks fixer
validator:
  ask:
    fixer: "Fix issues"

# fixer responds to reviewer, NOT validator - BUG!
fixer:
  ask-response:
    reviewer: "Fixes complete"  # ⚠ validator missing!
```

**Intentional indirection** (not a bug):
```yaml
# narrator → lint-coordinator → editor → narrator
# lint-coordinator responds to editor, not narrator (by design)
```

Document intentional indirections in `playbook_notes`.

## Prompt-to-Config Validation

Verify all agent references in prompts match agents defined in config.yaml.

**Rule**: Every `to: mesh/agent` in prompt examples must reference an agent that exists in the mesh's config.yaml.

**Manual check:**
```bash
# Extract agents from config
yq '.agents[].name' meshes/{mesh}/config.yaml | sort > /tmp/agents.txt

# Extract to: targets from prompts
rg "to: {mesh}/[a-z-]+" meshes/{mesh} --type md -o --no-filename \
  | sed 's/to: {mesh}\///' | sort | uniq > /tmp/targets.txt

# Find mismatches
comm -23 /tmp/targets.txt /tmp/agents.txt
```

**Common mistakes:**
- Generic `coordinator` when mesh has phase coordinators (`init-coord`, `render-coord`, etc.)
- Outdated agent names after refactoring
- Copy-paste from other meshes with different agent names

**Architectural principle:**

Prompts should reference **responsibilities**, not agent names. Routing decisions (who handles what) belong in config.yaml, not prompts.

| Pattern | Guidance |
|---------|----------|
| `to: mesh/specific-agent` in examples | Acceptable for illustrating message format |
| `to: {from: field}` dynamic routing | Preferred for ask-response patterns |
| Prose describing "send to agent X" | Move WHO to config, keep WHAT in prompt |

**Anti-pattern:**
```markdown
# BAD: Hardcoded routing in prompt
When done, send ask-response to COORDINATOR.
```

**Better:**
```markdown
# GOOD: Reference responsibility, config handles routing
When done, send ask-response to the coordinator that sent the ask.
# Config routing section defines which coordinator that is.
```

## Guardrails

Unified runtime enforcement with **strict/warning mode** on every guardrail. Config: `.ai/tx/data/config.yaml` under `guardrails:`.

**Mode** (applies to all guardrails):
| strict | warning | Result |
|--------|---------|--------|
| false  | true    | **Default** — Allow + inject feedback |
| true   | true    | Block/kill + reason |
| true   | false   | Block/kill silently |
| false  | false   | Disabled |

- **Write gate**: Intercepts Write/Edit/NotebookEdit and Bash redirects to undeclared paths.
- **Read gate**: Intercepts Read/Glob/Grep to undeclared paths.
- **Routing error**: Corrective injection on bad targets (max retries: 3) + per-edge message caps (`routing_retry_max` / `routing_fallback`).
- **Artifact validation**: Pre/post validation of agent outputs. Default: enabled, 2 retries.
- **Max messages/turns**: Global or per-agent caps. Accept bare number or `{strict, warning, limit}` object.
- **Max mesh messages**: Mesh-wide cap on total messages across all agents in a mesh run.
- **Max turns (warning mode)**: SDK limit bypassed, turns tracked manually, event emitted at threshold.
- **Parity**: Always-on, non-configurable.

```yaml
guardrails:
  write_gate:
    strict: false
    warning: true
    kill_threshold: null
  read_gate:
    strict: false
    warning: true
    kill_threshold: null
  routing_error:
    strict: false
    warning: true
    max_retries: 3
  artifact:
    strict: false
    warning: true
    post_validation: true
    pre_validation: true
    max_retry: 2
  max_messages:
    strict: false
    warning: true
    limit: null
  max_turns:
    strict: false
    warning: true
    limit: null
  max_mesh_messages:
    strict: false
    warning: true
    limit: null
  meshes:
    my-mesh:
      write_gate:
        strict: true
        kill_threshold: 5
      agents:
        my-agent:
          write_gate:
            strict: false
            warning: true
            kill_threshold: 10
```

Override chain: agent > mesh > global > hardcoded default. `strict` and `warning` resolve independently.

Gates activate automatically when manifest entries exist — no additional mesh config needed.

Full reference: `docs/guardrails.md`

## Debugging

```bash
tx status    # Workers, queue
tx msg       # Message viewer
tx spy       # Real-time activity
tx logs      # System logs
```
