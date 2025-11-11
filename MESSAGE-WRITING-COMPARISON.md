# Message Writing: MessageWriter vs Direct File Write

## Question
Is it more effective to call `MessageWriter.write()` or just write a file directly to `.ai/tx/msgs/`?

## TL;DR
**Use MessageWriter.write()** - it provides critical functionality beyond just writing files.

---

## What MessageWriter Provides

### 1. **State Tracking (Critical)**
```javascript
// Updates sender's activity timestamp
StateManager.updateActivity(from);

// Auto-detects state transitions based on message type
if (type === 'ask-human') {
  StateManager.transitionState(from, StateManager.STATES.BLOCKED);
}
if (type === 'task-complete') {
  StateManager.transitionState(from, StateManager.STATES.COMPLETING);
}
```

**Without this**: Agents' `last_activity` never updates, distraction detection fails, states don't transition.

### 2. **Rearmatter Validation**
```javascript
// Detects and validates rearmatter (spawning directives)
const { content, rearmatter } = RearmatterSchema.extractFromMessage(content);
const validation = RearmatterSchema.parse(rearmatterYaml);
```

**Without this**: Invalid rearmatter goes undetected, causing silent failures or spawning issues.

### 3. **Consistent Filename Generation**
```javascript
const filename = this.buildFilename(timestamp, from, to, type, msgId);
// Format: MMDDHHMMSS-{type}-{from}>{to}-{msgId}.md
```

**Without this**: Risk of filename collisions, incorrect format, sorting issues.

### 4. **Frontmatter Standardization**
```javascript
const completeFrontmatter = {
  to,
  from,
  type,
  'msg-id': msgId,
  timestamp,
  ...frontmatter  // Merges user-provided metadata
};
```

**Without this**: Missing required fields, inconsistent metadata, parsing failures.

### 5. **Logging & Observability**
```javascript
Logger.log('message-writer', 'Message written to event log', {
  from, to, type, msgId, filepath, hasRearmatter
});
```

**Without this**: No audit trail, harder to debug message flow.

### 6. **Dual-Write Support (Backward Compatibility)**
```javascript
// Optionally writes to old location for migration support
if (options.dualWrite && options.oldPath) {
  await fs.writeFile(options.oldPath, message);
}
```

**Without this**: Break backward compatibility during migration period.

---

## Direct File Write Example

```javascript
// ❌ BAD: Direct file write
const timestamp = new Date();
const mm = String(timestamp.getMonth() + 1).padStart(2, '0');
const dd = String(timestamp.getDate()).padStart(2, '0');
// ... build filename manually
const filepath = `.ai/tx/msgs/${ts}-task-core>brain-${msgId}.md`;

const frontmatter = `---
to: brain/brain
from: core/core
type: task
msg-id: ${msgId}
timestamp: ${timestamp.toISOString()}
---

`;

fs.writeFileSync(filepath, frontmatter + content);

// Missing:
// - Activity update for core/core
// - State transition detection
// - Rearmatter validation
// - Logging
// - Error handling
```

## MessageWriter Example

```javascript
// ✅ GOOD: Use MessageWriter
await MessageWriter.write(
  'core/core',           // from
  'brain/brain',         // to
  'task',                // type
  'task-123',            // msgId
  taskContent,           // content
  {                      // additional frontmatter
    headline: 'Analyze codebase',
    priority: 'high',
    status: 'start'
  }
);

// Automatically handles:
// - Activity update for core/core ✅
// - State transitions (if applicable) ✅
// - Rearmatter validation ✅
// - Filename generation ✅
// - Frontmatter standardization ✅
// - Logging ✅
```

---

## When You MIGHT Write Directly

There are very few cases where direct file writes are appropriate:

### 1. **System Messages (Not from Agents)**
If you're writing system-level messages that don't come from a tracked agent:

```javascript
// System notification (no agent activity to track)
const filepath = `.ai/tx/msgs/${timestamp}-system-notification-${msgId}.md`;
fs.writeFileSync(filepath, message);
```

**Better**: Create a `system` agent ID and use MessageWriter anyway for consistency.

### 2. **Testing/Development**
When writing test fixtures or debugging:

```javascript
// Quick test message
fs.writeFileSync('.ai/tx/msgs/test-message.md', testContent);
```

**Better**: Use MessageWriter even in tests to validate your test data format.

### 3. **Migration Scripts**
When bulk-migrating old messages:

```javascript
// Batch migration of 1000s of old messages
for (const oldMsg of oldMessages) {
  fs.writeFileSync(newPath, convertedMessage);
}
```

**Even here**: Consider wrapping in MessageWriter calls for validation.

---

## Performance Considerations

**Question**: "Is MessageWriter slower because it does more work?"

**Answer**: The overhead is negligible:

```javascript
MessageWriter.write() adds:
- 1 activity timestamp update (~1ms)
- 1-2 state transition checks (~1ms)
- Rearmatter regex extraction (~1ms)
- Frontmatter object merge (~<1ms)
- Logging (~1ms)

Total overhead: ~5ms per message
```

For 99.9% of use cases, this is irrelevant. You're not sending thousands of messages per second.

**The value gained** (state tracking, validation, consistency) **far outweighs** the minimal performance cost.

---

## Best Practices

### ✅ DO: Use MessageWriter for all inter-agent messages

```javascript
await MessageWriter.write(from, to, type, msgId, content, frontmatter);
```

### ✅ DO: Use MessageWriter for agent-to-system messages

```javascript
await MessageWriter.write('brain/brain', 'system', 'error', errorId, errorMsg);
```

### ❌ DON'T: Write directly unless you have a very specific reason

```javascript
// Avoid this
fs.writeFileSync('.ai/tx/msgs/message.md', content);
```

### ✅ DO: If you must write directly, explain why in a comment

```javascript
// Direct write: System-level notification with no associated agent
// (No activity tracking needed)
fs.writeFileSync(filepath, systemNotification);
```

---

## Summary

| Feature | MessageWriter | Direct Write |
|---------|--------------|--------------|
| State tracking | ✅ Automatic | ❌ Manual required |
| Activity updates | ✅ Automatic | ❌ Manual required |
| Rearmatter validation | ✅ Built-in | ❌ Not available |
| Filename consistency | ✅ Guaranteed | ⚠️ Error-prone |
| Frontmatter standardization | ✅ Enforced | ⚠️ Manual |
| Logging | ✅ Automatic | ❌ Manual required |
| Observability | ✅ Built-in | ❌ None |
| Code complexity | ✅ Simple API | ⚠️ Error-prone |

**Verdict**: Use `MessageWriter.write()` for all message writing. The benefits far outweigh any perceived simplicity of direct writes.
