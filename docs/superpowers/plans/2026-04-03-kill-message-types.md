# Kill Message Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `MessageType` system entirely. Replace type-string-driven routing with routing context + frontmatter fields + mesh state. Two signals remain: completion (`status/outcome: complete`) and session resume (`pending_asks` table).

**Architecture:** Consumer no longer infers or stores message types. Routing is determined by `to`/`from` fields, `status`/`outcome` frontmatter, and `pending_asks` table state. Events collapse from 4 to 3 (`core-message`, `worker-message`, `worker-resume`). Dispatcher collapses from 3 handlers to 2.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Node.js EventEmitter

**Spec:** `.ai/explore/2026-04-03-kill-message-types.md`

---

### Task 1: Remove MessageType from shared/types.ts

**Files:**
- Modify: `src/shared/types.ts:5-16` (MessageType union)
- Modify: `src/shared/types.ts:20-29` (Message interface)
- Modify: `src/shared/types.ts:318-324` (FSMTransitionConfig)

- [ ] **Step 1: Remove the MessageType union and update Message interface**

```ts
// Delete lines 5-16 entirely (MessageType union + comments)
// Delete the type import from Message interface

// Before (lines 18-29):
export type MessageStatus = 'pending' | 'delivered';

export interface Message {
  id?: number;
  from_agent: string;
  to_agent: string;
  type: MessageType;
  status?: MessageStatus;
  payload: MessagePayload;
  created_at?: number;
  delivered_at?: number;
}

// After:
export type MessageStatus = 'pending' | 'delivered';

export interface Message {
  id?: number;
  from_agent: string;
  to_agent: string;
  status?: MessageStatus;
  payload: MessagePayload;
  created_at?: number;
  delivered_at?: number;
  source_file?: string;
}
```

- [ ] **Step 2: Update FSMTransitionConfig trigger type**

```ts
// Before (line 321):
trigger: 'message' | 'task-complete' | 'manual' | 'ask';  // 'ask' DEPRECATED: use 'message'

// After:
trigger: 'message' | 'complete' | 'manual';
```

- [ ] **Step 3: Verify the file compiles in isolation**

Run: `npx tsc --noEmit src/shared/types.ts 2>&1 | head -5`
Expected: No errors from types.ts itself (downstream files will break — that's expected and intentional)

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "$(cat <<'EOF'
refactor: remove MessageType union from shared types

Remove the MessageType type alias and the type field from the Message
interface. Routing is now determined by frontmatter fields (status/outcome)
and mesh state (pending_asks), not type strings.
EOF
)"
```

---

### Task 2: Update event interfaces in worker/types.ts

**Files:**
- Modify: `src/worker/types.ts:189-241`

- [ ] **Step 1: Remove AskMessageEvent, update remaining interfaces**

```ts
// DELETE the AskMessageEvent interface entirely (lines 189-201)

// RENAME AskResponseMessageEvent → WorkerResumeEvent and remove type field
// Before (lines 221-232):
export interface AskResponseMessageEvent {
  id: number;
  filepath: string;
  from: string;
  to: string;
  content: string;
  headline?: string;
  msgId?: string;
  fromHumanBoundary?: boolean;
  resumesSuspension?: boolean;
}

// After:
export interface WorkerResumeEvent {
  id: number;
  filepath: string;
  from: string;
  to: string;
  content: string;
  headline?: string;
  msgId?: string;
}

// UPDATE BlockingHitlMessageEvent — remove type field (lines 207-215)
// Before:
export interface BlockingHitlMessageEvent {
  id: number;
  filepath: string;
  from: string;
  to: string;
  type: string;
  headline?: string;
  msgId?: string;
}

// After:
export interface BlockingHitlMessageEvent {
  id: number;
  filepath: string;
  from: string;
  to: string;
  headline?: string;
  msgId?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/worker/types.ts
git commit -m "$(cat <<'EOF'
refactor: remove type-based event interfaces

Remove AskMessageEvent (no longer emitted). Rename
AskResponseMessageEvent to WorkerResumeEvent. Remove type field
from BlockingHitlMessageEvent.
EOF
)"
```

---

### Task 3: Update SystemMessageWriter — remove type field

**Files:**
- Modify: `src/core/system-message-writer.ts`

- [ ] **Step 1: Remove type from interface, frontmatter, filename, queue insert, and logging**

```ts
// SystemMessageOptions — remove type field (line 22)
// Before:
export interface SystemMessageOptions {
  to: string;
  from: string;
  type: string;
  headline: string;
  body: string;
  msgId?: string;
  extraFrontmatter?: Record<string, string>;
  injectResponse?: boolean;
}

// After:
export interface SystemMessageOptions {
  to: string;
  from: string;
  headline: string;
  body: string;
  msgId?: string;
  extraFrontmatter?: Record<string, string>;
  injectResponse?: boolean;
}

// write() method changes:
// Line 60: Remove type from filename template
// Before:
const filename = `${timestamp}-${options.type}-${safeFrom}--${safeTo}-${msgId}.md`;
// After:
const filename = `${timestamp}-${safeFrom}--${safeTo}-${msgId}.md`;

// Lines 64-71: Remove type from frontmatter
// Before:
const frontmatterLines = [
  `to: ${options.to}`,
  `from: ${options.from}`,
  `type: ${options.type}`,
  `msg-id: ${msgId}`,
  `headline: ${options.headline}`,
  `timestamp: ${new Date(timestamp).toISOString()}`,
];
// After:
const frontmatterLines = [
  `to: ${options.to}`,
  `from: ${options.from}`,
  `msg-id: ${msgId}`,
  `headline: ${options.headline}`,
  `timestamp: ${new Date(timestamp).toISOString()}`,
];

// Lines 90-101: Remove type from queue insert
// Before:
const queueId = this.queue.insert({
  from_agent: options.from,
  to_agent: options.to,
  type: options.type,
  source_file: filepath,
  payload: { ... },
});
// After:
const queueId = this.queue.insert({
  from_agent: options.from,
  to_agent: options.to,
  source_file: filepath,
  payload: { ... },
});

// Lines 124-132: Remove type from event emission and logging
// Before:
this.emit(event, {
  id: queueId,
  filepath,
  agentId: options.to,
  from: options.from,
  type: options.type,
  event: 'add',
  injectResponse: options.injectResponse || false,
});
// After:
this.emit(event, {
  id: queueId,
  filepath,
  agentId: options.to,
  from: options.from,
  event: 'add',
  injectResponse: options.injectResponse || false,
});

// Line 134-140: Remove type from log
// Before:
log.info('system-writer', 'Message dispatched', {
  id: queueId,
  to: options.to,
  from: options.from,
  type: options.type,
  msgId,
});
// After:
log.info('system-writer', 'Message dispatched', {
  id: queueId,
  to: options.to,
  from: options.from,
  msgId,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/core/system-message-writer.ts
git commit -m "$(cat <<'EOF'
refactor: remove type field from SystemMessageWriter

Type is no longer written to frontmatter, filenames, queue inserts,
or event payloads. Messages are routed by to/from fields and
frontmatter state (status/outcome).
EOF
)"
```

---

### Task 4: Update all systemWriter.write() callers — drop type parameter

**Files:**
- Modify: `src/worker/dispatcher.ts` (12+ call sites)
- Modify: `src/cli/start.ts:570-573`
- Modify: `src/cli/run.ts:396-399`
- Modify: `src/hooks/pre/discovery-code.ts:181-184`
- Modify: `src/hooks/pre/know-check.ts:50-53`
- Modify: `src/hooks/utils/messages.ts:155-158` and line 175
- Modify: `src/hooks/utils/code-context.ts:28-31`
- Modify: `src/hooks/post/commit-auto.ts:116-119` and `157-160`
- Modify: `src/hooks/post/validation-code.ts:223-226` and line 232
- Modify: `src/hooks/post/brain-update.ts:133-136` and line 145
- Modify: `src/hooks/post/suggest-manifest.ts:181-184`
- Modify: `src/mesh/fsm.ts:1900-1903` and `1982-1985`
- Modify: `src/queue/deadlock-detector.ts:312-315`
- Modify: `src/reliability/reliability-manager.ts:89` (DispatcherBindings interface)

- [ ] **Step 1: Remove `type` from every `systemWriter.write()` call in dispatcher.ts**

For each call site, delete the `type: '...',` line. The calls at these lines need updating:
- Line 744-747: `type: 'info'` → delete
- Line 1433-1436: `type,` → delete (also remove `type` from the destructured parameters above)
- Line 2041-2044: `type: 'task'` → delete. Add `extraFrontmatter: { status: 'new' }` if the message is a fan-out task that needs to signal it's new work (check context — fan-out tasks are dispatched to agents, they don't need a type, they're just messages)
- Line 3428-3431: `type: 'error'` → delete
- Line 3450-3453: `type: 'task-complete'` → delete. Add `extraFrontmatter: { status: 'complete' }` since this IS a completion signal
- Line 3545-3548: `type: 'task-complete'` → delete. Add `extraFrontmatter: { status: 'complete' }`
- Line 3972-3975: `type: 'info'` → delete
- Line 5541-5544: `type: 'error'` → delete
- Line 5589-5592: `type: 'error'` → delete
- Line 5696-5699: `type: 'info'` → delete
- Line 5721-5724: `type: 'info'` → delete
- Line 6017-6020: `type: 'info'` → delete
- Line 6675-6678: `type: 'task'` → delete
- Line 6694-6697: `type: 'task'` → delete
- Line 7225-7228: `type: 'task'` → delete
- Line 7377-7380: `type: 'message'` → delete
- Line 7486-7489: `type: 'message'` → delete

- [ ] **Step 2: Remove `type` from dispatcher's requeueMessage binding**

```ts
// Line 1432:
// Before:
requeueMessage: (from: string, to: string, type: string, payload: Record<string, unknown>, extraFrontmatter?: Record<string, string>) => {
  this.systemWriter.write({
    from,
    to,
    type,
    headline: (payload.headline as string) || 'DLQ recovery',
    body: (payload.body as string) || '',
    ...
  });
},

// After:
requeueMessage: (from: string, to: string, payload: Record<string, unknown>, extraFrontmatter?: Record<string, string>) => {
  this.systemWriter.write({
    from,
    to,
    headline: (payload.headline as string) || 'DLQ recovery',
    body: (payload.body as string) || '',
    ...
  });
},
```

- [ ] **Step 3: Update DispatcherBindings interface in reliability-manager.ts**

```ts
// Line 89:
// Before:
requeueMessage: (from: string, to: string, type: string, payload: Record<string, unknown>, extraFrontmatter?: Record<string, string>) => void;
// After:
requeueMessage: (from: string, to: string, payload: Record<string, unknown>, extraFrontmatter?: Record<string, string>) => void;
```

- [ ] **Step 4: Update requeueMessage call sites in reliability-manager.ts**

```ts
// Line 472-486 (session_resume path):
// Before:
this.bindings!.requeueMessage(
  'system/dlq-recovery',
  entry.agent_id,
  'task',
  { ... },
  { 'session-id': sessionId }
);
// After (remove the 'task' argument):
this.bindings!.requeueMessage(
  'system/dlq-recovery',
  entry.agent_id,
  { ... },
  { 'session-id': sessionId }
);

// Line 509-514 (requeue path):
// Before:
this.bindings!.requeueMessage(
  entry.from_agent,
  entry.to_agent,
  entry.type,
  { ... },
);
// After (remove entry.type argument):
this.bindings!.requeueMessage(
  entry.from_agent,
  entry.to_agent,
  { ... },
);
```

- [ ] **Step 5: Remove `type` from all hook systemWriter.write() calls**

For each hook file, delete the `type: '...',` line from write() calls:
- `src/hooks/pre/discovery-code.ts:184` — delete `type: 'ask',`. Also update the raw frontmatter string at line 193: remove `type: ask\n` from the template literal.
- `src/hooks/pre/know-check.ts:53` — delete `type: 'info',`
- `src/hooks/utils/messages.ts:158` — delete `type: 'task',`. Also update raw frontmatter string at line 175: remove `type: task\n`.
- `src/hooks/utils/code-context.ts:31` — delete `type: 'update',`
- `src/hooks/post/commit-auto.ts:119` and `:160` — delete `type: 'update',`
- `src/hooks/post/validation-code.ts:226` — delete `type: 'ask',`. Also update raw frontmatter at line 232: remove `type: ask\n`.
- `src/hooks/post/brain-update.ts:136` — delete `type: 'task',`. Also update raw frontmatter at line 145: remove `type: task\n`.
- `src/hooks/post/suggest-manifest.ts:184` — delete `type: 'update',`

- [ ] **Step 6: Remove `type` from cli/start.ts and cli/run.ts**

```ts
// src/cli/start.ts line 573: delete `type: 'ask-human',`
// src/cli/run.ts line 399: delete `type: 'task',`
```

- [ ] **Step 7: Remove `type` from mesh/fsm.ts write() calls**

```ts
// Line 1903: delete `type: 'ask-human',`
// Line 1985: delete `type: 'task',`
```

- [ ] **Step 8: Remove `type` from queue/deadlock-detector.ts**

```ts
// Line 315: delete `type: 'notification',`
```

- [ ] **Step 9: Commit**

```bash
git add src/worker/dispatcher.ts src/cli/start.ts src/cli/run.ts src/hooks/ src/mesh/fsm.ts src/queue/deadlock-detector.ts src/reliability/reliability-manager.ts
git commit -m "$(cat <<'EOF'
refactor: remove type parameter from all message write calls

Drop type from systemWriter.write(), requeueMessage binding,
raw frontmatter templates, and all hook/CLI callers. Completion
signals now use extraFrontmatter: { status: 'complete' }.
EOF
)"
```

---

### Task 5: Update queue — make type optional in insert

**Files:**
- Modify: `src/queue/index.ts:94-97` (insertStmt)
- Modify: `src/queue/index.ts:238-248` (insert method)

- [ ] **Step 1: Make type column accept NULL in insert**

```ts
// Line 94-97 — update prepared statement to use NULL for type
// Before:
this.insertStmt = this.db.prepare(`
  INSERT INTO messages (from_agent, to_agent, type, payload, source_file, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// After:
this.insertStmt = this.db.prepare(`
  INSERT INTO messages (from_agent, to_agent, type, payload, source_file, created_at)
  VALUES (?, ?, NULL, ?, ?, ?)
`);

// Line 238-248 — remove type from insert parameters
// Before:
insert(msg: Message): number {
  try {
    const result = this.insertStmt.run(
      msg.from_agent,
      msg.to_agent,
      msg.type,
      JSON.stringify(msg.payload),
      msg.source_file || null,
      Date.now()
    );

// After:
insert(msg: Message): number {
  try {
    const result = this.insertStmt.run(
      msg.from_agent,
      msg.to_agent,
      JSON.stringify(msg.payload),
      msg.source_file || null,
      Date.now()
    );
```

Note: The SQLite column stays. We just stop writing to it. No migration needed.

- [ ] **Step 2: Update selectPendingStmt — remove type from SELECT**

```ts
// Line 99-104:
// Before:
this.selectPendingStmt = this.db.prepare(`
  SELECT id, from_agent, to_agent, type, status, payload, created_at, delivered_at
  FROM messages
  WHERE to_agent = ? AND status = 'pending'
  ORDER BY created_at ASC
`);

// After:
this.selectPendingStmt = this.db.prepare(`
  SELECT id, from_agent, to_agent, status, payload, created_at, delivered_at
  FROM messages
  WHERE to_agent = ? AND status = 'pending'
  ORDER BY created_at ASC
`);
```

- [ ] **Step 3: Search for any other queries that SELECT or filter by type**

Run: `rg 'type.*FROM messages|WHERE.*type' src/queue/`

Update any queries that reference the type column — remove type from SELECT lists, remove WHERE clauses that filter by type. Keep the column in the schema (backward compat with existing DBs).

- [ ] **Step 4: Commit**

```bash
git add src/queue/index.ts
git commit -m "$(cat <<'EOF'
refactor: stop writing type to message queue

Insert NULL for the type column. Remove type from SELECT statements.
SQLite column preserved for backward compatibility with existing DBs.
EOF
)"
```

---

### Task 6: Delete inferMessageType and type routing from consumer.ts

This is the core change. The consumer stops inferring types and routes purely by `to`/`from` + frontmatter fields + `pending_asks` state.

**Files:**
- Modify: `src/core/consumer.ts`

- [ ] **Step 1: Delete inferMessageType() method**

Delete the entire method at lines 1513-1541.

- [ ] **Step 2: Remove _explicitType and type inference from parseMessage()**

```ts
// Lines 1453-1459:
// Before:
if (!frontmatter.to || !frontmatter.from) return null;
if (frontmatter.type) {
  frontmatter._explicitType = 'true';
} else {
  frontmatter.type = this.inferMessageType(frontmatter, frontmatter.to, frontmatter.from);
}

// After:
if (!frontmatter.to || !frontmatter.from) {
  log.warn('consumer', `Message missing to/from fields`, { file: filename });
  return null;
}
```

Note: Also remove `type` from the Frontmatter interface (line 65).

- [ ] **Step 3: Remove re-inference block after dispatcher resolution**

Delete lines 648-660 entirely (the `if (!parsed.frontmatter._explicitType)` block).

- [ ] **Step 4: Remove type from queue insert call**

```ts
// Around line 1000:
// Before:
const id = this.queue.insert({
  from_agent: fromAgent,
  to_agent: toAgent,
  type: parsed.frontmatter.type,
  source_file: filepath,
  payload: { ... }
});

// After:
const id = this.queue.insert({
  from_agent: fromAgent,
  to_agent: toAgent,
  source_file: filepath,
  payload: { ... }
});
```

- [ ] **Step 5: Add isCompletion() helper**

```ts
// Add near top of class or as private method:
private isCompletion(frontmatter: Record<string, string | undefined>): boolean {
  return frontmatter.status === 'complete' || frontmatter.outcome === 'complete';
}
```

- [ ] **Step 6: Rewrite the routing section (lines ~1071-1437)**

This is the biggest change. Replace type-based branching with routing-based branching.

The new flow replaces all the `messageType === 'ask'`, `messageType === 'ask-human'`, `messageType === 'ask-response'`, and `messageType === 'task-complete'` checks:

```ts
// === HUMAN RESPONSE DETECTION ===
// core/core → agent: check if this resumes a suspended session
if (fromAgent === 'core/core' && toAgent !== 'core/core') {
  const pendingAsks = this.queue.getPendingAsks(toAgent);
  const hasPendingHumanAsk = pendingAsks.some(a => a.to_agent === 'core/core');

  if (hasPendingHumanAsk) {
    log.info('consumer', 'Human response detected for suspended agent', {
      from: fromAgent, to: toAgent, msgId, file: filename,
    });

    this.emit('worker-resume', {
      id,
      filepath,
      from: fromAgent,
      to: toAgent,
      content: parsed.body,
      headline: parsed.frontmatter.headline,
      msgId,
    });
    return;
  }
  // No pending ask → fall through to normal worker-message (new work)
}

// === ASK TRACKING ===
// Non-core agent → core/core (non-completion): track as pending ask
if (toAgent === 'core/core' && !fromAgent.startsWith('core/')) {
  const isComplete = this.isCompletion(parsed.frontmatter);

  if (!isComplete) {
    // Agent is asking the human a question — track for parity
    if (msgId) {
      this.queue.trackPendingAsk(fromAgent, toAgent, msgId);
    }

    // Blocking HITL: agent wants to keep session alive
    if (parsed.frontmatter.human === 'blocking') {
      this.emit('blocking-hitl-message', {
        id, filepath, from: fromAgent, to: toAgent,
        headline: parsed.frontmatter.headline, msgId,
      });
    } else {
      // Regular ask — emit ask-message for dispatcher to handle suspension
      this.emit('ask-message', {
        id, filepath, from: fromAgent, to: toAgent,
        headline: parsed.frontmatter.headline, msgId,
        crossesHumanBoundary: true,
        isTerminal: true,
      });
    }
  }
}

// === COMPLETION + PARITY GATE ===
if (toAgent === 'core/core' && this.isCompletion(parsed.frontmatter)) {
  const pending = this.queue.getPendingAsks(fromAgent);
  if (pending.length > 0) {
    // BLOCK: agent completing with unanswered asks
    log.warn('consumer', 'Parity gate: BLOCKING completion with pending asks', {
      fromAgent, pendingCount: pending.length, file: filename,
    });
    try { fs.unlinkSync(filepath); } catch {}
    this.emit('parity-reminder', {
      agentId: fromAgent,
      pendingAsks: pending.map(p => ({ msgId: p.msg_id, to: p.to_agent })),
      deletedFile: filepath,
    });
    return;
  }
}

// === EVENT EMISSION ===
if (toAgent === 'core/core') {
  this.emit('core-message', {
    id, filepath,
    from: parsed.frontmatter.from,
    completion: this.isCompletion(parsed.frontmatter),
    event,
  });
} else {
  this.emit('worker-message', {
    agentId: toAgent,
    from: fromAgent,
    headline: parsed.frontmatter.headline,
    file: filename,
    completion: this.isCompletion(parsed.frontmatter),
    injectResponse: parsed.frontmatter['inject-response'] === 'true',
  });
}
```

- [ ] **Step 7: Remove all deprecated-message-type log warnings**

Search for `deprecated-message-type` in consumer.ts and delete all those log.warn calls.

- [ ] **Step 8: Remove type from event payloads**

Remove `type` from core-message and worker-message emit payloads. Add `completion: boolean` field instead.

- [ ] **Step 9: Commit**

```bash
git add src/core/consumer.ts
git commit -m "$(cat <<'EOF'
refactor: replace type inference with routing-based message dispatch

Delete inferMessageType(). Remove _explicitType flag and re-inference.
Route by to/from fields + isCompletion() + pending_asks state.
Emit worker-resume for confirmed pending ask matches.
Core→agent without pending ask now emits worker-message (fixes
silent message swallowing bug).
EOF
)"
```

---

### Task 7: Update dispatcher — collapse event handlers

**Files:**
- Modify: `src/worker/dispatcher.ts`

- [ ] **Step 1: Update event bindings (around lines 1458-1494)**

```ts
// KEEP worker-message binding (unchanged)
// KEEP blocking-hitl-message binding (unchanged)
// KEEP parity-reminder binding (unchanged)

// CHANGE ask-response-message → worker-resume
// Before:
consumer.on('ask-response-message', this.boundAskResponseHandler);
// After:
consumer.on('worker-resume', this.boundAskResponseHandler);

// Remove the deprecation warnings from the handlers:
// Line 1472: delete `log.warn('dispatcher', 'DEPRECATE: ask-message...')`
// Line 1479: delete `log.warn('dispatcher', 'DEPRECATE: ask-response-message...')`
```

Note: Keep `ask-message` event binding for now — the consumer still emits it for agent→core asks that need dispatcher suspension handling. The event name is fine; it describes behavior (an agent asking), not a type string.

- [ ] **Step 2: Rename handleAskResponseMessage → handleWorkerResume**

Rename the method and update all internal call sites:
- Lines 1678, 1710, 1861: internal calls to `handleAskResponseMessage()` → `handleWorkerResume()`
- Update the bound handler reference

- [ ] **Step 3: Remove type from core-message tracking handler**

```ts
// Line 1510:
// Before:
this.boundCoreMessageTrackingHandler = (event: { from: string; type: string; filepath: string }) => {
// After:
this.boundCoreMessageTrackingHandler = (event: { from: string; filepath: string; completion?: boolean }) => {
```

Update the handler body to check `event.completion` instead of `event.type === 'task-complete'`.

- [ ] **Step 4: Remove type from worker-message tracking handler**

Update similarly — use `completion` boolean instead of type string.

- [ ] **Step 5: Update handleWorkerMessage — detect completion from payload**

In `handleWorkerMessage()`, where it checks message type for completion, change to check the payload's frontmatter fields:

```ts
// When polling a message from queue, check payload for completion:
const payload = message.payload || {};
const isCompletion = payload.status === 'complete' || payload.outcome === 'complete';
```

- [ ] **Step 6: Update blocking HITL detection (lines 1696-1721)**

Remove the type-based routing. The consumer now emits `worker-resume` for confirmed pending asks, so the blocking HITL path just needs to check for that event.

- [ ] **Step 7: Remove all `deprecated-message-type` log warnings from dispatcher**

- [ ] **Step 8: Update AskMessageEvent import to use the simplified type**

Since AskMessageEvent was removed from worker/types.ts, define it inline or keep it with reduced fields:

```ts
// If still needed for ask-message event handling, define inline:
interface AskMessageEvent {
  id: number;
  filepath: string;
  from: string;
  to: string;
  headline?: string;
  msgId?: string;
  crossesHumanBoundary?: boolean;
  isTerminal?: boolean;
}
```

- [ ] **Step 9: Commit**

```bash
git add src/worker/dispatcher.ts
git commit -m "$(cat <<'EOF'
refactor: collapse dispatcher handlers, remove type routing

Rename handleAskResponseMessage to handleWorkerResume. Bind to
worker-resume event. Detect completion via payload fields instead
of type strings. Remove deprecation warnings.
EOF
)"
```

---

### Task 8: Update message-router.ts

**Files:**
- Modify: `src/worker/message-router.ts`

- [ ] **Step 1: Remove type checks and deprecated warnings**

- Remove `handleAskMessage` method's type check for 'ask-human' (line 311)
- Rename `handleAskResponse` → `handleResume`
- Remove all `deprecated-message-type` log warnings
- Update method signatures to use `WorkerResumeEvent` instead of `AskResponseMessageEvent`

- [ ] **Step 2: Commit**

```bash
git add src/worker/message-router.ts
git commit -m "$(cat <<'EOF'
refactor: remove type checks from message router

Rename handleAskResponse to handleResume. Remove ask-human type
check and deprecation warnings.
EOF
)"
```

---

### Task 9: Update agent.ts — remove type switch

**Files:**
- Modify: `src/core/agent.ts:110-167`

- [ ] **Step 1: Replace type switch with routing-based dispatch**

```ts
// Before (lines 110-137):
private async handleMessage(msg: Message): Promise<void> {
  console.log(`\n[core] ← ${msg.type} from ${msg.from_agent}`);
  // ... type switch

// After:
private async handleMessage(msg: Message): Promise<void> {
  const payload = msg.payload || {};
  const isCompletion = payload.status === 'complete' || payload.outcome === 'complete';

  if (isCompletion) {
    console.log(`\n[core] ← completion from ${msg.from_agent}`);
    await this.handleTaskComplete(msg);
  } else if (msg.to_agent === 'core/core' && msg.from_agent !== 'core/core') {
    console.log(`\n[core] ← message from ${msg.from_agent}`);
    await this.handleAskHuman(msg);
  } else {
    console.log(`\n[core] ← routing ${msg.from_agent} → ${msg.to_agent}`);
    await this.routeMessage(msg);
  }
}
```

- [ ] **Step 2: Remove type from handleAskHuman's queue insert**

```ts
// Lines 155-166: Remove type: 'ask-response' from insert call
// Before:
this.queue.insert({
  from_agent: 'core/core',
  to_agent: msg.from_agent,
  type: 'ask-response',
  payload: { ... },
});
console.log(`[core] → ask-response to ${msg.from_agent}\n`);

// After:
this.queue.insert({
  from_agent: 'core/core',
  to_agent: msg.from_agent,
  payload: { ... },
});
console.log(`[core] → response to ${msg.from_agent}\n`);
```

- [ ] **Step 3: Remove type from writeParallelMessage template**

```ts
// Lines 332-343: Remove `type: task` from frontmatter template
// Before:
const messageContent = `---
to: ${agentId}
from: core/core
type: task
msg-id: ${msgId}
...

// After:
const messageContent = `---
to: ${agentId}
from: core/core
msg-id: ${msgId}
...
```

- [ ] **Step 4: Remove MessageType import if present**

Check the import line and remove any reference to MessageType.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent.ts
git commit -m "$(cat <<'EOF'
refactor: replace type switch with routing-based dispatch in agent

Route by completion state and to/from fields instead of type strings.
Remove type from queue inserts and message templates.
EOF
)"
```

---

### Task 10: Update prompt/core.ts — rewrite type vocabulary

**Files:**
- Modify: `src/prompt/core.ts`

- [ ] **Step 1: Replace all type-based terminology**

Find and replace throughout the file:
- `ask-human` → "pending question" or "agent question" (context-dependent)
- `task-complete` → "completion" or "message with `status: complete`"
- `ask-response` → "response" or "reply to agent"
- `Write a \`task\` message to trigger a worker` → `Write a message to trigger a worker`
- Line 398: Remove `task` from filename example: `${msgsDir}/{timestamp}-core--test-worker-{id}.md`
- Line 507: `**task-complete messages**` → `**Completion messages** (status: complete)`
- Line 509: `**ask-human messages**` → `**Agent questions** (human: true)`
- Line 521: `task-complete frontmatter` → `completion frontmatter`
- Line 526: `## Example ask-response:` → `## Example response to agent:`
- Line 232: `ask-human messages piling up` → `Suspended agents piling up`
- Line 1435: `If it's ask-human, present the question...` → `If an agent is asking for input, present the question...`

- [ ] **Step 2: Remove `type:` from example frontmatter blocks**

Search for `type: task` or `type:` in example markdown blocks and remove those lines.

- [ ] **Step 3: Commit**

```bash
git add src/prompt/core.ts
git commit -m "$(cat <<'EOF'
refactor: remove type vocabulary from core agent prompt

Replace ask-human/task-complete/ask-response terminology with
routing-based language: completion, agent questions, responses.
Remove type field from example frontmatter blocks.
EOF
)"
```

---

### Task 11: Update prompt/sections/task-context.ts — remove type extraction

**Files:**
- Modify: `src/prompt/sections/task-context.ts:25,29`

- [ ] **Step 1: Remove type field extraction**

```ts
// Delete line 25:
const typeMatch = metadata.match(/^type:\s*(.+)$/m);
// Delete line 29:
if (typeMatch) section += `**Type**: ${typeMatch[1]}\n`;
```

- [ ] **Step 2: Commit**

```bash
git add src/prompt/sections/task-context.ts
git commit -m "$(cat <<'EOF'
refactor: remove type field extraction from task context prompt
EOF
)"
```

---

### Task 12: Update cli/start.ts — remove type references

**Files:**
- Modify: `src/cli/start.ts`

- [ ] **Step 1: Update parseMessageFromFile**

```ts
// Line 1005-1008:
// Before:
return {
  from: fm['from'] || '',
  to: fm['to'] || 'core/core',
  type: fm['type'] || 'task-complete',
  body,
  ...
};
// After:
return {
  from: fm['from'] || '',
  to: fm['to'] || 'core/core',
  body,
  completion: fm['status'] === 'complete' || fm['outcome'] === 'complete',
  ...
};
```

- [ ] **Step 2: Update core-message handler**

```ts
// Line 1106-1114:
// Before:
consumer.on('core-message', ({ id, filepath, from, type }) => {
  log.info('injector', 'Received core-message event', { id, from, type, ... });
  ...
  if (type === 'task-complete') {
    const [mesh] = from.split('/');
    removedTask = removeOutgoingTask(mesh);
  }

// After:
consumer.on('core-message', ({ id, filepath, from, completion }) => {
  log.info('injector', 'Received core-message event', { id, from, completion, ... });
  ...
  if (completion) {
    const [mesh] = from.split('/');
    removedTask = removeOutgoingTask(mesh);
  }
```

- [ ] **Step 3: Update worker-message handler**

```ts
// Line 1137-1140:
// Before:
consumer.on('worker-message', ({ agentId, from, type, injectResponse }) => {
  if (from === 'core/core' && (type === 'task' || type === 'message')) {

// After:
consumer.on('worker-message', ({ agentId, from, injectResponse }) => {
  if (from === 'core/core') {
```

- [ ] **Step 4: Update ask-response-message emit calls**

```ts
// Line 555: change event name
// Before:
consumer.emit('ask-response-message', {
// After:
consumer.emit('worker-resume', {

// Line 616: same change
consumer.emit('worker-resume', {
```

- [ ] **Step 5: Update appendPendingMessage to not use type**

Remove the `type` parameter from the function signature and calls.

- [ ] **Step 6: Commit**

```bash
git add src/cli/start.ts
git commit -m "$(cat <<'EOF'
refactor: remove type from CLI start event handlers

Use completion boolean instead of type string. Update event names
from ask-response-message to worker-resume.
EOF
)"
```

---

### Task 13: Update tests

**Files:**
- Delete: `test/unit/consumer-type-inference.test.ts`
- Modify: `test/unit/consumer.test.ts`
- Modify: `src/prompt/__tests__/builder.test.ts`
- Modify: `src/prompt/__tests__/routing.test.ts`
- Modify: any other test files with type references

- [ ] **Step 1: Delete the type inference test file**

```bash
trash test/unit/consumer-type-inference.test.ts
```

- [ ] **Step 2: Update consumer.test.ts**

Remove `type:` from message fixtures. Update event assertions to use new event names and payload shapes (no `type` field, `completion` boolean instead). Remove any assertions checking inferred type values.

- [ ] **Step 3: Update prompt builder test**

```ts
// src/prompt/__tests__/builder.test.ts
// Line 64: remove `type: task` from test message frontmatter
// Line 91: change assertion
// Before:
assert.ok(prompt.includes('task-complete message'));
// After:
assert.ok(prompt.includes('status: complete'));
```

- [ ] **Step 4: Update routing test**

```ts
// src/prompt/__tests__/routing.test.ts
// Line 55: keep 'ask-response' as routing category key — add comment
// Add above line 55:
// Note: routing category keys are opaque mesh config values, not system message types
```

- [ ] **Step 5: Search for any remaining type references in tests**

Run: `rg "type.*task|MessageType|ask-response|ask-human|task-complete" test/`

Fix any remaining references.

- [ ] **Step 6: Run the full test suite**

Run: `npx tsx --test test/unit/*.test.ts src/prompt/__tests__/*.test.ts 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add -A test/ src/prompt/__tests__/
git commit -m "$(cat <<'EOF'
test: update tests for type-free message routing

Delete type inference tests. Update fixtures and assertions to use
routing-based semantics instead of type strings.
EOF
)"
```

---

### Task 14: Fix FSM rejection silent drop

**Files:**
- Modify: `src/core/consumer.ts` (around lines 955-964)

- [ ] **Step 1: Write feedback message on FSM rejection instead of silent drop**

```ts
// Before (lines 955-964):
if (!isValid) {
  log.warn('consumer', 'Message rejected by FSM validation', {
    filepath: filename, from: fromAgent, to: toAgent,
  });
  return;  // silent drop
}

// After:
if (!isValid) {
  log.warn('consumer', 'Message rejected by FSM validation', {
    filepath: filename, from: fromAgent, to: toAgent,
  });
  // Write feedback so the agent knows its message was rejected
  if (this.systemWriter) {
    this.systemWriter.write({
      to: fromAgent,
      from: 'system/fsm-validator',
      headline: 'Message rejected by FSM validation',
      body: `Your message to \`${toAgent}\` was rejected because it does not match the current FSM state. Check the mesh FSM configuration and ensure your message is valid for the current state.`,
    });
  }
  return;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/consumer.ts
git commit -m "$(cat <<'EOF'
fix: write feedback on FSM rejection instead of silent drop

Previously, messages rejected by FSM validation were silently
dropped with only a WARN log. Now the agent receives feedback
explaining the rejection.
EOF
)"
```

---

### Task 15: Add regression test for the original bug

**Files:**
- Create: `test/unit/consumer-routing.test.ts`

- [ ] **Step 1: Write test for core→agent without pending ask**

```ts
/**
 * Consumer Routing Tests
 * Verify routing-based message dispatch (replaces type inference)
 */

import { test } from 'node:test';
import assert from 'node:assert';

test('core/core → agent without pending ask emits worker-message', async () => {
  // This is the original bug: previously inferred as ask-response
  // and silently swallowed when no pending ask existed.
  // Now it should emit worker-message (new work for dispatcher).

  // Setup: create consumer with test queue
  // Write message from core/core to test/agent with no pending asks in queue
  // Assert: worker-message event emitted (not ask-response-message)
  // Assert: no worker-resume event emitted
});

test('core/core → agent WITH pending ask emits worker-resume', async () => {
  // Setup: create consumer, insert pending ask for test/agent
  // Write message from core/core to test/agent
  // Assert: worker-resume event emitted
  // Assert: no worker-message event emitted
});

test('agent → core/core with status: complete emits core-message with completion: true', async () => {
  // Setup: create consumer
  // Write message from test/agent to core/core with status: complete
  // Assert: core-message event emitted with completion: true
});

test('agent → core/core without completion emits core-message with completion: false', async () => {
  // Setup: create consumer
  // Write message from test/agent to core/core (no status/outcome)
  // Assert: core-message event emitted with completion: false
});
```

Note: Flesh out the test bodies using the existing consumer test patterns (setup/teardown from consumer.test.ts).

- [ ] **Step 2: Run the new tests**

Run: `npx tsx --test test/unit/consumer-routing.test.ts 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add test/unit/consumer-routing.test.ts
git commit -m "$(cat <<'EOF'
test: add routing-based dispatch regression tests

Covers the original bug (core→agent without pending ask) and
verifies completion detection via frontmatter fields.
EOF
)"
```

---

### Task 16: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.claude/skills/mesh-builder/SKILL.md`

- [ ] **Step 1: Update CLAUDE.md Message Flow section**

Replace the "Terminal-by-Default Messaging" section to remove type references:

```markdown
### Routing-Based Messaging

TX uses **routing context** instead of explicit type fields:

- **To core/core**: Messages for human → session suspends awaiting response
- **From core/core**: Human responses → resumes session if pending ask exists, otherwise new work
- **Completion**: `status: complete` or `outcome: complete` in frontmatter → completion flow
- **Everything else**: Regular inter-agent message → dispatcher spawns/queues work
```

- [ ] **Step 2: Update Event-Driven Architecture table**

Remove `type` from event payloads. Update event names:
- `ask-response-message` → `worker-resume`
- Add `completion` boolean to core-message and worker-message payloads

- [ ] **Step 3: Update mesh-builder SKILL.md if it references type field**

Search for `type:` in the skill file and update any message format examples.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .claude/skills/mesh-builder/SKILL.md
git commit -m "$(cat <<'EOF'
docs: update CLAUDE.md and mesh-builder for type-free routing

Replace type-based messaging docs with routing-based semantics.
Update event names and payload descriptions.
EOF
)"
```

---

### Task 17: Final verification

- [ ] **Step 1: Full TypeScript compilation check**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors

- [ ] **Step 2: Run full test suite**

Run: `npx tsx --test test/unit/*.test.ts src/prompt/__tests__/*.test.ts 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 3: Search for any remaining type string references**

Run: `rg "MessageType|'ask-response'|'ask-human'|'task-complete'|inferMessageType|_explicitType" src/ --type ts`
Expected: No matches (routing.test.ts 'ask-response' category key is OK — it's a mesh config key)

- [ ] **Step 4: Commit any stragglers**

If any remaining references found, fix and commit.
