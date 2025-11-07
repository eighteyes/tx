---
name: meshes
description: Comprehensive guide for building, testing, and debugging meshes in the tx system. Covers mesh architecture, agent design, prompt templates, E2E testing, validation strategies, and Human-In-The-Loop workflows. Use when creating new meshes, defining agent roles, writing tests, or debugging multi-agent workflows.
---

# Meshes: Building & Testing

This skill provides comprehensive guidance for creating, testing, and debugging meshes and agent configurations in the tx system.

## ⚠️ CRITICAL: Centralized Event Log Architecture

**The tx system uses a centralized event log:**
- ✅ ALL messages written to `.ai/tx/msgs/` (centralized event log)
- ✅ Filename format: `{mmddhhmmss}-{type}-{from-agent}>{to-agent}-{msg-id}.md`
- ✅ Messages are immutable, chronological events
- ✅ EventLogConsumer watches this directory with offset tracking
- ✅ System injects `@filepath` references to target agents
- ❌ Messages NEVER move or get copied

**Key Benefits:**
- Single source of truth for all system messages
- Chronological ordering with timestamps
- Easy querying by type, agent, or time
- Perfect audit trail
- No per-agent directory management

**If you see references to `.ai/tx/mesh/{mesh}/agents/{agent}/msgs/`, those are from the OLD architecture.**

## Core Concepts

### What is a Mesh?
A **mesh** is a named collection of agents that work together to accomplish a goal. It defines:
- Which agents participate
- How they're organized
- What capabilities they expose
- Entry and completion points

Example: `test-ask` mesh has an `asker` and `answerer` agent that work together.

### What is an Agent?
An **agent** is a Claude instance running in a tmux session that:
- Receives tasks via message files
- Processes work and generates output
- Sends responses via message files
- Communicates through message passing only

### Directory Structure
```
meshes/
├── mesh-configs/         # Mesh configuration files
│   └── {mesh-name}.json
└── agents/              # Agent prompts and configs
    └── {category}/
        └── {agent-name}/
            ├── config.json
            └── prompt.md
```

## Part 1: Building Meshes

### Quick Start

1. **Plan Your Mesh** - Define name, agents, flow, entry/completion points
2. **Create Mesh Config** - `meshes/mesh-configs/{mesh-name}.json`
3. **Create Agent Configs** - `meshes/agents/{category}/{agent}/config.json`
4. **Write Agent Prompts** - `meshes/agents/{category}/{agent}/prompt.md`

See: [mesh-config-reference.md](references/mesh-config-reference.md) and [agent-config-reference.md](references/agent-config-reference.md)

### Core Principles

#### 1. Message-Based Communication via Centralized Event Log
- Agents write messages to **centralized event log**: `.ai/tx/msgs/`
- Filename encodes routing: `{timestamp}-{type}-{from}>{to}-{msgid}.md`
- EventLogConsumer watches log and filters messages for each agent
- System injects messages via `@filepath` reference to target agents
- Messages stay in place permanently (immutable log)

#### 2. EventLogConsumer & Offset Tracking
- Each agent has an EventLogConsumer watching `.ai/tx/msgs/`
- Consumer tracks last processed timestamp in `.ai/tx/state/offsets/{agent}.json`
- Prevents duplicate message delivery
- Allows agent restart without reprocessing old messages
- Ensures chronological ordering

#### 3. Reactive Agents
- No "START NOW" in prompts - agents wait for messages
- Process when message is injected via `@filepath`
- Write response to `.ai/tx/msgs/` with proper frontmatter and filename format

#### 4. Frontmatter Routing
```markdown
---
from: mesh/agent
to: recipient
type: task-complete
status: complete
timestamp: 2025-10-20T00:00:00Z
---
```

#### 5. Template Variables
- `{{ mesh }}` - The mesh instance ID (e.g., `test-echo-abc123`)
- `{{ agent }}` - The agent name

Use these for dynamic path generation in prompts.

### Agent Prompt Guidelines

#### Test Agents - SUPER LIGHTWEIGHT
```markdown
# Role
You are an echo test agent. When you receive a task, echo it back to core.

# Workflow
1. Read the incoming task message
2. Write a response message with:
   - `to: core/core`
   - `type: task-complete`
   - Include the original task content
```

**NO examples, output formats, or complex logic for test agents!**

#### Production Agents
Can have full structure with Role, Workflow, Output Format sections.

See: [prompt-templates.md](references/prompt-templates.md)

### Common Patterns

- **Single Agent**: One agent handles everything → See simple examples
- **Multi-Agent Sequential**: Agents in sequence → See [workflows.md](references/workflows.md)
- **Bidirectional**: Two-way agent communication → See [multi-agent-patterns.md](references/multi-agent-patterns.md)
- **Iterative**: Feedback loops with approval gates → See [multi-agent-patterns.md](references/multi-agent-patterns.md)
- **HITL**: Human-in-the-loop Q&A → See [hitl-testing.md](references/hitl-testing.md)

## Part 2: Testing Meshes

### 🔑 Key Principle: Session-Based Validation

**The tmux session is the source of truth.** Validate by checking:
- `Read()` calls showing Claude reading messages
- `Write()` calls showing Claude creating messages
- File paths mentioned in session output
- THEN verify files actually exist on disk

```javascript
// Check session first
const sessionOutput = execSync(`tmux capture-pane -t ${session} -p -S -100`);
const wroteMessages = sessionOutput.includes('Write(') && sessionOutput.includes('.ai/tx/msgs/');

// Then verify files in centralized event log
const actualFiles = fs.readdirSync('.ai/tx/msgs/').filter(f => f.endsWith('.md'));
```

### ⚠️ CRITICAL: Injection Rule

**`TmuxInjector.injectText()` can ONLY be used with 'core' session**

- ✅ CORRECT: `TmuxInjector.injectText('core', 'spawn test-echo mesh')`
- ❌ WRONG: `TmuxInjector.injectText('mesh-agent', 'any text')`

Mesh agents communicate via messages only, never direct injection.

### Core Testing Principles

1. **Minimal Injection** - Only inject natural language to core, let Claude orchestrate
2. **Dynamic Validation** - Check what actually happened, not hardcoded patterns
3. **Idle = Done** - Use idle state, not arbitrary timeouts
4. **Proper Sequencing** - Wait for each step to complete

### Test Architecture & Separation of Responsibilities

#### E2EWorkflow Class
The `E2EWorkflow` class handles ALL spawning and workflow testing:
- Injects natural language to core
- Sends Enter keys at proper times
- Waits for idle states between operations
- Checks for mesh session creation with UUID patterns
- Validates message flow through the system

#### Individual Test Files
Test files (test-e2e-echo.js, test-e2e-ask.js) should ONLY:
1. Set up the system (start tx)
2. Create and call E2EWorkflow
3. Clean up afterwards

**DO NOT duplicate E2EWorkflow logic in test files!**

### Quick Test Template

```javascript
const { E2EWorkflow } = require('../lib/e2e-workflow');

async function test() {
  // Start system
  spawn('tx', ['start', '-d']);
  await waitForSession('core');
  await TmuxInjector.claudeReadyCheck('core', 30000);

  // Use E2EWorkflow for ALL spawning/testing
  const workflow = new E2EWorkflow('test-echo', 'echo',
    'spawn a test-echo mesh and send task');
  const passed = await workflow.test();

  // Clean up
  await cleanup();
  return passed;
}
```

See: [helpers.md](references/helpers.md) for utility functions

### Message Timestamps

All agent messages should include timestamps after frontmatter:
```markdown
---
from: mesh/agent
to: recipient
---

251020-1415

# Message Content
```

Format: `yymmdd-hhmm`

### Testing Patterns

- **Basic Testing** → [patterns.md](references/patterns.md)
- **Multi-Agent Testing** → [multi-agent-testing.md](references/multi-agent-testing.md)
- **Iterative Testing** → [iterative-testing.md](references/iterative-testing.md)
- **HITL Testing** → [hitl-testing.md](references/hitl-testing.md)
- **Debugging Guide** → [debugging.md](references/debugging.md)
- **Testing Checklist** → [checklist.md](references/checklist.md)

## Debugging

### Quick Commands
```bash
# View session output
tmux capture-pane -t session-name -p -S -100

# View centralized event log
tx msg
tx msg --follow

# Monitor messages
watch -n 1 'ls -lt .ai/tx/msgs/ | head -20'

# Filter messages for specific agent
ls -la .ai/tx/msgs/ | grep "core>"
ls -la .ai/tx/msgs/ | grep ">brain"

# Check offset tracking state
cat .ai/tx/state/offsets/core-core.json
```

### Common Issues
1. **Agent not receiving**: Check `to:` field in frontmatter
2. **Test timeouts**: Agent still processing - increase wait time
3. **EPIPE errors**: Normal on process termination
4. **Session not found**: Check UUID pattern matching
5. **HITL issues**: Need explicit wait instructions

See: [debugging.md](references/debugging.md) for detailed troubleshooting

## Complete Example

### Simple Hello World Mesh

**1. Mesh Config** (`meshes/mesh-configs/hello-world.json`):
```json
{
  "mesh": "hello-world",
  "agents": ["tutorial/greeter"],
  "entry_point": "greeter",
  "completion_agent": "greeter"
}
```

**2. Agent Config** (`meshes/agents/tutorial/greeter/config.json`):
```json
{
  "name": "greeter",
  "options": { "model": "haiku", "output": "clean" }
}
```

**3. Agent Prompt** (`meshes/agents/tutorial/greeter/prompt.md`):
```markdown
# Role
You greet users warmly.

# Workflow
1. Read incoming message
2. Send greeting to core with `to: core/core` and `type: task-complete`
```

**4. Test**: `tx spawn hello-world`

## Resources

### Building References
- [mesh-config-reference.md](references/mesh-config-reference.md) - Mesh configuration spec
- [agent-config-reference.md](references/agent-config-reference.md) - Agent configuration spec
- [prompt-templates.md](references/prompt-templates.md) - Agent prompt examples
- [workflows.md](references/workflows.md) - Common topologies
- [multi-agent-patterns.md](references/multi-agent-patterns.md) - Advanced patterns

### Testing References
- [helpers.md](references/helpers.md) - Utility functions
- [patterns.md](references/patterns.md) - Testing patterns
- [debugging.md](references/debugging.md) - Troubleshooting
- [checklist.md](references/checklist.md) - Test checklists
- [multi-agent-testing.md](references/multi-agent-testing.md) - Multi-agent tests
- [iterative-testing.md](references/iterative-testing.md) - Iterative workflows
- [hitl-testing.md](references/hitl-testing.md) - Human-in-the-loop

## Key Takeaways

### Building
- Keep test agents lightweight (Role + Workflow only)
- Use template variables for dynamic paths
- Message-based communication only
- Agents are reactive, not proactive

### Testing
- Only inject to core session
- Validate via session output first
- Use idle state for completion
- Dynamic validation over hardcoded patterns