# TX-Core Module Relationships & Architecture

## Module Dependency Graph (Visual)

### Core Execution Layer

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI (Command Entry)                      │
│  start│server│run│msg│logs│spy│tasks│prompt│validate-mesh│tool│
└──────────────────┬────────────────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
        ▼          ▼          ▼
    ┌────────┐ ┌──────────┐ ┌──────────────┐
    │ CORE   │ │ SERVER   │ │   WORKER     │
    │ Agent  │ │ HTTP/WS  │ │ Headless     │
    └────────┘ └──────────┘ └──────────────┘
        │          │              │
        └──────────┬──────────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │    CONSUMER (File Watcher)   │
    │  Chokidar → Queue → Events   │
    └──────────────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────┐
    │   MESSAGE QUEUE (SQLite)     │
    │  messages│sessions│pending   │
    └──────────────────────────────┘
```

---

### Worker Execution Pipeline

```
DISPATCHER
    │
    ├─→ Queue.poll(agent)
    │
    ├─→ MeshValidator.validate()
    │
    ├─→ MeshManager.load()
    │
    ├─→ SdkRunner.createOrResume()
    │       │
    │       ├─→ @anthropic-ai/claude-agent-sdk
    │       └─→ Store conversationId
    │
    ├─→ PromptInjector.injectContext()
    │       │
    │       └─→ Workspace Manager
    │
    ├─→ SdkRunner.stream()
    │       │
    │       ├─→ Tool execution
    │       └─→ Message parsing
    │
    ├─→ Hooks (Preflight/Postflight)
    │
    ├─→ QualityStack.evaluate()
    │       │
    │       ├─→ Accuracy gate
    │       ├─→ Rubric gate
    │       ├─→ Checklist gate
    │       ├─→ Adversarial gate
    │       ├─→ Deterministic gate
    │       └─→ Summarizer
    │
    ├─→ MeshFSM.executeTransition()
    │       │
    │       ├─→ FSMEvaluator (conditions)
    │       ├─→ FSMExpression (parse)
    │       ├─→ FSMScripts (execute)
    │       └─→ FSMPersistence (store)
    │
    ├─→ EnsembleCoordinator (if ensemble)
    │       │
    │       └─→ AggregationEngine
    │
    └─→ Write response → .ai/tx/msgs/
            │
            └─→ Back to CONSUMER
```

---

### Data Flow Diagram

```
User Command
    │
    ├─→ CLI.start()
    │       └─→ CoreAgent.start()
    │           └─→ TmuxSession.attach()
    │
    ├─→ CLI.server()
    │       └─→ Server.listen()
    │           ├─→ SessionManager
    │           ├─→ WorkerPool
    │           ├─→ QuotaManager
    │           └─→ RateLimiter
    │
    ├─→ CLI.run()
    │       └─→ HeadlessRunner.repl()
    │
    └─→ CLI.msg/logs/spy/tasks
            └─→ Queue.queryMessages()

═══════════════════════════════════════════════════════════════════

Mesh File → .ai/tx/msgs/task.md
    │
    ├─→ Consumer (Chokidar watches)
    │
    ├─→ Parser (YAML frontmatter)
    │       │
    │       ├─ to: target_agent
    │       ├─ from: source_agent
    │       ├─ type: task|ask|update
    │       └─ [msg-id, headline, timestamp...]
    │
    ├─→ Queue.insert(message)
    │
    ├─→ Emit event
    │       ├─ core-message → Injector (if to: core/core)
    │       └─ worker-message → Dispatcher (else)
    │
    └─→ Process message...
```

---

## Module Groupings by Function

### Group 1: Message Distribution & Routing

```
PRODUCER           CONSUMER           ROUTING
---------          --------           -------
Worker              Consumer          Dispatcher
├─ SdkRunner        ├─ Chokidar       ├─ Queue polling
├─ write() to       ├─ YAML parse     ├─ Agent lookup
│  .ai/tx/msgs/    ├─ Insert queue   └─ Task spawning
│
CoreAgent
└─ write() to
   .ai/tx/msgs/

QUEUE (SQLite)
├─ messages table
├─ sessions table
└─ pending_asks table
```

---

### Group 2: Agent Execution

```
DISPATCHER
├─→ MESH MANAGER
│   ├─ Load config.yaml
│   ├─ Validate schema
│   └─ Parse agents/routes
│
├─→ SDK RUNNER
│   ├─ Claude Agent SDK
│   ├─ Resume/create conversation
│   └─ Stream responses
│
├─→ WORKSPACE INJECTOR
│   ├─ Build task context
│   └─ Inject into prompt
│
├─→ HOOKS
│   ├─ Preflight validation
│   └─ Postflight processing
│
└─→ QUALITY GATES
    ├─ Registry lookup
    ├─ Stack execution
    └─ 6x Evaluators
```

---

### Group 3: State Management

```
FSM ENGINE
├─ FSM.ts (main state machine)
├─ FSM Persistence (SQLite)
│   └─ Shares DB with Queue
├─ FSM Evaluator (conditions)
├─ FSM Expression (parsing)
└─ FSM Scripts (shell execution)

STATE MACHINE
├─ Core state-machine.ts
├─ Logging middleware
└─ Worker state tracking
```

---

### Group 4: Context & Workspace

```
WORKSPACE MANAGER
├─ Config normalization
├─ Lifecycle management
└─ Directory structure

PROMPT INJECTOR
├─ PreambleContext
├─ TaskContext
├─ FSMContext
└─ SubtaskContext

MESSAGING PROTOCOL
└─ Message format definitions
```

---

### Group 5: Storage & Persistence

```
LOCAL PROVIDER          REDIS PROVIDER
├─ File-based          ├─ ioredis client
├─ Development         ├─ Distributed
└─ Single-machine      └─ Multi-tenant

SHARED STORAGE INTERFACE
├─ StorageProvider (abstract)
├─ SessionState type
└─ AgentMessage type

QUEUE (SQLite)
├─ messages
├─ sessions (conversation IDs)
└─ pending_asks
```

---

### Group 6: HTTP Server & Multi-Tenant

```
SERVER
├─→ SESSION MANAGER
│   ├─ Create session
│   ├─ Resume session
│   └─ Destroy session
│
├─→ WORKER POOL
│   ├─ Worker allocation
│   ├─ Resource limits
│   └─ Pool cleanup
│
├─→ QUOTA MANAGER
│   ├─ Per-tenant limits
│   └─ Usage tracking
│
├─→ RATE LIMITER
│   ├─ Request throttling
│   └─ Per-tenant limits
│
└─→ AUTH
    ├─ API key validation
    ├─ Tenant resolution
    └─ Permission checks

CONTROLLERS
├─ MeshController
├─ WorkspaceController
├─ SessionsController
├─ StatsController
└─ LogsController
```

---

### Group 7: Search & Tools

```
SEARCH SYSTEM
├─→ BASE PROVIDER
│   ├─ SearchResult type
│   └─ Health check interface
│
├─→ PROVIDER REGISTRY
│   ├─ Provider lookup
│   ├─ Health monitoring
│   └─ Factory
│
└─→ 12x PROVIDERS
    ├─ StackOverflow
    ├─ GitHub
    ├─ ArXiv
    ├─ Wikipedia
    ├─ YouTube
    ├─ Brave
    ├─ DuckDuckGo
    ├─ PubMed
    ├─ SemanticScholar
    ├─ CrossRef
    ├─ DevTo
    └─ HackerNews
```

---

## Dependency Matrix

### Dependency Count by Module

| Module | Imports From | Imported By | Criticality |
|--------|--------------|-------------|------------|
| shared/logger | - | 38 files | ★★★★★ CRITICAL |
| shared/types | logger, colors | 16 files | ★★★★★ CRITICAL |
| queue/index | logger, better-sqlite3 | 18 files | ★★★★★ CRITICAL |
| worker/dispatcher | queue, workspace, quality, mesh, fsm | 5+ files | ★★★★★ CRITICAL |
| worker/sdk-runner | queue, logger, anthropic-sdk | 8 files | ★★★★★ CRITICAL |
| core/consumer | queue, logger, chokidar, yaml | 2 files | ★★★★★ CRITICAL |
| mesh/fsm | queue(persist), logger, types | 5 files | ★★★★ HIGH |
| workspace/injector | logger, types, fs-promises | 2 files | ★★★★ HIGH |
| workspace/manager | logger, types | 1 file | ★★★ MEDIUM |
| quality/registry | types, logger | 4 files | ★★★ MEDIUM |
| providers/claude | types, logger, child_process | 1 file | ★★ LOW |
| storage/interface | types | 2 files | ★★ LOW |
| tools/search | logger, http | 1 file | ★★ LOW |

### Circular Dependency Check

✓ **No circular dependencies detected**

- Queue does not depend on modules that depend on queue
- Dispatcher does not depend on modules that depend on dispatcher
- Workspace does not depend on modules that depend on workspace
- FSM Persistence shares database with Queue (not a dependency cycle)

---

## Import Statistics

### Most Imported Modules
```
shared/logger.ts          ████████████████████████████████████ 38 imports
queue/index.ts            ██████████████████ 18 imports
shared/types.ts           ████████████████ 16 imports
base-provider.ts          ████████████████ 16 imports
module-local types.ts     ███████████ 11 imports
yaml (external)           █████████ 9 imports
path (node builtin)       █████████ 9 imports
sdk-runner.ts             ████████ 8 imports
registry.ts               ████████ 8 imports
shared/colors.ts          ██████ 6 imports
fs/promises (node)        ██████ 6 imports
better-sqlite3 (extern)   ██████ 6 imports
shared/time.ts            █████ 5 imports
```

### External Dependencies (NPM)

```
@anthropic-ai/claude-agent-sdk    3 imports (worker, headless, types)
@anthropic-ai/claude-code          1 import  (cli)
@anthropic-ai/sdk                  1 import  (cli)
better-sqlite3                     6 imports (queue, mesh-fsm, etc)
chokidar                          4 imports (core, consumer, spy)
dotenv                            1 import  (cli)
ioredis                           2 imports (storage)
ws                                2 imports (server)
yaml                              9 imports (core, worker, etc)
youtube-transcript-plus           1 import  (tools/youtube)
@noble/curves                     1 import  (utils)
@scure/bip39                      1 import  (utils)
```

---

## Critical Paths

### Path 1: Message Execution (CLI → Core → Queue)

```
tx start
  ↓
CLI/start.ts → CoreAgent.start()
  ↓
Core/Agent → Consumer watch
  ↓
Consumer detects .ai/tx/msgs/*.md
  ↓
Consumer → Queue.insert()
  ↓
Emit event (core-message or worker-message)
  ↓
Dispatcher.onWorkerMessage()
  ↓
[Execution continues...]
```

### Path 2: Worker Execution (Dispatcher → SDK)

```
Dispatcher.poll()
  ↓
Queue.poll(agentId)
  ↓
Load mesh config (YAML)
  ↓
Create SdkRunner
  ↓
Resume/create Claude conversation
  ↓
Stream responses + tools
  ↓
Apply quality gates
  ↓
Execute FSM transitions
  ↓
Write response messages
  ↓
Back to Consumer/Queue
```

### Path 3: Server Deployment (CLI → Server → Sessions)

```
tx server
  ↓
CLI/server.ts → Server.listen()
  ↓
Storage.initialize() (Redis or local)
  ↓
SessionManager.createSession()
  ↓
WorkerPool.allocate()
  ↓
WorkerDispatcher.spawnWorker()
  ↓
Worker execution (same as Path 2)
  ↓
Response → WebSocket client
```

---

## Module Independence & Cohesion

### High Cohesion (Closely Related)
- Queue + FSM Persistence (share SQLite)
- Workspace Manager + Workspace Injector
- FSM modules (fsm + fsm-persistence + fsm-evaluator + fsm-expression + fsm-scripts)
- Quality modules (registry + stack + 6x gates)
- Storage modules (interface + local + redis)
- Server modules (index + session + pool + quota + rate + auth)
- Search modules (base + registry + 12x providers)

### Loose Coupling (Independent)
- Providers (each provider is self-contained)
- Quality evaluators (pluggable via registry)
- CLI commands (mostly independent, reuse logger)
- Controllers (HTTP route handlers)

### Shared Foundations
- Logging (every module uses logger.ts)
- Types (core types centralized in shared/types.ts)
- Utilities (time, colors, string, fib in shared/)

---

## Configuration Flow

### Mesh Configuration
```
User creates: meshes/my-mesh/config.yaml
    ↓
MeshManager.load()
    ↓
MeshValidator.validate()
    ↓
Return: MeshConfig {
  mesh: string
  agents: MeshAgentConfig[]
  routing: MeshRouting
  fsm?: FSMConfig
  ensemble?: EnsembleConfig
}
```

### Workspace Configuration
```
WorkspaceManager.normalizeConfig()
    ↓
Return: WorkspaceConfig {
  directory: string
  maxSize: number
  cleanup: boolean
  ...
}
```

---

## Error Handling & Logging

### Logging Hierarchy
```
All modules
    ↓
Shared/Logger.ts (central)
    ↓
.ai/tx/logs/v4.jsonl (structured JSONL)

Last run → .ai/tx/logs/v4.last.jsonl
```

### Error Propagation
```
SdkRunner error
    ↓
log.error() → queue
    ↓
Dispatcher catches
    ↓
Quality gate may retry
    ↓
StuckAgentDetector may detect
    ↓
Write error message to queue
```

---

## Scalability Considerations

### Single-Machine (Default)
- SQLite queue (better-sqlite3)
- Local file storage
- Single consumer/dispatcher process
- Tmux session for core agent

### Multi-Tenant (Server Mode)
- Redis storage (optional)
- HTTP/WebSocket API
- Session manager pools
- Distributed worker allocation
- Rate limiting & quotas

### Distributed (Future)
- Database backend (PostgreSQL)
- Message broker (Redis Streams, RabbitMQ)
- Load balancing
- Worker grid coordination

---

## Summary Table: Module at a Glance

| Module | Size | Type | Key Dependency | Exports |
|--------|------|------|---|---------|
| CLI | 12 files | Command handler | shared/logger | Commands (start, server, run, etc) |
| Core | 5 files | Orchestration | queue, consumer | CoreAgent, Consumer, TmuxSession |
| Consumer | 1 file | File watcher | chokidar, queue | MessageConsumer |
| Queue | 3 files | Persistence | better-sqlite3 | MessageQueue, StaleMessageCleaner, DeadlockDetector |
| Worker | 10+ files | Execution | queue, sdk | Dispatcher, SdkRunner, MeshValidator |
| Dispatcher | 1 file | Task scheduler | queue, workspace, quality, fsm | WorkerDispatcher |
| SdkRunner | 1 file | SDK wrapper | anthropic-sdk, queue | SdkRunner |
| Mesh | 8 files | State machine | queue (persist) | MeshFSM, Aggregation, Distribution |
| FSM | 4 files | FSM engine | better-sqlite3, logger | FSMPersistence, Evaluator, Expression |
| Quality | 8 files | Validation | logger, types | Registry, Stack, 6x Evaluators |
| Workspace | 4 files | Context mgmt | logger, types | Manager, Injector, Protocol |
| Server | 6 files | HTTP API | storage, auth | Server, SessionManager, WorkerPool |
| Storage | 4 files | Persistence | ioredis (optional) | LocalProvider, RedisProvider |
| Tools | 13 files | Search | http, logger | 12x Providers, Registry |
| Providers | 3 files | LLM abstraction | logger, types | ClaudeProvider, Registry |
| Controllers | 5 files | HTTP routes | logger, validator | 5x Controllers |
| Shared | 7 files | Utilities | - | Types, Logger, Utilities |

---

## Key Architectural Decisions

1. **Event-Driven via File Watchers**: No polling - Chokidar watches .ai/tx/msgs/ directory
2. **SQLite Queue**: Single-file database, no external dependencies
3. **Ephemeral Workers**: Each agent execution = new process (started/completed/exited)
4. **Centralized Logging**: All logging → .ai/tx/logs/v4.jsonl for debugging
5. **Pluggable Quality Gates**: Registry pattern allows custom evaluators
6. **Workspace Injection**: Task context injected into prompt, not passed as state
7. **FSM Persistence**: State stored in same SQLite DB as queue
8. **Parity Gate via Pending Asks**: Track unresolved asks to prevent race conditions

