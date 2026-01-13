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

## Documentation Patterns

**Two-layer documentation approach:**

1. **`playbook_notes` in config.yaml** (for maintainers)
   - Design rationale and architectural decisions
   - WHY the mesh is built this way
   - Alignment with methodologies/patterns
   - Not processed by the system

2. **`AGENTS.md` in mesh directory** (for agents at runtime)
   - Operational guidance for autonomous execution
   - HOW to operate (mandates, decision trees, quality gates)
   - Loaded by agents during execution
   - Keep brief and actionable

**Example structure:**
```
meshes/ralph-ice-cream-2/
├── config.yaml          # includes playbook_notes
├── AGENTS.md            # runtime operational guide
├── ralph-haiku/
│   └── prompt.md
└── sonnet-reviewer/
    └── prompt.md
```

**When to use each:**
- `playbook_notes`: Complex meshes with novel patterns or specific methodologies
- `AGENTS.md`: Multi-agent meshes where agents need operational context
- Both: Advanced meshes like Ralph where design rationale AND runtime guidance matter

## Debugging

```bash
tx status    # Workers, queue
tx msg       # Message viewer
tx spy       # Real-time activity
tx logs      # System logs
```
