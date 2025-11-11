# TX CLI: Visual Architecture & Data Flows

## 1. MESSAGE DELIVERY FLOW (Detailed)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       CENTRALIZED EVENT LOG                              │
│                      (.ai/tx/msgs/*.md)                                 │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 1102083000-prompt-system>core-abc123.md                          │  │
│  │ 1102083001-task-core>research-interviewer-def456.md              │  │
│  │ 1102083002-update-research-interviewer>core-ghi789.md            │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
         │                              │
         │ (File watcher)               │ (EventLogConsumer)
         ├─ chokidar                    └─ Per-agent consumers
         ├─ Detects .md files           └─ Track offset/timestamp
         └─ Emits file:msgs:new         └─ Prevent duplicates
         │
         ▼
┌─────────────────────────┐
│  EventBus              │
│  .emit('file:msgs:new')│
└──────┬──────────────────┘
       │
       ├──────────────────────┬──────────────────────┐
       │                      │                      │
       ▼                      ▼                      ▼
   Queue              SpawnHandler            EventLogConsumer
   (Primary)          (Beta)                  (Parallel)
   
   │ Parses             │ Extracts                │ Checks if for me
   │ from/to/type       │ rearmatter              │ Checks offset
   ▼                    ▼                        ▼
   
  Queue.              If spawn field:          Consumer.
  routeMessage()      processSpawn()           processMessage()
   │                   │                        │
   │ Validates         │ Call spawn()            │ May reset
   │ routing           │ Save parent info        │ May apply lens
   │ Gets session      │ Notify parent           │ May inject self-modify
   ▼                   ▼                        ▼
   
  Check if            Mesh instance            TmuxInjector.
  session exists      created with             injectFile()
   │                  prompt                    │
   │ YES   │ NO (retry) │                        │ Queue for injection
   ▼       ▼            ▼                        ▼
   │    RetryQueue     (Returns)           Per-session FIFO
   │    .enqueue()                         Injection Queue
   │
   └─────────────────────┬──────────────────────┐
                         ▼                      ▼
              TmuxInjector.injectFile()
              (Primary delivery)
              
              ┌─────────────────────────────┐
              │ Session FIFO Queue          │
              │ ┌───────────────────────┐   │
              │ │ Message 1             │   │
              │ │ Message 2             │   │ (Per-session)
              │ │ Message 3             │   │
              │ └───────────────────────┘   │
              └──────┬──────────────────────┘
                     │
                     │ If not processing:
                     │ _processInjectionQueue()
                     ▼
              ┌──────────────────────────┐
              │ Execute injection        │
              │ _doInjectFile()          │
              │ - Write to buffer        │
              │ - Paste to pane          │
              │ - Send Enter             │
              └──────────┬───────────────┘
                         │
                         ▼
              ┌──────────────────────────┐
              │ Wait for idle            │
              │ waitForIdle()            │
              │ - Poll pane (200ms)      │
              │ - Normalize output       │
              │ - Timeout: 60s           │
              └──────────┬───────────────┘
                         │
                         ▼
              ┌──────────────────────────┐
              │ Mark not processing      │
              │ Process next in queue    │
              │ (recursive)              │
              └──────────────────────────┘
```

---

## 2. RETRY QUEUE FLOW (Error Recovery)

```
Queue.routeMessage()
│
├─ TmuxInjector.sessionExists() → FALSE
│  │
│  └─ RetryQueue.enqueue()
│     │
│     └─ Save to .ai/tx/state/retry-queue.json
│        {
│          "session-{msgId}-{ts}": {
│            session: "research-interviewer",
│            filepath: ".ai/tx/msgs/...",
│            attempts: 0,
│            nextRetry: now + 5000,
│            reason: "session-not-found"
│          }
│        }
│
└─ TmuxInjector.injectFile() → FALSE
   │
   └─ RetryQueue.enqueue()
      │
      └─ Same as above but reason="injection-failed"

┌─────────────────────────────────────────────────┐
│ Retry Queue Processor (every 10s)               │
│ RetryQueue.start() → setInterval(processRetries)│
└──────┬──────────────────────────────────────────┘
       │
       ├─ Load retry-queue.json
       ├─ For each pending retry:
       │  │
       │  ├─ if nextRetry > now: skip (not ready)
       │  │
       │  ├─ if attempts >= 20: drop (max attempts)
       │  │
       │  ├─ if !sessionExists: postpone (still waiting)
       │  │
       │  ├─ if isUserTyping: postpone (avoid interrupt)
       │  │
       │  └─ Attempt injection:
       │     │
       │     ├─ TmuxInjector.injectFile()
       │     │
       │     ├─ Success: remove from queue
       │     │
       │     └─ Failed:
       │        │
       │        └─ attempts++
       │        └─ Exponential backoff:
       │           nextRetry = now + min(
       │             5000 * 2^(attempts-1),
       │             30000
       │           )
       │        └─ Save updated retry

BACKOFF SCHEDULE:
  Attempt   Wait      Total
  ─────────────────────────
  1st       5s        5s
  2nd       10s       15s
  3rd       20s       35s
  4th       30s       65s
  5th       30s       95s
  ...
  20th      30s       ~545s (9 min)

MAX TIME: 30s * ~18 attempts ≈ 9 minutes
```

---

## 3. AGENT SPAWNING FLOW

```
Agent needs task from parent
│
├─ Parent writes message with rearmatter
│  ┌──────────────────────────┐
│  │ ---                      │
│  │ spawn:                   │
│  │   mesh: research         │
│  │   reason: analyze trends │
│  │   context: "..."         │
│  │ ---                      │
│  │ Please research...       │
│  └──────────────────────────┘
│
└─ Message written to .ai/tx/msgs/

   │
   ├─ Watcher detects file
   ├─ EventBus emits file:msgs:new
   └─ SpawnHandler.handleNewMessage()
      │
      ├─ Parse message
      ├─ Extract rearmatter
      ├─ Check if spawn field exists
      │
      └─ If YES:
         │
         ├─ SpawnHandler.processSpawn()
         │  │
         │  ├─ Generate mesh ID from reason
         │  │  "analyze trends" → "at{uuid}"
         │  │
         │  ├─ spawn() command
         │  │  ├─ Create mesh instance ID
         │  │  ├─ Initialize directories
         │  │  ├─ Clean orphaned messages
         │  │  ├─ Create tmux session
         │  │  ├─ Start Claude
         │  │  ├─ Wait for ready (30-45s)
         │  │  ├─ Inject model config
         │  │  ├─ Build prompt
         │  │  ├─ Write prompt to event log
         │  │  └─ Update state to 'active'
         │  │
         │  ├─ Save parent info to child state
         │  │  └─ .ai/tx/mesh/{childMesh}/state.json
         │  │     {
         │  │       parent_agent: "research/core",
         │  │       parent_msg_id: "abc123",
         │  │       spawn_reason: "analyze trends",
         │  │       lenses: [...]
         │  │     }
         │  │
         │  └─ Notify parent
         │     └─ Write update message to parent
         │        {
         │          status: 'spawned',
         │          child-mesh: 'research-at{uuid}',
         │          ...
         │        }
         │
         └─ Child mesh starts processing
            ├─ Reads initial prompt
            ├─ Receives parent's context
            ├─ Starts working on task
            └─ Reports progress back

SESSION NAMING PATTERNS:

Scenario                    Session Name
─────────────────────────────────────────
core/core                   core
mesh == agent (persistent)  {mesh}
Regular mesh + agent        {mesh}-{uuid}-{agent}

Example:
  Parent: core/core
  Child:  research-807055 (mesh instance)
  Agent:  interviewer
  Session: research-807055-interviewer
```

---

## 4. SESSION MONITORING & HEALTH

```
Health Check Command: tx health

┌────────────────────────────────────┐
│ collectHealthData()                │
└──────┬─────────────────────────────┘
       │
       ├─ Check event log directory
       │  └─ .ai/tx/msgs/ exists? Count files?
       │
       ├─ Get active sessions
       │  └─ tmux list-sessions -F '#{session_name}'
       │
       ├─ Check session capture directory
       │  └─ .ai/tx/session/ exists? Count files?
       │
       ├─ Check log files exist
       │  ├─ .ai/tx/logs/debug.jsonl?
       │  └─ .ai/tx/logs/error.jsonl?
       │
       ├─ Get recent errors (last hour)
       │  └─ Parse error.jsonl, filter by timestamp
       │
       ├─ Get retry queue status
       │  ├─ RetryQueue.getStatus()
       │  ├─ Total pending retries
       │  └─ Breakdown by session
       │
       └─ Determine overall health
          ├─ healthy: All checks pass
          ├─ degraded: Some warnings (errors, high retry queue)
          └─ unhealthy: Critical issues (missing logs)

STATUS COMMAND: tx status

┌────────────────────────────────────┐
│ status()                           │
└──────┬─────────────────────────────┘
       │
       ├─ Get all meshes from .ai/tx/mesh/
       ├─ Get recent messages (last 5 min)
       │
       └─ For each mesh:
          │
          └─ For each agent in mesh:
             │
             ├─ Get current task (from recent messages)
             ├─ Get last activity timestamp
             │
             └─ Determine idle status
                ├─ lastActivity > 2 minutes?
                │  ├─ TRUE → 💤 idle
                │  └─ FALSE → 🟢 active
                │
                └─ Display:
                   📦 research-807055
                   🟢 interviewer: Extract findings (active 23s ago)
                   💤 analyst: idle

IDLE DETECTION: 120 seconds (2 minutes)
```

---

## 5. SEQUENCE DIAGRAM: Happy Path

```
User              tx spawn          Queue              TmuxInjector       Claude
 │                  │                 │                    │                 │
 │ tx spawn         │                 │                    │                 │
 ├─────────────────>│                 │                    │                 │
 │                  │                 │                    │                 │
 │                  │ Create session  │                    │                 │
 │                  ├───────────────────────────────────────>│                 │
 │                  │                 │                    │                 │
 │                  │                 │                    │ tmux new-session│
 │                  │                 │                    ├────────────────>│
 │                  │                 │                    │<────────────────┤
 │                  │                 │                    │                 │
 │                  │                 │                    │ Send: claude    │
 │                  │                 │                    ├────────────────>│
 │                  │                 │                    │ Start up...     │
 │                  │                 │                    │<────────────────┤
 │                  │                 │                    │                 │
 │                  │                 │                    │ Wait for ready  │
 │                  │                 │                    │ (30-45s)        │
 │                  │                 │                    │                 │
 │                  │                 │                    │ ⏵⏵ bypass...   │
 │                  │                 │                    │<────────────────┤
 │                  │                 │                    │                 │
 │                  │ Write prompt    │                    │                 │
 │                  ├──────────────────────> READY        │                 │
 │                  │                 │     Inject prompt │                 │
 │                  │                 │────────────────────>│                 │
 │                  │                 │                    │                 │
 │                  │                 │                    │ Read file @...  │
 │                  │                 │                    ├────────────────>│
 │                  │                 │                    │ Processing...   │
 │                  │<──────────────────────────────────────┤                 │
 │                  │                 │                    │                 │
 │<─ Spawned ✓      │                 │                    │                 │
 │  (session ready) │                 │                    │                 │
```

---

## 6. ERROR SCENARIOS

### Scenario A: Session Not Yet Created

```
Message arrives → Queue.routeMessage()
                 │
                 └─ TmuxInjector.sessionExists("research-interviewer")
                    │
                    └─ FALSE (session not yet spawned)
                       │
                       ├─ Queue logs: "Target session not found"
                       │
                       └─ RetryQueue.enqueue(
                            session="research-interviewer",
                            reason="session-not-found",
                            nextRetry=now+5000
                          )
                          │
                          ├─ Save to retry-queue.json
                          │
                          └─ After 5s, retry processor kicks in
                             │
                             ├─ Check if session now exists
                             │  ├─ Still NO: Backoff to 10s
                             │  └─ YES: Inject message
                             │
                             └─ (Repeat every 10s)

STATUS:
  ❌ Message stuck in retry queue (waiting for session)
  🟡 Will eventually succeed once session spawned
  💡 Max wait: 20 attempts * 30s = 9 minutes
```

### Scenario B: User Actively Typing

```
Retry processor runs
│
└─ TmuxInjector.isUserTyping(session, 3000ms)
   │
   ├─ Capture pane content (snap 1)
   ├─ Wait 500ms
   ├─ Capture pane content (snap 2)
   │
   ├─ If snap1 != snap2:
   │  └─ TRUE → User typing detected
   │     │
   │     └─ RetryQueue.updateRetry(
   │          attempts++,
   │          reason="user-typing",
   │          nextRetry=now+10000
   │        )
   │     │
   │     └─ Skip injection, retry next interval
   │
   └─ If snap1 == snap2:
      └─ FALSE → No typing
         └─ Proceed with injection
```

### Scenario C: Max Retries Exceeded

```
RetryQueue processing
│
├─ Check retry.attempts >= 20?
│  │
│  └─ YES
│     │
│     ├─ Log: "Max attempts reached, dropping: {retryId}"
│     │
│     ├─ Remove from retry queue
│     │
│     └─ Message LOST
│        (No delivery, no alert, no escalation)
│
└─ NO: Continue retrying (next interval)

IMPROVEMENT OPPORTUNITY:
  └─ Before dropping:
     ├─ Send escalation alert
     ├─ Record to dead-letter log
     ├─ Optionally auto-respawn agent
     └─ Try alternate routing
```

---

## 7. DATA FLOW: Message Offset Tracking

```
EventLogConsumer starts
│
├─ Load offset from .ai/tx/state/offsets/{agentId}.json
│  ├─ If exists: lastProcessed = loaded timestamp
│  └─ If not exists: lastProcessed = null (start from beginning)
│
├─ Get existing messages from .ai/tx/msgs/
│  ├─ Filter: only messages for this agent
│  ├─ Filter: timestamp > lastProcessed
│  └─ Sort by timestamp (chronological)
│
├─ Process each existing message
│  └─ Inject via TmuxInjector
│
└─ Watch for NEW messages
   │
   ├─ chokidar detects .md file added
   │
   ├─ Check: isForMe(msg)?
   │  └─ Filter by agent ID
   │
   ├─ Check: isProcessed(msg)?
   │  └─ msg.timestamp <= lastProcessed?
   │     ├─ YES: Skip (already processed)
   │     └─ NO: Process
   │
   ├─ Process message
   │  ├─ May reset session
   │  ├─ May apply lens
   │  ├─ Inject via TmuxInjector
   │  │
   │  └─ UPDATE OFFSET
   │     │
   │     └─ Save to .ai/tx/state/offsets/{agentId}.json
   │        {
   │          "agentId": "research-807055/interviewer",
   │          "lastProcessedTimestamp": "2024-11-02T08:30:15Z",
   │          "updatedAt": "2024-11-02T08:30:20Z"
   │        }
   │
   └─ Next message...

BENEFIT: Crash-safe
  ├─ Consumer dies after injection but before offset save
  │  └─ Message reprocessed on restart (OK - idempotent)
  │
  └─ Consumer dies after offset save
     └─ Message not reprocessed (OK - already done)
```

---

## 8. Comparison: Queue vs EventLogConsumer

```
                    Queue                EventLogConsumer
────────────────────────────────────────────────────────────
Trigger             file:msgs:new        chokidar watch
Scope               All messages         Messages for agent
Session Check       Immediate            In processor
Error Handling      RetryQueue           Offset tracking
Delivery Guarantee  Best-effort → Retry  Persistent offset
Re-delivery Risk    Yes (if retry fails) No (offset saved)
Fault Tolerance     High (10-20 retries) High (offset survives crash)
Target              Primary delivery     Agent-side guarantee
```

**Both work in parallel**:
- Queue: Fast, immediate, handles retries
- Consumer: Slow, reliable, crash-resistant

