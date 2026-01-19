# TX-Core Module Dependency Map

## Overview

TX-Core is a multi-agent orchestration system with event-driven architecture. The system coordinates agents across meshes using a SQLite-backed message queue and file-watcher-based consumer.

**Architecture Pattern**: Event-driven with file watchers triggering message consumption, FSM-based agent workflows, and ephemeral worker processes.

---

## Module Structure

### Core Modules (Primary Execution Path)

#### 1. **CLI** (`src/cli/`)
**Purpose**: Command-line interface for TX system operations
**Files**: 12 command handlers + main index
**Key Dependencies**:
- `./start.ts` - Start core agent
- `./server.ts` - Start HTTP/WebSocket server
- `./run.ts` - Headless REPL for meshes
- `./msg.ts` - View messages
- `./logs.ts` - View system logs
- `./spy.ts` - Real-time activity stream
- `./tasks.ts` - View task queue
- `./status.ts` - System status
- `shared/logger.ts` - Logging

**External**: `dotenv` (environment loading)

---

#### 2. **Core** (`src/core/`)
**Purpose**: Core agent and message consumption loop
**Files**: 5 core components
**Key Files**:
- `consumer.ts` - File watcher → message queue → event emitter
- `agent.ts` - Core agent orchestrator (manages workers)
- `tmux.ts` - Tmux session management for Claude
- `worktree.ts` - Git worktree management

**Key Dependencies**:
- `queue/index.ts` - SQLite message queue
- `shared/logger.ts` - Logging
- `shared/types.ts` - Type definitions
- `worker/sdk-runner.ts` - SDK runner for agents

**External**:
- `chokidar` - File watcher (triggers events)
- `yaml` - YAML parsing

**Event Flow**:
```
File written to .ai/tx/msgs/
  ↓
Consumer watches directory (chokidar)
  ↓
Parse YAML frontmatter
  ↓
Insert into SQLite queue
  ↓
Emit event (core-message or worker-message)
  ↓
Dispatcher or Injector picks up
```

---

#### 3. **Queue** (`src/queue/`)
**Purpose**: SQLite-based message queue with persistence
**Files**: 3 components
**Key Components**:
- `index.ts` - MessageQueue class (main interface)
- `stale-cleaner.ts` - Removes old pending messages
- `deadlock-detector.ts` - Detects message circular dependencies

**Key Types**:
- `Message` - Standard message format
- `MessageFilter` - Query messages
- `PendingAsk` - Tracks unresolved asks (parity gate)

**Database Schema**:
- `messages` - Main queue table
- `sessions` - Stored conversation IDs (for resume)
- `pending_asks` - Parity gate tracking

**Key Methods**:
- `insert(msg)` - Add message
- `poll(agent)` - Consume pending messages
- `peek(agent)` - View without consuming
- `queryMessages(filter)` - Search messages
- `trackPendingAsk()` - Parity gate support
- `resolvePendingAsk()` - Resolve asks

**External**: `better-sqlite3` - SQLite wrapper

---

#### 4. **Worker** (`src/worker/`)
**Purpose**: Ephemeral worker processes that execute agent tasks
**Files**: 10+ core components

**Key Components**:
- `dispatcher.ts` - Main coordinator (watches queue, spawns workers)
- `sdk-runner.ts` - Wraps Claude Agent SDK for conversation
- `mesh-validator.ts` - Validates mesh YAML configs
- `mesh-manager.ts` - Loads & manages mesh configurations
- `hooks.ts` - Lifecycle hooks (preflight, validation, postflight)
- `stuck-detector.ts` - Detects agents not responding
- `ensemble-coordinator.ts` - Manages ensemble execution
- `headless-runner.ts` - REPL mode for direct mesh execution
- `types.ts` - Worker-specific types

**Key Dependencies**:
- `queue/index.ts` - Message queue
- `shared/types.ts` - Type definitions
- `shared/logger.ts` - Logging
- `state-machine/index.ts` - FSM execution
- `workspace/index.ts` - Workspace management
- `quality/index.ts` - Quality gates
- `mesh/index.ts` - FSM evaluation
- `core/consumer.ts` - Parity reminder events

**External**:
- `@anthropic-ai/claude-agent-sdk` - SDK for agent interaction
- `yaml` - Config parsing

**Dispatcher Flow**:
```
1. Poll queue for worker-message
2. Load mesh config from YAML
3. Create/resume SdkRunner (Claude session)
4. Inject task context via PromptInjector
5. Execute agent (streaming responses)
6. Apply quality gates/hooks
7. Write response messages back to .ai/tx/msgs/
8. Exit worker process
```

---

### State & Execution

#### 5. **State Machine** (`src/state-machine/`)
**Purpose**: FSM execution engine for agents
**Files**: 3 components
- `core/state-machine.ts` - Main FSM runner
- `middleware/logging.ts` - Logging middleware
- `workers/worker-state.ts` - Worker state tracking

**Key Dependencies**:
- `shared/logger.ts` - Logging
- `shared/types.ts` - Type definitions

**Responsibilities**:
- Execute FSM transitions
- Manage state persistence
- Middleware support (logging, auditing)

---

#### 6. **Mesh** (`src/mesh/`)
**Purpose**: Finite State Machine & ensemble execution
**Files**: 8 components

**Key Components**:
- `fsm.ts` - Main FSM engine
- `fsm-persistence.ts` - SQLite FSM state storage
- `fsm-evaluator.ts` - Evaluate conditions
- `fsm-expression.ts` - Parse FSM expressions
- `fsm-scripts.ts` - Execute shell scripts
- `aggregation.ts` - Ensemble result aggregation
- `distribution.ts` - Task distribution strategy
- `index.ts` - Public API

**Key Dependencies**:
- `shared/logger.ts` - Logging
- `shared/types.ts` - Type definitions (FSMConfig, EnsembleConfig)
- `queue/index.ts` (in fsm-persistence) - FSM state persistence

**Capabilities**:
- State transitions with conditions
- Guard expressions
- Ensemble aggregation strategies
- Task distribution (Phase 2)

---

#### 7. **Quality Gates** (`src/quality/`)
**Purpose**: Pre/post-flight validation and quality checks
**Files**: 8 evaluators + registry

**Key Components**:
- `registry.ts` - Gate registry & lookup
- `stack.ts` - Pipeline composition
- `gates/accuracy.ts` - LLM-based accuracy check
- `gates/rubric.ts` - Grading against rubric
- `gates/checklist.ts` - Task completion checklist
- `gates/adversarial.ts` - Adversarial evaluation
- `gates/deterministic.ts` - Logic-based checks
- `gates/summarizer.ts` - Response summarization

**Key Dependencies**:
- `shared/types.ts` - Evaluation types
- `shared/logger.ts` - Logging

---

### Context & Workspace

#### 8. **Workspace** (`src/workspace/`)
**Purpose**: Task-scoped output workspaces and prompt injection
**Files**: 4 components

**Key Components**:
- `manager.ts` - Workspace configuration & lifecycle
- `injector.ts` - Prompt injection (task context, FSM state)
- `messaging-protocol.ts` - Message format definitions
- `index.ts` - Public API

**Key Dependencies**:
- `shared/logger.ts` - Logging
- `shared/types.ts` - Type definitions

**Key Classes**:
- `WorkspaceManager` - Manages task workspaces
- `PromptInjector` - Injects context into prompts

---

### Storage & Server

#### 9. **Storage** (`src/storage/`)
**Purpose**: Session persistence (local or Redis)
**Files**: 4 components

**Providers**:
- `local-provider.ts` - File-based storage
- `redis-provider.ts` - Redis-based storage
- `interface.ts` - StorageProvider interface
- `index.ts` - Factory & exports

**Key Dependencies**:
- `ioredis` (optional) - Redis client

**Use Cases**:
- Session state persistence
- Distributed deployments (Redis)
- Local development (file-based)

---

#### 10. **Server** (`src/server/`)
**Purpose**: HTTP/WebSocket server for multi-tenant mode
**Files**: 6 components

**Key Components**:
- `index.ts` - HTTP server setup
- `session-manager.ts` - Session lifecycle
- `worker-pool.ts` - Worker pool management
- `quota-manager.ts` - Tenant quotas
- `rate-limiter.ts` - Request rate limiting
- `auth.ts` - Authentication & authorization

**Key Dependencies**:
- `storage/index.ts` - Session persistence
- `shared/logger.ts` - Logging
- `worker/dispatcher.ts` (indirect) - Worker management

**API Routes**:
- Sessions: CRUD operations
- Messages: Send/receive
- Meshes: Configuration management
- WebSocket: Real-time streaming

---

### Providers & Tools

#### 11. **Providers** (`src/providers/`)
**Purpose**: LLM provider abstraction
**Files**: 3 components

**Components**:
- `claude.ts` - Claude provider implementation
- `interface.ts` - LLMProvider interface
- `index.ts` - Registry & factory

**Key Dependencies**:
- `shared/types.ts` - Type definitions

---

#### 12. **Tools** (`src/tools/`)
**Purpose**: Search and web utilities for agents
**Subdirectory**: `tools/search/`

**Key Components**:
- `base-provider.ts` - Search provider base class
- `provider-registry.ts` - Provider registry & health checks
- `search.ts` - Unified search interface

**Search Providers** (12 total):
- `providers/stackoverflow.ts`
- `providers/github.ts`
- `providers/arxiv.ts`
- `providers/wikipedia.ts`
- `providers/youtube.ts`
- `providers/brave.ts`
- `providers/duckduckgo.ts`
- `providers/pubmed.ts`
- `providers/semanticscholar.ts`
- `providers/crossref.ts`
- `providers/devto.ts`
- `providers/hackernews.ts`

**Key Dependencies**:
- `shared/logger.ts` - Logging

---

### HTTP Controllers

#### 13. **Controllers** (`src/controllers/`)
**Purpose**: HTTP endpoint handlers
**Files**: 5 controllers

**Controllers**:
- `mesh-controller.ts` - Mesh CRUD & validation
- `workspace-controller.ts` - Workspace management
- `sessions-controller.ts` - Session management
- `stats-controller.ts` - System statistics
- `logs-controller.ts` - Log retrieval

**Key Dependencies**:
- `shared/logger.ts` - Logging
- `worker/mesh-validator.ts` - Mesh validation

---

### Utilities

#### 14. **Shared** (`src/shared/`)
**Purpose**: Shared utilities and type definitions
**Files**: 7 utilities

**Key Exports**:
- `types.ts` - Core type definitions (Message, AgentConfig, FSMConfig, etc.)
- `logger.ts` - Structured logging to JSONL
- `time.ts` - Time formatting utilities
- `colors.ts` - Terminal color helpers
- `string.ts` - String utilities
- `index.ts` - Module exports
- `fib.ts` - Fibonacci backoff utilities

---

## Dependency Graph (Simplified)

```
CLI
├── ./start.ts ──→ Core/Agent
├── ./server.ts ──→ Server
├── ./run.ts ──→ Worker/HeadlessRunner
├── ./msg.ts ──→ Queue
├── ./logs.ts ──→ Shared/Logger
└── Shared/Logger (all commands)

Core/Consumer (File Watcher)
├── Chokidar (fs watch)
├── Queue/MessageQueue
├── Shared/Logger
├── Shared/Types
└── events: core-message, worker-message

Core/Agent
├── Queue/MessageQueue
├── Consumer (events)
├── Tmux (session mgmt)
├── SdkRunner
└── Shared/Logger

Worker/Dispatcher
├── Queue/MessageQueue
├── SdkRunner
├── MeshValidator
├── MeshManager
├── Workspace/Manager
├── Workspace/Injector
├── Hooks (preflight/postflight)
├── StuckAgentDetector
├── Quality/Stack
├── FSM/MeshFSM
├── EnsembleCoordinator
└── Shared/Logger

SdkRunner (Claude SDK wrapper)
├── @anthropic-ai/claude-agent-sdk
├── Queue/MessageQueue
├── Shared/Types
└── Shared/Logger

Mesh/FSM Engine
├── FSM/Persistence
├── FSM/Evaluator
├── FSM/Expression
├── FSM/Scripts
├── Shared/Logger
└── Shared/Types

Workspace/Injector
├── Workspace/Manager
├── Workspace/MessageProtocol
├── Shared/Logger
├── Shared/Types
└── File I/O

Server
├── Storage/Provider
├── SessionManager
├── WorkerPool
├── QuotaManager
├── RateLimiter
├── Auth
└── Shared/Logger

Storage/Provider
├── LocalProvider (file-based)
└── RedisProvider (ioredis)

Tools/Search
├── BaseProvider (abstract)
├── ProviderRegistry
├── 12x SearchProviders
└── Shared/Logger

Quality/Gates
├── Registry
├── Stack (pipeline)
├── 6x Evaluators
└── Shared/Types

Controllers
├── MeshController ──→ Worker/MeshValidator
├── WorkspaceController
├── SessionsController
├── StatsController
├── LogsController
└── Shared/Logger

Shared Exports
├── Types (Message, AgentConfig, FSMConfig, etc.)
├── Logger (structured JSONL logging)
├── Time utilities
├── Color utilities
└── String utilities
```

---

## External Dependencies

### NPM Packages

| Package | Module | Purpose |
|---------|--------|---------|
| `@anthropic-ai/claude-agent-sdk` | Worker | Claude Agent SDK for conversation |
| `@anthropic-ai/claude-code` | CLI | Claude Code library |
| `@anthropic-ai/sdk` | Core | Anthropic SDK |
| `better-sqlite3` | Queue | SQLite database wrapper |
| `chokidar` | Core | File system watcher |
| `dotenv` | CLI | Environment variable loading |
| `ioredis` | Storage | Redis client |
| `ws` | Server | WebSocket server |
| `yaml` | Core | YAML parser |
| `youtube-transcript-plus` | Tools | YouTube transcript fetching |
| `@noble/curves` | Utils | Cryptography utilities |
| `@scure/bip39` | Utils | BIP39 word list |

### Node.js Built-ins

| Module | Usage |
|--------|-------|
| `fs`, `fs/promises` | File I/O |
| `path` | Path manipulation |
| `crypto` | Random ID generation |
| `child_process` | Script execution |
| `events` | EventEmitter base class |
| `http`, `https` | HTTP server/client |
| `util` | Utility functions |

---

## Key Dependency Patterns

### 1. **Logging Hierarchy**
Every module imports from `shared/logger.ts` for structured logging:
```typescript
import { log } from '../shared/logger.ts';
```
All logs → `.ai/tx/logs/v4.jsonl` (event-driven system trace)

### 2. **Type Definitions**
Core types centralized in `shared/types.ts`:
- `Message` - Queue message format
- `MessageType`, `MessageStatus`
- `AgentConfig`, `AgentStatus`
- `FSMConfig`, `FSMStateConfig`
- `EnsembleConfig`, `TaskDistributionConfig`
- `SemanticModel` - LLM model selection

### 3. **Message Queue Access**
Multiple modules consume from `queue/index.ts`:
- Dispatcher polls for `worker-message`
- Stale cleaner prunes old messages
- Deadlock detector tracks pending asks

### 4. **Mesh & FSM Dependencies**
FSM system uses:
- `fsm-persistence.ts` ← shares database with queue
- `fsm-evaluator.ts` + `fsm-expression.ts` → condition evaluation
- `fsm-scripts.ts` → shell script execution

### 5. **Workspace Injection Pattern**
Worker → PromptInjector → file writes trigger Consumer → Queue

### 6. **Worker Lifecycle**
Dispatcher → SdkRunner → Hooks → Quality Gates → FSM

---

## Internal Module Import Frequency

**Most Imported** (>10 files):
1. `shared/logger.ts` (38 imports) - Logging
2. `queue/index.ts` (18 imports) - Message queue
3. `shared/types.ts` (16 imports) - Type definitions
4. `base-provider.ts` (16 imports) - Search provider base

**Commonly Imported** (5-10 imports):
- `types.ts` (11 imports) - Module-local types
- `yaml` (9 imports) - Config parsing
- `path` (9 imports) - File paths
- `sdk-runner.ts` (8 imports) - Worker runner
- `registry.ts` (8 imports) - Gate registry

---

## Module Lifecycle & Flow

### Typical Message Flow (Start to Response)

```
1. File written: .ai/tx/msgs/*.md
   └─ Frontmatter: { to, from, type, ... }

2. Consumer detects (chokidar)
   ├─ Parse YAML frontmatter
   └─ Insert to Queue

3. Event emission
   ├─ core-message → Injector (for core/core)
   └─ worker-message → Dispatcher (for other agents)

4. Dispatcher processes worker-message
   ├─ Load mesh config (YAML)
   ├─ Get/create SdkRunner (Claude session)
   ├─ Inject workspace context
   └─ Execute agent

5. SdkRunner execution
   ├─ Resume/create conversation
   ├─ Stream Claude responses
   └─ Capture tool results

6. Post-execution
   ├─ Apply quality gates
   ├─ Execute FSM transitions
   ├─ Aggregation (ensemble)
   └─ Write response messages

7. Response written: .ai/tx/msgs/*.md
   └─ Back to step 1 (Consumer watches)
```

---

## Cross-Module Dependencies Summary

| From → To | Purpose | Key Class |
|-----------|---------|-----------|
| CLI → Core | Start core agent | `CoreAgent` |
| CLI → Server | Start HTTP server | (http.Server) |
| CLI → Worker | Direct mesh execution | `HeadlessRunner` |
| Consumer → Queue | Insert messages | `MessageQueue` |
| Dispatcher → Queue | Poll tasks | `MessageQueue.poll()` |
| Dispatcher → SdkRunner | Execute agent | `SdkRunner` |
| SdkRunner → Queue | Write responses | `MessageQueue.insert()` |
| Dispatcher → Workspace | Inject context | `PromptInjector` |
| Dispatcher → Quality | Validate output | `QualityStack` |
| Dispatcher → FSM | Execute state machine | `MeshFSM` |
| FSM → Persistence | Store state | `FSMPersistence` |
| Workspace → Injector | Build prompts | `PromptInjector` |
| Server → Storage | Persist sessions | `StorageProvider` |
| Server → Dispatcher | Spawn workers | (event-based) |
| Controllers → Mesh | Validate config | `MeshValidator` |
| Tools → Providers | Search execution | `SearchProvider` |

---

## Critical Dependency Chains

1. **Execution Chain**: CLI → Core → Consumer → Dispatcher → SdkRunner → Quality → FSM
2. **Persistence Chain**: SdkRunner → Queue → FSMPersistence (shared SQLite)
3. **Workspace Chain**: Dispatcher → Injector → Manager → file writes → Consumer
4. **Validation Chain**: Dispatcher → MeshValidator → MeshManager → YAML parser

---

## Notes

- **Single SQLite Database**: Queue and FSM share the same database instance (`queue.getDb()` returned to FSM)
- **Event-Driven**: File watchers trigger all async operations
- **Stateless Workers**: Each worker process is ephemeral (runs, completes, exits)
- **Session Resumption**: Conversation IDs stored in queue.sessions table
- **Parity Gate**: Tracks pending asks in queue.pending_asks table
- **Quality Composable**: Quality gates stackable in configuration

