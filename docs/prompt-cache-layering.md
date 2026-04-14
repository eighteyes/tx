# Prompt Cache Layering

Mechanical strategy for maximising Anthropic prompt cache hits across multi-agent dispatches. The system partitions the assembled system prompt into **shared layers** (cached once per turn) and **agent-specific layers** (vary per dispatch).

## Layer Architecture

```
  SHARED (cached once per turn — reused across all agent dispatches)
  ┌──────────────────────────────────────────────────────────────┐
  │  Layer 1  TX shared preamble (tool guidance, conventions)    │
  │  Layer 2  Project CLAUDE.md (project-level instructions)     │
  │  Layer 3  Prefix files (manifest injection: 'prefix')        │
  ├══════════════════ cache break ═══════════════════════════════ ┤
  │  Layer 4  Agent identity (name, address, TX_ROOT)            │
  │  Layer 5  FSM context (current phase)                        │
  │  Layer 6  Situational awareness (pending asks, queued tasks) │
  │  Layer 7  Task workspace (where to write)                    │
  │  Layer 8  File contract + preloaded files                    │
  │  Layer 9  Agent prompt (template-resolved)                   │
  │  Layer 10 Brain access (optional)                            │
  │  Layer 11 Rearmatter, messaging, routing                     │
  └──────────────────────────────────────────────────────────────┘
  AGENT-SPECIFIC (varies per dispatch)
```

**Cache break** sits after Layer 3. Everything above is identical across all agents in the same turn, so Anthropic's API caches it once and reuses it for every subsequent dispatch. Everything below varies per agent and is not cached across dispatches.

## Why This Order Matters

The Claude API caches system prompts by prefix match. Two prompts sharing the same first N tokens get a cache hit on that prefix. By placing content that changes per-agent *after* content shared by all agents, the cached prefix is as long as possible.

**Example**: A mesh with 8 agents dispatched in the same turn. Preamble + CLAUDE.md + prefix files = ~12K tokens shared. Without layering, each dispatch re-sends 12K tokens uncached. With layering, dispatches 2–8 hit the cache and only pay for agent-specific tokens.

## Shared Layers (Pre-Break)

**Layer 1 — TX Shared Preamble**
Tool guidance, autonomous-operation conventions. Contains no agent name, mesh name, or project references. Identical across all meshes and agents.

**Layer 2 — Project CLAUDE.md**
Project-level instructions from `CLAUDE.md` files. Stable across all agents in the project. Loaded unless `load_claude_md: false` in mesh config.

**Layer 3 — Prefix Files**
Manifest entries with `injection: 'prefix'`. These are turn-level files that every agent in the mesh needs — shared context that doesn't vary by agent.

```yaml
# config.yaml manifest entry
- id: context.yaml
  description: Turn context consumed by all agents
  location: workspace
  injection: prefix
  reads: [narrator, scribe, dramaturg]
  writes: [init-turn]
```

> Prefix files are subject to the same 200KB size guard as regular manifest entries. Large files log a warning and are skipped.

## Agent-Specific Layers (Post-Break)

These layers carry per-agent identity, prompt, preloaded files, and routing instructions. They change with every dispatch, so they sit after the cache break.

**Layer 4 — Agent Identity**: Name, mesh address, TX_ROOT path.

**Layer 5 — FSM Context**: Current state, transitions, phase-specific instructions.

**Layer 6 — Situational Awareness**: Pending asks, queued tasks, operational context.

**Layer 7 — Task Workspace**: Where the agent writes output files.

**Layer 8 — File Contract + Preloaded Files**: Read/write paths plus the actual file content injected via `autoInject`, `context` queries, or `agent.load`.

**Layer 9 — Agent Prompt**: The agent's prompt.md with template tokens replaced.

**Layer 10 — Brain Access** (optional): Injected when `brain: true` in mesh config.

**Layer 11+ — Rearmatter, Messaging, Routing**: Appended after guardrail gates. Includes parallel instance context, routing tables, and self-assessment scaffolding.

## Manifest Context Queries

Context queries control *how much* of a manifest entry reaches each agent. This reduces prompt size (better cache efficiency) and ensures agents only see relevant data.

Three query modes, configured per-agent in the manifest entry's `context` field:

**`'full'`** — Read entire file
```yaml
context:
  calibrator: full
```

**`sections`** — Extract specific YAML keys via `yq pick`
```yaml
context:
  narrator:    { sections: [voice, pov, tense, cadence] }
  editor:      { sections: [diction, cadence, pacing] }
  dramaturg:   { sections: [pacing, chaos_register, endings] }
```

**`script`** — Run a shell command, inject stdout
```yaml
context:
  narrator:    { script: "scripts/character-brief.sh {id} {campaign_path}" }
  sim-planner: { script: "scripts/character-brief.sh {id} {campaign_path}" }
```

**Fallback behaviour** — When a sections/script query fails:
```yaml
context:
  narrator: { sections: [voice, pov], fallback: 'full' }   # Falls back to full file read
  editor:   { sections: [diction],    fallback: 'omit' }   # Silently skips entry
```

**Precedence**: When a `context` query exists for an agent, it replaces `autoInject` entirely for that entry. Agents not listed in `context` receive no content from the entry.

### Token Substitution

Script queries support these tokens:

```
{id}              File basename without extension
{path}            Full resolved file path
{game_path}       Resolved game location
{campaign_path}   Resolved campaign location
{workspace}       Resolved workspace location
```

Plus environment variables: `TX_FILE_PATH`, `TX_FILE_ID`, `TX_WORK_DIR`.

### Resolution Tags

Every injected context block is tagged for traceability:

```
# [pre-loaded: entities/characters/maya.yaml — sections: current_state, traits.evolved]
# [pre-loaded: author.yaml — full]
# [pre-loaded: state.yaml — script]
# [pre-loaded: setting.yaml — full (fallback)]
# [pre-loaded: entities/characters/ — empty directory]
```

### Size Guards

```
Per-agent context limit    200KB   (aggregate across all context queries for one agent)
Per-file skip threshold    200KB   (individual files larger than this are warned and skipped)
Aggregate prompt warning   ~80K tokens (~320KB)
```

## Prefix vs Context vs AutoInject

Three mechanisms for injecting manifest content into agent prompts. Choose based on sharing scope and specificity:

```
                    Shared across      Agent-specific    Where in
                    all agents?        content?          prompt?
injection: prefix   ✓ all agents       ✗ same content    Layer 3 (cached)
autoInject: true    ✗ per-agent        ✗ full file       Layer 8 (not cached)
context: {}         ✗ per-agent        ✓ filtered         Layer 8 (not cached)
```

**Use `injection: prefix`** for turn-level shared state (context.yaml, intent.yaml, campaign state). Maximises cache hits.

**Use `autoInject: true`** (or mesh-level `autoInjectManifestFiles: true`) for files every reading agent needs in full. Default behaviour — files on the agent's `reads` list are injected automatically.

**Use `context` queries** for large files where agents only need specific sections. Reduces prompt tokens and keeps agents focused.

## Deduplication

The dispatcher prevents the same content from appearing twice in a prompt:

1. Prefix entries are excluded from the regular manifest collection loop
2. `preloadedFiles` tracks paths already injected — duplicates are skipped
3. File contract lists paths only (no content), while preloaded section carries actual content

## Narrative Engine Example

The narrative engine (NE2) uses all three mechanisms across ~30 manifest entries:

```yaml
# Prefix — shared turn state, goes into cached layer
- id: context.yaml
  injection: prefix
  reads: [narrator, scribe, dramaturg, ...]

- id: intent.yaml
  injection: prefix
  reads: [narrator, dramaturg, ...]

- id: state.yaml
  injection: prefix          # Campaign state shared by all
  reads: [init-turn, dramaturg, sim-planner, ...]

# Context queries — filtered per agent
- id: author.yaml
  persistent: true
  context:
    narrator:    { sections: [voice, pov, tense, cadence, style, ...] }
    editor:      { sections: [diction, cadence, pacing, balance, ...] }
    dramaturg:   { sections: [pacing, chaos_register, ...] }
    calibrator:  full

# Directory entries with per-agent sections
- id: entities/characters/
  persistent: true
  context:
    gravity:     { sections: [current_state, conditions, traits.evolved] }
    sim-voices:  { sections: [life.voice_markers, life.verbal_habits, layers] }
    narrator:    { script: "scripts/character-brief.sh {id} {campaign_path}" }
    calibrator:  full
```

**Cache economics**: With 12 agents and ~15K shared prefix tokens, Layers 1–3 are cached after the first dispatch. Remaining 11 dispatches reuse the prefix, saving ~165K input tokens per turn. Context queries further reduce per-agent post-break tokens by extracting only what each agent needs from large files.

## Session Resume and Cache

When resuming from a checkpoint (`resumeSessionAt`), the system rebuilds the prompt:

1. **System prompt** stays identical → cache hit on the shared prefix
2. **Preloaded files** re-injected as originally resolved
3. **Message history** truncated to the fork point
4. **New branch** created from checkpoint, parent session untouched

Fork operations preserve cache efficiency because the system prompt prefix remains stable across branches.

## Dynaprompt Fragments and Cache

[Dynaprompt fragments](./manifest-routing.md) are injected as **user messages**, not system prompt content:

1. System prompt assembled and cached once per session
2. Fragment injections arrive as follow-up turns
3. Each fragment branch reuses the cached system prompt
4. Checkpoint → parallel fragment branches → judge pattern costs one system prompt cache, not N

## Variable Resolution Caching

Manifest variable maps (location templates → resolved paths) are cached per-mesh:

```typescript
const varMap = this.cachedManifestVars.get(meshName) ||
              this.resolveManifestVariables(meshName, wsLocations);
```

This prevents re-resolving workspace locations on every agent dispatch within the same mesh run.

## Implementation Reference

```
src/worker/dispatcher.ts         Layer ordering, prefix collection, cache break comment
src/worker/context-resolver.ts   Context query resolution (full, sections, script)
src/worker/mesh-validator.ts     ManifestContextValue type, injection field validation
src/workspace/injector.ts        buildPrefixBlock(), buildFileSection(), prompt assembly
src/prompt/core.ts               Core agent prompt builder
```

## See Also

- [Manifest Routing](./manifest-routing.md) — File-pipeline orchestration using manifest reads/writes
- [Mesh Configuration](./mesh-config.md) — Full field reference including manifest, autoInject, context
- [Ensemble Execution](./ensemble-execution.md) — Parallel agent patterns
- [Reliability](./reliability.md) — Session resume, checkpoints, DLQ recovery
