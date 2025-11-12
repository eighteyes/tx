---
title: Send Message with Write Tool
category: messaging
complexity: basic
tags: [messaging, write, basic, inter-agent]
when: Standard inter-agent communication without immediate state tracking needs
related: [messaging/messagewriter-sync, messaging/ask-human, tasks/send-task]
---

# Send Message with Write Tool

## When to Use

✅ **Use this pattern when:**
- Sending standard inter-agent messages
- No need for immediate state tracking guarantees
- Basic communication (tasks, asks, responses)
- You want simple, clean code

❌ **Don't use when:**
- You need immediate, synchronous feedback
- You're orchestrating multiple agents and need guarantees
- See: `messaging/messagewriter-sync` instead

## Pattern

```bash
# Write message to event log
Write(.ai/tx/msgs/TIMESTAMP-TYPE-FROM>TO-MSGID.md)
```

The watcher picks up the file and:
- Validates frontmatter
- Tracks sender activity
- Detects state transitions
- Delivers to recipient

## Complete Example: Send Task

```markdown
Write(.ai/tx/msgs/1110100000-task-core>brain-analyze.md)

---
to: brain/brain
from: core/core
type: task
status: start
requester: core/core
msg-id: analyze
headline: Analyze codebase structure
priority: normal
timestamp: 2025-11-10T10:00:00.000Z
---

# Task: Analyze Codebase Structure

Please analyze the TX project structure and create a high-level overview.

## Goals
- Identify main components
- Map data flow
- Document architecture

## Deliverables
Save your analysis to: `.ai/tx/mesh/brain/workspace/architecture-overview.md`
```

## Filename Convention

**Format**: `MMDDHHMMSS-TYPE-FROM>TO-MSGID.md`

**Breakdown**:
- `MMDDHHMMSS` - Timestamp (2-digit month, day, hour, minute, second)
- `TYPE` - Message type (task, ask, ask-response, task-complete, etc.)
- `FROM>TO` - Agent names only (not full paths)
- `MSGID` - Unique identifier (alphanumeric, no spaces)

**Examples**:
```
1110100000-task-core>brain-analyze.md
1110100530-ask-human-brain>core-clarify.md
1110101200-task-complete-brain>core-analyze.md
1110101300-ask-response-core>brain-answer.md
```

## Generate Timestamp

```bash
# Get current timestamp in MMDDHHMMSS format
Bash(date +"%m%d%H%M%S")
```

**Example output**: `1110100530`

## Required Frontmatter Fields

**Always include**:
- `to` - Recipient agent (e.g., `brain/brain`)
- `from` - Sender agent (e.g., `core/core`)
- `type` - Message type
- `msg-id` - Unique message ID
- `timestamp` - ISO timestamp

**For tasks, also include**:
- `status` - Usually `start`
- `requester` - Who requested the task (usually same as `from`)
- `headline` - Short task description (1 line)
- `priority` - `critical`, `high`, `normal`, or `low`

## Message Types

Common types:
- `task` - Assign work to an agent
- `task-complete` - Report task completion
- `ask-human` - Request human input (blocks agent)
- `ask-response` - Respond to ask-human
- `ask` - Question between agents
- `result` - Share results/findings
- `update` - Status update

## Common Pitfalls

❌ **Wrong**: Forgetting timestamp in filename
```
task-core>brain-analyze.md  # Missing timestamp!
```

❌ **Wrong**: Using full paths in filename
```
1110100000-task-core/core>brain/brain-analyze.md  # Too verbose!
```

❌ **Wrong**: Spaces in msg-id
```
msg-id: analyze code  # Use: analyze-code
```

❌ **Wrong**: Missing required frontmatter
```yaml
---
to: brain/brain
# Missing from, type, timestamp!
---
```

✅ **Right**: All fields present, clean naming
```
1110100000-task-core>brain-analyze.md
```

## Full Workflow Example

```bash
# 1. Get timestamp
Bash(date +"%m%d%H%M%S")
# Returns: 1110100530

# 2. Create message file
Write(.ai/tx/msgs/1110100530-task-core>brain-analyze.md)

---
to: brain/brain
from: core/core
type: task
status: start
requester: core/core
msg-id: analyze
headline: Analyze codebase structure
priority: normal
timestamp: 2025-11-10T10:05:30.000Z
---

# Task: Analyze Codebase Structure

Your task details here...

# 3. Done! Watcher will:
#    - Validate frontmatter
#    - Update core's activity timestamp
#    - Deliver to brain's EventLogConsumer
#    - Transition brain: READY → WORKING
```

## What Happens Next

1. **File written** to `.ai/tx/msgs/`
2. **Watcher detects** new file
3. **Validates** frontmatter and rearmatter
4. **Updates** sender's activity timestamp
5. **Detects** state transitions (if applicable)
6. **Delivers** to recipient's EventLogConsumer
7. **Recipient** receives message, state transitions

## Related Patterns

- **`messaging/messagewriter-sync`** - When you need immediate feedback
- **`messaging/ask-human`** - Human-in-the-loop pattern
- **`tasks/send-task`** - Task-specific examples
- **`workflows/multi-step-task`** - Coordinating multiple steps

## Pro Tips

💡 **Tip 1**: Use descriptive msg-ids
- Good: `analyze-architecture`, `review-code`, `test-login`
- Bad: `msg1`, `abc123`, `task`

💡 **Tip 2**: Include context in task body
- Explain what you want done
- Specify deliverables clearly
- Include any constraints or requirements

💡 **Tip 3**: Check recipient exists
```bash
# Before sending, verify brain is running
Bash(tmux has-session -t brain 2>/dev/null && echo "✓ brain running" || echo "✗ brain not running")
```

💡 **Tip 4**: Set appropriate priority
- `critical` - Urgent, blocks other work
- `high` - Important, do soon
- `normal` - Standard priority (default)
- `low` - Nice to have, when available
