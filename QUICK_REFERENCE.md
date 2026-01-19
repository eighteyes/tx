# TX-Core Quick Reference Card

## 30-Second Module Summary

| Module | Purpose | Key Class |
|--------|---------|-----------|
| **CLI** | Command entry point | Various command handlers |
| **Core** | Orchestration loop | CoreAgent, Consumer, TmuxSession |
| **Consumer** | File watcher | MessageConsumer (watches .ai/tx/msgs/) |
| **Queue** | SQLite persistence | MessageQueue (sqlite, messages, sessions) |
| **Worker** | Ephemeral execution | Dispatcher, SdkRunner |
| **Mesh** | FSM & ensemble | MeshFSM (state machine) |
| **Quality** | Validation gates | QualityStack (6x evaluators) |
| **Workspace** | Task context | PromptInjector, WorkspaceManager |
| **Server** | HTTP/WebSocket | SessionManager, WorkerPool, QuotaManager |
| **Storage** | Persistence layer | StorageProvider (local or redis) |
| **Tools** | Search utilities | 12x providers (github, arxiv, etc) |
| **Providers** | LLM abstraction | ClaudeProvider |
| **Shared** | Utilities | Logger, Types, Time, Colors |
| **Controllers** | HTTP handlers | MeshController, SessionsController |

---

## Dependency Levels

```
Level 0: shared/logger.ts ────────────┐
         shared/types.ts              │
         shared/colors.ts             │ (foundations)
         shared/time.ts               │
                                      ▼
Level 1: queue/index.ts ◄─── better-sqlite3
         storage/index.ts ◄─── ioredis (opt)
         providers/index.ts
                  │
                  ▼
Level 2: core/consumer.ts ◄─── chokidar, yaml
         worker/sdk-runner.ts ◄─── @anthropic-ai/claude-agent-sdk
         mesh/fsm.ts
                  │
                  ▼
Level 3: worker/dispatcher.ts ◄─── combines 2+3
         workspace/injector.ts
         quality/stack.ts
                  │
                  ▼
Level 4: core/agent.ts
         server/index.ts
                  │
                  ▼
Level 5: cli/index.ts
```

---

## Critical Imports (Memorize These)

### For Logging (Used in EVERY file)
```typescript
import { log } from '../shared/logger.ts';
log.error('component', 'message', { context });
```

### For Types (Used in 16 files)
```typescript
import type { Message, AgentConfig, FSMConfig } from '../shared/types.ts';
```

### For Queue (Used in 18 files)
```typescript
import { MessageQueue, type Message } from '../queue/index.ts';
const queue = new MessageQueue(dbPath);
queue.insert(message);
```

### For Workers (Used in 8 files)
```typescript
import { SdkRunner, type SdkRunnerConfig } from './sdk-runner.ts';
const runner = new SdkRunner(config);
```

### For FSM (Used in 4 files)
```typescript
import { MeshFSM } from '../mesh/index.ts';
const fsm = new MeshFSM(config, db);
```

---

## Message Flow (One Paragraph)

User writes file → Consumer detects (chokidar) → Parse YAML → Queue.insert() → Emit event → Dispatcher polls → Load mesh config → SdkRunner resumes/creates Claude session → Claude responds → Inject context via PromptInjector → Apply quality gates → Execute FSM transitions → Write response messages → Loop

---

## Execution Chains

**Short**: Dispatcher → SdkRunner → Claude → Response

**Medium**: Queue.poll() → MeshManager → Dispatcher → SdkRunner → Quality → FSM

**Long**: CLI → Core → Consumer → Queue → Dispatcher → [Medium chain] → Write → Loop

---

## Data Stored Where

| Data | Storage | Query |
|------|---------|-------|
| Messages | Queue (SQLite) | `queue.queryMessages()` |
| Agent state | FSM (SQLite) | `fsm.getState()` |
| Session IDs | Queue.sessions (SQLite) | `queue.getConversationId()` |
| Pending asks | Queue.pending_asks (SQLite) | `queue.getPendingAsks()` |
| Logs | JSONL file | `.ai/tx/logs/v4.jsonl` |
| Multi-tenant sessions | Storage (local/redis) | `storage.get(key)` |

---

## External Packages (12 Total)

| Package | Import | Module | Purpose |
|---------|--------|--------|---------|
| @anthropic-ai/claude-agent-sdk | `query` | worker | Agent SDK |
| better-sqlite3 | `Database` | queue | SQLite |
| chokidar | `watch` | consumer | File watcher |
| yaml | `YAML` | consumer | Parse YAML |
| ws | `WebSocket` | server | WebSocket server |
| ioredis | `Redis` | storage | Redis client (opt) |
| dotenv | `config` | cli | .env loader |
| @noble/curves | - | utils | Crypto |
| @scure/bip39 | - | utils | BIP39 |
| youtube-transcript-plus | - | tools | YouTube API |
| @anthropic-ai/sdk | - | cli | Anthropic SDK |
| @anthropic-ai/claude-code | - | cli | Claude Code |

---

## Module Characteristics

### Stateless Modules
- CLI, Controllers, Tools (search providers)
- Can be instantiated multiple times
- No side effects on init

### Stateful Modules
- Queue (SQLite connection)
- Consumer (file watcher)
- SdkRunner (Claude session)
- WorkerPool (worker tracking)

### Transient Modules
- Worker processes (ephemeral)
- Dispatcher instances (recreated per message)
- Quality evaluation (run-once)

---

## Safe Refactoring Rules

1. **Don't break circular dependencies** ✓ None exist!
2. **Don't move shared/logger** - 38 files depend on it
3. **Don't move shared/types** - 16 files depend on it
4. **Don't change queue schema** - FSM and stale cleaner depend on it
5. **Do keep Logger, Types, Time as utilities**
6. **Do keep Queue accessible from Dispatcher and SdkRunner**

---

## Bottlenecks & Constraints

| Bottleneck | Impact | Solution |
|-----------|--------|----------|
| Single SQLite file | Write contention | WAL mode enabled (see queue) |
| Consumer polling rate | Message latency | Chokidar is instant (not polling) |
| SdkRunner session | Token limit | Conversation stored in queue |
| Quality gate time | Worker latency | Parallel evaluation possible |
| Prompt size | Context limit | Task trimming in injector |

---

## Debug Checklist

- [ ] Check logs: `.ai/tx/logs/v4.jsonl`
- [ ] Check messages: `tx msg`
- [ ] Check status: `tx status`
- [ ] Check FSM state: Query SQLite directly
- [ ] Check pending asks: `queue.getAllPendingAsks()`
- [ ] Check stale messages: Run stale cleaner
- [ ] Check deadlocks: Run deadlock detector
- [ ] Check stuck agents: StuckAgentDetector running?

---

## Common Tasks

### Add Logging
```typescript
import { log } from '../shared/logger.ts';
log.error('mymodule', 'error message', { detail: value });
```

### Use Message Queue
```typescript
import { MessageQueue } from '../queue/index.ts';
const queue = new MessageQueue('.ai/tx/.queue.db');
const msgs = queue.queryMessages({ type: 'task', limit: 10 });
```

### Add Quality Gate
```typescript
import { QualityStack } from '../quality/stack.ts';
const stack = new QualityStack();
stack.add('accuracy', config);
const result = await stack.evaluate(output);
```

### Create Custom Provider
```typescript
import { BaseSearchProvider, type SearchResult } from './base-provider.ts';

export class MyProvider extends BaseSearchProvider {
  async search(query: string): Promise<SearchResult[]> {
    // Implementation
  }
}
```

### Access FSM State
```typescript
import { FSMPersistence } from '../mesh/fsm-persistence.ts';
const persistence = new FSMPersistence(db);
const state = persistence.load(fsmId);
```

---

## File Structure Quick Map

```
src/
├── cli/              (12 command files)
├── core/             (Consumer, Agent, TmuxSession)
├── queue/            (MessageQueue, StaleMessageCleaner, DeadlockDetector)
├── worker/           (Dispatcher, SdkRunner, Hooks, Validator)
├── mesh/             (FSM, Persistence, Evaluator, Scripts)
├── quality/          (Stack, Registry, 6x Evaluators)
├── workspace/        (Manager, Injector, Protocol)
├── server/           (SessionManager, WorkerPool, Quota, RateLimit, Auth)
├── storage/          (LocalProvider, RedisProvider)
├── tools/            (Search, 12x Providers)
├── providers/        (ClaudeProvider)
├── shared/           (Logger, Types, Time, Colors, String, Fib)
├── state-machine/    (StateMachine, Logging, WorkerState)
└── controllers/      (MeshController, WorkspaceController, etc)
```

---

## Import Frequency at a Glance

```
████████████████████████████████████ 38  shared/logger.ts
██████████████████ 18  queue/index.ts
████████████████ 16  shared/types.ts
████████████████ 16  base-provider.ts
███████████  11  types.ts (various)
█████████  9   yaml, path
████████  8   sdk-runner.ts, registry.ts
██████  6   colors.ts, fs/promises, better-sqlite3
█████  5   time.ts, hooks.ts
```

---

## Dependency Health Score: A+

- Circular dependencies: 0 ✓
- Critical imports: 3 (well-managed)
- Max depth: 5 levels (reasonable)
- Bottleneck concentration: shared/ (by design)
- Cross-cutting concerns: properly isolated
- External dependencies: 12 (minimal)

---

## One-Line Summaries

| Module | TL;DR |
|--------|-------|
| CLI | Parses args → calls handlers |
| Core | Starts agent → watches queue → routes messages |
| Consumer | Watches disk → parses YAML → inserts queue |
| Queue | SQLite with messages, sessions, pending_asks |
| Worker | Polls queue → loads mesh → spawns SDK runner → writes response |
| Mesh | Executes FSM with conditions, scripts, aggregation |
| Quality | Stacks evaluators (accuracy, rubric, checklist, etc) |
| Workspace | Manages task directories and prompt injection |
| Server | HTTP API for multi-tenant sessions |
| Storage | Abstraction layer (local or Redis) |
| Tools | Search providers (12x sources) |
| Providers | LLM abstraction (Claude) |
| Shared | Logging, types, utilities |
| Controllers | HTTP route handlers |

---

## Remember

1. **Everything goes through Queue** - it's the spine
2. **Logger is everywhere** - don't break it
3. **No circular deps** - graph is clean
4. **Ephemeral workers** - stateless execution
5. **Event-driven** - file watchers trigger everything
6. **Single SQLite** - Queue and FSM share database
7. **Pluggable gates** - use registry pattern
8. **Multi-tenant ready** - optional server mode

---

**For full details, see**: DEPENDENCY_MAP_INDEX.md

