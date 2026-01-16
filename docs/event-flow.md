# Event Flow Architecture

TX V4 is an **event-driven** system with clear propagation hierarchy. Events flow from file system changes through consumers, dispatchers, and workers, enabling real-time observability and extensibility.

---

## System Components

### EventEmitter Components

| Component | File | Events Emitted | Events Listened |
|-----------|------|----------------|-----------------|
| **MessageConsumer** | `src/core/consumer.ts` | `core-message`, `worker-message`, `ask-message`, `ask-response-message`, `revision-message`, `parity-reminder` | None |
| **WorkerDispatcher** | `src/worker/dispatcher.ts` | 20+ events (worker:*, fsm:*, quality:*, mesh:*, ensemble:*) | All consumer events |
| **MessageRouter** | `src/worker/message-router.ts` | `spawn-worker`, `revision:*`, `worker:*`, `parity:*` | None |
| **MeshFSM** | `src/mesh/fsm.ts` | `fsm:transition`, `fsm:gate-check`, `fsm:script-run`, `fsm:reset` | None |
| **LifecycleHooks** | `src/worker/hooks.ts` | None (throws errors) | None |
| **StuckAgentDetector** | `src/worker/stuck-detector.ts` | `agent:nudged`, `agent:escalated` | None |
| **EnsembleCoordinator** | `src/worker/ensemble-coordinator.ts` | `ensemble:*` | None |

---

## Event Types & Payloads

### Consumer Events

**core-message** - Message routed to core/core
```typescript
{
  id: number,          // Queue ID
  filepath: string,    // Source file path
  from: string,        // Sender agent ID
  type: string,        // Message type
  event: 'new' | 'revision'
}
```

**worker-message** - Message routed to worker agent
```typescript
{
  id: number,          // Queue ID
  agentId: string,     // Target agent (mesh/agent)
  from: string,        // Sender agent ID
  type: string,        // Message type
  event: 'new' | 'revision'
}
```

**ask-message** - Ask or ask-human request detected
```typescript
{
  id: number,
  filepath: string,
  from: string,        // Agent sending the ask
  to: string,          // Agent being asked
  type: 'ask' | 'ask-human',
  headline?: string,
  msgId?: string
}
```

**ask-response-message** - Response to ask detected
```typescript
{
  id: number,
  filepath: string,
  from: string,        // Agent responding
  to: string,          // Agent receiving response
  content: string,     // Response body
  headline?: string,
  msgId?: string
}
```

**revision-message** - Message file edited (triggers interrupt+resume)
```typescript
{
  filepath: string,
  agentId: string,
  from: string,
  type: string,
  content: string,
  headline?: string
}
```

**parity-reminder** - task-complete blocked due to pending asks
```typescript
{
  agentId: string,
  pendingAsks: Array<{ msgId: string; to: string }>,
  deletedFile: string
}
```

### Dispatcher Events

**Worker Lifecycle:**
| Event | Description | Payload |
|-------|-------------|---------|
| `worker:spawn` | Worker starting | `{ agentId, model }` |
| `worker:start` | Worker started running | `{ agentId, sessionId }` |
| `worker:output` | Worker output chunk | `{ agentId, chunk }` |
| `worker:idle` | Worker idle (polling) | `{ agentId }` |
| `worker:complete` | Worker finished | `{ id, messagesProcessed, output, sessionId, metrics, transitionName, qualityResult }` |
| `worker:error` | Worker error | `{ id, error }` |

**Ask/Response:**
| Event | Description | Payload |
|-------|-------------|---------|
| `worker:await` | Worker waiting for response | `{ workerId, targets, sessionId, type }` |
| `worker:ask-human` | Worker sent ask-human | `{ workerId, target }` |
| `worker:suspended` | Worker killed (ask-human) | `{ agentId, sessionId, reason, targetAgent }` |
| `worker:resume` | Worker resuming | `{ workerId, from, allReceived }` |
| `worker:resuming` | Session being resumed | `{ agentId, sessionId, meshName, agentConfig, runner, machine, resumePrompt }` |
| `worker:resumed` | Worker resumed | `{ agentId, sessionId }` |

**Quality:**
| Event | Description | Payload |
|-------|-------------|---------|
| `quality:pass` | Quality gates passed | `{ agentId, iteration }` |
| `quality:retry` | Quality iteration triggered | `{ agentId, iteration, maxIterations, feedback }` |
| `quality:halt` | Quality halted | `{ agentId, reason }` |
| `quality:exhausted` | Max iterations reached | `{ agentId, maxIterations }` |

**FSM:**
| Event | Description | Payload |
|-------|-------------|---------|
| `fsm:transition` | State transition occurred | `{ meshName, from, to, trigger, triggerAgent, timestamp, durationMs }` |
| `fsm:gate-check` | Gate validation | `{ meshName, state, gate, passed, retryCount, error, timestamp }` |
| `fsm:script-run` | Script executed | `{ meshName, scriptType, scriptPath, success, durationMs, error, timestamp }` |
| `fsm:reset` | FSM reset to initial | `{ meshName }` |

**Mesh:**
| Event | Description | Payload |
|-------|-------------|---------|
| `mesh:loaded` | Mesh config loaded | `{ mesh, agents }` |
| `mesh:invalid` | Mesh config invalid | `{ mesh, error }` |
| `mesh:halt` | Mesh halted (FSM failure) | `{ meshName, reason, error, message }` |

**Ensemble:**
| Event | Description | Payload |
|-------|-------------|---------|
| `ensemble:start` | Parallel execution starting | `{ meshName, state, agents }` |
| `ensemble:agent-complete` | Agent in ensemble completed | `{ meshName, agentId }` |
| `ensemble:complete` | All ensemble agents done | `{ meshName, state }` |

**Agent Health:**
| Event | Description | Payload |
|-------|-------------|---------|
| `agent:nudged` | Stuck agent nudged | `{ agentId, duration }` |
| `agent:escalated` | Stuck agent escalated | `{ agentId, duration }` |
| `session-start` | New session started | `{ agentId }` |

### Router Events

| Event | Description | Payload |
|-------|-------------|---------|
| `spawn-worker` | Worker spawn requested | `{ meshName, agent, meshConfig }` |
| `revision:interrupt` | Session interrupted for revision | `{ agentId, sessionId, headline }` |
| `revision:complete` | Revision processing done | `{ agentId, sessionId, success }` |
| `revision:error` | Revision failed | `{ agentId, sessionId?, error }` |
| `parity:interrupt` | Session interrupted for parity | `{ agentId, sessionId, pendingAsks }` |
| `parity:resume` | Session resumed after parity | `{ agentId, sessionId, success }` |
| `parity:error` | Parity handling failed | `{ agentId, sessionId?, error }` |

---

## Flow Sequences

### Flow A: Basic Task Message

```
User writes task message
    |
[CONSUMER] File watcher (chokidar) detects .md file
    |
[CONSUMER] Parse frontmatter, validate FSM
    |
[CONSUMER] Insert into SQLite queue
    |
[CONSUMER] emit('worker-message')
    |
[DISPATCHER] Receives event
    |
[DISPATCHER] Load mesh config
    |
[DISPATCHER] emit('worker:spawn')
    |
[DISPATCHER] Create SdkRunner + WorkerStateMachine
    |
[RUNNER] emit('start') -> dispatcher emits 'worker:start'
[RUNNER] emit('output') -> dispatcher emits 'worker:output'
[RUNNER] emit('idle') -> dispatcher emits 'worker:idle'
    |
[RUNNER] Worker writes task-complete
    |
[RUNNER] emit('complete')
    |
[DISPATCHER] Execute post-hooks
    |
[DISPATCHER] emit('worker:complete')
    |
[CONSUMER] Detects task-complete
    |
[CONSUMER] emit('core-message')
    |
[CORE] Processes result
```

### Flow B: Ask/Ask-Response

```
[WORKER] Writes ask message
    |
[CONSUMER] Detects ask
    |
[CONSUMER] Track in parity gate: trackPendingAsk()
    |
[CONSUMER] emit('ask-message')
    |
[DISPATCHER/ROUTER] handleAskMessage()
    |
IF ask-human:
    [ROUTER] handleAskHuman()
    [ROUTER] runner.kill()
    [ROUTER] emit('worker:suspended')
ELSE:
    [ROUTER] machine.enterAwait()
    [ROUTER] emit('worker:await')
    |
[User/Agent] Writes ask-response
    |
[CONSUMER] Detects ask-response
    |
[CONSUMER] resolvePendingAsk()
    |
[CONSUMER] emit('ask-response-message')
    |
[DISPATCHER/ROUTER] handleAskResponse()
    |
IF suspended:
    [ROUTER] resumeSuspendedSession()
    [ROUTER] emit('worker:resuming')
    [ROUTER] emit('worker:resumed')
ELSE:
    [ROUTER] machine.receiveResponse()
    [ROUTER] resumeAfterAllResponses()
    [ROUTER] emit('worker:resume')
```

### Flow C: FSM State Transition

```
[WORKER] Sends message
    |
[CONSUMER] Validate with FSM
    |
[FSM] Get current state config
    |
[FSM] Execute exit.set operations
    |
[FSM] Check exit.gates
    |
IF gate fails:
    [FSM] emit('fsm:gate-check', { passed: false })
    [FSM] Return false (block message)
    |
[FSM] Evaluate exit routing
    |
[FSM] Validate agent routing
    |
IF valid:
    [FSM] Run onExit script
    [FSM] Update state in persistence
    [FSM] emit('fsm:transition')
    [FSM] Run onEnter script
    [FSM] Return true (allow message)
ELSE:
    [FSM] Return false (reject)
```

### Flow D: Quality Iteration

```
[DISPATCHER] Worker completes
    |
[HOOKS] executePostHooks(['quality:evaluate'])
    |
[HOOKS] Run quality gates
    |
IF all pass:
    [DISPATCHER] emit('quality:pass')
    [DISPATCHER] Continue to completion
    |
ELSE IF onFail === 'loop' AND iteration < max:
    [HOOKS] Throw QualityIterationError
    [DISPATCHER] Catch error
    [DISPATCHER] emit('quality:retry')
    [DISPATCHER] Write feedback message
    [DISPATCHER] Increment iteration
    [DISPATCHER] runner.resume(sessionId, feedback)
    Loop back
    |
ELSE:
    [HOOKS] Throw QualityExhaustedError
    [DISPATCHER] emit('quality:exhausted')
    [DISPATCHER] Complete anyway
```

---

## Event Propagation Hierarchy

```
+-------------------------------------------------------------+
|                    File System Events                        |
|              (chokidar watches .ai/tx/msgs/)                 |
+--------------------------+----------------------------------+
                           |
                           v
          +--------------------------------+
          |       MessageConsumer          |
          |       (EventEmitter)           |
          |                                |
          | Emits:                         |
          |  - core-message                |
          |  - worker-message              |
          |  - ask-message                 |
          |  - ask-response-message        |
          |  - revision-message            |
          |  - parity-reminder             |
          +--------+-----------------------+
                   |
           +-------+---------------------------+
           |                                   |
           v                                   v
      core/core                          WorkerDispatcher
      (system)                          (EventEmitter)
      processes                              |
      results                                |
                                             v
                      +----------------------------------+
                      | Emits 20+ events:                |
                      |  - worker:* (lifecycle)          |
                      |  - quality:* (iteration)         |
                      |  - fsm:* (transitions)           |
                      |  - ensemble:* (parallel)         |
                      |  - mesh:* (config)               |
                      +--------+-------------------------+
                               |
                      +--------+------------+
                      |                     |
                      v                     v
              MessageRouter          SdkRunner
              (handles routing)      (spawns workers)
              |                      |
              | Emits:               | Emits:
              | - spawn-worker       | - start
              | - worker:await       | - output
              | - worker:resume      | - idle
              | - revision:*         | - complete
              | - parity:*           | - error
              |                      |
              v                      v
          MeshFSM              Worker Process
          (validates)          (Claude API)
          |                    |
          | Emits:             | Writes messages
          | - fsm:transition   | back to msgs dir
          | - fsm:gate-check   | (loops back)
          | - fsm:script-run   |
          | - fsm:reset        |
```

---

## Event Subscription Examples

### Monitor Worker Lifecycle

```typescript
import { WorkerDispatcher } from './src/worker/dispatcher.ts';

const dispatcher = new WorkerDispatcher(config, queue);

dispatcher.on('worker:spawn', (event) => {
  console.log(`Worker spawning: ${event.agentId} (${event.model})`);
});

dispatcher.on('worker:start', (event) => {
  console.log(`Worker started: ${event.agentId}`);
  console.log(`  Session: ${event.sessionId?.slice(0, 8)}...`);
});

dispatcher.on('worker:complete', (event) => {
  console.log(`Worker complete: ${event.id}`);
  console.log(`  Messages: ${event.messagesProcessed}`);
  console.log(`  Output: ${event.output.slice(0, 100)}...`);
});

dispatcher.on('worker:error', (event) => {
  console.error(`Worker error: ${event.id}`);
  console.error(`  Error: ${event.error}`);
});
```

### Monitor FSM Transitions

```typescript
dispatcher.on('fsm:transition', (event) => {
  console.log(`FSM: ${event.meshName}`);
  console.log(`  ${event.from} -> ${event.to}`);
  console.log(`  Trigger: ${event.trigger} by ${event.triggerAgent}`);
  console.log(`  Duration: ${event.durationMs}ms`);
});

dispatcher.on('fsm:gate-check', (event) => {
  const status = event.passed ? 'PASS' : 'FAIL';
  console.log(`Gate ${status}: ${event.gate.script}`);
  if (!event.passed) {
    console.log(`  Retry: ${event.retryCount}/3`);
  }
});

dispatcher.on('fsm:script-run', (event) => {
  const status = event.success ? 'OK' : 'ERROR';
  console.log(`Script ${status}: ${event.scriptPath}`);
  console.log(`  Type: ${event.scriptType}`);
  console.log(`  Duration: ${event.durationMs}ms`);
});
```

### Monitor Quality Iteration

```typescript
dispatcher.on('quality:retry', (event) => {
  console.log(`Quality retry: ${event.agentId}`);
  console.log(`  Iteration: ${event.iteration}/${event.maxIterations}`);
  console.log(`  Feedback: ${event.feedback.slice(0, 200)}...`);
});

dispatcher.on('quality:pass', (event) => {
  console.log(`Quality passed: ${event.agentId}`);
  console.log(`  Iteration: ${event.iteration}`);
});

dispatcher.on('quality:exhausted', (event) => {
  console.warn(`Quality exhausted: ${event.agentId}`);
  console.warn(`  Max iterations: ${event.maxIterations}`);
});
```

### Monitor Ask/Response Flow

```typescript
dispatcher.on('worker:await', (event) => {
  console.log(`Worker awaiting: ${event.workerId}`);
  console.log(`  Targets: ${event.targets.join(', ')}`);
  console.log(`  Type: ${event.type}`);
});

dispatcher.on('worker:suspended', (event) => {
  console.log(`Worker suspended: ${event.agentId}`);
  console.log(`  Reason: ${event.reason}`);
  console.log(`  Session: ${event.sessionId.slice(0, 8)}...`);
});

dispatcher.on('worker:resumed', (event) => {
  console.log(`Worker resumed: ${event.agentId}`);
  console.log(`  Session: ${event.sessionId.slice(0, 8)}...`);
});
```

### Monitor Ensemble Execution

```typescript
dispatcher.on('ensemble:start', (event) => {
  console.log(`Ensemble starting: ${event.meshName}`);
  console.log(`  State: ${event.state}`);
  console.log(`  Agents: ${event.agents.join(', ')}`);
});

dispatcher.on('ensemble:agent-complete', (event) => {
  console.log(`Ensemble agent done: ${event.agentId}`);
});

dispatcher.on('ensemble:complete', (event) => {
  console.log(`Ensemble complete: ${event.meshName}`);
  console.log(`  State: ${event.state}`);
});
```

---

## Debugging Events

### Live Event Spy

```bash
tx spy  # Real-time event monitoring
```

**Watches:**
- Consumer events
- Dispatcher events
- FSM events
- Message router events

### Log File Analysis

```bash
# View all events from log
cat .ai/tx/logs/v4.jsonl | jq 'select(.event != null)'

# Filter by event type
cat .ai/tx/logs/v4.jsonl | jq 'select(.event == "worker:complete")'

# Filter by agent
cat .ai/tx/logs/v4.jsonl | jq 'select(.agentId == "brain/worker")'

# View last run
cat .ai/tx/logs/v4.last.jsonl
```

### Custom Event Listeners

For external integrations, subscribe to dispatcher events:

```typescript
import { EventEmitter } from 'node:events';

// Create custom listener
const monitor = new EventEmitter();

// Forward events to external system
dispatcher.on('worker:complete', (event) => {
  sendToMonitoringService({
    type: 'agent_complete',
    agent: event.id,
    messages: event.messagesProcessed,
    timestamp: Date.now()
  });
});

dispatcher.on('quality:exhausted', (event) => {
  sendAlert({
    level: 'warning',
    message: `Quality exhausted for ${event.agentId}`,
    maxIterations: event.maxIterations
  });
});
```

---

## Files Reference

| Component | File | Key Lines |
|-----------|------|-----------|
| **Consumer** | `src/core/consumer.ts` | EventEmitter @ L11, events @ L460-661 |
| **Dispatcher** | `src/worker/dispatcher.ts` | EventEmitter @ L206, events throughout |
| **Message Router** | `src/worker/message-router.ts` | EventEmitter @ L55 |
| **FSM** | `src/mesh/fsm.ts` | EventEmitter @ L123, events @ L42-92 |
| **Event Types** | `src/worker/types.ts` | L160-259 |
| **FSM Event Types** | `src/mesh/fsm.ts` | L42-121 |

---

## Summary

TX V4 event system:
- **Event-driven architecture** - No polling, pure event propagation
- **Clear hierarchy** - Consumer -> Dispatcher -> Router -> FSM -> Worker
- **20+ event types** - Full observability into system behavior
- **Multiple flow patterns** - Basic tasks, ask/response, FSM transitions, quality loops
- **Extensible** - Custom event listeners for external integrations
- **Debuggable** - Live spy mode + structured JSON logs
