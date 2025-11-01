# Error Monitoring Example

Automatically watch error logs and fix issues as they occur using the watch capability.

---

## What You'll Learn

- How to use the `tx watch` command
- Delta tracking (only new errors processed)
- Background mesh operation
- Auto-fix workflows

---

## Scenario

You're developing an application and want errors automatically detected and fixed without manual intervention.

---

## Step 1: Create Error-Fixer Mesh

Create `meshes/mesh-configs/error-fixer.json`:

```json
{
  "mesh": "error-fixer",
  "type": "sequential",
  "description": "Monitors error log and attempts automatic fixes",
  "agents": ["analyzer", "fixer"],
  "entry_point": "analyzer",
  "completion_agent": "fixer",
  "capabilities": [],
  "routing": {
    "analyzer": {
      "complete": {
        "fixer": "Analysis complete, proceeding to fix"
      },
      "no-action-needed": {
        "core": "Error is informational only"
      }
    },
    "fixer": {
      "complete": {
        "core": "Fix applied successfully"
      },
      "blocked": {
        "core": "Cannot auto-fix, human intervention required"
      }
    }
  }
}
```

---

## Step 2: Create Analyzer Agent

Create `meshes/agents/error-fixer/analyzer/prompt.md`:

```markdown
# Error Analyzer

You analyze error messages and determine if they can be auto-fixed.

## Input Format

You'll receive error messages in JSONL format:

\```json
{"level":"error","msg":"undefined variable foo","file":"lib/queue.js","line":120}
\```

## Your Tasks

1. **Parse error message**
2. **Determine severity** (critical, high, medium, low)
3. **Assess fixability** (auto-fixable vs requires human)
4. **Provide fix strategy**

## Decision Tree

- **Syntax errors** → auto-fixable
- **Undefined variables** → auto-fixable (add declaration)
- **Missing imports** → auto-fixable (add import)
- **Type errors** → auto-fixable (add type annotation)
- **Logic errors** → requires human
- **Architecture issues** → requires human

## Response Format

Send message to fixer:

\```markdown
---
to: error-fixer/fixer
from: error-fixer/analyzer
type: task
status: start
msg-id: [generate-id]
headline: Fix strategy for [error-type]
---

# Error Analysis

**File:** lib/queue.js:120
**Error:** undefined variable 'foo'
**Severity:** medium
**Fixability:** auto-fixable

## Fix Strategy

Add variable declaration at line 119:
\```javascript
const foo = /* appropriate default value */;
\```

## Context

[Relevant code context around error]
\```
```

---

## Step 3: Create Fixer Agent

Create `meshes/agents/error-fixer/fixer/prompt.md`:

```markdown
# Error Fixer

You implement fixes based on analyzer's strategy.

## Your Tasks

1. **Read fix strategy** from analyzer
2. **Locate error** in codebase
3. **Apply fix** using Edit tool
4. **Verify fix** (read file, check syntax)
5. **Report completion**

## Tools Available

- `Read` - Read files
- `Edit` - Make precise edits
- `Bash` - Run tests to verify fix

## Workflow

1. Read error file
2. Understand context
3. Apply minimal fix
4. Verify syntax
5. Report to core

## Response Format

\```markdown
---
to: core/core
from: error-fixer/fixer
type: task-complete
status: complete
msg-id: [generate-id]
headline: Error fixed in [file]
---

# Fix Applied

**File:** lib/queue.js:120
**Error:** undefined variable 'foo'
**Fix:** Added variable declaration

## Changes

- Added: `const foo = null;` at line 119
- Verified: File syntax is valid

## Verification

Ran quick syntax check - no errors detected.
\```
```

---

## Step 4: Start Watching

### Option A: Attached Mode (see output in real-time)

```bash
tx watch .ai/tx/logs/error.jsonl --mesh error-fixer
```

You'll see:
```
🔍 Starting watcher for error.jsonl
🚀 Spawning error-fixer mesh...
✅ error-fixer spawned
👁️  Watching for changes...
```

### Option B: Background Mode (detached)

```bash
tx watch .ai/tx/logs/error.jsonl --mesh error-fixer -d
```

```
🔍 Watcher started in background
   File: error.jsonl
   Mesh: error-fixer
   PID: 12345
```

---

## Step 5: Trigger Errors

### Simulate Errors

Create a file with intentional error:

```javascript
// test-file.js
function test() {
  console.log(undefinedVar);  // Error: undefinedVar is not defined
}
```

Run and capture error:

```bash
node test-file.js 2>&1 | tee -a .ai/tx/logs/error.jsonl
```

---

## Step 6: Watch It Work

### If Attached:

You'll see:
```
📬 New delta detected:
   Lines 42 → 43

📤 Sending to error-fixer/analyzer...

⏳ Waiting for processing...

✅ Response received from error-fixer/fixer:
   Fixed: test-file.js:2 - Added variable declaration
```

### If Detached:

Check status:
```bash
tx status
```

Output:
```
Active Watchers (1):
  🟢 error-fixer
     File: error.jsonl
     State: idle
     Processed: 1 change
     Last activity: 30s ago
```

View fix:
```bash
cat test-file.js
```

```javascript
// test-file.js
function test() {
  const undefinedVar = null;  // Auto-generated fix
  console.log(undefinedVar);
}
```

---

## Step 7: Monitor Activity

### View Watcher State

```bash
cat .ai/tx/state/watchers/error-fixer.json
```

```json
{
  "meshName": "error-fixer",
  "watchedFile": "/workspace/.ai/tx/logs/error.jsonl",
  "lastProcessedLine": 43,
  "lastProcessedAt": "2025-10-30T12:00:00Z",
  "totalChangesProcessed": 1,
  "currentState": "idle"
}
```

### View Messages

```bash
# Analyzer messages
ls .ai/tx/mesh/error-fixer/agents/analyzer/msgs/

# Fixer messages
ls .ai/tx/mesh/error-fixer/agents/fixer/msgs/
```

---

## Advanced: Custom Debouncing

Errors often come in bursts. Debounce to batch them:

```bash
# Wait 5 seconds after last change before processing
tx watch .ai/tx/logs/error.jsonl --mesh error-fixer --debounce 5000
```

---

## Stopping the Watcher

```bash
tx stop error-fixer
```

---

## Real-World Use Cases

1. **Development workflow**: Auto-fix linting errors, missing imports
2. **Production monitoring**: Alert on critical errors, attempt auto-recovery
3. **Log analysis**: Extract patterns, aggregate similar errors
4. **Testing feedback**: Watch test output, auto-fix failing tests

---

## Tips

1. **Start with read-only analyzer** - Don't auto-fix until confident
2. **Log all fixes** - Keep audit trail of changes
3. **Set severity thresholds** - Only auto-fix low/medium severity
4. **Human approval for critical** - Route high-severity to core
5. **Version control** - Commit before running auto-fixer

---

## Next Steps

- **[Code Review Example](../code-review/)** - Parallel workflows
- **[Custom Mesh Example](../custom-mesh/)** - Build your own

---

## Troubleshooting

### Issue: Watcher not detecting changes

```bash
# Check watcher is running
tx status

# Check file path is correct
ls .ai/tx/logs/error.jsonl

# Check logs
tx logs debug -f | grep watcher
```

### Issue: Fixes not applied

```bash
# Attach to mesh to see what's happening
tx attach error-fixer

# Check fixer agent has Edit tool access
```

---

**Questions?** See [Troubleshooting Guide](../../new/troubleshooting.md)
