# Manifest Routing Mode

**Date**: 2026-03-13
**Status**: Design approved

## Summary

Add `routing_mode: 'manifest'` as a third routing mode for TX meshes. Instead of agents sending messages to each other (agent mode) or a centralized routing table (dispatcher mode), the filesystem determines execution order. The manifest's `reads`/`writes` declarations — already present for validation — become the orchestration mechanism. No FSM, no routing table, no inter-agent messages.

## Core Concept

The manifest already declares what each agent reads and writes. A resolver checks the filesystem after each agent completes and spawns whichever agents are newly eligible:

```
Agent completes → post-validate writes → mark done → resolve → spawn eligible agents
```

An agent is **eligible** when:
- All manifest files it `reads` exist on disk
- At least one manifest file it `writes` is not yet in the `writtenFiles` set
- It has not already completed

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| First agent | `entry_point` if set, otherwise resolver picks (agent with no reads) | Belt and suspenders — explicit override available |
| Multiple eligible | Parallel spawn (OAOM per-agent) | Eligibility implies execution |
| Completion detection | Worker finishes → post-validate writes → mark done | Reuses existing manifest_enforcement |
| Mesh done | All agents done, or `completion_agents` finishes | Uses existing `completion_agents` field |
| HITL | Agents write messages to core/core | Manifest mode only replaces agent-to-agent routing |
| Deadlock | No eligible agents + incomplete agents = error to core | Prevents silent stall, includes diagnostic |
| Agent with no manifest entries | Validator error | Config mistake, catch at load time |
| FSM/routing in manifest mode | Validator warning (ignored at runtime) | Contradictory config, warn don't fail |
| Iteration loops | Not supported | Manifest mode is for pipelines, not cycles |
| Directory manifest entries | Existence = satisfied | Containers, not deliverables — skip in writes-incomplete checks |
| Crash recovery | Not persisted (mesh restart re-runs from scratch) | Follow-up work, same as FSM reset today |

## Manifest Resolver

New class: `src/worker/manifest-resolver.ts`

```typescript
class ManifestResolver {
  resolve(
    manifest: ManifestEntry[],
    agents: AgentConfig[],
    completedAgents: Set<string>,
    writtenFiles: Set<string>,
    pathContext: ManifestPathContext
  ): string[]  // agent names eligible to run
}
```

### Resolution Algorithm

1. For each agent not in `completedAgents`:
   - Collect manifest entries where agent appears in `reads` — check all files exist on disk
   - Collect manifest entries where agent appears in `writes` — check if any resolved paths are not in `writtenFiles`
   - Directory entries (`id` ends with `/`): existence = satisfied, skip in writes-incomplete checks
   - If reads satisfied AND writes incomplete → **eligible**
2. Return all eligible agents

### State Tracking

Two sets per mesh instance, stored on the dispatcher. Cleared on mesh reset.

- `completedAgents: Set<string>` — agents that have finished and passed post-validation
- `writtenFiles: Set<string>` — resolved paths confirmed written by post-validation

Not persisted to disk. Mesh restart re-runs from scratch (same as FSM reset). Persistence is follow-up work.

### Edge Cases

- **Agent with no reads**: Eligible immediately (entry point of the pipeline)
- **Agent with no manifest entries**: Rejected at config validation time (error)
- **All agents completed, no eligible**: Mesh success (if all done) or deadlock (if some incomplete)
- **Circular dependencies**: Two agents that read each other's writes — deadlock detected, error surfaced to core
- **Directory entries**: `fs.existsSync` on the resolved path. Existence = satisfied.

### Deadlock Diagnostics

When deadlock is detected (no eligible agents, incomplete agents remain), the error message to core includes:

```
Manifest deadlock: 2 agents stuck
  narrator: missing reads [decomposition.yaml]
  editor: missing reads [draft.md]
```

## Completion Loop

1. **Mesh starts** → if `entry_point` set, spawn it; otherwise resolver runs → spawns eligible agents
2. **Agent completes** → post-validate writes (existing `manifest_enforcement`) → retry if missing → add to `completedAgents`, add validated paths to `writtenFiles`
3. **Re-resolve** → newly eligible agents spawn (parallel if multiple, OAOM per-agent)
4. **Mesh done** when:
   - `completion_agents` finishes → immediate success → `task-complete` to core
   - No agents eligible AND all completed → success → `task-complete` to core
   - No agents eligible AND some NOT completed → deadlock → diagnostic error to core

## Dispatcher Integration

### Spawn Mechanism

When the resolver returns eligible agents, the dispatcher calls `spawnWorker` directly with a resolver-constructed task context:

```typescript
{
  from: 'manifest-resolver',
  type: 'task',
  body: `Your reads are satisfied. Write: [${writesNeeded.join(', ')}]`,
  // agent's system prompt already has manifest context via injection
}
```

No queue message needed. The task context tells the agent what files it's expected to produce. The agent's full prompt (with manifest injection) provides the rest.

### Branching Points

**Mesh start** (initial trigger from `tx run` or entry message from core):
- If `routing_mode === 'manifest'`: call `resolver.resolve()`, spawn returned agents
- Otherwise: existing queue-based flow

**Worker complete** (`worker.on('complete', ...)`):
- If manifest mode: post-validate, update `completedAgents`/`writtenFiles`, re-resolve, spawn next
- Otherwise: existing routing/FSM flow

### What Stays the Same

- Worker lifecycle (hooks, guardrails, metrics, OAOM per-agent)
- Pre-validation (manifest reads check)
- Post-validation (manifest writes check + retry)
- HITL (messages to core/core for human boundary)
- CLI commands (status, kill, clear)
- Session management, suspension, resumption

### What's Not Used in Manifest Mode

- FSM (filesystem is the state)
- Routing table (manifest derives routing)
- Message queue for agent-to-agent routing
- `DispatchRouter` / agent routing config

## Config Validation

### Errors (block mesh load)

- `routing_mode: manifest` without a `manifest` section
- Agent in manifest mode with zero manifest entries (no reads AND no writes)

### Warnings (log, don't block)

- `routing_mode: manifest` with `routing` section present (ignored at runtime)
- `routing_mode: manifest` with `fsm` section present (ignored at runtime)

## Config Example

```yaml
name: my-pipeline
routing_mode: manifest
completion_agents: [editor]

agents:
  architect:
    model: sonnet
    prompt: architect/prompt.md
  narrator:
    model: sonnet
    prompt: narrator/prompt.md
  editor:
    model: haiku
    prompt: editor/prompt.md

manifest_enforcement:
  pre_validation: true
  post_validation: true
  max_retry: 2

manifest:
  - id: decomposition.yaml
    description: Scene breakdown from architect
    location: workspace
    reads: [narrator]
    writes: [architect]

  - id: draft.md
    description: Scene prose from narrator
    location: workspace
    reads: [editor]
    writes: [narrator]

  - id: final.md
    description: Polished output
    location: workspace
    reads: []
    writes: [editor]
```

### Resolver Walkthrough

1. Start → architect has no reads → eligible → spawns
2. Architect completes → post-validate → `decomposition.yaml` added to `writtenFiles` → resolve → narrator reads satisfied → spawns
3. Narrator completes → `draft.md` added to `writtenFiles` → resolve → editor reads satisfied → spawns
4. Editor completes → `completion_agents` → mesh done → `task-complete` to core

## Limitations

- **No iteration loops**: Once an agent completes, it cannot re-run. Manifest mode is for pipelines, not cycles. Use `agent` or `dispatcher` mode for iterative workflows.
- **No crash recovery**: `completedAgents` and `writtenFiles` are in-memory only. Mesh restart re-runs from scratch. Persistence is follow-up work.

## Files Changed

### New

| File | Purpose |
|------|---------|
| `src/worker/manifest-resolver.ts` | Resolver class: eligibility check, deadlock detection |

### Modified

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `'manifest'` to `RoutingMode` |
| `src/mesh/config-loader.ts` | Validate manifest mode configs |
| `src/mesh/mesh-validator.ts` | Agent-has-no-manifest-entries check, `'manifest'` in routing_mode enum |
| `src/worker/dispatcher.ts` | Branch on manifest mode at start and completion, track `completedAgents`/`writtenFiles` |

### Unchanged

| File | Reason |
|------|--------|
| `src/worker/manifest-validator.ts` | Reuse existing path resolution and validation |
| Worker lifecycle, hooks, guardrails | No changes needed |
| CLI commands | Work as-is |
