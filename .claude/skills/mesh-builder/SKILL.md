---
name: mesh-builder
description: Build TX V4 meshes - agent configs, prompts, routing. Use for new meshes, agent roles, or multi-agent workflows. Triggers - mesh, routing, agents, multi-agent, config.yaml
---

# Mesh Builder

Build meshes (agent workflows) for TX V4.

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

## Common Patterns

**Automatic Session persistence**: `continuation: true` or `continuation: [agent1, agent2]`

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

**FSM state tracking**: `fsm:` block for system-managed state variables and logic. Only use if needed, linear workflows generally don't need fsm.

**Parallel execution**: `ensemble: { type: parallel }` for FSM states - See `docs/mesh-fsm-config.md` "Ensemble States" section

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

## FSM (State Tracking)

Add `fsm:` block to track state and provide context to agents.

**IMPORTANT**: If you use FSM, you must also define `routing:` configuration. Routes can exist without FSM, but FSM cannot exist without routes.

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

## Additional Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `brain` | boolean | Enable brain-update insights |
| `capabilities` | array | Agent capability tags |
| `config` | object | Custom mesh-specific settings |
| `idle_timeout_minutes` | number/false | Idle timeout (false=disabled) |
| `clear-before` | boolean | Clear state before run |
| `turn_workspace` | object | Turn-based game workspace |

## Debugging

```bash
tx status    # Workers, queue
tx msg       # Message viewer
tx spy       # Real-time activity
tx logs      # System logs
```
