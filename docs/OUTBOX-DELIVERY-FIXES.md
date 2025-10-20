# Outbox Message Delivery Fixes

## Summary

Fixed critical issues with outbox message processing and delivery to ensure all agent responses are properly routed to their destinations, even when multiple messages are queued.

## Issues Identified and Fixed

### 1. **Lost Agent Context in Event Parameters**
**Problem**: When an agent outbox file was detected by the watcher, the agent info was included in the event but not passed to the `processOutbox()` function. This meant the function had to re-derive the source agent from message metadata, which was inefficient and error-prone.

**Solution**:
- Updated event listener at `lib/queue.js:75-76` to pass the agent parameter
- Updated `processOutbox()` method signature to accept agent as a parameter
- Updated mesh-level outbox listener to pass `null` for agent

### 2. **No Batch Processing of Outbox Files**
**Problem**: When `processOutbox()` was called for a single outbox file, it only processed that one file. If an agent had multiple messages in its outbox queue, only the file that triggered the watcher event would be delivered. Subsequent files would remain stuck in the outbox.

**Solution**:
- Added `processAgentOutboxQueue()` method (lib/queue.js:692-731) to process remaining agent outbox files
- Added `processMeshOutboxQueue()` method (lib/queue.js:737-774) to process remaining mesh outbox files
- Modified `processOutbox()` to call these queue processors after successfully delivering a message (lines 655-661)
- Uses `setImmediate()` to avoid deep recursion while maintaining proper queue ordering

### 3. **No Processing of Existing Queue Backlog on Spawn**
**Problem**: If queue files existed before a mesh spawned (e.g., from a previous run or crash), they might not be processed in the correct order. Messages could be stuck in outbox, active, next, or inbox queues waiting for eventual processing by watchers.

**Solution**:
- Added `processQueueBacklog(mesh)` method to Queue class (lib/queue.js:88-137)
- Added `_processQueueBacklogForPath()` helper to process specific queues (lib/queue.js:139-205)
- Called from spawn.js after Claude is ready (lib/commands/spawn.js:212-215)
- Processes queues in order: **outbox → active → next → inbox** for both mesh and all agents
- Ensures all backlog is delivered when a mesh comes online (eventual consistency)

### 4. **Missing Defensive File Existence Checks**
**Problem**: The `processOutbox()` method didn't verify the file still existed before attempting to read it. If the file was moved or deleted by another process, the function would fail without proper error handling.

**Solution**:
- Added file existence check at line 470 before attempting to parse the message
- Added defensive try-catch around message parsing (lines 481-508)
- Added metadata validation to ensure 'to' field exists (lines 512-534)
- Enhanced error logging and evidence recording for all failure cases

### 5. **Inadequate Error Handling and Observability**
**Problem**: When outbox processing failed, errors were logged but there was limited evidence of what went wrong. No distinction between different failure types.

**Solution**:
- Added new Evidence types in lib/evidence.js:31-33:
  - `PARSE_ERROR`: Message file exists but can't be parsed
  - `INVALID_MESSAGE`: Message missing required fields
  - `PROCESSING_ERROR`: Other processing failures
- Enhanced logging with source agent context (added `sourceAgent` to logs at line 636)
- All error paths now record evidence for forensic analysis

## Code Changes

### lib/queue.js
- **Lines 70-77**: Updated event listeners to pass agent context to `processOutbox()`
- **Lines 88-137**: Added `processQueueBacklog(mesh)` method for spawn-time recovery
- **Lines 139-205**: Added `_processQueueBacklogForPath()` helper for queue-specific processing
- **Lines 467-686**: Completely refactored `processOutbox()` with:
  - File existence validation
  - Message parsing error handling
  - Required field validation
  - Enhanced logging and evidence recording
  - Recursive queue processing
- **Lines 692-774**: Added queue processing methods for batch delivery

### lib/system-manager.js
- **Removed**: Call to `Queue.processInitialOutbox()` (moved to spawn.js)
- Queue backlog processing now happens per-mesh at spawn time (eventual consistency)

### lib/commands/spawn.js
- **Line 7**: Added Queue import
- **Lines 212-215**: Added call to `Queue.processQueueBacklog(mesh)` after Claude is ready
- Processes all queued messages before injecting configuration

### lib/evidence.js
- **Lines 31-33**: Added new evidence types for better diagnostics

## Behavior Changes

### Before
```
1. System starts - queues initialized, watcher started
2. Agent writes response to outbox
3. Watcher detects file
4. File is routed to destination inbox
5. Other files in outbox remain unprocessed (stuck)
6. When mesh spawns later, no backlog recovery happens
```

### After
```
1. System starts - queues initialized, watcher started (no backlog processing)
2. Mesh is spawned - Claude initializes
3. After Claude is ready, queue backlog is processed in order:
   - Process all outbox files → route to destinations
   - Process all active files → notify agent to continue
   - Process all next files → move to active
   - Process all inbox files → queue for processing
4. This happens for both mesh-level AND all agent-level queues
5. New messages use event-driven processing (watcher events)
6. Ensures eventual consistency: backlog clears when mesh comes online
```

## Testing

To verify the fixes work:

```bash
# 1. Start the system
npm start

# 2. Check logs for outbox processing
tail -f .ai/tx/logs/debug.jsonl | grep outbox

# 3. Verify messages are routed correctly
find .ai/tx/mesh -name "outbox" -type d -exec ls -la {} \;

# 4. Check evidence log for any delivery issues
tail -f .ai/tx/logs/evidence.jsonl | grep outbox
```

## Performance Impact

- **System startup**: No change (no backlog processing at startup)
- **Mesh spawn**: Slightly longer due to `processQueueBacklog()` scanning agent queues
- **Runtime**: No measurable impact; queue processing is still event-driven for new messages
- **Memory**: Uses `setImmediate()` to process queues sequentially, preventing stack overflow
- **Benefits**: Faster system startup, improved mesh startup (one-time backlog clear), better eventual consistency

## Backwards Compatibility

All changes are backwards compatible:
- `processOutbox()` signature changed from 3 to 4 parameters, but all callsites updated
- Event listeners work with or without agent context
- Existing queue processing methods unchanged

## Related Issues

- Fixes messages stuck in agent outbox queues
- Enables reliable cross-mesh message routing
- Improves system resilience after crashes or restarts
