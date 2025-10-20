# Logic Gaps Analysis: Watcher/Spawn/Message System

Generated: 2025-10-19

## 🔴 HIGH-RISK GAPS

### **Gap 1: Lost Messages When Agent Crashes**
- **File**: `lib/queue.js:828-866` (`notifyAgent`)
- **Issue**: Messages moved to `agent/active` and injected via tmux, but if Claude crashes before reading, message is **orphaned forever**
- **No recovery mechanism** - no watchdog, no timeout, no retry
- **Impact**: Silent message loss

### **Gap 2: Unroutable Messages Stuck in Outbox**
- **File**: `lib/queue.js:431-441` (`processOutbox`)
- **Issue**: Cross-mesh routing to non-existent mesh logs error and **returns without moving file**
- **No dead-letter queue** - bad messages accumulate in outbox
- **Impact**: Outbox pollution, no visibility into failures

### **Gap 3: Concurrent File Operations Race**
- **Files**: `lib/watcher.js:343-349`, `lib/queue.js` (multiple)
- **Issue**: `ignoreNextOperation()` is called, then `fs.moveSync()` executes. If watcher fires **between** these calls, event isn't ignored
- **Timing assumption**: 100ms `stabilityThreshold` should prevent this, but move is atomic
- **Impact**: Duplicate processing, potential loops

## 🟡 MEDIUM-RISK GAPS

### **Gap 4: Hardcoded Default Agent Name**
- **File**: `lib/queue.js:421-428` (`processOutbox`)
- **Issue**: When routing `to: some-mesh` (no agent specified), assumes agent is named `'core'`
```javascript
destAgent = 'core';  // What if mesh has no 'core' agent?
```
- **Impact**: Messages routed to non-existent agent inbox

### **Gap 5: No Mesh Config Validation in Spawn**
- **File**: `lib/commands/spawn.js:87-162`
- **Issue**: Validates agent config exists, but **doesn't verify mesh config exists or is valid**
- Directories created before validation might complete
- **Impact**: Orphaned directories, broken state

## 🔵 ARCHITECTURAL INSIGHTS

### **Frontmatter's Central Role** (Critical!)

Frontmatter is the **control plane metadata** for the entire system:

1. **Routing** (`to: mesh/agent`): Determines message destination
2. **Type** (`type: ask|task|update`): Triggers specific handlers
3. **Status** (`status: complete`): Auto-completes agent tasks
4. **Tracking** (`msg-id`): Links request/response pairs

**BUT** - validation is **permissive** (`lib/message.js:168-177`):
```javascript
catch (error) {
  Logger.warn('message', `⚠️ validation failed (message will still be delivered)`);
  // Proceeds anyway!
}
```

**Gap**: Invalid frontmatter → wrong routing → messages delivered to incorrect agents

### **The Watch → Spawn → Inject Dance**

```
Watcher detects file → EventBus emits → Queue routes → TmuxInjector delivers
          ↓                    ↓                ↓                    ↓
   chokidar 'add'      'file:inbox:new'   moves files      send-keys @filepath
```

**Critical assumption**: Agent session must **already exist** for injection to work. If spawn fails or session dies, `notifyAgent()` silently returns false (Gap #1).

## 📋 SPECIFIC ISSUES

### **Issue: `ignoreNextOperation()` Not Thread-Safe**
- **File**: `lib/watcher.js:347-349`
- Uses vanilla Set - no locking mechanism
- Multiple concurrent queue operations could corrupt ignore list

### **Issue: Frontmatter Parser Brittle**
- **File**: `lib/watcher.js:269-275`
- Naive `line.split(':')` breaks on values containing colons
- Workaround works for simple cases, fails on complex content

### **Issue: No Message TTL or Expiration**
- Messages can sit in queues indefinitely
- No age-based cleanup or alerting

---

## Your Specific Concerns Answered

**Watcher role**: Detects new `.md` files in `msgs/` directories, extracts frontmatter, emits typed events
**Frontmatter role**: **Control metadata** - routing, type, status - parsed at every stage
**Spawn role**: Creates tmux sessions, initializes directories, loads prompts - **but doesn't handle recovery**
**Injection role**: Delivers files to running Claude sessions - **assumes session exists**

**Key Gap**: The **lifecycle assumption** is linear (spawn → message → inject → process), but there's no handling for:
- Sessions dying mid-conversation
- Messages arriving before agent spawns
- Routing failures (bad mesh/agent names)

## The Complete Message Flow (End-to-End)

```
1. User writes message to mesh inbox
   ↓
2. Watcher detects file:inbox:new
   ↓
3. EventBus emits event
   ↓
4. Queue.processInbox listens
   ↓
5. Reads frontmatter to find target agent
   ↓
6. Moves inbox → agent inbox
   ↓
7. Watcher detects file:agent-inbox:new
   ↓
8. Queue.processAgentInbox listens
   ↓
9. Moves agent inbox → agent next
   ↓
10. Watcher detects file:agent-next:new
    ↓
11. Queue.processAgentNext listens
    ↓
12. Moves agent next → agent active
    ↓
13. Watcher detects file:agent-active:new
    ↓
14. Queue.notifyAgent injects file into Claude's tmux
    ↓
15. Claude processes and writes to agent outbox
    ↓
16. Watcher detects file:agent-outbox:new
    ↓
17. Queue.processOutbox reads frontmatter destination
    ↓
18. Routes to destination agent inbox (cross-mesh if needed)
    ↓
19. Cycle repeats at step 7
```

## Critical Files Summary

| File | Purpose | Key Function |
|------|---------|---|
| `lib/watcher.js` | File detection | `_handleFileAdd()`, event emission |
| `lib/message.js` | Message creation/parsing | `validateFrontmatter()`, `parseMessage()` |
| `lib/queue.js` | Message routing | `processInbox()`, `processOutbox()`, `notifyAgent()` |
| `lib/tmux-injector.js` | tmux control | `injectFile()`, `claudeReadyCheck()` |
| `lib/commands/spawn.js` | Agent initialization | `spawn()`, `generateTaskUID()` |
| `lib/event-bus.js` | Event coordination | `emit()`, listener registration |
| `lib/atomic-state.js` | State persistence | Lock-based updates |
| `lib/system-manager.js` | System orchestration | Startup order guarantee |
