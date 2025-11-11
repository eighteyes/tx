# Dynamic Pattern System Design

## Concept
Agents can request code patterns/recipes on-demand instead of having everything pre-loaded in their initial prompt.

## Use Cases

### 1. Message Sending Patterns
```
Agent: @patterns/messaging/write-tool
Returns: How to send messages using Write tool with proper frontmatter

Agent: @patterns/messaging/messagewriter-sync
Returns: How to use MessageWriter for synchronous state tracking
```

### 2. State Management Patterns
```
Agent: @patterns/state/check-agent-state
Returns: How to query agent states from database

Agent: @patterns/state/transition-states
Returns: How to manually transition agent states
```

### 3. Task Orchestration Patterns
```
Agent: @patterns/tasks/send-task
Returns: Complete example of sending a task message

Agent: @patterns/tasks/wait-for-completion
Returns: How to wait for and handle task completion
```

### 4. Workflow Patterns
```
Agent: @patterns/workflows/git-commit-push
Returns: Safe git workflow for committing work

Agent: @patterns/workflows/multi-step-task
Returns: Breaking down complex tasks into steps
```

## Storage Structure

```
meshes/patterns/
├── index.json                 # Pattern catalog
├── messaging/
│   ├── write-tool.md         # Simple Write tool pattern
│   ├── messagewriter-sync.md # MessageWriter for sync updates
│   └── ask-human.md          # Ask human for input pattern
├── tasks/
│   ├── send-task.md
│   ├── wait-for-completion.md
│   └── parallel-tasks.md
├── workflows/
│   ├── git-commit-push.md    # Safe git workflow
│   ├── multi-step-task.md    # Breaking down complex tasks
│   ├── research-and-report.md # Research pattern
│   └── code-review.md        # Review workflow
├── deliverables/
│   ├── markdown-report.md    # Structuring reports
│   ├── code-documentation.md # Documenting code
│   └── test-results.md       # Presenting test results
└── advanced/
    ├── spawn-mesh.md
    ├── rearmatter.md
    └── self-modify.md
```

## Pattern Catalog (index.json)

```json
{
  "patterns": {
    "messaging": {
      "write-tool": {
        "title": "Send Message with Write Tool",
        "description": "Simple message sending using Claude's Write tool",
        "complexity": "basic",
        "tags": ["messaging", "write", "basic"]
      },
      "messagewriter-sync": {
        "title": "Synchronous MessageWriter",
        "description": "Use MessageWriter via node for immediate state tracking",
        "complexity": "intermediate",
        "tags": ["messaging", "state", "sync"],
        "when": "Need immediate feedback or state tracking guarantees"
      },
      "ask-human": {
        "title": "Ask Human for Input",
        "description": "Request input from human and wait for response",
        "complexity": "basic",
        "tags": ["messaging", "hitl", "blocking"]
      }
    },
    "state": {
      "check-agent-state": {
        "title": "Check Agent State",
        "description": "Query current state of an agent from database",
        "complexity": "basic",
        "tags": ["state", "query"]
      }
    },
    "tasks": {
      "send-task": {
        "title": "Send Task to Agent",
        "description": "Complete example of task message with frontmatter",
        "complexity": "basic",
        "tags": ["tasks", "messaging", "orchestration"]
      }
    }
  }
}
```

## Pattern File Format

Each pattern is a standalone markdown file with:
- Clear example code
- When to use it
- Common pitfalls
- Related patterns

### Example: `messaging/write-tool.md`

````markdown
# Send Message with Write Tool

## When to Use
- Simple message sending between agents
- No need for immediate state tracking
- Standard inter-agent communication

## Pattern

```bash
# Write message to event log
Write(.ai/tx/msgs/TIMESTAMP-TYPE-FROM>TO-MSGID.md)
```

## Example: Send Task

```markdown
---
to: brain/brain
from: core/core
type: task
status: start
requester: core/core
msg-id: analyze-code
headline: Analyze codebase structure
priority: normal
timestamp: 2025-11-10T10:00:00.000Z
---

# Task: Analyze Codebase Structure

Please analyze the project structure and create a high-level overview...

## Deliverables
- Architecture diagram
- Component list
- Data flow description
```

## Filename Convention

```
MMDDHHMMSS-TYPE-FROM>TO-MSGID.md

Examples:
1110100000-task-core>brain-analyze.md
1110100530-ask-human-brain>core-clarify.md
1110101200-task-complete-brain>core-analyze.md
```

## Common Pitfalls

❌ **Wrong**: Forgetting timestamp in filename
❌ **Wrong**: Missing required frontmatter fields (to, from, type)
❌ **Wrong**: Using invalid msg-id (spaces, special chars)

✅ **Right**: All required frontmatter fields present
✅ **Right**: Filename matches frontmatter content
✅ **Right**: Timestamp is MMDDHHMMSS format

## Related Patterns
- `messaging/messagewriter-sync` - When you need immediate feedback
- `tasks/send-task` - Task-specific messaging
- `messaging/ask-human` - Human-in-the-loop pattern
````

### Example: `messaging/messagewriter-sync.md`

````markdown
# Synchronous MessageWriter Pattern

## When to Use
- Need immediate state tracking (can't wait for watcher)
- Need synchronous validation (rearmatter, frontmatter)
- Need error handling before message is sent
- Orchestrating multiple agents (core agent pattern)

## Why Not Write Tool?
The Write tool is async - the watcher picks up the file later and applies state tracking.
MessageWriter gives you **immediate, synchronous guarantees**.

## Pattern

```bash
Bash(node -e "
  const { MessageWriter } = require('./lib/message-writer');

  MessageWriter.write(
    'core/core',           // from
    'brain/brain',         // to
    'task',                // type
    'task-' + Date.now(),  // msgId (unique)
    \`# Task Content

Your task details here...
\`,
    {                      // frontmatter metadata
      headline: 'Short task description',
      priority: 'normal',
      status: 'start'
    }
  ).then(() => {
    console.log('✅ Message sent with state tracking applied');
  }).catch(err => {
    console.error('❌ Failed to send:', err.message);
  });
")
```

## What You Get

✅ **Immediate state tracking** - Sender's activity updated NOW
✅ **Immediate validation** - Rearmatter validated before write
✅ **Error handling** - Catch failures synchronously
✅ **State transitions** - BLOCKED/COMPLETING states applied immediately

## Trade-offs

**Pros:**
- Synchronous feedback
- Guaranteed state tracking
- Better error handling

**Cons:**
- More verbose than Write tool
- Requires knowledge of MessageWriter API
- Bash overhead (~5ms)

## Common Pitfalls

❌ **Wrong**: Forgetting to escape backticks in node -e
❌ **Wrong**: Not awaiting the promise (won't catch errors)
❌ **Wrong**: Using sync fs.writeFileSync (defeats the purpose)

✅ **Right**: Use MessageWriter.write() with proper escaping
✅ **Right**: Handle promise rejection
✅ **Right**: Log success/failure

## Related Patterns
- `messaging/write-tool` - Simpler alternative for most cases
- `state/transition-states` - Manual state transitions
- `tasks/parallel-tasks` - Orchestrating multiple tasks
````

## How Agents Access Patterns

### Option 1: Direct File Reference
```
Agent: Read @meshes/patterns/messaging/write-tool.md
```

### Option 2: Pattern Command (Better)
Add a `pattern` capability:

```markdown
# Pattern System

Request code patterns on-demand:

pattern <category>/<name>
pattern list                    # Show all available patterns
pattern search <keyword>        # Search patterns by keyword
pattern messaging               # List all messaging patterns
```

Implementation:
```bash
# Agent runs:
Bash(node bin/tx.js pattern messaging/write-tool)

# Returns the pattern content to agent
```

### Option 3: Smart Prompt Injection
System detects when agent needs a pattern and auto-injects it:

```javascript
// In watcher or event-log-consumer
if (agentAsksAbout('how to send message')) {
  TmuxInjector.injectFile(session, 'meshes/patterns/messaging/write-tool.md');
}
```

## Benefits

### For Agents
- 🎯 **Focused prompts** - Only get patterns when needed
- 📚 **Discoverability** - Can browse available patterns
- ✅ **Consistency** - Everyone uses proven approaches
- 🚀 **Just-in-time learning** - Learn as you go

### For System
- 📉 **Reduced prompt size** - Don't pre-load everything
- 🔄 **Easier updates** - Update patterns without re-prompting agents
- 📖 **Living documentation** - Patterns are the docs
- 🧪 **Testable** - Each pattern can have tests

### For Development
- 🎓 **Onboarding** - New patterns = new capabilities
- 🔍 **Debugging** - "Which pattern did you use?"
- 📊 **Metrics** - Track which patterns are most used
- 🌱 **Evolution** - Patterns improve based on usage

## Implementation Plan

### Phase 1: Create Pattern Library
1. Extract existing patterns from prompts
2. Create `meshes/patterns/` directory structure
3. Write 5-10 core patterns
4. Create pattern index

### Phase 2: Pattern Access
1. Add `tx pattern` CLI command
2. Allow agents to request patterns via Bash
3. Return pattern content to stdout

### Phase 3: Discovery
1. Add `pattern list` to show catalog
2. Add `pattern search <keyword>`
3. Update agent prompts with pattern system docs

### Phase 4: Smart Injection
1. Detect when agent needs a pattern
2. Auto-inject relevant pattern
3. Track usage metrics

## Future Enhancements

- **Pattern composition** - Combine multiple patterns
- **Pattern templates** - Fill-in-the-blank patterns
- **Pattern validation** - Test patterns with real agents
- **Pattern contributions** - Agents can suggest pattern improvements
- **Pattern versioning** - Track pattern evolution

---

## Example Patterns to Create

**Basic Tier:**
- `messaging/write-tool` ✅
- `messaging/ask-human`
- `tasks/send-task`
- `state/check-agent-state`

**Intermediate Tier:**
- `messaging/messagewriter-sync` ✅
- `tasks/wait-for-completion`
- `tasks/parallel-tasks`
- `workflows/git-commit-push`
- `workflows/multi-step-task`
- `deliverables/markdown-report`

**Advanced Tier:**
- `advanced/spawn-mesh`
- `advanced/rearmatter`
- `advanced/self-modify`
- `workflows/research-and-report`
- `workflows/code-review`
