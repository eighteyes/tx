Do NOT run `tx start`, `tx trace` or `tx run` or you will be terminated.
TRUST the meshes to run and respond to you. Only investigate if prompted.

## Architecture
- `.ai/tx/` - system state
- `src/cli/` - CLI commands (start, status, msg, spy, factory)
- `src/core/` - Consumer (file watcher), tmux utilities
- `src/queue/` - SQLite message queue
- `src/worker/` - SDK-based ephemeral workers
- `src/mesh/capability/` - Capability schema, router, factory, fragments
- `meshes/` - Agent configs and prompts
- `src/mesh/fragments/` - Prompt fragment library (42 YAML files)


# Overview
- USER interfaces with CLI via core agent.
- Core sends messages which start meshes ( agent workflows ).
- Meshes write back to core / user when finished or with questions.
- System is event driven from file writes into the Consumer.

## Key Learnings

### Prompts Are Programming
Mesh prompts are reinforced and enabled by system behavior. As we change the system, be sure to update the prompts.

### Write Messages, NEVER Update

Update tool does not trigger the file watcher and will not send messages to meshes when used.

### Logging

**CRITICAL**: Capture all errors and logs with the logging class (`log` from `src/shared/logger.ts`). Never use `console.error` or `console.log` for error handling or system logging.

- Use `log.error()` for errors
- Use `log.warn()` for warnings
- Use `log.info()` for informational messages
- Use `log.debug()` for debug output

Logs are written to `.ai/tx/logs/v4.jsonl` with the last run at `v4.last.jsonj` 

### Mesh-Builder Skill Updates

**CRITICAL**: Whenever you add or modify mesh configuration fields or patterns:

1. **Update `.claude/skills/mesh-builder/SKILL.md`** to reflect the changes
2. Add new fields to the Config Field Reference table
3. Document new patterns with examples
4. Update Best Practices if security/architectural implications exist

## Message Flow

1. Agent writes `.md` file to `.ai/tx/msgs/`
2. Consumer (chokidar) detects file → inserts to queue → emits event
3. `core-message` → Injector injects to Claude (backoff retry if busy)
4. `worker-message` → Dispatcher spawns worker immediately
5. Workers write response messages back to msgs dir
6. `inject-response: true` on outgoing task → active injection into tmux on mesh completion (retry loop, fallback to pending)

### Routing-Based Messaging

TX uses **routing context** instead of explicit type fields:

- **To core/core**: Messages for human → session suspends awaiting response
- **From core/core + pending ask**: Human responses → resumes suspended session
- **From core/core + no pending ask**: New work → dispatcher spawns worker
- **Completion**: `status: complete` or `outcome: complete` in frontmatter → completion flow
- **Everything else**: Regular inter-agent message → dispatcher spawns/queues work

## Event-Driven Architecture

**Consumer Events** (`MessageConsumer`):
| Event | Payload | Trigger |
|-------|---------|---------|
| `core-message` | `{id, filepath, from, completion}` | Message for `core/core` |
| `worker-message` | `{agentId, from, completion}` | Message for worker agent |
| `worker-resume` | `{id, filepath, from, to, content}` | Human response to pending ask |

**Dispatcher Events** (`WorkerDispatcher`):
| Event | Payload | Trigger |
|-------|---------|---------|
| `worker:spawn` | `{agentId, model}` | Worker starting |
| `worker:complete` | `{id, messagesProcessed, output}` | Worker finished |
| `worker:error` | `{id, error}` | Worker error |
| `mesh:loaded` | `{mesh, agents}` | Mesh config loaded |

## God Mode (Autonomous Operation)

`tx start --god-mode` enables fully autonomous operation:

**Core**: Runs with `--dangerously-skip-permissions` — no permission prompts.

**Workers**: `bypassPermissions` mode + SDK sandbox:
- `sandbox.enabled: true` — workers sandboxed
- `autoAllowBashIfSandboxed: true` — bash auto-approved within sandbox
- `filesystem.allowWrite: [workDir]` — writes fenced to project directory
- Bash-guard is skipped (sandbox replaces it as primary boundary)

**Injection**: `injectPrompt()` sends a second Enter after 1s unconditionally, preventing stalled completion→dispatch loops.

**Use case**: Hand core a task list, walk away. Core dispatches meshes sequentially, workers execute without prompts, injection retries keep the loop alive.

**Key files:**
- `src/worker/sdk-runner.ts` — sandbox config built when `godMode` active
- `src/worker/permissions.ts` — `resolvePermissions()` returns `bypassPermissions` in god mode
- `src/core/tmux.ts` — `injectPrompt()` retry Enter logic
- `src/cli/start.ts:1300` — `--dangerously-skip-permissions` flag passthrough

## Guardrails

Unified runtime enforcement with **strict/warning mode** on every guardrail. Config: `.ai/tx/data/config.yaml` under `guardrails:`.

**Mode** (applies to all guardrails, default: `strict: false, warning: true`):
| strict | warning | Result |
|--------|---------|--------|
| false  | true    | **Default** — Allow + inject feedback |
| true   | true    | Block/kill + reason |
| true   | false   | Block/kill silently |
| false  | false   | Disabled |

Override chain: agent > mesh > global > hardcoded default. `strict` and `warning` resolve independently.

`max_messages`/`max_turns` accept bare number (backward compatible) or `{strict, warning, limit}` object.

Full reference: `docs/guardrails.md`

## Mesh Factory

Generate meshes from capability requirements or plan directories.

```bash
tx factory capabilities.yaml                        # generate mesh from capability YAML
tx factory .ai/plan/my-plan/                         # from plan directory (haiku derives caps)
tx factory caps.yaml --run "build the auth module"   # generate + dispatch immediately
tx factory caps.yaml --output meshes/foo             # custom output path
tx factory --reflect                                 # re-derive factory heuristics from the eval archive
tx factory --eval <generated-mesh-dir>               # manually score a completed run
```

**`--run <prompt>`**: generates mesh AND writes initial message to `.ai/tx/msgs/` to start it. Consumer picks up, dispatcher loads on demand, workers spawn.

**Hash-based reuse**: output defaults to `.ai/tx/generated-meshes/{capability-hash}/`. Same capabilities → same hash → skips compilation on second run — unless run evaluations flagged the mesh for recompile (see Self-Evaluation).

### Self-Evaluation (Hyperagents-style, 3 loops)

1. **Compile-time coverage** — `checkCoverage()` verifies every requested capability value is fragment-backed (domain/tools/interaction) or recorded in the generated config (input/output). Report written to `coverage.yaml` in the mesh dir and archive. Sub-1.0 coverage is logged/printed as a warning, not a hard block.
2. **Run-time evaluation** — when a factory-generated mesh completes, the dispatcher fires a one-shot haiku evaluator (`evaluateMeshRun`) scoring `capabilityFit` / `outputQuality` / `efficiency`. Each run lands in `.ai/tx/archived-meshes/{hash}-{name}/runs/{runId}.yaml`; `score.yaml` holds the rolling aggregate. Best-effort — failures are swallowed. `tx factory --eval <dir>` triggers the same manually.
3. **Metacognitive reflection** — `tx factory --reflect` reads all archive scores + coverage reports, asks haiku for cross-mesh heuristics, writes `.ai/tx/archived-meshes/_meta/insights.yaml`. On the next compile the factory embeds those heuristics into each generated agent prompt (`## Factory Guidance`). Manual trigger — run it after several generated meshes have executed.

**Router feedback:** a generated mesh whose rolling `avgOverall` falls below ~0.45 over ≥2 runs (`recommendRecompile`) is recompiled instead of reused on the next request, so it picks up the latest fragments + insights.

**Archive layout** (`.ai/tx/archived-meshes/{hash}-{name}/`): `config.yaml`, `agents/`, `source-capabilities.yaml`, `.factory-meta.json` (locator), `coverage.yaml`, `runs/{runId}.yaml`, `score.yaml`. Recompiles refresh the artefacts but preserve `runs/` + `score.yaml`. Project-wide reflection: `.ai/tx/archived-meshes/_meta/insights.yaml`.

**Search paths**: both `MeshConfigLoader` and consumer search `.ai/tx/generated-meshes/` alongside `meshes/`. Generated meshes load on demand when messaged.

**Capability schema** — bidirectional contract (meshes declare, plans request):
```yaml
capability:
  domain: [dev, research, ...]       # problem space
  input: [codebase, spec, ...]       # what the mesh accepts
  output: [code-changes, report, ...]# what the mesh produces
  tools: [git, web-search, ...]      # special tools needed
  interaction: [none, gate-exit, ...]# human involvement
  topology: static                   # wiring pattern (plan-side only)
```

**Pipeline:** router checks catalog → match found → use existing mesh. No match → factory compiles fragments + topology → config.yaml + agent prompts → validates → outputs mesh directory.

**Plan-input mode:** reads plan.md + tasks.md, calls haiku to extract capabilities, caches as `capabilities_needed.yaml` in plan dir. Second run skips LLM.

**Key files:**
- `src/mesh/capability/schema.ts` — enums, types, validation, `hashCapability()`
- `src/mesh/capability/router.ts` — mechanical set-coverage scoring
- `src/mesh/capability/factory.ts` — fragment assembler + config generator (embeds reflection insights, runs coverage check)
- `src/mesh/capability/evaluator.ts` — self-evaluation: coverage check, run-eval (haiku), archive scoring, `reflectOnArchive()`
- `src/mesh/capability/plan-deriver.ts` — plan→capabilities extraction
- `src/mesh/fragments/` — 42 YAML prompt fragments (domain, input, output, tools, interaction, topology)
- `src/cli/factory.ts` — CLI entry point, `--run` / `--reflect` / `--eval` flags, `resolveEntryPoint()`
- `src/worker/dispatcher.ts` — `maybeEvaluateGeneratedMeshRun()` fires run-eval on mesh completion
- `src/prompt/core.ts` — core agent prompt builder (includes factory section)

<!-- know:start -->
<know-instructions>
When discussing architecture, product decisions, features, or system design,
use the `know` CLI to capture decisions in the spec-graph.

Run `know -h` for commands. Run `know <command> -h` for usage details.

Spec graph entities: project, user, objective, feature, workflow, action, component, operation
Code graph entities: module, package, layer, namespace, interface, class, function

Common reference types: data-model, endpoint, api-contract, business-logic,
  acceptance-criterion, validation-rule, source-file, external-dep, code-link

Run `know check ref-types` for reference types with descriptions.
Run `know gen rules describe entities` for entity types.
Run `know gen rules graph` for the dependency topology.

Persist architectural decisions as graph entities, not prose.
The spec-graph is the source of truth for product intent.
</know-instructions>
<!-- know:end -->

