---
name: mesh-builder
description: Comprehensive guide for building meshes in TX V4. Covers SDK-based worker architecture, agent design, prompt templates, message protocols, and HITL workflows. Use when creating new meshes, defining agent roles, or debugging multi-agent systems.
---

# Mesh Builder: TX V4

This skill provides comprehensive guidance for creating meshes and agents in TX V4's SDK-based architecture.

## TX V4 Architecture

### Core Differences from V3

| Aspect | V3 (Legacy) | V4 (Current) |
|--------|-------------|--------------|
| **Workers** | Tmux sessions | Claude Agent SDK (`query()`) |
| **Messaging** | `tmux send-keys` | Write tool to `.ai/tx/msgs/` |
| **Queue** | File watching only | SQLite + file watching |
| **Core** | Tmux (for HITL) | Tmux (unchanged) |
| **Models** | Full model IDs | Semantic names: `opus`, `sonnet`, `haiku` |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        TX V4 System                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐        ┌──────────────────┐               │
│  │   User (tmux)    │        │   CLI Commands   │               │
│  │   - Sees core    │        │   tx start/msg   │               │
│  │   - HITL here    │        │   tx status/spy  │               │
│  └────────┬─────────┘        └────────┬─────────┘               │
│           │                           │                          │
│           ▼                           ▼                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Core Agent (tmux)                       │  │
│  │  - User interface layer                                    │  │
│  │  - HITL handler: shows ask-human, captures responses       │  │
│  │  - Routes tasks to workers via queue                       │  │
│  └───────────────────────────────┬───────────────────────────┘  │
│                                  │                               │
│                                  ▼                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   SQLite Queue (Bridge)                    │  │
│  │  - Messages flow: File → Consumer → SQLite → Dispatcher    │  │
│  │  - Tracks: messages, tasks, agent state                    │  │
│  └───────────────────────────────┬───────────────────────────┘  │
│                                  │                               │
│           ┌──────────────────────┼──────────────────────┐       │
│           │                      │                      │       │
│           ▼                      ▼                      ▼       │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐ │
│  │  Brain Agent   │    │   Dev Agent    │    │  Test Agent    │ │
│  │   (SDK/opus)   │    │  (SDK/sonnet)  │    │  (SDK/haiku)   │ │
│  │                │    │                │    │                │ │
│  │ - Know gateway │    │ - Coding       │    │ - Testing      │ │
│  │ - Spec-graph   │    │ - Refactoring  │    │ - Validation   │ │
│  └────────────────┘    └────────────────┘    └────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### SDK Worker Execution

Workers run via the Claude Agent SDK's `query()` function:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: userPrompt,
  options: {
    cwd: workDir,
    model: 'opus',  // Semantic: opus, sonnet, haiku
    systemPrompt: agentPrompt,
    permissionMode: 'bypassPermissions',
    maxTurns: 50,
  }
});

for await (const msg of q) {
  // Handle assistant messages, tool calls, results
}
```

### Model Selection (Claude Opus 4.5 Era)

| Semantic Name | Use Case | Characteristics |
|---------------|----------|-----------------|
| `opus` | Complex reasoning, architecture, synthesis | Most capable, slower, higher cost |
| `sonnet` | General tasks, coding, coordination | Balanced speed/capability |
| `haiku` | Simple tasks, validation, echoing | Fastest, lowest cost |

**Recommendations**:
- **Brain agent**: `opus` (needs deep reasoning for spec-graph)
- **Dev agent**: `sonnet` or `opus` (coding requires good reasoning)
- **Test agents**: `haiku` (simple validation tasks)
- **Coordinator agents**: `sonnet` (good balance)

## Message Protocol

### Centralized Event Log

ALL messages go to `.ai/tx/msgs/` with this filename format:
```
{timestamp}-{type}-{from}--{to}-{msg-id}.md
```

Example: `1733901000-task-core--brain-brain-abc123.md`

### Message Frontmatter

```yaml
---
to: mesh/agent           # Recipient (e.g., brain/brain, core/core)
from: mesh/agent         # Sender
type: task | task-complete | ask | ask-response | ask-human
msg-id: unique-id        # For correlation
headline: Brief summary  # Human-readable
timestamp: ISO-8601      # When created
command: /slash:command  # Optional: triggers slash command
---

Message body content here.

Markdown formatting supported.
```

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `task` | core → worker | Assign work |
| `task-complete` | worker → core | Report completion |
| `ask` | agent → agent | Request information |
| `ask-response` | agent → agent | Provide answer |
| `ask-human` | worker → core | Request human input (HITL) |

### Slash Command Routing

Messages can include a `command` field to trigger slash commands:

```yaml
---
to: brain/brain
from: core/core
type: task
command: /know:prepare
msg-id: task-123
headline: Execute /know:prepare
---

User requested: /know:prepare
```

The worker receives this and executes the slash command.

## Building Meshes

### Directory Structure

```
v4/
├── meshes/
│   ├── brain/                 # Brain mesh
│   │   ├── config.yaml        # Mesh configuration
│   │   └── prompt.md          # Agent prompt
│   ├── dev/                   # Dev mesh
│   │   ├── config.yaml
│   │   └── prompt.md
│   ├── research/              # Multi-agent mesh
│   │   ├── config.yaml
│   │   ├── interviewer/
│   │   │   └── prompt.md
│   │   ├── sourcer/
│   │   │   └── prompt.md
│   │   └── writer/
│   │       └── prompt.md
│   └── system/                # System meshes
│       └── commit-agent/
│           ├── config.yaml
│           └── prompt.md
└── .ai/tx/
    ├── msgs/                  # Message event log
    └── logs/                  # System logs
```

### Mesh Configuration (YAML)

**Location**: `meshes/{mesh-name}/config.yaml`

```yaml
# meshes/dev/config.yaml
mesh: dev
description: "Development mesh for coding tasks"

# Intent-based routing (optional)
intents:
  patterns:
    - build
    - implement
    - "code up"
  commands:
    build: "/know:build"

agents:
  - name: worker
    model: opus
    prompt: prompt.md  # Relative to mesh directory

entry_point: worker
completion_agent: worker

# IMPORTANT: Multi-agent meshes SHOULD have routing!
# Routing enables automatic agent-to-agent flow without core intervention
routing:
  worker:
    complete:
      core: "Task finished"
    blocked:
      core: "Need human input"
    ask:
      brain: "Need project knowledge"

# Optional: workspace for output files
workspace:
  path: ".ai/output/{task-id}/"

# Optional: rearmatter (transparency metadata)
rearmatter:
  enabled: true
  fields:
    - grade
    - confidence
    - status
    - gaps
```

### Config Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mesh` | string | Yes | Unique mesh identifier |
| `description` | string | No | Human-readable description |
| `agents` | array | Yes | List of agents in mesh |
| `entry_point` | string | No | Agent that receives initial tasks |
| `completion_agent` | string | No | Agent that signals completion |
| `type` | string | No | `ephemeral` or `persistent` |
| `routing` | object | No* | Message routing rules (*required for multi-agent meshes) |
| `intents` | object | No | Intent patterns for auto-routing |
| `workspace` | object | No | Workspace output configuration |
| `rearmatter` | object | No | Transparency metadata config |
| `system` | boolean | No | Mark as system mesh |
| `worktree` | boolean | No | Enable git worktree isolation |
| `lifecycle` | object | No | Pre/post hooks |

### intents Field

Auto-routes tasks to meshes based on user intent:

```yaml
intents:
  patterns:
    - research
    - investigate
    - "find out"
  commands:
    research: "/know:research"
```

- `patterns`: Keywords that trigger this mesh
- `commands`: Map patterns to slash commands

### workspace Field

Configure output workspace:

```yaml
# Object format (preferred)
workspace:
  path: ".ai/research/{topic}/"
  create_on_init: true
  cleanup_on_complete: false

# Legacy string format (still supported)
workspace: ".ai/research/{topic}/"
```

### rearmatter Field

Transparency metadata fields:

```yaml
rearmatter:
  enabled: true
  fields:
    - grade       # Letter grade (A-F)
    - confidence  # Numeric (0.0-1.0)
    - speculation # Degree of speculation
    - gaps        # Known information gaps
    - assumptions # Key assumptions made
    - status      # Current status
    - iteration   # Iteration number
  thresholds:
    confidence: 0.8
    grade: "B"
```

### Agent Prompt Template

**CRITICAL**: Focus prompts on **core workflow only**. Message protocol, file paths, and infrastructure details are **injected dynamically** by the system prompt builder.

#### What to Include (Core Workflow)

```markdown
# {Agent Name}

You are the {role} agent for TX V4.

## Your Responsibilities

1. {Responsibility 1}
2. {Responsibility 2}
3. {Responsibility 3}

## Workflow

1. Read the incoming task message
2. {Step-by-step work process}
3. {Decision logic and quality criteria}
4. Write task-complete message when finished

## Quality Standards

- {Quality criteria specific to this role}
- {When to ask for human input}
- {Success/failure conditions}
```

#### What NOT to Include (Injected Automatically)

**Do NOT hardcode these in prompts** - they are injected by the system:

- ❌ Message directory paths (`.ai/tx/msgs/`)
- ❌ Filename formats (`{timestamp}-{type}-{from}--{to}-{msg-id}.md`)
- ❌ Frontmatter schema examples (to/from/type/msg-id/etc)
- ❌ Message type enums (task, task-complete, ask-human)
- ❌ Agent addressing format (mesh/agent)
- ❌ Workspace paths (injected from config's `workspace` field)

**Why?** These are infrastructure concerns. Hardcoding them makes prompts brittle and hard to maintain. The system injects them dynamically based on mesh configuration.

### Minimal Test Agent

For testing, keep prompts SUPER lightweight - core workflow ONLY:

```markdown
# Echo Agent

You echo back messages.

## Workflow
1. Read incoming task
2. Echo the content back in a task-complete message
```

**Note**: Message destination, format, and paths are injected by the system. Prompts focus on **what** to do, not **how** to format infrastructure.

## HITL (Human-In-The-Loop)

### How HITL Works in V4

1. **Worker needs human input** → Writes `ask-human` message to core
2. **Core displays question** → User sees it in tmux
3. **User responds** → Core writes `ask-response` back to worker
4. **Worker continues** → Receives response via queue polling

### ask-human Message Format

```yaml
---
to: core/core
from: dev/worker
type: ask-human
msg-id: hitl-q1
headline: Need clarification on feature scope
timestamp: 2025-12-11T00:00:00Z
---

## Question

Should this feature include:
1. Option A - Full implementation
2. Option B - MVP only
3. Option C - Skip for now

Please advise.
```

### ask-response Format (from core)

```yaml
---
to: dev/worker
from: core/core
type: ask-response
msg-id: hitl-q1
headline: User response
timestamp: 2025-12-11T00:01:00Z
---

Go with Option B - MVP only for now.
```

## Multi-Agent Patterns

### How Routing Works

**IMPORTANT**: Routing enables automatic agent-to-agent flow without core intervention.

When an agent has routing configured in the mesh config:
1. The dispatcher extracts routing rules for that agent
2. SDK runner injects routing instructions into the task prompt
3. Agent receives clear guidance on where to route based on outcome

Example - what the agent sees in its prompt:
```markdown
## Routing Instructions

When complete, route based on outcome:

**complete** → research/sourcer
Write task message to: research/sourcer
Reason: Requirements complete, ready to source information

**blocked** → core/core
Write task message to: core/core
Reason: Cannot proceed - unclear research requirements
```

Agents without routing config receive: "When done, write a task-complete message to core/core."

### Sequential Pipeline

```
core → agent1 → agent2 → agent3 → core
```

Config:
```yaml
routing:
  agent1:
    complete: { agent2: "Pass to next stage" }
  agent2:
    complete: { agent3: "Pass to next stage" }
  agent3:
    complete: { core: "Pipeline finished" }
```

### Bidirectional (Ping-Pong)

```
core → agentA ⟷ agentB → core
```

Agents exchange multiple messages before completion.

### Fan-Out/Fan-In

```
core → coordinator → [worker1, worker2, worker3] → coordinator → core
```

Coordinator distributes work, collects results.

## Testing

### Test Harness Pattern

```typescript
import { TestHarness } from './test/helpers/harness';

const harness = new TestHarness();

// Start system
await harness.startCore();

// Insert test task
await harness.insertMessage({
  from: 'core/core',
  to: 'test/echo',
  type: 'task',
  payload: { headline: 'Echo test', body: 'Hello World' }
});

// Run worker
const result = await harness.runWorker('test/echo', { model: 'haiku' });

// Verify response
const response = await harness.waitForMessage(
  msg => msg.type === 'task-complete' && msg.from === 'test/echo'
);

expect(response.payload.body).toContain('Hello World');
```

### E2E Test Structure

```typescript
// test/e2e/XX-feature.test.ts
import { describe, it, before, after } from 'node:test';
import { TestHarness } from '../helpers/harness';

describe('Feature Test', () => {
  let harness: TestHarness;

  before(async () => {
    harness = new TestHarness();
    await harness.setup();
  });

  after(async () => {
    await harness.cleanup();
  });

  it('should do the thing', async () => {
    // Test implementation
  });
});
```

## Debugging

### CLI Commands

```bash
# View system status
tx status

# View messages
tx msg
tx msg --follow

# View logs
tx logs [agent-id]

# Real-time spy
tx spy [agent-id]

# View tasks
tx tasks
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Worker not starting | Queue empty | Check message was inserted |
| Message not delivered | Wrong `to:` field | Verify agent ID format |
| HITL timeout | No response from core | Check core is running |
| Task stuck | Worker error | Check `tx logs` |

### Log Locations

- Debug: `.ai/tx/logs/debug.jsonl`
- Errors: `.ai/tx/logs/error.jsonl`
- E2E tests: `.ai/tx/logs/e2e-test.log`

## Best Practices

### Prompt Design

1. **Keep test agents minimal** - Role + Workflow only
2. **Be explicit about message format** - Show exact frontmatter
3. **Include the output path** - `.ai/tx/msgs/`
4. **Specify completion message** - Always end with task-complete

### Model Selection

1. **Start with haiku** for simple tasks
2. **Use sonnet** for general development
3. **Reserve opus** for complex reasoning (brain, architecture)

### Message Design

1. **Use descriptive headlines** - Human-readable summaries
2. **Include msg-id** - For correlation and debugging
3. **Timestamp everything** - ISO-8601 format
4. **Structure the body** - Use markdown sections

## References

- [mesh-config-reference.md](references/mesh-config-reference.md) - Config specification
- [agent-config-reference.md](references/agent-config-reference.md) - Agent options
- [prompt-templates.md](references/prompt-templates.md) - Prompt examples
- [workflows.md](references/workflows.md) - Message flow patterns
- [multi-agent-patterns.md](references/multi-agent-patterns.md) - Advanced patterns
- [hitl-testing.md](references/hitl-testing.md) - HITL workflows
- [debugging.md](references/debugging.md) - Troubleshooting guide
