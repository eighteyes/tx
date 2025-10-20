# Evidence Logging & System Validation Implementation

**Date**: 2025-10-19
**Status**: ✅ Complete

## Overview

Implemented comprehensive evidence logging system and validation framework to detect and record system anomalies, addressing logic gaps identified in the watcher/spawn/message flow.

---

## 1. Evidence Logging System

### New File: `lib/evidence.js`

**Purpose**: Forensic logging of system anomalies and failures

**Features**:
- JSONL format logging to `.ai/tx/logs/evidence.jsonl`
- Structured evidence types with full context
- 5000-line rolling log (auto-trimmed)
- Query methods: `tail()`, `summary()`

**Evidence Types**:
```javascript
{
  ROUTING_FAILURE,       // Message routing failed
  MISSING_SESSION,       // Agent session not found (Gap 1)
  INVALID_FRONTMATTER,   // Frontmatter validation failed
  HARDCODED_FALLBACK,    // Used hardcoded default (Gap 4)
  MESH_NOT_FOUND,        // Destination mesh doesn't exist (Gap 2)
  AGENT_NOT_FOUND,       // Agent config missing
  ORPHANED_MESSAGE,      // Message stuck in queue
  DUPLICATE_PROCESSING,  // Concurrent processing detected
  QUEUE_STUCK,          // Queue not advancing
  CONFIG_INVALID,       // Configuration error
  DIRECTORY_MISSING,    // Required directory not found
  VALIDATION_FAILURE    // System validation failed
}
```

**Evidence Structure**:
```json
{
  "timestamp": "2025-10-19T12:34:56.789Z",
  "type": "mesh_not_found",
  "description": "Message stuck in outbox - destination mesh does not exist",
  "context": {
    "mesh": "core",
    "agent": "core",
    "file": "2510191234-task.md",
    "queue": "outbox",
    "frontmatter": { "from": "core", "to": "nonexistent", "type": "task" },
    "component": "queue",
    "destMesh": "nonexistent",
    "destMeshDir": ".ai/tx/mesh/nonexistent",
    "filepath": ".ai/tx/mesh/core/agents/core/msgs/outbox/2510191234-task.md"
  }
}
```

---

## 2. Fixed Gap 4: Hardcoded 'core' Agent

### Problem
**File**: `lib/queue.js:426`

When routing to a mesh without specifying agent (e.g., `to: some-mesh`), system hardcoded `destAgent = 'core'`, causing failures if mesh doesn't have 'core' agent.

### Solution

**Added**: `Queue.getDefaultAgent(mesh)` helper function (lib/queue.js:88-153)

**Logic**:
1. Read mesh config from `meshes/mesh-configs/{mesh}.json`
2. Check for `entry_point` field first
3. Fall back to first agent in `agents` array
4. Extract agent name if has category prefix (`test/echo` → `echo`)
5. Log evidence if no default found

**Evidence logged when**:
- Mesh config not found
- Config has no `entry_point` or `agents`
- Failed to parse config
- Using hardcoded 'core' as last resort

**Updated routing** (lib/queue.js:489-520):
```javascript
if (fs.existsSync(possibleMeshPath)) {
  destMesh = to;
  destAgent = Queue.getDefaultAgent(destMesh);

  if (!destAgent) {
    destAgent = 'core'; // Last resort fallback
    Evidence.record(Evidence.Types.HARDCODED_FALLBACK, ...);
  }

  isCrossMesh = true;
}
```

---

## 3. Fixed Gap 2: Unroutable Messages Evidence

### Problem
**File**: `lib/queue.js:431-441`

When destination mesh doesn't exist, message stuck in outbox forever with only error log.

### Solution

**Added evidence logging** (lib/queue.js:532-548):
```javascript
if (!fs.existsSync(destMeshDir)) {
  Logger.error('queue', `Destination mesh not found: ${destMesh}`, {...});

  Evidence.record(
    Evidence.Types.MESH_NOT_FOUND,
    `Message stuck in outbox - destination mesh does not exist: ${destMesh}`,
    { mesh, file, queue: 'outbox', frontmatter: {...}, additional: {...} }
  );

  return;
}
```

**Result**: Full forensic trail of unroutable messages with context for debugging.

---

## 4. Fixed Gap 1: Missing Session Evidence

### Problem
**File**: `lib/queue.js:946-952`

When agent session not running, message moved to active but injection fails silently.

### Solution

**Added evidence logging** (lib/queue.js:953-968):
```javascript
if (!TmuxInjector.sessionExists(sessionName)) {
  Logger.warn('queue', `Cannot notify agent - session not found: ${sessionName}`, {...});

  Evidence.record(
    Evidence.Types.MISSING_SESSION,
    `Message stuck in active - agent session not running: ${sessionName}`,
    { mesh, agent, file, queue: 'active', additional: {...} }
  );

  return false;
}
```

**Result**: Orphaned messages in active queue now logged with full context.

---

## 5. System Validation Framework

### New File: `lib/validator.js`

**Purpose**: Comprehensive pre-flight validation before system startup

**Validation Checks**:

#### A. Mesh Config Validation
- Config file exists
- Valid JSON parsing
- Required fields present (`mesh`, `agents`)
- Mesh name matches filename
- `entry_point` references valid agent
- All agents have config files

#### B. Directory Validation
- Required directories exist (creates if missing):
  - `.ai/tx/logs`
  - `.ai/tx/mesh`
  - `meshes/mesh-configs`
  - `meshes/agents`

#### C. Orphaned Message Detection
- Scans all `active` queues (mesh-level and agent-level)
- Reports messages that may be stuck from crashed sessions
- Warns on startup if found

### Integration

**Updated**: `lib/commands/start.js:26-35`

System now validates before starting:
```javascript
const validationResults = Validator.validateSystem();

if (!validationResults.valid) {
  console.error('❌ System validation failed - cannot start');
  console.error('   Fix the errors above and try again\n');
  await cleanup(1);
  return;
}

console.log('✅ System validation passed\n');
```

**Output Example**:
```
🔍 Validating system...

📁 Directory validation:
  ✅ All required directories exist

📋 Mesh config validation:
  ✅ core
     ⚠️  No entry_point specified, will use first agent in array
  ✅ test-echo
  ❌ test-ask
     • Agent config not found: meshes/agents/test-ask/answerer/config.json

⚠️  Total warnings: 1

❌ System validation failed - cannot start
   Fix the errors above and try again
```

---

## 6. Evidence Query Examples

### View Recent Evidence
```bash
cat .ai/tx/logs/evidence.jsonl | jq -c '. | {type, description, mesh: .context.mesh}'
```

### Filter by Type
```bash
cat .ai/tx/logs/evidence.jsonl | jq 'select(.type == "mesh_not_found")'
```

### Count by Type
```bash
cat .ai/tx/logs/evidence.jsonl | jq -r '.type' | sort | uniq -c
```

### Get Summary (in code)
```javascript
const { Evidence } = require('./lib/evidence');
const summary = Evidence.summary();
console.log(summary);
// {
//   total: 47,
//   byType: { mesh_not_found: 12, missing_session: 35 },
//   byMesh: { core: 25, test-echo: 22 },
//   recentCount: 15,
//   oldestTimestamp: '2025-10-19T12:00:00.000Z',
//   newestTimestamp: '2025-10-19T14:30:00.000Z'
// }
```

---

## Testing Results

### Validation Catches Real Issues

**Test Run**: `tx start --detach`

**Found Issues**:
1. ✅ **Core mesh**: Validates correctly (no errors)
2. ❌ **test-ask**: Config references wrong agent path
   - Says: `test-ask/answerer`
   - Should be: `test/answerer`
3. ❌ **test-pingpong**: Agents missing `config.json` files
   - Have: `prompt.md` only
   - Need: `config.json` + `prompt.md`

**Evidence Logged**: ✅
```json
{"type":"config_invalid","description":"Agent config not found for 'test/ping'","mesh":"test-pingpong","agent":"ping"}
{"type":"config_invalid","description":"Agent config not found for 'test/pong'","mesh":"test-pingpong","agent":"pong"}
{"type":"validation_failure","description":"Mesh config validation failed for 'test-pingpong': 2 errors","mesh":"test-pingpong"}
{"type":"validation_failure","description":"System validation failed: 4 errors across 4 meshes","mesh":null}
```

---

## Files Modified

1. **Created**: `lib/evidence.js` - Evidence logging system
2. **Created**: `lib/validator.js` - System validation framework
3. **Modified**: `lib/queue.js` - Added evidence logging for Gaps 1, 2, 4
4. **Modified**: `lib/commands/start.js` - Added validation before startup
5. **Created**: `docs/beta/logic-gaps.md` - Analysis of system gaps
6. **Created**: `docs/beta/evidence-logging-implementation.md` - This document

---

## Impact on Logic Gaps

| Gap | Issue | Status | Evidence Type |
|-----|-------|--------|---------------|
| Gap 1 | Lost messages (agent crash) | ✅ Logged | `MISSING_SESSION` |
| Gap 2 | Unroutable messages (bad mesh) | ✅ Logged | `MESH_NOT_FOUND` |
| Gap 4 | Hardcoded 'core' fallback | ✅ Fixed + Logged | `HARDCODED_FALLBACK` |
| Gap 5 | No mesh validation on start | ✅ Fixed | `CONFIG_INVALID`, `VALIDATION_FAILURE` |

**Remaining gaps** (not addressed in this implementation):
- Gap 3: Concurrent file operation races
- Gap 6: `ignoreNextOperation()` not thread-safe
- Gap 7: Agent discovery (partially addressed by Gap 4 fix)
- Gap 8: File overwrite on duplicate names
- Gap 9: No timeout for queue processing
- Gap 10: Naive frontmatter parser

---

## Next Steps

1. **Fix config issues** identified by validator:
   - Update `test-ask.json` agent paths
   - Create `config.json` for ping/pong agents

2. **Monitor evidence logs** during operation:
   - Check for patterns of `MISSING_SESSION` (agent crashes)
   - Look for `MESH_NOT_FOUND` (routing errors)
   - Identify `HARDCODED_FALLBACK` usage

3. **Consider dead-letter queue**:
   - Move unroutable messages from outbox to DLQ
   - Periodic cleanup of stuck messages
   - Alert on evidence accumulation

4. **Address remaining gaps**:
   - Implement proper locking for `ignoreNextOperation()`
   - Add queue processing timeouts
   - Improve frontmatter parser robustness

---

## Conclusion

✅ **Evidence logging system operational**
✅ **System validation prevents bad starts**
✅ **Gaps 1, 2, 4, 5 now have forensic trails**
✅ **Real config errors discovered and documented**

The system now has comprehensive visibility into anomalies and failures, enabling data-driven debugging and system improvements.
