# TX Message System

Understanding how agents communicate through file-based messages with stay-in-place architecture.

---

## Table of Contents

1. [Overview](#overview)
2. [Stay-in-Place Architecture](#stay-in-place-architecture)
3. [Message Format](#message-format)
4. [Message Types](#message-types)
5. [Routing Rules](#routing-rules)
6. [Message Lifecycle](#message-lifecycle)
7. [Examples](#examples)
8. [Best Practices](#best-practices)

---

## Overview

TX uses **file-based messaging** where agents communicate by writing markdown files with frontmatter. This approach provides:

- ✅ **Observable workflows** - Messages are human-readable files
- ✅ **Audit trails** - Every interaction is logged
- ✅ **Debuggable** - Inspect messages at any time
- ✅ **Resumable** - System survives crashes
- ✅ **No network** - Purely filesystem-based

---

## Stay-in-Place Architecture

### Core Principle

**Messages NEVER move from their creation location.**

```
Traditional messaging:          Stay-in-place messaging:
┌─────────┐                     ┌─────────┐
│ Agent A │                     │ Agent A │
│  writes │──(move)──>  inbox   │  writes │ (file stays here)
└─────────┘                     └─────────┘
                                      │
┌─────────┐                           │
│ Agent B │                           ├──> @filepath reference
│  reads  │  <────┘                   │
└─────────┘                     ┌─────────┐
                                │ Agent B │
                                │  reads  │ (gets reference, not copy)
                                └─────────┘
```

### Why Stay-in-Place?

1. **No file operations** - Reduces I/O and race conditions
2. **Single source of truth** - Message exists in one location only
3. **Audit trails** - Clear ownership and history
4. **Debugging** - Easy to trace message flow
5. **Resumability** - No "lost" messages during transfers

### How It Works

1. **Agent A writes message** to `.ai/tx/mesh/mesh-a/agents/agent-a/msgs/msg-001.md`
2. **Routing system detects** new file via file watcher
3. **System injects reference** to Agent B: `@/path/to/msg-001.md`
4. **Agent B reads** the file via reference
5. **Agent B responds** by writing to `.ai/tx/mesh/mesh-b/agents/agent-b/msgs/response-001.md`
6. **System injects reference** back to Agent A

**Result:** No files moved, no copies created, perfect audit trail.

---

## Message Format

Messages use **Markdown with YAML frontmatter**:

```markdown
---
to: [target-mesh]/[target-agent]
from: [source-mesh]/[source-agent]
type: ask | ask-response | task | task-complete | update
status: start | in-progress | rejected | approved | complete
requester: [original-requester]
msg-id: [unique-id]
in-reply-to: [parent-msg-id]  # Optional
headline: [short-summary]
timestamp: [ISO-8601-datetime]
---

# Message Title

Message body in markdown...

## Details

More content here...
```

### Required Fields

| Field | Description | Example |
|-------|-------------|---------|
| `to` | Target mesh/agent | `brain/brain` |
| `from` | Source mesh/agent | `core/core` |
| `type` | Message type | `ask`, `task`, `update` |
| `status` | Current status | `start`, `complete` |
| `requester` | Original requester | `core/core` |
| `msg-id` | Unique identifier | `readme-val-001` |
| `headline` | Short summary | `Validate README completeness` |
| `timestamp` | ISO 8601 datetime | `2025-10-30T10:00:00Z` |

### Optional Fields

| Field | Description | Example |
|-------|-------------|---------|
| `in-reply-to` | Parent message ID | `readme-val-001` |
| `priority` | Urgency level | `high`, `normal`, `low` |
| `tags` | Categorization | `code-review`, `research` |
| `deadline` | Due date/time | `2025-10-31T00:00:00Z` |

---

## Message Types

### `ask`

**Purpose:** Request information from another agent, block until response.

**Behavior:**
- Sender waits for `ask-response`
- Workflow pauses until answered
- Response expected

**Example:**
```markdown
---
to: brain/brain
from: core/core
type: ask
status: start
requester: core/core
msg-id: ask-brain-001
headline: What is the entry point of this codebase?
timestamp: 2025-10-30T10:00:00Z
---

# Question about Entry Point

I need to understand the entry point for this application.

Can you analyze the codebase and tell me:
1. What is the main entry file?
2. What framework or runtime is used?
3. Are there multiple entry points?
```

---

### `ask-response`

**Purpose:** Answer an `ask` message.

**Behavior:**
- Must reference `in-reply-to` field
- Unblocks waiting agent
- Ends ask-response cycle

**Example:**
```markdown
---
to: core/core
from: brain/brain
type: ask-response
status: complete
requester: core/core
msg-id: response-ask-brain-001
in-reply-to: ask-brain-001
headline: Entry point analysis complete
timestamp: 2025-10-30T10:05:00Z
---

# Entry Point Analysis

Based on package.json and codebase analysis:

1. **Main entry:** `bin/tx.js`
2. **Framework:** Node.js CLI with Commander.js
3. **Multiple entry points:**
   - CLI: `bin/tx.js`
   - Library: `lib/index.js`
```

---

### `task`

**Purpose:** Assign work to an agent, non-blocking.

**Behavior:**
- Receiver works asynchronously
- Sender continues without waiting
- Completion notified via `task-complete`

**Example:**
```markdown
---
to: code-review/coordinator
from: core/core
type: task
status: start
requester: core/core
msg-id: task-review-001
headline: Review authentication module
timestamp: 2025-10-30T10:00:00Z
---

# Code Review Task

Please review the authentication module for:
- SOLID principles compliance
- Security vulnerabilities
- Test coverage
- Documentation quality

**Files:**
- `lib/auth/`
- `test/auth/`

**Priority:** High
**Deadline:** 2025-10-31
```

---

### `task-complete`

**Purpose:** Notify that a task is finished.

**Behavior:**
- References original task via `in-reply-to`
- Includes results or summary
- May trigger next workflow step

**Example:**
```markdown
---
to: core/core
from: code-review/coordinator
type: task-complete
status: complete
requester: core/core
msg-id: complete-review-001
in-reply-to: task-review-001
headline: Authentication module review complete
timestamp: 2025-10-30T12:00:00Z
---

# Code Review Complete

## Summary

All 4 analyzers completed review of authentication module.

**Findings:**
- ✅ SOLID principles: 8/10 (good)
- ⚠️  Security: 2 medium-risk issues found
- ✅ Test coverage: 87% (exceeds 80% threshold)
- ⚠️  Documentation: Missing API docs for 3 functions

**Full report:** `.ai/reports/code-review-001.md`

**Action required:** Address security issues before merge.
```

---

### `update`

**Purpose:** One-way communication, no response expected.

**Behavior:**
- Fire-and-forget
- Informational only
- No workflow impact

**Example:**
```markdown
---
to: core/core
from: brain/brain
type: update
status: complete
requester: brain/brain
msg-id: update-spec-graph-001
headline: Spec graph updated
timestamp: 2025-10-30T11:00:00Z
---

# Spec Graph Updated

I've updated the spec graph with new entities:

- Added 5 new components
- Fixed 3 invalid dependencies
- Validated 48 total entities

**Status:** ✅ Validation passed
```

---

## Routing Rules

Routing defines how messages flow between agents within a mesh.

### Routing Configuration

Defined in `meshes/mesh-configs/{mesh}.json`:

```json
{
  "mesh": "tdd-cycle",
  "routing": {
    "red-phase": {
      "complete": {
        "green-phase": "Test written and documented"
      },
      "blocked": {
        "core": "Cannot write test - missing requirements"
      }
    },
    "green-phase": {
      "complete": {
        "refactor-phase": "All tests pass"
      },
      "failed": {
        "red-phase": "Tests fail - revise test"
      }
    }
  }
}
```

### Routing Keys

- **complete** - Success, move to next agent
- **blocked** - Cannot proceed, escalate
- **failed** - Failure, retry or escalate
- **ready-for-next-iteration** - Loop back

### Cross-Mesh Routing

Messages can route between meshes:

```markdown
---
to: brain/brain
from: core/core
---
```

**Important:** Always use full mesh instance name with UUID for running meshes:
- ✅ Correct: `to: test-echo-abc123/echo`
- ❌ Wrong: `to: test-echo/echo`

---

## Message Lifecycle

### 1. Creation

Agent writes message file:

```bash
.ai/tx/mesh/core/agents/core/msgs/task-spawn-brain-001.md
```

### 2. Detection

File watcher detects new file (via Chokidar):

```
[Watcher] New file: task-spawn-brain-001.md
[Validator] Validating frontmatter...
[Validator] ✅ Valid message
```

### 3. Routing

Routing system determines destination:

```
[Router] to: brain/brain
[Router] Injecting reference to brain session
```

### 4. Injection

System injects `@filepath` reference to target agent:

```bash
# In tmux session "brain"
tmux send-keys -t brain "@/workspace/.ai/tx/mesh/core/agents/core/msgs/task-spawn-brain-001.md" Enter
```

### 5. Processing

Target agent reads and processes:

```
[brain/brain] Reading message: task-spawn-brain-001.md
[brain/brain] Type: task
[brain/brain] Processing request...
```

### 6. Response

Agent writes response message:

```bash
.ai/tx/mesh/brain/agents/brain/msgs/task-complete-spawn-brain-001.md
```

### 7. Completion

Cycle repeats, injecting response back to originator.

---

## Examples

### Example 1: Simple Ask/Response

**core → brain:**
```markdown
---
to: brain/brain
from: core/core
type: ask
status: start
msg-id: ask-001
---

What is the primary programming language?
```

**brain → core:**
```markdown
---
to: core/core
from: brain/brain
type: ask-response
status: complete
msg-id: response-001
in-reply-to: ask-001
---

The primary language is JavaScript (Node.js).
```

---

### Example 2: Task with Completion

**core → code-review:**
```markdown
---
to: code-review/coordinator
from: core/core
type: task
status: start
msg-id: task-001
---

Review `lib/auth/` module.
```

**code-review → core:**
```markdown
---
to: core/core
from: code-review/coordinator
type: task-complete
status: complete
msg-id: complete-001
in-reply-to: task-001
---

Review complete. Report: `.ai/reports/review-001.md`
```

---

### Example 3: Update (No Response)

**brain → core:**
```markdown
---
to: core/core
from: brain/brain
type: update
status: complete
msg-id: update-001
---

Spec graph updated with 10 new entities.
```

*(No response expected)*

---

## Best Practices

### 1. Use Descriptive msg-ids

```markdown
✅ Good: msg-id: readme-validation-001
❌ Bad:  msg-id: msg001
```

### 2. Include Context in Headline

```markdown
✅ Good: headline: Validate README against best practices
❌ Bad:  headline: Task
```

### 3. Reference Parent Messages

```markdown
✅ Always include: in-reply-to: ask-brain-001
```

### 4. Use Appropriate Message Types

- **ask** - Need answer NOW (blocks)
- **task** - Work asynchronously (non-blocking)
- **update** - FYI only (no response)

### 5. Keep Messages Focused

One message = one purpose. Don't combine multiple requests.

### 6. Provide Sufficient Context

Include file paths, requirements, deadlines, priority.

### 7. Use Markdown Formatting

Make messages readable with headers, lists, code blocks.

---

## Debugging Messages

### View Recent Messages

```bash
# Core messages
ls -lt .ai/tx/mesh/core/agents/core/msgs/ | head

# Brain messages
ls -lt .ai/tx/mesh/brain/agents/brain/msgs/ | head
```

### Read Message Content

```bash
cat .ai/tx/mesh/core/agents/core/msgs/task-001.md
```

### Trace Message Flow

```bash
# Find all messages related to msg-id
grep -r "ask-001" .ai/tx/mesh/
```

### Check Routing Logs

```bash
tail -f .ai/tx/logs/debug.jsonl | grep routing
```

---

## Common Issues

### Issue: Message not received

**Check:**
1. Frontmatter is valid YAML
2. `to` field uses correct mesh/agent name
3. Target mesh is running (`tx status`)
4. File watcher is active

**Debug:**
```bash
tx logs debug -f | grep -i "message\|routing"
```

---

### Issue: Orphaned messages

**Symptom:** Files with `*-orphan.md` suffix

**Cause:** Message sent to inactive mesh, cleaned up on next spawn

**Solution:** Normal behavior, can ignore or delete

---

### Issue: Routing loops

**Symptom:** Agents keep sending messages back and forth

**Cause:** Invalid routing rules

**Solution:** Check mesh config routing, ensure terminal states exist

---

## Advanced Topics

### Message Queues

TX implements queue-based message processing:

```
.ai/tx/state/queues/{mesh}-queue.json
```

Messages are processed FIFO with priorities.

### Message Expiration

Set deadlines:

```markdown
---
deadline: 2025-10-31T00:00:00Z
---
```

Expired messages logged but not processed.

### Batching

Multiple messages can be sent atomically by writing all files before triggering watcher.

---

## Need Help?

- **[Getting Started](./getting-started.md)** - Setup guide
- **[Commands Reference](./commands.md)** - CLI commands
- **[Architecture](./architecture.md)** - System design
- **[Troubleshooting](./troubleshooting.md)** - Common issues

---

**Next:** [Available Meshes →](./meshes.md)
