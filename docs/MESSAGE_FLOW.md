# Message Flow - Location-Based Injection System

## Overview

The tx message system uses a **location-based injection pattern** where messages are routed via file moves and injected as file locations into agent sessions. There are no inbox/outbox subdirectories - all messages for an agent live in a single flat directory.

## Core Architecture

### Message Storage
```
.ai/tx/mesh/{mesh}/agents/{agent}/msgs/
```
- Single flat directory per agent
- All messages (sent and received) in one place
- No subdirectories (no inbox/outbox)

### Message Routing Flow
```
1. Agent writes message → msgs/
2. Watcher detects new message (lib/simple-watcher.js)
3. Router moves file to destination (lib/simple-queue.js)
4. Injector attaches file location (lib/tmux-injector.js)
5. Destination agent receives via @filepath
```

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
`lib/simple-queue.js` handles routing via **file move**:
```javascript
// Parse destination from message frontmatter
const message = Message.fromFile(filePath);
const [destMesh, destAgent] = message.to.split('/');

// Move (not copy) to destination
const destPath = path.join(destAgentDir, 'msgs', filename);
await fs.rename(sourcePath, destPath);
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
| Message Transfer | Copy between directories | Move to destination |
| Delivery Method | File copy | Location injection via `@filepath` |
| Queue Implementation | `lib/queue.js` (1427 lines) | `lib/simple-queue.js` (simpler) |

## Message Lifecycle Example

### Agent A sends to Agent B:
```
1. Agent A writes: .ai/tx/mesh/test/agents/A/msgs/msg-001.md
2. Watcher detects new file in A's msgs/
3. Router reads frontmatter, sees "to: test/B"
4. Router moves file to: .ai/tx/mesh/test/agents/B/msgs/msg-001.md
5. Injector runs: @/workspace/...test/agents/B/msgs/msg-001.md
6. Agent B receives message as attached file
```

## Message States

Messages don't have explicit state directories. State is tracked by:
- **Location**: Which agent's `msgs/` directory contains the file
- **Filename**: Can include status prefixes (e.g., `complete-task-001.md`)
- **Frontmatter**: Contains status field

## Multi-Agent Communication

### Sequential Flow
```
Agent A → Agent B → Agent C
1. A writes to msgs/ with "to: B"
2. File moves to B's msgs/
3. B processes and writes response with "to: C"
4. File moves to C's msgs/
5. C processes and completes workflow
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
3. Ensure using `lib/simple-queue.js` not `lib/queue.js`
4. Verify tmux-injector is configured for location injection