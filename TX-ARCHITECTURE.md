# TX CLI: Message Delivery & Agent Spawning Architecture

## Executive Summary

TX is a distributed agentic system where agents communicate through a **centralized event log** (`.ai/tx/msgs/`). The architecture separates concerns into:
- **Message Delivery**: File watcher → Queue → TmuxInjector
- **Agent Spawning**: SpawnHandler detects spawn requests in messages
- **Session Monitoring**: Status/Health checks monitor active sessions and idle agents
- **Robustness**: RetryQueue handles transient failures with exponential backoff

---

## 1. MESSAGE DELIVERY SYSTEM

### 1.1 Architecture Overview

```
Message Created
    ↓
File Watcher (chokidar)
    ↓
EventBus.emit('file:msgs:new')
    ↓
Queue.handleNewMessage()
    ↓
Queue.routeMessage()
    ↓
TmuxInjector.injectFile()
    ↓
Injection Queue (FIFO per-session)
    ↓
TmuxInjector.waitForIdle() → Inject
    ↓
EventLogConsumer.processMessage() [Parallel]
```

### 1.2 Key Files

| File | Purpose | Key Responsibility |
|------|---------|-------------------|
| `lib/watcher.js` | File system monitoring | Detects new messages in `.ai/tx/msgs/` |
| `lib/queue.js` | Message routing | Routes messages to correct session |
| `lib/tmux-injector.js` | Session injection | Injects files into tmux panes with queueing |
| `lib/event-log-consumer.js` | Agent-side consumption | Alternative parallel delivery path |
| `lib/retry-queue.js` | Failure handling | Retries failed injections with backoff |

### 1.3 Message Filename Format

**Centralized event log** (`.ai/tx/msgs/`):
```
{MMDDHHMMSS}-{type}-{from}>{to}-{msgId}.md
                     ↑      ↑
                   Source  Destination

Example: 1102083000-task-core>interviewer-abc123.md
```

**Frontmatter** (YAML):
```yaml
---
to: research-807055/interviewer
from: core/core
type: task
status: start
msg-id: abc123
timestamp: 2024-11-02T08:30:00.000Z
---

[Message Content]
```

---

## 2. MESSAGE INJECTION FLOW

### 2.1 Queue Path (Primary Route)

**File: `lib/queue.js`**

```javascript
Queue.handleNewMessage() 
  → Validates message exists
  → Parses message metadata (from/to/type)
  → Calls Queue.routeMessage()
    → Validates routing (optional)
    → Gets destination session via Queue.getDestinationSession()
    → Checks TmuxInjector.sessionExists()
      ✗ Not found → RetryQueue.enqueue() (if enabled)
      ✓ Found → TmuxInjector.injectFile(session, filepath, isPrompt)
      ✓ Success → Queue.recordMessageDelivery() (if enabled)
      ✗ Failed → RetryQueue.enqueue()
```

**Key logic** (lines 241-297):
- Session name resolution handles: `core`, `mesh/agent`, `mesh-uuid-agent`
- Retries go to `RetryQueue` if session doesn't exist yet
- Optional delivery tracking prevents re-injection

### 2.2 EventLogConsumer Path (Parallel Route)

**File: `lib/event-log-consumer.js`**

Per-agent consumer that:
1. Watches `.ai/tx/msgs/` directly
2. Filters messages addressed to this specific agent
3. Tracks offset (last processed timestamp) to prevent duplicates
4. Injects via `TmuxInjector.injectFile()`

**Key features**:
- **Offset tracking** (`.ai/tx/state/offsets/{agentId}.json`): Ensures chronological order and no duplicates
- **Self-modify handling**: Injects self-modify instructions before message
- **Lens application**: Wraps message with specified perspective
- **Clear-before**: Can reset agent before task delivery

**Processing** (lines 161-236):
```javascript
EventLogConsumer.processMessage()
  → Check if ask-human message → Notify user
  → Check if task with clear-before → Reset session
  → Check for self-modify → Inject instructions
  → Check for lens → Apply perspective
  → TmuxInjector.injectFile(sessionName, filepath, isPrompt)
  → Update offset to prevent reprocessing
```

### 2.3 Message Injection Queue (TmuxInjector)

**File: `lib/tmux-injector.js` (lines 6-177)**

Each session has its own FIFO queue:

```javascript
TmuxInjector.injectionQueues = Map<sessionName, {
  queue: [], 
  processing: false,
  sequenceNumber: 0
}>
```

**Queueing logic** (lines 75-106):
```
injectFile() → _enqueueInjection()
  → Add to queueState.queue
  → If not processing: _processInjectionQueue()
    → Mark processing=true
    → Execute injection (_doInjectFile)
    → Wait for idle (2s no output, max 60s)
    → Mark processing=false
    → Process next in queue (recursive)
```

**Idle detection** (lines 463-505):
- Polls session pane output every 200ms
- Compares normalized output (strips animated content like "Thinking…")
- Returns true when output stable for `idleTime` (default 2s)
- Times out after 60 seconds

---

## 3. AGENT SPAWNING ARCHITECTURE

### 3.1 Spawn Detection Flow

**File: `lib/spawn-handler.js`**

1. SpawnHandler listens to `EventBus.on('file:msgs:new')` with priority 5
2. When message arrives, extracts rearmatter YAML from message body
3. If rearmatter contains `spawn:` field, triggers spawn process

```javascript
SpawnHandler.handleNewMessage()
  → Extract rearmatter from message
  → If spawn field exists:
    → SpawnHandler.processSpawn()
      → Call spawnMesh() with config
      → Save parent_agent to child state
      → Notify parent agent
      → Record spawn event to evidence log
```

**Rearmatter format** (in message content):
```yaml
---
spawn:
  mesh: research
  reason: "analyze competitor strategy"
  context: "User wants to understand market positioning"
  lens: [strategic, competitive]
  priority: high
entity_refs: [entity1, entity2]
---
```

### 3.2 Spawn Command (`lib/commands/spawn.js`)

**Session creation** (lines 280-403):

```
spawnSingleAgent()
  → Validate agent config exists
  → Initialize directories
  → Clean orphaned messages
  → Create tmux session
  → Start Claude with: `claude --dangerously-skip-permissions`
  → Wait for Claude ready (check for "⏵⏵ bypass permissions on")
  → Inject model config (if specified)
  → Build prompt via PromptBuilder
  → Write prompt to event log
  → Update mesh state to 'active'
```

**Key timing**:
- Base 30s timeout + 15s per agent
- Waits for Claude to show "⏵⏵ bypass permissions on" before proceeding
- Injects prompt as `{MMDDHHMMSS}-prompt-system>{agent}-{msgId}.md`

### 3.3 Session Name Convention

| Scenario | Session Name |
|----------|--------------|
| Core agent | `core` |
| Persistent mesh (mesh==agent) | `{mesh}` |
| Regular mesh with agent | `{mesh}-{uuid}-{agent}` |

Example: `research-807055-interviewer`

---

## 4. SESSION MONITORING & HEALTH

### 4.1 Status Command (`lib/commands/status.js`)

**Agent idle detection** (lines 74-90):

```javascript
isAgentIdle(lastActivity):
  - Idle threshold: 2 minutes (120s)
  - Returns true if: now - lastActivity > 120000ms
  - Detects from message activity in event log
```

**Status display**:
```
📦 research-807055
   🟢 interviewer: Extract key findings (active 23s ago)
   💤 analyst: idle

📦 core
   🟢 core: Processing queue
```

### 4.2 Health Check (`lib/commands/health.js`)

**System health metrics** (lines 229-281):

```
Health Data Collected:
  ✓ Event log directory exists & message count
  ✓ Active tmux sessions (via tmux list-sessions)
  ✓ Session capture directory count
  ✓ Debug/error log files exist
  ✓ Recent errors (last hour)
  ✓ Retry queue status (pending retries)
  
Status Determination:
  - healthy: No issues, logs exist, sessions active
  - degraded: Some issues (few errors, high retry queue)
  - unhealthy: Missing logs or critical issues
```

**Retry queue monitoring** (line 240):
```javascript
RetryQueue.getStatus() → {
  total: number,
  bySession: { session: count },
  oldestRetry: timestamp
}
```

### 4.3 Session Existence Checks

**Three mechanisms**:

1. **TmuxInjector.sessionExists()** (lines 312-321):
   ```bash
   tmux list-sessions -F '#{session_name}' | grep -q '^{session}$'
   ```

2. **TmuxInjector.isUserTyping()** (lines 532-560):
   - Captures pane content twice with 500ms delay
   - Returns true if content changed (user typing)
   - Used by RetryQueue to avoid interrupting user

3. **TmuxInjector.claudeReadyCheck()** (lines 409-457):
   - Looks for "⏵⏵ bypass permissions on" pattern
   - Returns gates: `initial-config`, `bypass-permissions`, `ready`

---

## 5. ROBUSTNESS FEATURES

### 5.1 Retry Queue (`lib/retry-queue.js`)

**Triggered when**:
- Session not found (session-not-found)
- Injection failed (injection-failed)
- User actively typing (user-typing)

**Configuration**:
```javascript
{
  retryInterval: 10000,      // Check every 10 seconds
  maxAttempts: 20,           // ~3 minutes total
  initialBackoff: 5000,      // 5s before first retry
  maxBackoff: 30000,         // Max 30s between retries
  userTypingThreshold: 3000  // Wait if user typed recently
}
```

**Exponential backoff**:
```
Attempt 1: 5s
Attempt 2: 10s (5 * 2^1)
Attempt 3: 20s (5 * 2^2)
Attempt 4+: 30s (capped)
```

**Persistent storage** (`.ai/tx/state/retry-queue.json`):
```json
{
  "session-{msgId}-{timestamp}": {
    "session": "research-interviewer",
    "filepath": ".ai/tx/msgs/1102083000-task-...",
    "attempts": 2,
    "nextRetry": 1735689015000,
    "reason": "session-not-found"
  }
}
```

### 5.2 Queue-Level Error Handling

**File: `lib/queue.js` (lines 248-284)**

```javascript
if (!TmuxInjector.sessionExists(sessionName)) {
  // Session not ready yet
  if (ConfigLoader.isFeatureEnabled('beta.retry_queue')) {
    RetryQueue.enqueue(sessionName, filepath, isPrompt, 'session-not-found')
  } else {
    Logger.warn('queue', 'Dropping message')
  }
  return
}

if (TmuxInjector.injectFile() failed) {
  // Injection failed
  if (ConfigLoader.isFeatureEnabled('beta.retry_queue')) {
    RetryQueue.enqueue(sessionName, filepath, isPrompt, 'injection-failed')
  } else {
    Logger.warn('queue', 'Dropping message')
  }
  return
}
```

### 5.3 EventLogConsumer Persistence

**File: `lib/event-log-consumer.js` (lines 261-282)**

- Saves offset after each message processed
- Offset tracks timestamp of last processed message
- On restart, consumer resumes from saved offset
- Prevents duplicate injection of same message

```json
{
  "agentId": "research-807055/interviewer",
  "lastProcessedTimestamp": "2024-11-02T08:30:15.000Z",
  "updatedAt": "2024-11-02T08:30:20.000Z"
}
```

---

## 6. POTENTIAL HOOKS FOR ROBUSTNESS FEATURES

### 6.1 Auto-Spawn on Missing Session

**Hook location**: `lib/queue.js` lines 248-264

```javascript
if (!TmuxInjector.sessionExists(sessionName)) {
  Logger.warn('queue', `Target session not found: ${sessionName}`);
  
  // HOOK: Auto-spawn missing agent
  // - Extract mesh/agent from sessionName
  // - Call spawn() command
  // - Wait for session creation (polling)
  // - Retry injection
  
  if (ConfigLoader.isFeatureEnabled('beta.retry_queue')) {
    RetryQueue.enqueue(...) // Existing behavior
  }
}
```

### 6.2 Agent Liveness Checks

**Hook location**: `lib/system-manager.js` or new `lib/agent-monitor.js`

```javascript
// Periodic health check (every 30s)
// - For each active session
//   - Check if Claude still responsive
//   - Monitor CPU/memory
//   - Detect crashes (no pane activity + no Claude process)
// - If agent dead:
//   - Log failure
//   - Optionally auto-respawn
```

### 6.3 Idle Agent Auto-Respawn

**Hook location**: `lib/commands/status.js` or new scheduler

```javascript
// Monitor agents marked 'idle' for too long (>30 minutes)
// - If idle threshold exceeded:
//   - Mark as 'stalled'
//   - Send alert
//   - Optionally auto-reset/respawn
```

### 6.4 Message Delivery Timeout

**Hook location**: `lib/retry-queue.js` line 142

```javascript
if (retry.attempts >= RetryQueue.config.maxAttempts) {
  // HOOK: Before dropping
  // - Send escalation alert
  // - Record to dead-letter log
  // - Optionally auto-respawn agent
  // - Try alternate routing
  Logger.warn('retry-queue', `Max attempts reached`)
}
```

### 6.5 Smart Session Recovery

**Hook location**: `lib/tmux-injector.js` lines 129-132

```javascript
if (!TmuxInjector.sessionExists(session)) {
  // HOOK: Before wait
  // - Check if session died recently
  // - Check session capture files
  // - Check logs for crash
  // - Attempt recovery (respawn / reattach)
  Logger.warn('tmux-injector', `Session ${session} not found`)
}
```

---

## 7. CONFIGURATION FLAGS

**Feature toggles** in `.ai/tx/config.json`:

```json
{
  "beta": {
    "retry_queue": true,                  // Enable retry queue
    "delivery_tracking": false,           // Track delivered messages
    "routing_validation": false,          // Validate routes
    "rearmatter_spawning": false,         // Auto-spawn from messages
    "clear_before": false                 // Reset before tasks
  }
}
```

**RetryQueue start** (`lib/queue.js` lines 42-47):
```javascript
if (ConfigLoader.isFeatureEnabled('beta.retry_queue')) {
  RetryQueue.start()  // Starts timer for periodic retry checks
}
```

---

## 8. EVENT LOG STRUCTURE

**Directory**: `.ai/tx/msgs/`

**Files**:
- `{timestamp}-prompt-{from}>{to}-{msgId}.md` - Initial prompts
- `{timestamp}-task-{from}>{to}-{msgId}.md` - Tasks to execute
- `{timestamp}-update-{from}>{to}-{msgId}.md` - Status updates
- `{timestamp}-task-complete-{from}>{to}-{msgId}.md` - Task finished

**Offset tracking**: `.ai/tx/state/offsets/{agentId}.json`

**Retry queue**: `.ai/tx/state/retry-queue.json`

**Delivery tracking**: `.ai/tx/state/delivery-log.json` (if enabled)

---

## 9. CRITICAL CODE PATHS FOR ROBUSTNESS

| Feature | File | Lines | Critical Path |
|---------|------|-------|---------------|
| Message detection | watcher.js | 80-84 | File watcher filters `.ai/tx/msgs/*.md` |
| Session routing | queue.js | 241-246 | Gets session name, checks exists |
| Injection queuing | tmux-injector.js | 111-176 | FIFO queue with idle waiting |
| Idle detection | tmux-injector.js | 463-505 | Normalizes output, polls 200ms interval |
| Retry logic | retry-queue.js | 123-191 | Checks session, user typing, backoff |
| Consumer offset | event-log-consumer.js | 262-282 | Saves timestamp after each injection |
| Spawn detection | spawn-handler.js | 43-85 | Monitors rearmatter in messages |

---

## 10. TESTING CONSIDERATIONS

### Pre-flight Checks

1. **Session exists before injection**:
   - Queue logs: "Target session not found"
   - Should retry if enabled

2. **Agent ready before injection**:
   - TmuxInjector.claudeReadyCheck() must pass
   - Looks for "⏵⏵ bypass permissions on"

3. **Idle detection working**:
   - Pane output stabilizes for 2s
   - Normalized output comparison (strips timers)

4. **Retry queue processing**:
   - Every 10s checks pending retries
   - Exponential backoff: 5s, 10s, 20s, 30s
   - Max 20 attempts (≈3 minutes total)

### Failure Scenarios

1. **Session dies during injection**:
   - Queue detects missing session
   - Added to retry queue
   - RetryQueue processes on next interval (10s)
   - Retries up to 20 times

2. **Claude crashes during message processing**:
   - No pane output change
   - Idle timeout at 60s
   - Could be detected by monitoring Claude process

3. **User typing interrupts injection**:
   - RetryQueue detects user typing
   - Postpones injection to next interval
   - Retries when user idle >3s

4. **Message file deleted before injection**:
   - TmuxInjector.injectFile() fails
   - Caught in Queue.routeMessage() catch block
   - Added to retry queue if enabled

---

## Summary of Key Insights

1. **Dual delivery paths**: Queue (primary) + EventLogConsumer (parallel) ensures messages reach agents
2. **Per-session FIFO queues**: TmuxInjector prevents message overlap, enforces idle waiting
3. **Persistent retry queue**: Failed injections retried up to 20x with exponential backoff
4. **Offset tracking**: EventLogConsumer prevents duplicate processing on restart
5. **Session existence checks**: Multiple mechanisms (tmux list-sessions, pane output, process checks)
6. **Idle detection**: Normalized output comparison + configurable thresholds
7. **Spawn on-demand**: SpawnHandler detects spawn requests in message content
8. **Observable health**: Status/Health commands monitor sessions, errors, and retry queue

**Gap areas for enhancement**:
- No auto-respawn on agent crash/death
- No proactive liveness monitoring
- No escalation when delivery impossible
- No circuit breaker for stuck sessions
