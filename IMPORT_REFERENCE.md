# TX-Core Import Reference

## Quick Import Guide

This document lists the most commonly imported modules and how they're used.

---

## Critical Imports (Used Everywhere)

### 1. Shared Logger (38 imports)
**Import**: `shared/logger.ts`
**Used By**: Every production module
**Pattern**:
```typescript
import { log } from '../shared/logger.ts';

// Usage
log.info('component', 'message', { context });
log.error('component', 'error message', { details });
log.warn('component', 'warning', { data });
log.debug('component', 'debug info', { verbose });
```
**Output**: Structured JSONL → `.ai/tx/logs/v4.jsonl`

**Files Using This**:
- All CLI commands
- Core, Consumer, Agent
- Worker, Dispatcher, SdkRunner
- Queue, FSM, Quality gates
- Controllers, Workspace

---

### 2. Shared Types (16 imports)
**Import**: `shared/types.ts`
**Used By**: Worker, Mesh, Quality, Workspace, Providers
**Key Types**:
```typescript
// Message types
Message, MessageType, MessagePayload, MessageStatus

// Agent config
AgentConfig, AgentStatus, SemanticModel

// State machine
FSMConfig, FSMStateConfig, FSMEnsembleConfig

// Ensemble
EnsembleConfig, TaskDistributionConfig, AggregationStrategy

// Results
WorkerResult, QueryMetrics, WorkerMetrics
```

---

### 3. Message Queue (18 imports)
**Import**: `queue/index.ts`
**Used By**: Core, Dispatcher, Consumer, Workers
**Interface**:
```typescript
import { MessageQueue, type Message } from '../queue/index.ts';

// Create
const queue = new MessageQueue(dbPath);

// Insert
queue.insert({
  from_agent: 'core/core',
  to_agent: 'mesh/agent',
  type: 'task',
  payload: { /* ... */ }
});

// Poll (consume)
const messages = queue.poll('mesh/agent');

// Query
const filtered = queue.queryMessages({
  type: 'task-complete',
  limit: 50
});
```

**Also Exports**:
- `StaleMessageCleaner` - Removes old messages
- `DeadlockDetector` - Circular dependency detection
- `FSMPersistence` - FSM state storage (shares DB)

---

## Execution Path Imports

### Worker Execution Chain

#### 4. Worker Dispatcher (5 files depend on it)
**Import**: `worker/dispatcher.ts`
**Main Class**: `WorkerDispatcher`
**Responsibilities**:
- Poll queue for worker messages
- Load mesh configuration
- Spawn SdkRunner with task
- Apply quality gates
- Execute FSM transitions

**Key Dependencies**:
```typescript
import { MessageQueue } from '../queue/index.ts';
import { SdkRunner } from './sdk-runner.ts';
import { MeshValidator } from './mesh-validator.ts';
import { MeshManager } from './mesh-manager.ts';
import { PromptInjector } from '../workspace/injector.ts';
import { QualityStack } from '../quality/stack.ts';
import { MeshFSM } from '../mesh/index.ts';
import { EnsembleCoordinator } from './ensemble-coordinator.ts';
```

---

#### 5. SDK Runner (8 imports)
**Import**: `worker/sdk-runner.ts`
**Main Class**: `SdkRunner`
**Wraps**: Claude Agent SDK for conversation management
**Key Methods**:
```typescript
import { SdkRunner, type SdkRunnerConfig } from './sdk-runner.ts';

const runner = new SdkRunner(config);

// Start agent with Claude SDK
await runner.query(prompt);

// Stream responses
runner.on('message', (msg) => { /* ... */ });
runner.on('tool-result', (result) => { /* ... */ });
```

**Dependencies**:
```typescript
import { query, type SDKResultMessage, type McpServerConfig }
  from '@anthropic-ai/claude-agent-sdk';
import { MessageQueue } from '../queue/index.ts';
```

---

### File Watcher Path

#### 6. Core Consumer (3 imports)
**Import**: `core/consumer.ts`
**Main Class**: `MessageConsumer`
**Watches**: `.ai/tx/msgs/` directory
**Emits**: `core-message`, `worker-message` events

```typescript
import { MessageConsumer } from '../core/consumer.ts';

const consumer = new MessageConsumer(queue, workDir);

consumer.on('core-message', (event) => {
  // Handle core agent message
});

consumer.on('worker-message', (event) => {
  // Dispatcher handles this
});
```

**Dependencies**:
```typescript
import { watch } from 'chokidar';      // File watcher
import YAML from 'yaml';                // Parse frontmatter
import { MessageQueue } from '../queue/index.ts';
```

---

## Configuration & Validation

#### 7. Mesh Validator (3 imports)
**Import**: `worker/mesh-validator.ts`
**Main Class**: `MeshValidator`
**Validates**: Mesh YAML configuration

```typescript
import { MeshValidator, type MeshConfigSchema, type ValidationResult }
  from './mesh-validator.ts';

const validator = new MeshValidator();
const result = await validator.validate(configPath, strict);

if (!result.valid) {
  console.log(result.errors);
}
```

---

#### 8. Mesh Manager (1 file depends on it)
**Import**: `worker/mesh-manager.ts`
**Main Class**: `MeshManager`
**Loads**: Mesh configuration and agent definitions

```typescript
import { MeshManager } from './mesh-manager.ts';

const manager = new MeshManager(workDir);
const meshConfig = await manager.load(meshName);
```

---

## State Management & FSM

#### 9. FSM Modules (mesh/ directory)
**Main Import**: `mesh/index.ts`

```typescript
import { MeshFSM } from '../mesh/index.ts';
import { FSMPersistence } from '../mesh/fsm-persistence.ts';
import { ConditionEvaluator } from '../mesh/fsm-evaluator.ts';

// FSM execution
const fsm = new MeshFSM(config, db);
await fsm.transition(fromState, toState, context);

// With persistence (shares DB with queue)
const persistence = new FSMPersistence(db);
const state = persistence.load(fsm.id);
```

**Sub-modules**:
- `fsm.ts` - Main FSM engine
- `fsm-persistence.ts` - SQLite state storage
- `fsm-evaluator.ts` - Condition evaluation
- `fsm-expression.ts` - Expression parsing
- `fsm-scripts.ts` - Script execution
- `aggregation.ts` - Ensemble aggregation
- `distribution.ts` - Task distribution

---

## Quality Gates & Validation

#### 10. Quality Registry (4 imports)
**Import**: `quality/registry.ts`
**Main**: `QualityStack`, gate registry

```typescript
import { QualityStack } from '../quality/stack.ts';
import { evaluateGates, type GateType } from '../quality/registry.ts';

// Get evaluator
const evaluator = registry.get('accuracy');

// Stack gates
const stack = new QualityStack();
stack.add('accuracy', config)
     .add('rubric', config)
     .add('checklist', config);

// Evaluate
const results = await stack.evaluate(output);
```

**Available Gates**:
- `accuracy` - LLM-based accuracy scoring
- `rubric` - Grade against rubric
- `checklist` - Task completion checklist
- `adversarial` - Adversarial evaluation
- `deterministic` - Logic-based rules
- `summarizer` - Response summarization

---

## Context & Prompt Injection

#### 11. Workspace Injector (2 imports)
**Import**: `workspace/index.ts` or `workspace/injector.ts`

```typescript
import { PromptInjector, type FSMInjectionContext }
  from '../workspace/injector.ts';

const injector = new PromptInjector(workDir);

// Inject task context into prompt
const context: FSMInjectionContext = {
  task: { /* task details */ },
  fsm: { /* FSM state */ },
  /* ... */
};

const enhanced = await injector.inject(prompt, context);
```

---

#### 12. Workspace Manager (1 import)
**Import**: `workspace/manager.ts`

```typescript
import { WorkspaceManager, normalizeWorkspaceConfig }
  from '../workspace/manager.ts';

const manager = new WorkspaceManager(config);
const workspace = await manager.create(taskId);
await manager.cleanup(taskId);
```

---

## Storage & Persistence

#### 13. Storage Provider (3 imports)
**Import**: `storage/index.ts`

```typescript
import type { StorageProvider } from '../storage/index.ts';
import { LocalStorageProvider } from '../storage/local-provider.ts';
import { RedisStorageProvider } from '../storage/redis-provider.ts';

// Local (development)
const local = new LocalStorageProvider(baseDir);

// Redis (production)
const redis = new RedisStorageProvider(redisUrl);

// Interface
interface StorageProvider {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
```

---

## HTTP Server & Multi-Tenant

#### 14. Server Components (5 imports)
**Import**: `server/index.ts`

```typescript
import {
  SessionManager,
  WorkerPool,
  QuotaManager,
  RateLimiter,
  AuthHandler
} from '../server/index.ts';

// Create server
const server = createHttpServer({
  sessionManager: new SessionManager(storage),
  workerPool: new WorkerPool(config),
  quotaManager: new QuotaManager(storage),
  rateLimiter: new RateLimiter(config),
  auth: new AuthHandler(secrets)
});

await server.listen(port, host);
```

---

## Tools & Search

#### 15. Search Registry (8 imports in tools/)
**Import**: `tools/search/provider-registry.ts`

```typescript
import { registry, getProvider } from './provider-registry.ts';

// List available
const providers = registry.list();

// Get specific
const github = registry.get('github');

// Search
const results = await github.search('typescript types');

// Health check
const status = await registry.checkHealth('github');
```

**Providers**:
- stackoverflow, github, arxiv, wikipedia, youtube
- brave, duckduckgo, pubmed, semanticscholar
- crossref, devto, hackernews

---

## Utilities & Helpers

#### 16. Shared Utilities (in shared/)

**Time Utilities**:
```typescript
import { formatDuration, elapsed } from '../shared/time.ts';

console.log(formatDuration(5000));  // "5s"
console.log(elapsed(startTime));   // "2s ago"
```

**Color Utilities**:
```typescript
import { colors } from '../shared/colors.ts';

console.log(colors.green('Success!'));
console.log(colors.red('Error!'));
```

**String Utilities**:
```typescript
import { truncate, capitalize } from '../shared/string.ts';

const short = truncate(long, 50);
const title = capitalize('hello'); // "Hello"
```

---

## External NPM Imports

### Most Used External Packages

| Package | Purpose | Files |
|---------|---------|-------|
| `yaml` | Parse/stringify YAML | Core, Worker, Mesh (9 imports) |
| `better-sqlite3` | SQLite wrapper | Queue, FSM (6 imports) |
| `chokidar` | File watcher | Consumer, CLI (4 imports) |
| `@anthropic-ai/claude-agent-sdk` | Claude conversation | Worker (3 imports) |
| `ioredis` | Redis client | Storage (optional) |
| `ws` | WebSocket server | Server |
| `dotenv` | Environment loading | CLI |

### Node.js Built-ins

| Module | Usage |
|--------|-------|
| `fs`, `fs/promises` | File I/O (6 imports) |
| `path` | Path utilities (9 imports) |
| `crypto` | Random IDs, encryption |
| `events` | EventEmitter |
| `child_process` | Shell execution |
| `http`, `https` | HTTP requests |

---

## Import Patterns by Module

### CLI Module Pattern
```typescript
import { log } from '../shared/logger.ts';
import { startCore } from './start.ts';
import { startServer } from './server.ts';
import { showStatus } from './status.ts';
// Each command is self-contained submodule
```

### Worker Module Pattern
```typescript
import { MessageQueue } from '../queue/index.ts';
import { SdkRunner } from './sdk-runner.ts';
import { MeshValidator } from './mesh-validator.ts';
import { PromptInjector } from '../workspace/injector.ts';
import { QualityStack } from '../quality/stack.ts';
import { MeshFSM } from '../mesh/index.ts';
// Heavy orchestration dependencies
```

### Quality Module Pattern
```typescript
import type { EvalResult, GateType } from './types.ts';
import { BaseEvaluator } from './base.ts';
// Each gate inherits from base, self-contained
```

### Search Module Pattern
```typescript
import { BaseSearchProvider, type SearchResult } from './base-provider.ts';
// Each provider inherits from base
```

---

## Finding Imports in Your Module

To find what a specific file imports:

```bash
# Search imports in a file
grep "^import" src/worker/dispatcher.ts

# Find all imports of a module
grep -r "from.*shared/logger" src --include="*.ts"

# Find what imports a specific module
grep -r "from.*queue/index" src --include="*.ts"

# Count import frequency
grep -rh "^import.*from\|^export.*from" src --include="*.ts" | \
  sed "s/.*from ['\"]//;s/['\"].*//" | \
  sort | uniq -c | sort -rn
```

---

## Module Import Dependencies at a Glance

```
shared/logger ──────────────┐
                            │
                    (38 files depend)
                            │
                            ▼
        ┌──────────────────────────────────┐
        │  Every Production Module Uses    │
        │  For Structured Logging (JSONL)  │
        └──────────────────────────────────┘

shared/types ───────────────┐
                            │
                    (16 files depend)
                            │
                            ▼
        ┌──────────────────────────────────┐
        │ Centralized Type Definitions     │
        │ Message, Config, FSM, Ensemble   │
        └──────────────────────────────────┘

queue/index ────────────────┐
                            │
                    (18 files depend)
                            │
                            ▼
        ┌──────────────────────────────────┐
        │ SQLite Queue & Persistence       │
        │ Messages, Sessions, Pending Asks │
        └──────────────────────────────────┘
```

---

## Testing & Development Imports

For test files (`.test.ts`):
```typescript
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { MessageQueue } from '../queue/index.ts';
```

---

## Quick Reference Table

| What I Need | Import | File |
|------------|--------|------|
| Logging | `import { log }` | `shared/logger.ts` |
| Types | `import type { Message }` | `shared/types.ts` |
| Message Queue | `import { MessageQueue }` | `queue/index.ts` |
| Worker Dispatch | `import { WorkerDispatcher }` | `worker/dispatcher.ts` |
| SDK Runner | `import { SdkRunner }` | `worker/sdk-runner.ts` |
| FSM Engine | `import { MeshFSM }` | `mesh/index.ts` |
| Quality Gates | `import { QualityStack }` | `quality/stack.ts` |
| Prompt Context | `import { PromptInjector }` | `workspace/injector.ts` |
| File Watching | `import { MessageConsumer }` | `core/consumer.ts` |
| Session Mgmt | `import { SessionManager }` | `server/session-manager.ts` |
| Search | `import { registry }` | `tools/search/provider-registry.ts` |
| Storage | `import type { StorageProvider }` | `storage/index.ts` |
| Config | `import { MeshValidator }` | `worker/mesh-validator.ts` |
| Time Utils | `import { formatDuration }` | `shared/time.ts` |
| Colors | `import { colors }` | `shared/colors.ts` |

