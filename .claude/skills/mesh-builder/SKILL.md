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

Focus on **workflow only**. The system auto-injects:
- Message protocol (paths, frontmatter schema, types)
- Workspace paths
- Routing instructions

```markdown
# {Agent Name}

You are the {role} agent.

## Workflow
1. Read incoming task
2. {Work steps}
3. Write task-complete when finished
```

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

**Session persistence**: `continuation: true` or `continuation: [agent1, agent2]`

**MCP tools only**: `toolRestriction: mcp-only`

**Quality evaluation**: `graded: true` or `graded: [checklist, rubric]`

**FSM state tracking**: `fsm:` block for system-managed state

**Original task injection**: `injectOriginalMessage: true` - Injects original task into downstream agents

**Ralph Loops (iterative refinement)**: `ralph_loops:` block for agent iteration with resource limits and success patterns

## FSM (State Tracking)

Add `fsm:` block to track state and provide context to agents.

```yaml
fsm:
  initial: init

  context:
    turn: 0
    workspace: null

  states:
    init:
      agents: [coordinator]
      entry: [turn, workspace]
      transitions:
        worker: awaiting_work

    awaiting_work:
      agents: [worker]
      transitions:
        coordinator: complete

  scripts:
    turn: "echo $((turn + 1))"
    workspace: "echo \"/path/to/turn-$turn\""
```

**Agents receive injected context:**
```markdown
## FSM Context
state: awaiting_work
turn: 5
workspace: /path/to/turn-5
```

See `docs/mesh-fsm-config.md` for full documentation.

## Debugging

```bash
tx status    # Workers, queue
tx msg       # Message viewer
tx spy       # Real-time activity
tx logs      # System logs
```
