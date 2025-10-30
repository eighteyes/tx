# Message Flow - Stay-In-Place Message System

## Overview

The tx message system uses a **stay-in-place pattern** where messages NEVER move or get copied. Each agent writes messages to their own `msgs/` folder, and the system injects file references (`@filepath`) to destination agents. Messages remain at their origin throughout their lifecycle.

## ❌ What NOT to Do

**These patterns are WRONG and from the old system:**
- ❌ Moving files from one agent's msgs/ to another's
- ❌ Copying message files between agents
- ❌ Using `fs.rename()` or `fs.move()` for message delivery
- ❌ Writing messages to other agents' directories
- ❌ Assuming messages "travel" to their destination

**✅ Correct behavior:**
- ✅ Messages stay in creator's msgs/ folder forever
- ✅ Only @filepath references are injected to recipients
- ✅ Recipients read from the original location

## Core Architecture

### Mental Model: Messages Stay Home
```
┌─────────────────┐       ┌─────────────────┐
│   Agent A       │       │   Agent B       │
│   msgs/         │       │   msgs/         │
│   ├─ msg1.md ───┼──@──→ │                 │
│   └─ msg2.md    │       │   └─ reply.md ──┼──@──→ Agent C
└─────────────────┘       └─────────────────┘
     ↑ stays here              ↑ stays here

Messages NEVER move. Only @filepath references are injected.
```

### Message Storage
```
.ai/tx/mesh/{mesh}/agents/{agent}/msgs/
```
- Single flat directory per agent
- Messages stay where created (never move to other agents)
- No subdirectories (no inbox/outbox)

### Message Routing Flow
```
1. Agent writes message → their own msgs/
2. Watcher detects new message (lib/watcher.js)
3. Router reads frontmatter to find destination (lib/queue.js)
4. Injector injects file reference via @filepath (lib/tmux-injector.js)
5. Destination agent receives reference to original location
```

**CRITICAL: Files NEVER move from their creation location**

## Implementation Details

### 1. Message Creation
Agent writes message to its own `msgs/` directory:
```markdown
# File: .ai/tx/mesh/researcher/agents/analyzer/msgs/task-001.md
---
from: researcher/analyzer
to: researcher/summarizer
type: task
---
Message content
```

### 2. Message Detection
`lib/simple-watcher.js` watches for new files:
```javascript
// Watches msgs/ directory (not subdirectories)
const msgDir = path.join(agentDir, 'msgs');
watcher.add(msgDir);
```

### 3. Message Routing
`lib/queue.js` handles routing via **file reference injection**:
```javascript
// Parse destination from message frontmatter
const message = Message.parseMessage(filepath);
const { to } = message.metadata;

// Inject filepath reference (file stays at origin)
TmuxInjector.injectFile(sessionName, filepath);

// ❌ NO file move/copy - file remains at creation location
```

### 4. Message Injection
`lib/tmux-injector.js` injects file location using Claude Code's @ command:
```javascript
// Send @ to trigger attachment feature
sendKeys('@');
await sleep(200);

// Send absolute file path
sendKeys('/absolute/path/to/message.md');
await sleep(200);

// Send Enter to attach
sendKeys('Enter');
```

## Key Differences from Old System

| Aspect | Old System | Current System |
|--------|------------|----------------|
| Directory Structure | `msgs/inbox/`, `msgs/outbox/` | Single `msgs/` directory |
| Message Transfer | Copy/move between directories | ❌ NO TRANSFER - stays at origin |
| Delivery Method | File copy to destination | Reference injection via `@filepath` |
| Message Location | Changes (moves to receiver) | Fixed (stays with sender) |
| Queue Implementation | `lib/queue.js` with inbox/outbox | `lib/queue.js` with stay-in-place |

## Message Lifecycle Example

### Agent A sends to Agent B:
```
1. Agent A writes: .ai/tx/mesh/test/agents/A/msgs/msg-001.md
2. Watcher detects new file in A's msgs/
3. Router reads frontmatter, sees "to: test/B"
4. Router injects: @/workspace/.ai/tx/mesh/test/agents/A/msgs/msg-001.md
5. Agent B receives file reference (file STAYS in A's msgs/)
6. Agent B reads from A's location
```

**KEY INSIGHT: msg-001.md NEVER leaves A's msgs/ folder**

## Message States

Messages don't have explicit state directories. State is tracked by:
- **Ownership**: Messages stay in creator's `msgs/` directory (never move)
- **Filename**: Can include status prefixes (e.g., `complete-task-001.md`)
- **Frontmatter**: Contains status field
- **Visibility**: Destination agents receive references, not copies

## Multi-Agent Communication

### Sequential Flow
```
Agent A → Agent B → Agent C
1. A writes msg-001.md to A/msgs/ with "to: B"
2. System injects @.../A/msgs/msg-001.md to B
3. B processes and writes msg-002.md to B/msgs/ with "to: C"
4. System injects @.../B/msgs/msg-002.md to C
5. C processes msg-002.md from B's location

Note: Each message stays in its creator's msgs/ folder
```

### Parallel Processing
Multiple agents can receive different messages simultaneously:
```
Coordinator writes:
- task-001.md (to: Agent A)
- task-002.md (to: Agent B)
- task-003.md (to: Agent C)

All three files are routed in parallel.
```

## Error Handling

### Failed Routing
If destination agent doesn't exist:
- Message remains in sender's `msgs/` directory
- Error logged in `.ai/tx/logs/debug.jsonl`
- No automatic retry (manual intervention required)

### Injection Failures
If tmux injection fails:
- Message file exists at destination
- Agent won't see it automatically
- Can be manually injected via `@filepath`

## Benefits of Current Architecture

1. **Simplicity**: Single directory is easier to understand
2. **Efficiency**: File moves are atomic operations
3. **Clarity**: Message location indicates current owner
4. **Debugging**: Easier to track message flow
5. **No Duplication**: Messages exist in only one place

## Technical References

- Message parsing: `lib/message.js`
- File watching: `lib/simple-watcher.js`
- Routing logic: `lib/simple-queue.js`
- Location injection: `lib/tmux-injector.js`
- Event coordination: `lib/event-bus.js`

## Quick Command Reference

### Check message location:
```bash
ls -la .ai/tx/mesh/*/agents/*/msgs/
```

### Watch message flow:
```bash
tail -f .ai/tx/logs/debug.jsonl | jq
```

### Manual message injection:
In agent's tmux session, type:
```
@/absolute/path/to/message.md
```

## Migration Notes

If upgrading from old outbox/inbox system:
1. Update all agent prompts to write to `msgs/` not `msgs/outbox/`
2. Remove references to inbox/outbox subdirectories
3. ❌ Remove any code that moves/copies message files
4. ✅ Understand messages stay at origin (never move)
5. Verify tmux-injector is configured for location injection

**CRITICAL: If you see code that moves or copies message files, it's WRONG**