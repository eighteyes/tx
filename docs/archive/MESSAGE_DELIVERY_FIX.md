# Message Delivery Fix - Outbox Routing

## Problem

When spawning a mesh with a task (e.g., `test-echo-hfcp`), agent responses were getting stuck in an `outbox` directory and never being delivered to their destination inbox.

Example stuck message:
```
.ai/tx/mesh/test-echo/agents/test-echo-hfcp/msgs/outbox/task-complete-qvn6w0.md
```

## Root Cause

1. **MockAgent** was writing responses to an orphaned `outbox` directory
2. **Outbox was not part of the standard queue system** - no handlers existed to process or route messages from it
3. The Queue system only handled: `inbox`, `next`, `active`, `complete`, `archive`
4. Messages in outbox had nowhere to go and never reached their destination

## Solution

### 1. Fixed MockAgent Response Routing (`lib/mock-agent.js`)

**Before**: Response messages were written to `msgs/outbox/` directory
```javascript
const outboxDir = path.join(meshDir, 'msgs', 'outbox');
fs.ensureDirSync(outboxDir);
fs.writeFileSync(outboxPath, response);
```

**After**: Response messages are routed directly to destination agent's inbox
```javascript
const destAgentDir = path.join(meshDir, 'agents', toAgent, 'msgs', 'inbox');
fs.ensureDirSync(destAgentDir);
fs.writeFileSync(responsePath, response);

Logger.log('mock-agent', 'Response routed to destination inbox', {...});
```

### 2. Added Outbox Handler to Queue System (`lib/queue.js`)

**Added event listener** in `Queue.init()`:
```javascript
EventBus.on('file:outbox:new', ({ mesh, file, filepath }) => {
  Queue.processOutbox(mesh, file, filepath);
});
```

**Added `processOutbox()` function**:
- Reads and parses outbox message
- Extracts destination agent from `to` field
- Moves message from `outbox` to destination agent's `inbox`
- Triggers inbox processing to move message through the queue

```javascript
static processOutbox(mesh, file, filepath) {
  // Parse message to extract destination
  const message = Message.parseMessage(filepath);
  const destAgent = message.metadata.to.split('/')[1];

  // Move to destination inbox
  const destAgentDir = path.join(`.ai/tx/mesh/${mesh}`, 'agents', destAgent, 'msgs', 'inbox');
  fs.moveSync(outboxPath, inboxPath);

  // Trigger queue processing
  EventBus.emit('file:inbox:new', {...});
}
```

## How It Works Now

1. **Agent creates response message** → writes to outbox (temporary location)
2. **Watcher detects file** → emits `file:outbox:new` event
3. **Queue processes outbox** → routes to destination inbox
4. **Queue processes inbox** → moves through standard queue: inbox → next → active → complete

## Message Flow Diagram

```
Agent completes task
        ↓
Creates response in outbox
        ↓
Watcher detects file
        ↓
Emits 'file:outbox:new' event
        ↓
Queue.processOutbox() routes to destination inbox
        ↓
Message in: .ai/tx/mesh/{mesh}/agents/{destAgent}/msgs/inbox/
        ↓
Queue.processInbox() moves: inbox → next
        ↓
Queue.processNext() moves: next → active
        ↓
Destination agent processes message
        ↓
Message moved: active → complete
```

## Files Modified

1. `lib/mock-agent.js` - Fixed `_createResponseMessage()` to route to destination inbox
2. `lib/queue.js` - Added outbox event listener and `processOutbox()` function

## Testing

To verify the fix works:

```bash
# Spawn an agent with a task
tx spawn test-echo test-echo -i "test message"

# Check that responses reach the core inbox instead of staying in outbox
ls .ai/tx/mesh/test-echo/agents/core/msgs/inbox/
```

The message should appear in the destination inbox and not be stuck in outbox.

## Benefits

✅ Messages are no longer stuck in outbox
✅ Agent responses reach their destinations
✅ Maintains backward compatibility with existing queue system
✅ Automatic routing without additional intervention needed
