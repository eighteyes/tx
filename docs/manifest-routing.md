# Manifest Routing (File Pipeline)

Filesystem-driven orchestration where manifest `reads`/`writes` declarations determine execution order. No routing table, no FSM, no inter-agent messages. Agents produce files that unlock downstream agents.

## Example Config

```yaml
routing_mode: manifest
completion_agents: [editor]

agents:
  - name: architect
    model: sonnet
    prompt: architect/prompt.md
  - name: narrator
    model: sonnet
    prompt: narrator/prompt.md
  - name: editor
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
    reads: [editor]
    writes: [narrator]

  - id: final.md
    description: Polished output
    reads: []
    writes: [editor]
```

## How It Works

1. Mesh starts → resolver finds agents with no reads (architect) → spawns
2. Architect completes → `decomposition.yaml` written → narrator eligible → spawns
3. Narrator completes → `draft.md` written → editor eligible → spawns
4. Editor completes → `completion_agents` → mesh done

## Eligibility Rules

An agent is eligible when:
- All files it `reads` exist on disk
- At least one file it `writes` hasn't been produced yet
- It hasn't already completed

Parallel-eligible agents spawn concurrently. If two agents both read from architect but don't depend on each other, they run in parallel automatically.

## Deadlock Detection

When no agents are eligible but some remain incomplete, the system sends a diagnostic to core naming stuck agents and missing files:

```
Manifest deadlock: 2 agents stuck
  narrator: missing reads [decomposition.yaml]
  editor: missing reads [draft.md]
```

## When to Use

- Workflow is a file pipeline (A produces → B consumes → C refines)
- Execution order is fully determined by file dependencies
- No inter-agent conversation needed (agents talk through files, not messages)
- Parallel stages emerge naturally from independent reads

## When NOT to Use

- Agents need to discuss, ask questions, or iterate (use agent mode)
- Routing depends on agent judgment or outcomes (use dispatcher or agent mode)
- Workflow has loops (manifest mode is pipeline-only — once done, can't re-run)

## Limitations

- No iteration loops — once an agent completes, it cannot re-run
- No crash recovery — in-memory state, mesh restart re-runs from scratch
- HITL works via messages to core/core (same as other modes)

## Config Validation

- **Error**: `routing_mode: manifest` without a `manifest` section
- **Error**: Agent with zero manifest entries (no reads AND no writes)
- **Warning**: `routing_mode: manifest` with `routing` or `fsm` sections (ignored at runtime)

## Comparison

| Feature | Agent mode | Dispatcher mode | Manifest mode |
|---------|-----------|----------------|---------------|
| Routing | Agent writes messages | Sentinel-based config | Filesystem state |
| Orchestration | Agent judgment | Config table | File dependencies |
| Parallelism | Manual | Fan-out arrays | Automatic (from reads/writes) |
| Loops | Yes | Yes | No |
| Inter-agent chat | Yes | Yes (discuss) | No (files only) |
| Use case | Flexible workflows | Fan-out/fan-in | File pipelines |

## Directory Entries

Manifest entries with `id` ending in `/` are treated as directories:
- **Reads**: existence check via `fs.existsSync` (same as files)
- **Writes**: skipped in writes-incomplete checks (containers, not deliverables)

## Design Spec

Full design: `docs/superpowers/specs/2026-03-13-manifest-routing-design.md`
