Do NOT run `tx start`, `tx msg`, `tx run`, or `tx restart` or you will be terminated.
TRUST the meshes to run and respond to you. Only investigate if prompted.

# TX V4 - Multi-Agent Orchestration System

TX is a CLI-based multi-agent orchestration system built on the Anthropic Claude Agent SDK. It coordinates ephemeral LLM workers through "meshes" (agent workflow configurations), using file-based messaging, SQLite queues, and tmux for the core session.

## Architecture Overview

```
User ──► CLI (tx) ──► Core Agent (tmux/Claude)
                          │
                          ▼
                   Message Files (.ai/tx/msgs/)
                          │
                          ▼
                   Consumer (chokidar watcher)
                          │
                    ┌──────┴──────┐
                    ▼             ▼
              core-message   worker-message
              (Injector)     (Dispatcher)
                    │             │
                    ▼             ▼
              tmux inject   SDK Runner (ephemeral)
                                  │
                                  ▼
                           Response messages
                           (.ai/tx/msgs/)
```

## Directory Structure

### Source Code (`src/`)

| Directory | Purpose |
|-----------|---------|
| `src/cli/` | CLI commands: start, stop, restart, status, msg, spy, logs, tasks, run, server, session, mesh, recover, forensics, deploy, login/logout, prompt, tool, inbox |
| `src/core/` | Consumer (file watcher), tmux utilities, persistent core, worktree support, recovery |
| `src/worker/` | SDK-based ephemeral workers: dispatcher, sdk-runner, session management, message routing, guardrails (write/read/identity gates), hooks, ensemble coordination, lifecycle |
| `src/mesh/` | Mesh config loader, FSM (finite state machine) engine, aggregation, distribution |
| `src/queue/` | SQLite message queue, deadlock detection, stale message cleaning |
| `src/hooks/` | Lifecycle hooks system: pre-hooks (worktree-create, discovery, quality-preflight) and post-hooks (validation, quality checks, commit-auto, worktree-cleanup, brain-update, forensics, AI linter) |
| `src/prompt/` | Prompt builder: sections (preamble, agent-prompt, routing, task-context, rearmatter) |
| `src/workspace/` | Workspace manager, injector, messaging protocol |
| `src/providers/` | LLM provider abstraction (Claude SDK) |
| `src/server/` | HTTP/WebSocket server: auth, session management, worker pool, rate limiting, quota management |
| `src/controllers/` | Server route controllers: sessions, stats, workspace, logs, mesh |
| `src/storage/` | Storage providers: local filesystem, Redis |
| `src/forensics/` | Post-execution analysis: transcript parsing, session analysis |
| `src/shared/` | Shared utilities: logger, types, colors, string helpers, Anthropic client, time |
| `src/session/` | Session storage (SQLite), session summarization, full-text search |
| `src/quality/` | Quality gate stack, registry, iteration loops |
| `src/quality-gates/` | Quality gate evaluation |
| `src/state-machine/` | State machine middleware for worker lifecycle |
| `src/tools/` | Search providers (arXiv, Stack Overflow, GitHub, DuckDuckGo, HackerNews, PubMed, etc.) |
| `src/utils/` | Path helpers, general utilities |

### Meshes (`meshes/`)

Agent workflow configurations. Each mesh has a `config.yaml` and agent `prompt.md` files.

| Mesh | Purpose | Model(s) |
|------|---------|----------|
| `brain` | Knowledge gateway, spec-graph access | opus |
| `dev` | Deep dev: implement → test → review | opus/sonnet |
| `dev-lite` | Lightweight single-agent dev | sonnet |
| `dev-brain` | Dev with brain integration | opus/sonnet |
| `dev-haiku` | FSM-driven iterative dev (coordinator/worker/reviewer) | haiku/sonnet |
| `dev-worktree` | Dev with git worktree isolation | opus |
| `dev-mesh` | Multi-specialist dev (architect, frontend, backend, etc.) | opus/sonnet |
| `dev-tdd` | TDD cycle: red → green → refactor → review | sonnet |
| `dev-review` | Dev with reviewer and tester | opus/sonnet |
| `dev-know-build` | Feature build with know tool integration | opus |
| `dev-ui-prototypes` | UI design exploration with multiple approaches | sonnet |
| `dev-ui-completion` | UI completion pipeline | opus/sonnet |
| `deep-research` | Research with confidence iteration loop | opus/sonnet |
| `ensemble-research` | Parallel research with aggregation | sonnet |
| `mesh-builder` | Build new mesh configurations | opus/sonnet |
| `narrative-engine-v2` | Interactive fiction / narrative engine | opus/sonnet |

### System State (`.ai/tx/`)

| Path | Purpose |
|------|---------|
| `.ai/tx/msgs/` | Message files (markdown with YAML frontmatter) |
| `.ai/tx/data/` | Runtime data: `config.yaml`, SQLite database |
| `.ai/tx/logs/` | Log files: `v4.jsonl` (current), `v4.last.jsonl` (previous) |
| `.ai/tx/forensics/` | Forensics analysis output |
| `.ai/tx/sessions/` | Worker session data |

### Frontend (`frontend/`)

React + Vite SPA for the server mode. Components for dashboard, mesh editor, session runner, core chat, logs viewer, workspace management. Uses Playwright for E2E tests.

### Claude Code Integration (`.claude/`)

| Path | Purpose |
|------|---------|
| `.claude/settings.json` | Claude Code hooks (UserPromptSubmit context injection, PreToolUse graph file protection) |
| `.claude/skills/` | Claude Code skills: `mesh-builder`, `know-tool` |
| `.claude/commands/know/` | Slash commands for spec-graph management |
| `.claude/agents/` | Custom agent configs (feature-effort-estimator) |

### Documentation (`docs/`)

| File | Topic |
|------|-------|
| `docs/mesh-config.md` | Mesh configuration field reference |
| `docs/message-format.md` | Message format (frontmatter, rearmatter) |
| `docs/guardrails.md` | Guardrails configuration reference |
| `docs/hooks.md` | Lifecycle hooks integration guide |
| `docs/fsm.md` | FSM orchestration guide |
| `docs/meshes.md` | Mesh catalog and usage guide |
| `docs/server.md` | HTTP/WebSocket server API |
| `docs/event-flow.md` | Event-driven architecture details |
| `docs/ensemble-execution.md` | Ensemble (parallel) execution |
| `docs/mesh-fsm-config.md` | FSM configuration reference |

## Technology Stack

- **Runtime**: Node.js with ESM (`"type": "module"`)
- **Language**: TypeScript (ES2022 target, NodeNext modules), run via `tsx`
- **LLM SDK**: `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`
- **Database**: SQLite via `better-sqlite3`
- **File Watching**: `chokidar`
- **Terminal**: tmux (core agent session)
- **Config**: YAML (`yaml` package)
- **Frontend**: React + Vite + Playwright
- **Storage**: Local filesystem or Redis (`ioredis`)
- **Server**: Native Node.js HTTP + WebSocket (`ws`)

## Development Commands

```bash
# Build
npm run build          # TypeScript compilation (tsc)

# Tests
npm test               # Unit tests (node --test)
npm run test:e2e       # E2E tests
npm run test:all       # All tests
npm run test:frontend  # Frontend Playwright tests

# Dev server
npm run dev            # Start HTTP/WebSocket server
```

Tests use Node.js built-in test runner (`node --test`), not Jest or Mocha. Test files are in `test/unit/` and `test/e2e/`. Some source files have colocated tests (`*.test.ts` in `src/`).

## Key Conventions

### Logging

**CRITICAL**: Use the logging class (`log` from `src/shared/logger.ts`). Never use `console.error` or `console.log` for error handling or system logging.

```typescript
import { log } from '../shared/logger.ts';

log.error('component', 'message', { details });
log.warn('component', 'message', { details });
log.info('component', 'message', { details });
log.debug('component', 'message', { details });
```

Logs are written to `.ai/tx/logs/v4.jsonl` with the previous run at `v4.last.jsonl`.

### Write Messages, NEVER Update

The Update tool does not trigger the file watcher and will not send messages to meshes. Always write new message files.

### Prompts Are Programming

Mesh prompts are reinforced and enabled by system behavior. When changing the system, update corresponding prompts.

### Mesh-Builder Skill Updates

**CRITICAL**: Whenever you add or modify mesh configuration fields or patterns:

1. **Update `.claude/skills/mesh-builder/SKILL.md`** to reflect the changes
2. Add new fields to the Config Field Reference table
3. Document new patterns with examples
4. Update Best Practices if security/architectural implications exist

### Import Style

- Use `.ts` extensions in imports: `import { foo } from './bar.ts'`
- ESM throughout (`import`/`export`, no `require`)

### Models

Semantic model names: `opus`, `sonnet`, `haiku`. The system resolves these to actual Anthropic model IDs.

## Message Flow

1. Agent writes `.md` file to `.ai/tx/msgs/`
2. Consumer (chokidar) detects file → inserts to queue → emits event
3. `core-message` → Injector injects to Claude (backoff retry if busy)
4. `worker-message` → Dispatcher spawns worker immediately
5. Workers write response messages back to msgs dir
6. `inject-response: true` on outgoing task → active injection into tmux on mesh completion (retry loop, fallback to pending)

### Terminal-by-Default Messaging

TX uses **boundary-based message inference** instead of explicit type fields:

- **To core/core**: Questions for human → session suspends awaiting response
- **From core/core**: Human responses → session resumes with answer
- **To other agents**: Collaboration requests → session awaits response
- **completion_agents → core/core**: Mesh completion → validates parity gate

The `type` field is **optional** for backward compatibility. The system infers message semantics from routing and boundaries.

### Message Format

Messages are markdown files with YAML frontmatter:
- **Required fields**: `to`, `from`, `msg-id`, `headline`, `timestamp`
- **Optional fields**: `type`, `status`, `command`, `feature`, `inject-response`
- **Filename**: `{timestamp}-{type}-{from}--{to}-{msg-id}.md`

## Event-Driven Architecture

**Consumer Events** (`MessageConsumer`):
| Event | Payload | Trigger |
|-------|---------|---------|
| `core-message` | `{id, filepath, from, type}` | Message for `core/core` |
| `worker-message` | `{id, agentId, from, type}` | Message for worker agent |

**Dispatcher Events** (`WorkerDispatcher`):
| Event | Payload | Trigger |
|-------|---------|---------|
| `worker:spawn` | `{agentId, model}` | Worker starting |
| `worker:complete` | `{id, messagesProcessed, output}` | Worker finished |
| `worker:error` | `{id, error}` | Worker error |
| `mesh:loaded` | `{mesh, agents}` | Mesh config loaded |

## Key Subsystems

### FSM (Finite State Machine)

System-managed state tracking for mesh workflows. States, transitions, gates, and context variables are defined in mesh `config.yaml` under the `fsm:` block. State is persisted in SQLite. See `docs/fsm.md`.

### Guardrails

Unified runtime enforcement with **strict/warning mode** on every guardrail. Config: `.ai/tx/data/config.yaml` under `guardrails:`.

| strict | warning | Result |
|--------|---------|--------|
| false  | true    | **Default** — Allow + inject feedback |
| true   | true    | Block/kill + reason |
| true   | false   | Block/kill silently |
| false  | false   | Disabled |

Override chain: agent > mesh > global > hardcoded default. `strict` and `warning` resolve independently.

Guardrail types: `write_gate`, `read_gate`, `identity_gate`, `routing_error`, `max_messages`, `max_turns`.

Full reference: `docs/guardrails.md`

### Lifecycle Hooks

Pre/post hooks execute around worker invocations. Configured per-mesh in `config.yaml`.

- **Pre-hooks**: worktree-create, discovery-code, quality-preflight
- **Post-hooks**: validation-code, quality checks (accuracy, adversarial, deterministic, checklist, rubric), commit-auto, worktree-cleanup, brain-update, forensics-analyze, AI linter, suggest-manifest

Hook context flows: pre-hook → worker → post-hook. See `docs/hooks.md`.

### Ensemble Execution

Multiple agents run the same task in parallel with result aggregation. Strategies: `concat`, `deduplicate`, `voting`, `consensus`, `custom`. Supports coordinators (task decomposition) and reviewers (synthesis).

### Dispatcher Routing

Routing modes in mesh config:
- **Linear**: `agent_a: agent_b` (auto-route to next)
- **Branch**: `agent_a: { outcome_a: agent_b, outcome_c: agent_d }` (outcome-based)
- **Fan-out**: `agent_a: [agent_b, agent_c, agent_d]` (parallel dispatch)
- **Terminal**: Agent not in routing map → routes to `core/core` on complete

### Server Mode

HTTP/WebSocket server for multi-tenant operation. REST API for sessions, messages, meshes. WebSocket for real-time streaming. Supports local or Redis storage backends.

## Docker Environment

`/workspace/` is normal, disregard if it's an issue.
