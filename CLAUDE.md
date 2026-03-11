Do NOT run `tx start`, `tx msg` or `tx run` or you will be terminated.
TRUST the meshes to run and respond to you. Only investigate if prompted.

## Architecture
- `.ai/tx/` - system state
- `src/cli/` - CLI commands (start, status, msg, spy)
- `src/core/` - Consumer (file watcher), tmux utilities
- `src/queue/` - SQLite message queue
- `src/worker/` - SDK-based ephemeral workers
- `meshes/` - Agent configs and prompts


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

### Terminal-by-Default Messaging

TX uses **boundary-based message inference** instead of explicit type fields:

- **To core/core**: Questions for human → session suspends awaiting response
- **From core/core**: Human responses → session resumes with answer
- **To other agents**: Collaboration requests → session awaits response
- **completion_agents → core/core**: Mesh completion → validates parity gate

The `type` field is **optional** for backward compatibility. The system infers message semantics from routing and boundaries.

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
