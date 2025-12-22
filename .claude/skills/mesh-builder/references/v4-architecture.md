# TX V4 Architecture Reference

This document covers the key architectural changes in TX V4 compared to V3.

## SDK-Based Workers

### V3 Approach (Legacy)
```javascript
// V3: Workers ran in tmux sessions
const session = TmuxInjector.createSession(sessionName, 'claude');
TmuxInjector.injectText(session, prompt);
// Poll tmux for output
```

### V4 Approach (Current)
```typescript
// V4: Workers run via Claude Agent SDK
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: userPrompt,
  options: {
    model: 'opus',  // Semantic name
    systemPrompt: agentPrompt,
    permissionMode: 'bypassPermissions',
    maxTurns: 50,
    settingSources: ['project'],  // Load slash commands
  }
});

for await (const msg of q) {
  // Handle streaming messages
}
```

### Key Differences

| Aspect | V3 | V4 |
|--------|----|----|
| Runtime | Tmux session | SDK query() |
| Lifecycle | Persistent until killed | Ephemeral per task |
| Output | Tmux pane capture | AsyncIterator stream |
| Tools | Claude Code native | SDK tool integration |
| Permissions | Interactive | bypassPermissions |

## Message Flow

### V3 Flow
```
File written → Chokidar detects → Inject to tmux → Agent reads
```

### V4 Flow
```
File written → Chokidar detects → SQLite insert → Dispatcher polls → SDK worker spawned
```

## SQLite Queue

V4 introduces a SQLite queue as the central message broker:

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  payload JSON NOT NULL,
  created_at INTEGER,
  delivered_at INTEGER
);
```

### Queue Operations

```typescript
// Insert message
queue.insert({
  from_agent: 'core/core',
  to_agent: 'brain/brain',
  type: 'task',
  payload: { headline: 'Do work', body: '...' }
});

// Poll for messages
const msg = queue.pollOne('brain/brain');

// Mark delivered
queue.markDelivered(msg.id);
```

## Model Resolution

V4 uses semantic model names that resolve to actual model IDs:

```typescript
const MODEL_MAP = {
  opus: 'opus',      // SDK resolves to claude-3-opus
  sonnet: 'sonnet',  // SDK resolves to claude-3-5-sonnet
  haiku: 'haiku',    // SDK resolves to claude-3-haiku
};
```

### Model Selection Guidelines

| Use Case | Model | Reasoning |
|----------|-------|-----------|
| Brain/reasoning | `opus` | Best reasoning, spec-graph operations |
| Development | `sonnet` | Good balance, coding tasks |
| Testing/echo | `haiku` | Fast, cheap, simple tasks |
| Coordination | `sonnet` | Multi-agent orchestration |

## Core Agent (Tmux)

The core agent remains in tmux for HITL:

```typescript
// Core stays in tmux for human interaction
const coreSession = 'core';

// HITL flow:
// 1. Worker writes ask-human to queue
// 2. Core displays to user in tmux
// 3. User responds
// 4. Core writes ask-response back to queue
// 5. Worker receives via polling
```

## Worker Dispatcher

The dispatcher polls the queue and spawns SDK workers:

```typescript
class WorkerDispatcher {
  async dispatch() {
    // Poll for task messages
    const tasks = this.queue.pollTasks();

    for (const task of tasks) {
      // Spawn SDK worker
      const runner = new SdkRunner({
        id: task.to_agent,
        model: this.resolveModel(task),
        systemPrompt: await this.loadPrompt(task.to_agent),
        workDir: process.cwd(),
        msgsDir: '.ai/tx/msgs',
      }, this.queue);

      await runner.run();
    }
  }
}
```

## Slash Command Execution

V4 supports slash command routing via the `command` frontmatter field:

```yaml
---
to: brain/brain
from: core/core
type: task
command: /know:prepare
---
```

The SDK worker receives this and executes the slash command:

```typescript
// In SdkRunner.buildUserPrompt()
if (msg.payload.command) {
  parts.push(msg.payload.command);  // /know:prepare
}
```

This requires `settingSources: ['project']` in the SDK options.

## Directory Structure

```
v4/
├── src/
│   ├── cli/           # CLI commands (start, status, msg, spy, logs, tasks)
│   ├── core/          # Core agent (tmux, consumer, injector)
│   ├── queue/         # SQLite queue
│   ├── worker/        # SDK runner, dispatcher
│   ├── providers/     # Model resolution
│   └── shared/        # Types, logger, colors
├── meshes/
│   ├── brain/         # Brain mesh (know gateway)
│   ├── dev/           # Dev mesh (coding tasks)
│   ├── deep-research/ # Multi-agent research pipeline
│   ├── test/          # Test mesh
│   ├── system/        # System meshes (commit-agent)
│   └── protagents/    # User productivity meshes (meet)
├── test/
│   └── e2e/           # E2E tests
└── .ai/tx/
    ├── msgs/          # Message event log (central)
    ├── data/          # SQLite queue (queue.db)
    ├── logs/          # System logs (v4.jsonl, debug.jsonl, error.jsonl)
    └── sessions/      # Captured worker sessions
```

## Test Infrastructure

V4 uses Node's built-in test runner with a TestHarness:

```typescript
// test/helpers/harness.ts
export class TestHarness {
  queue: MessageQueue;

  async setup() {
    this.queue = new MessageQueue(':memory:');
  }

  async insertMessage(msg: Partial<Message>) {
    this.queue.insert({
      from_agent: msg.from,
      to_agent: msg.to,
      type: msg.type,
      payload: msg.payload || {},
    });
  }

  async runWorker(agentId: string, opts: RunnerOpts) {
    const runner = new SdkRunner({...}, this.queue);
    return runner.run();
  }

  async waitForMessage(predicate: (msg: Message) => boolean) {
    // Poll queue until predicate matches
  }
}
```

## Migration from V3

| V3 Pattern | V4 Equivalent |
|------------|---------------|
| `TmuxInjector.createSession()` | `new SdkRunner().run()` |
| `TmuxInjector.injectText()` | `queue.insert()` |
| `tmux capture-pane` | SDK message stream |
| File watching only | SQLite queue + file watching |
| `tx attach` | Not needed (workers are ephemeral) |

## HITL Protocol

V4 HITL uses the queue for synchronization:

```
1. Worker needs input
   └── Writes ask-human message to queue

2. Core receives ask-human
   └── Displays to user in tmux
   └── User types response
   └── Core writes ask-response to queue

3. Worker polls queue
   └── Receives ask-response
   └── Continues execution
```

### ask-human Trigger

Workers signal HITL by using the AskUserQuestion tool or writing an ask-human message:

```yaml
---
to: core/core
from: dev/worker
type: ask-human
msg-id: hitl-001
headline: Need input
---

What should I do?
```
