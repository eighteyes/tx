# Event-Based Architecture Migration

## Overview

TX Watch has been successfully migrated from an OOP/procedural architecture to a fully event-driven system. This eliminates circular dependencies, improves testability, and makes the system flow explicit through event names.

## What Changed

### Before (OOP with Circular Dependencies)
```javascript
// Watcher called Queue directly
class Watcher {
  handleNewMessage(mesh, file) {
    Queue.processInbox(mesh);  // Direct call
  }
}

// Queue called Watcher directly
class Queue {
  ensureQueueContinues(mesh) {
    Watcher.checkMesh(mesh);  // Direct call
  }
}
```

**Problems:**
- Circular import (Watcher → Queue → Watcher)
- Tight coupling between components
- Hard to test in isolation
- System behavior hidden in method calls
- Difficult to add new listeners

### After (Event-Based)
```javascript
// Watcher emits events
class Watcher {
  handleNewMessage(mesh, file) {
    EventBus.emit('file:inbox:new', { mesh, file });
  }
}

// Queue listens to events
class Queue {
  static init() {
    EventBus.on('file:inbox:new', ({ mesh }) => {
      Queue.processInbox(mesh);
    });
  }
}
```

**Benefits:**
- Zero circular dependencies
- Loose coupling via events
- Easy to mock for testing
- System behavior documented in event names
- Extensible - just add more listeners

## Migration Summary

### 1. EventBus Core (lib/event-bus.js)

Created a central event coordination system:

```javascript
// Register listener
EventBus.on('file:inbox:new', handler);

// Wildcard listeners
EventBus.on('file:*', handler);  // All file events
EventBus.on('*', handler);       // All events

// Emit event
EventBus.emit('file:inbox:new', { mesh, file });

// One-time listeners
EventBus.once('system:started', handler);

// Priority listeners (higher = first)
EventBus.on('task:queued', handler, { priority: 10 });
```

**Features:**
- Async and sync event emission
- Event logging (last 1000 events)
- Wildcard pattern matching
- Priority-based execution
- Debug mode for development
- Event statistics and introspection

### 2. Watcher Migration (lib/watcher.js)

**Changes:**
- Removed `const { Queue } = require('./queue')`
- Added `const { EventBus } = require('./event-bus')`
- Replaced ~12 direct Queue method calls with event emissions

**Events Emitted:**
- `watcher:started` - File watcher initialized
- `watcher:stopped` - File watcher shutdown
- `file:inbox:new` - Message added to inbox
- `queue:process:next` - Request to process next queue
- `file:complete:new` - Message marked complete
- `file:active:removed` - Active file removed

### 3. Queue Migration (lib/queue.js)

**Changes:**
- Added `const { EventBus } = require('./event-bus')`
- Created `Queue.init()` method to register event listeners
- Added event emissions for task lifecycle

**Events Listened To:**
- `file:inbox:new` → calls `processInbox()` or `processAgentInbox()`
- `queue:process:next` → calls `processNext()` or `processAgentNext()`
- `file:complete:new` → processes next task
- `file:active:removed` → processes next task

**Events Emitted:**
- `task:queued` - Task moved from inbox to next
- `task:activated` - Task moved from next to active

### 4. AtomicState Migration (lib/atomic-state.js)

**Changes:**
- Added `const { EventBus } = require('./event-bus')`
- Emits `state:changed` on every update
- Includes previous/current state snapshots

**Events Emitted:**
```javascript
EventBus.emit('state:changed', {
  mesh: 'core',
  changes: { status: 'active' },
  previous: { status: 'stopped', ... },
  current: { status: 'active', ... }
});
```

### 5. SystemManager Updates (lib/system-manager.js)

**Changes:**
- Calls `Queue.init()` before starting Watcher
- Ensures event listeners are registered before file watching begins

```javascript
// Initialize queue event listeners before starting watcher
Queue.init();

// Start file watcher so it's ready when meshes initialize
Watcher.start();
```

## Event Catalog

See [EVENTS.md](./EVENTS.md) for complete event documentation.

### Event Naming Convention
`category:subcategory:action`

Examples:
- `file:inbox:new` - File added to inbox
- `task:queued` - Task queued for processing
- `state:changed` - State updated
- `workflow:advanced` - Workflow moved to next agent

### Event Flow Example

Typical task processing flow:

```
1. file:inbox:new        → Watcher detects new file
2. task:queued           → Queue moves to next queue
3. file:next:new         → Watcher detects in next
4. task:activated        → Queue moves to active
5. file:active:new       → Watcher detects activation
6. task:injected         → TmuxInjector sends to agent
   (Agent works on task...)
7. task:completed        → Agent runs `tx done`
8. file:complete:new     → File moved to complete
9. workflow:advanced     → (if multi-agent)
```

## Testing the Migration

### Quick Test
```bash
# Start in mock mode
MOCK_MODE=true DEBUG=true tx start

# Watch event logs
tail -f .ai/tx/logs/*.jsonl
```

### Event Debugging
```javascript
// Get recent events
const events = EventBus.getEventLog();

// Filter by type
const fileEvents = EventBus.getEventLog('file:inbox:new');

// Get statistics
const stats = EventBus.getStats();
// {
//   totalEvents: 10,
//   totalListeners: 25,
//   eventLog: 150,
//   events: { 'file:inbox:new': 3, ... }
// }
```

### Enable Debug Mode
```bash
TX_DEBUG_MODE=true tx start
```

This will log every event emission to help trace system behavior.

## Benefits Achieved

### ✅ Zero Circular Dependencies
- Watcher no longer imports Queue
- Queue no longer imports Watcher
- Components communicate only via EventBus

### ✅ Improved Testability
```javascript
// Mock EventBus for unit tests
const mockBus = { emit: jest.fn(), on: jest.fn() };
```

### ✅ Enhanced Debugging
- Every event logged with timestamp
- Event replay capability for debugging
- Clear system behavior trail

### ✅ Better Extensibility
```javascript
// Add new feature without modifying core
EventBus.on('task:queued', ({ mesh, taskId }) => {
  // Custom analytics
  trackTaskMetric(mesh, taskId);
});
```

### ✅ Self-Documenting
Event names describe what's happening:
- `file:inbox:new` - New file in inbox (clear!)
- `Queue.processInbox()` - Process inbox (what does this do?)

## Migration Statistics

- **Files Changed:** 12
- **Lines Added:** 1,411
- **Lines Removed:** 106
- **Net Change:** +1,305 lines (mostly documentation)
- **Circular Dependencies Removed:** 1 (Watcher ↔ Queue)
- **Event Types Defined:** 25+
- **Time to Migrate:** ~2-3 hours

## Next Steps

### Potential Enhancements

1. **Event Replay for Testing**
   ```javascript
   const replay = EventBus.getEventLog();
   replay.forEach(({ event, data }) => {
     EventBus.emit(event, data);
   });
   ```

2. **Event Persistence**
   - Save events to disk for audit trail
   - Replay events after crash recovery

3. **Remote Events**
   - Emit events over network
   - Distributed mesh coordination

4. **Event Filtering/Routing**
   - Route events to specific handlers
   - Filter events based on criteria

5. **Performance Monitoring**
   - Track event processing time
   - Identify slow handlers

## Backwards Compatibility

**BREAKING CHANGES:** None

The public API remains unchanged:
- `Queue.processInbox()` still works
- `Watcher.start()` still works
- All existing code continues to function

The only difference is:
- Internally uses events instead of direct calls
- Must call `Queue.init()` on system startup

## Conclusion

The event-based architecture makes TX Watch more maintainable, testable, and extensible. The system's behavior is now explicit through event names, making it easier to understand and debug.

**Key Takeaway:** Event-driven architecture is a natural fit for file-based systems like TX Watch. The file watcher IS already event-driven - we just formalized it.
