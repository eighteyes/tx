# TX V4

Multi-agent orchestration system with human-in-the-loop (HITL) support.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Core (Claude CLI in tmux)                                   │
│  - Interactive user session                                 │
│  - Writes task messages to .ai/tx/msgs/                     │
│  - Receives responses via message injection                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Consumer (chokidar)                                         │
│  - Watches .ai/tx/msgs/ for new files                       │
│  - Parses frontmatter → queues messages                     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Queue (SQLite)                                              │
│  - messages table: from, to, type, payload                  │
│  - sessions table: agent_id → conversation_id               │
│  - tasks table: id, status, assigned_to, headline           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Dispatcher                                                  │
│  - Polls queue for task messages                            │
│  - Spawns SdkRunner for each worker                         │
│  - Tracks active workers                                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ SdkRunner (Claude Agent SDK)                                │
│  - Calls Claude programmatically                            │
│  - Resumes previous conversations                           │
│  - Stores session ID after completion                       │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start the system
npm start
```

## Key Concepts

- **Core**: Interactive Claude session in tmux for user interaction
- **Workers**: Ephemeral SDK-based agents that process tasks and exit
- **Messages**: Markdown files with frontmatter for inter-agent communication
- **Resume**: Workers can resume previous conversations via stored session IDs
- **Workspaces**: Task-scoped output directories for structured agent outputs

## Directory Structure

```
v4/
├── src/
│   ├── cli/          # CLI commands (start, status, msg, logs, spy, tasks)
│   ├── core/         # Core agent, tmux, consumer
│   ├── queue/        # SQLite message queue
│   ├── worker/       # SDK runner, dispatcher
│   ├── workspace/    # Task-scoped output workspaces
│   ├── providers/    # Claude provider
│   └── shared/       # Types, colors, time utilities
├── meshes/
│   ├── configs/      # Mesh configurations (JSON)
│   └── agents/       # Agent prompts (Markdown)
├── test/
│   └── e2e/          # End-to-end tests
└── .ai/tx/output/    # Task workspace directories
```

## Message Protocol

Messages are markdown files with YAML frontmatter:

```markdown
---
to: brain/brain
from: core/core
type: task
msg-id: task-123
headline: Run know:prepare
timestamp: 2025-12-09T00:00:00.000Z
---

Please prepare this project.
```

### Message Types

- `task` - Request work from an agent
- `task-complete` - Work finished successfully
- `ask-human` - Worker needs user input
- `ask-response` - User's response to ask-human
- `update` - Status update

## CLI Commands

```bash
tx start              # Start core agent (attaches to tmux)
tx status             # Show system status
tx msg [options]      # View messages
tx logs [options]     # View logs
tx spy [options]      # Real-time activity stream
tx tasks [options]    # View task queue
tx stop               # Stop core agent
```

### Observability

| Command | Purpose |
|---------|---------|
| `tx status` | Agent states, PIDs, health |
| `tx msg` | View message queue (filter by type/agent) |
| `tx tasks` | View task queue (filter by status/agent/mesh) |
| `tx logs [agent]` | Agent output logs (-f to follow) |
| `tx spy [agent]` | Real-time stream of messages + output |

## Documentation

- [WORKSPACE_SYSTEM.md](./WORKSPACE_SYSTEM.md) - Task-scoped output workspaces
- [STATE_MACHINE_INDEX.md](./STATE_MACHINE_INDEX.md) - State machine architecture
- [CLAUDE.md](./CLAUDE.md) - Development guide

## Dependencies

- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK for workers
- `better-sqlite3` - SQLite for message queue and sessions
- `chokidar` - File watching for message consumer
