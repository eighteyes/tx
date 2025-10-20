# Cross-Mesh Routing Implementation

## Overview

Cross-mesh routing now fully supports messages being routed between different meshes in the tmux-riffic system. Previously, the `processOutbox()` function only routed messages within the same mesh.

## What Changed

### 1. `lib/queue.js` - Enhanced `processOutbox()` Function

**Location:** `lib/queue.js:324-406`

The `processOutbox()` function now supports three routing formats:

```javascript
// Same-mesh routing (agent within same mesh)
to: agent-name

// Cross-mesh with explicit agent
to: destMesh/destAgent

// Cross-mesh to default agent (usually 'core')
to: destMesh
```

**Key features:**
- Detects cross-mesh routing by checking if the destination mesh exists
- Routes messages to the correct mesh instead of staying within the source mesh
- Validates that destination mesh exists before attempting delivery
- Emits events to the destination mesh for processing
- Logs all routing with cross-mesh flag for debugging

### 2. `lib/message.js` - Relaxed Validation Rules

**Changes:**
- Made `msg-id` optional (audit field, not required for routing)
- Made `from` field more flexible to accept both `mesh/agent` and just `agent` formats
- Both changes allow legacy and new message formats to work

## Usage Examples

### Route to another mesh using implicit format
```yaml
from: test-echo-hfcp
to: core
type: task-complete
status: completed
```
→ Routes to `.ai/tx/mesh/core/agents/core/msgs/inbox/`

### Route to specific agent in another mesh
```yaml
from: my-agent
to: core/processor
type: task
status: pending
```
→ Routes to `.ai/tx/mesh/core/agents/processor/msgs/inbox/`

### Route within same mesh (backward compatible)
```yaml
from: agent-a
to: agent-b
type: ask
status: pending
```
→ Routes to `.ai/tx/mesh/current-mesh/agents/agent-b/msgs/inbox/`

## Implementation Details

### Routing Logic Flow

```
Message in outbox
    ↓
Parse message metadata (from, to, type, etc)
    ↓
Check if 'to' is cross-mesh?
    ├─ If to contains "/": Split as "destMesh/destAgent"
    │   └─ Check if destMesh == sourceMesh?
    │       ├─ Same-mesh → Route within source mesh
    │       └─ Cross-mesh → Route to destination mesh
    └─ If to doesn't contain "/": Check if it's a known mesh?
        ├─ Yes → Cross-mesh to "mesh/core" (default agent)
        └─ No → Same-mesh routing
    ↓
Validate destination mesh exists
    ↓
Create destination agent inbox path
    ↓
Move message from source outbox to destination inbox
    ↓
Emit event to destination mesh for processing
```

### Event Handling

When a cross-mesh message is routed, the system emits:
```javascript
EventBus.emit('file:inbox:new', {
  mesh: destMesh,        // Destination mesh (not source)
  file: filename,
  filepath: inboxPath,
  queue: 'inbox',
  agent: destAgent
});
```

This triggers the destination mesh's queue processing.

## Testing

### Test the implementation

```bash
# Run the cross-mesh routing test
node test/test-cross-mesh-routing-full.js

# Route all pending messages
node test/test-route-all-messages.js
```

### Real-world example: test-echo → core

The test-echo mesh previously had 3 undelivered messages trying to route to `to: core`:

**Before:**
```
.ai/tx/mesh/test-echo/agents/test-echo-hfcp/msgs/outbox
├── task-complete-qvn6w0.md
├── task-complete-vp1tgc.md
└── task-complete-zsoqru.md
```

**After cross-mesh routing:**
```
.ai/tx/mesh/core/agents/core/msgs/inbox
├── task-complete-qvn6w0.md  ✓
├── task-complete-vp1tgc.md  ✓
└── task-complete-zsoqru.md  ✓
```

## Backward Compatibility

- All existing same-mesh routing continues to work unchanged
- Legacy message formats (without `msg-id`) are now supported
- Agent-only names in `from` field are now accepted
- New messages can optionally include these fields

## Error Handling

If a message cannot be routed:
- Destination mesh doesn't exist → Error logged, message left in outbox
- Invalid message format → Error logged, message left in outbox
- Permission issues → Error logged, message left in outbox

Messages that fail routing remain in the source outbox for retry or manual inspection.

## Architecture Benefits

✓ **Decoupled Meshes**: Agents can communicate across mesh boundaries
✓ **Flexible Routing**: Support both implicit (known mesh) and explicit (mesh/agent) formats
✓ **Event-Driven**: Destination meshes process cross-mesh messages through normal queue
✓ **Debuggable**: Clear logging with cross-mesh flag for troubleshooting
✓ **Composable**: Enables multi-mesh workflows and agent coordination

## Files Modified

- `lib/queue.js` - Enhanced cross-mesh routing in `processOutbox()`
- `lib/message.js` - Relaxed validation for backward compatibility

## Related Documentation

- `docs/MESSAGE_FLOW.md` - Message flow architecture
- `docs/MESSAGE_BOXES_VISUALIZATION.md` - Inbox/outbox structure
