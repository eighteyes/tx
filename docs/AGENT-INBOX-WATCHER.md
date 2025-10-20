# Agent Inbox Watcher System

## Overview

The system now has complete support for watching and processing agent inbox files. This enables cross-mesh message routing to be automatically processed by the destination agent.

## What Changed

### 1. Enhanced Watcher (`lib/watcher.js`)

**New Capability:** Distinguish between mesh inbox and agent inbox files

The watcher now emits different events based on file location:

```
Mesh inbox:        .ai/tx/mesh/[mesh]/msgs/inbox/file.md
                   → Emits: file:inbox:new

Agent inbox:       .ai/tx/mesh/[mesh]/agents/[agent]/msgs/inbox/file.md
                   → Emits: file:agent-inbox:new
                   → Includes: { mesh, agent, file, filepath }
```

**Implementation:**
- Checks if file path includes `/agents/` to determine if it's an agent inbox
- Extracts agent name using regex: `\/agents\/([^/]+)\/msgs/`
- Emits correct event type with agent context

### 2. Enhanced Queue (`lib/queue.js`)

**New Event Listeners:**

```javascript
EventBus.on('file:agent-inbox:new', ({ mesh, agent, file }) => {
  Queue.processAgentInbox(mesh, agent);
});

EventBus.on('file:agent-next:new', ({ mesh, agent, file }) => {
  Queue.processAgentNext(mesh, agent);
});

EventBus.on('file:agent-active:removed', ({ mesh, agent }) => {
  Queue.processAgentNext(mesh, agent);
});
```

These listeners automatically trigger agent queue processing when files are detected.

### 3. Updated Cross-Mesh Routing (`lib/queue.js` - `processOutbox`)

Now emits the correct event to trigger agent inbox processing:

```javascript
EventBus.emit('file:agent-inbox:new', {
  mesh: destMesh,
  agent: destAgent,
  file,
  filepath: inboxPath,
  queue: 'inbox'
});
```

This notifies the destination mesh to process the routed message.

## Complete Flow: Cross-Mesh Message Routing

```
┌─────────────────────────────────────────────────────────┐
│ test-echo-hfcp creates response with "to: core"         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Message written to outbox                               │
│ .../test-echo/agents/test-echo-hfcp/msgs/outbox/msg.md │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Watcher detects outbox file → emit: file:outbox:new    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Queue.processOutbox() called                            │
│ - Parses "to: core"                                     │
│ - Detects cross-mesh routing                            │
│ - Moves file to destination agent inbox                 │
│ - .../core/agents/core/msgs/inbox/msg.md              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Emits: file:agent-inbox:new                            │
│ { mesh: 'core', agent: 'core', file: 'msg.md' }       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Queue listener for file:agent-inbox:new triggered     │
│ Calls: Queue.processAgentInbox('core', 'core')        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Message processed through agent queue                   │
│ inbox → next → active → complete                       │
└─────────────────────────────────────────────────────────┘
```

## Event Types

### Mesh-Level Events (Original)
- `file:inbox:new` - New file in mesh inbox
- `file:next:new` - New file in mesh next queue
- `file:active:new` - New file in mesh active queue
- `file:complete:new` - New file in mesh complete queue
- `file:outbox:new` - New file in mesh outbox
- etc.

### Agent-Level Events (New)
- `file:agent-inbox:new` - New file in agent inbox
  - Includes: `{ mesh, agent, file, filepath, queue }`
- `file:agent-next:new` - New file in agent next queue
- `file:agent-active:new` - New file in agent active queue
- `file:agent-active:removed` - File removed from agent active
- `file:agent-complete:new` - New file in agent complete
- `file:agent-outbox:new` - New file in agent outbox
- `file:ask:new` - Ask message (agent inbox)
- `file:ask-response:new` - Ask response (agent inbox)

## Architecture Benefits

✓ **Automatic Processing**: Messages in agent inboxes are automatically moved through the queue
✓ **Cross-Mesh Integration**: Destination meshes process routed messages without manual intervention
✓ **Event-Driven**: Clean separation of concerns using event bus
✓ **Backward Compatible**: Mesh-level inbox handling unchanged
✓ **Debuggable**: Clear event flow with agent context in logs

## Testing

### Agent Inbox Watcher Test
```bash
node test/test-agent-inbox-watcher.js
```

Verifies:
- ✅ Watcher detects agent inbox files
- ✅ Queue processes agent inbox automatically
- ✅ Messages move through agent queue

### Full Cross-Mesh Flow Test
```bash
node test/test-full-cross-mesh-flow.js
```

Verifies:
- ✅ Message routing from one mesh to another
- ✅ Watcher detection of cross-mesh messages
- ✅ Queue automatic processing of routed messages

## Files Modified

- `lib/watcher.js` - Enhanced file detection with agent context
- `lib/queue.js` - Added agent inbox event listeners
- `lib/queue.js` - Updated processOutbox to emit correct event

## Related Documentation

- `docs/CROSS-MESH-ROUTING.md` - Cross-mesh message routing
- `docs/MESSAGE_FLOW.md` - Overall message flow architecture
- `docs/MESSAGE_BOXES_VISUALIZATION.md` - Queue structure
