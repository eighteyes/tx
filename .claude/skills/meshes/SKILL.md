---
name: meshes
description: Comprehensive guide for building, testing, and debugging meshes in the tx system. Covers mesh architecture, agent design, prompt templates, E2E testing, and validation strategies. Use when creating new meshes, defining agent roles, writing tests, or debugging multi-agent workflows.
---

# Meshes: Building & Testing

This skill provides comprehensive guidance for creating, testing, and debugging meshes and agent configurations.

## Part 1: Building Meshes

### Core Concepts

#### What is a Mesh?

A **mesh** is a named collection of agents that work together to accomplish a goal. It defines:
- Which agents participate
- How they're organized
- What capabilities they expose
- Entry and completion points

Example: `test-ask` mesh has an `asker` and `answerer` agent that work together.

#### What is an Agent?

An **agent** is a Claude instance running in a tmux session. It:
- Receives tasks via message files
- Processes work and generates output
- Sends responses via message files
- Communicates through message passing only

### Directory Structure

```
meshes/
├── mesh-configs/
│   ├── core.json              # Core orchestrator mesh
│   ├── test-ask.json          # Example: multi-agent mesh
│   └── test-echo.json         # Example: single-agent mesh
│
└── agents/
    ├── core/
    │   ├── config.json        # Core agent config
    │   └── prompt.md          # Core agent prompt
    │
    ├── test/
    │   ├── asker/
    │   │   ├── config.json
    │   │   └── prompt.md
    │   ├── answerer/
    │   │   ├── config.json
    │   │   └── prompt.md
    │   └── echo/
    │       ├── config.json
    │       └── prompt.md
    │
    └── research/
        ├── analyst/
        ├── sourcer/
        └── writer/
```

### Building a New Mesh

#### 1. Define Mesh Configuration

File: `meshes/mesh-configs/your-mesh.json`

```json
{
  "mesh": "your-mesh",
  "type": "ephemeral",
  "description": "What this mesh does",
  "agents": ["category/agent1", "category/agent2"],
  "workflow_topology": "sequential",
  "entry_point": "agent1",
  "completion_agent": "agent2"
}
```

#### 2. Create Agent Directory

```bash
mkdir -p meshes/agents/category/agent-name
```

#### 3. Configure Agent

File: `meshes/agents/category/agent-name/config.json`

```json
{
  "name": "agent-name",
  "description": "What this agent does",
  "capabilities": ["capability1", "capability2"],
  "options": {
    "model": "sonnet",
    "output": "clean"
  }
}
```

#### 4. Write Agent Prompts

File: `meshes/agents/category/agent-name/prompt.md`

##### Template Variables

The PromptBuilder automatically injects template variables into agent prompts:
- `{{ mesh }}` - The mesh instance ID (e.g., `test-echo-abc123`)
- `{{ agent }}` - The agent name

This allows dynamic path generation without hardcoding:
```markdown
Write message to `.ai/tx/mesh/{{ mesh }}/agents/{{ agent }}/msgs/`
```

##### Lightweight Test Agent Prompts

**Test agents should be SUPER LIGHTWEIGHT** - only Role and Workflow sections:

```markdown
# Role
You are an echo test agent. When you receive a task, echo it back to core.

# Workflow
1. Read the incoming task message
2. Write a response message with:
   - `to: core/core`
   - `type: task-complete`
   - Include the original task content in your response
```

**For test agents, DO NOT include:**
- Examples
- Output formats
- Detailed instructions
- Multiple sections
- Complex logic

##### Production Agent Prompts

Production agents can have full structure:

```markdown
# Agent Name

## Your Role
You are... [what you do]

## Workflow
1. Read task from inbox
2. Process the task
3. Send response to outbox

## Output Format
Save to outbox with frontmatter...
```

### Core Building Principles

#### 1. Message-Based Communication

Agents communicate **only** via message files in directories:
- `msgs/` - Main message directory
- Messages include frontmatter for routing

**Never** use shared files or direct communication.

#### 2. Agents Are Reactive

Agents **wait for messages**, they don't start work spontaneously:
- No "START NOW" in prompts
- Wait for task in inbox
- Process when ready
- Send response to outbox

#### 3. Frontmatter Metadata

Every message file starts with YAML frontmatter:

```markdown
---
from: mesh/agent
to: recipient
type: task-complete
status: complete
timestamp: 2025-10-20T00:00:00Z
---
```

This metadata routes messages and tracks workflow state.

## Part 2: Testing Meshes

### 🔑 Key Testing Principle: Session-Based File Validation

**Check the session to verify files were injected and created. The tmux session is the source of truth.**

Tests must validate by monitoring what Claude actually does in the session:
- Watch for `Read()` calls showing Claude reading message files
- Look for `Write()` calls showing Claude creating messages
- Check for file paths in session output (e.g., `/msgs/task-123.md`)
- Verify file operations completed before checking filesystem
- The session shows intent AND execution - both matter

```javascript
// Session-based validation - check what Claude actually did
const sessionOutput = execSync(`tmux capture-pane -t ${session} -p -S -100`);

// Look for evidence of file injection/creation in the session
const readMessages = sessionOutput.includes('Read(') && sessionOutput.includes('/msgs/');
const wroteMessages = sessionOutput.includes('Write(') && sessionOutput.includes('/msgs/');
const filePathsMentioned = sessionOutput.match(/\/msgs\/[^\/\s]+\.md/g) || [];

// THEN verify those files actually exist
const msgsDir = `.ai/tx/mesh/${meshInstance}/agents/${agentName}/msgs`;
const actualFiles = fs.existsSync(msgsDir) ?
  fs.readdirSync(msgsDir).filter(f => f.endsWith('.md')) : [];

console.log('Session shows Read operations:', readMessages);
console.log('Session shows Write operations:', wroteMessages);
console.log('Files mentioned in session:', filePathsMentioned);
console.log('Files actually on disk:', actualFiles);
```

### ⚠️ CRITICAL: Injection Rule

**`TmuxInjector.injectText()` can ONLY be used with the 'core' session.**

- ✅ **ALLOWED**: `TmuxInjector.injectText('core', 'your instruction here')`
- ❌ **FORBIDDEN**: `TmuxInjector.injectText('mesh-agent', 'any text')`
- ❌ **FORBIDDEN**: `TmuxInjector.injectText(agentSession, 'any text')`

The 'core' session represents the user. Only users can type commands. Mesh agents communicate exclusively through the message routing system - they never receive direct text injection.

### Core Testing Principles

#### 1. Minimal Test Injection

**Tests should inject ONLY the initial natural language instruction to core, nothing else. Let Claude do ALL the work.**

```javascript
// ✅ CORRECT: Single natural language instruction to CORE ONLY
TmuxInjector.injectText(coreSession, 'spawn a test-echo mesh and send it a simple echo task');

// ❌ WRONG: Creating files directly
fs.writeFileSync('.ai/tx/mesh/test-echo/msgs/task.md', taskContent);  // NEVER DO THIS!

// ❌ WRONG: Injecting to agent sessions
TmuxInjector.injectText(agentSession, 'Execute your task...');  // NEVER DO THIS!
```

#### 2. Dynamic Message Validation

**Validate by checking what files are actually written, not hardcoded patterns.**

```javascript
// ✅ CORRECT: Dynamically check what files were written
const coreMsgsDir = '.ai/tx/mesh/core/agents/core/msgs';
const files = fs.existsSync(coreMsgsDir) ? fs.readdirSync(coreMsgsDir) : [];
const hasMessages = files.filter(f => f.endsWith('.md')).length > 0;

// Check tmux output to see what Claude actually did
const coreOutput = execSync(`tmux capture-pane -t core -p -S -100`);
const wroteMessage = coreOutput.includes('Write(') && coreOutput.includes('/msgs/');
```

#### 3. Idle = Done

**Use session idle state to know when work is complete, not arbitrary timeouts.**

```javascript
// ✅ CORRECT: Wait for idle state
const isIdle = await TmuxInjector.waitForIdle(session, 5000, 60000);

// ❌ WRONG: Fixed wait time
await new Promise(resolve => setTimeout(resolve, 30000));
```

### Quick Test Example

```javascript
const { execSync, spawn } = require('child_process');
const { TmuxInjector } = require('../lib/tmux-injector');
const fs = require('fs');

const MESH = 'test-ask';
const CORE = 'core';

async function test() {
  try {
    // Start tmux
    execSync('tmux start-server', { stdio: 'pipe' });

    // Start tx system
    spawn('tx', ['start', '-d']);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Wait for core
    while (!TmuxInjector.listSessions().includes(CORE)) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Wait for Claude ready
    await TmuxInjector.claudeReadyCheck(CORE, 30000);

    // Inject instruction (simulating human typing)
    TmuxInjector.injectText(CORE, `spawn a ${MESH} mesh and do work`);

    // Wait for work
    await TmuxInjector.waitForIdle(CORE, 5000, 60000);

    // SESSION-BASED VALIDATION: Check session FIRST
    const coreOutput = execSync(`tmux capture-pane -t ${CORE} -p -S -100`, { encoding: 'utf-8' });

    // 1. Check for file operations in the session
    const sessionShowsRead = coreOutput.includes('Read(') && coreOutput.includes('/msgs/');
    const sessionShowsWrite = coreOutput.includes('Write(') && coreOutput.includes('/msgs/');

    // 2. THEN verify those files actually exist on disk
    const coreMsgs = `.ai/tx/mesh/core/agents/core/msgs`;
    const filesOnDisk = fs.existsSync(coreMsgs) ?
      fs.readdirSync(coreMsgs).filter(f => f.endsWith('.md')) : [];

    // Success requires session evidence AND files on disk
    const success = sessionShowsWrite && filesOnDisk.length > 0;
    console.log(success ? '✅ PASSED' : '❌ FAILED');
    process.exit(success ? 0 : 1);
  } finally {
    execSync('tx stop', { stdio: 'pipe' }).catch(() => {});
  }
}

test();
```

## Common Patterns

### Single Agent Mesh (Simple)

One agent handles everything:

```json
{
  "mesh": "simple-task",
  "agents": ["test/echo"],
  "entry_point": "echo",
  "completion_agent": "echo"
}
```

**Flow**: core → echo → core

### Multi-Agent Mesh (Sequential)

Multiple agents in sequence:

```json
{
  "mesh": "test-ask",
  "agents": ["test/asker", "test/answerer"],
  "entry_point": "asker",
  "completion_agent": "asker"
}
```

**Flow**: core → asker → answerer → asker → core

### Research Mesh (Complex)

Multiple specialized agents:

```json
{
  "mesh": "deep-research",
  "agents": ["research/analyst", "research/sourcer", "research/writer"],
  "workflow_topology": "sequential",
  "entry_point": "analyst",
  "completion_agent": "writer"
}
```

**Flow**: core → analyst → sourcer → writer → core

## Debugging Tips

### Check Session Output

Always check what Claude actually did in the session:

```bash
# View session output
tmux capture-pane -t session-name -p

# Check last 100 lines
tmux capture-pane -t session-name -p -S -100
```

### Monitor Message Flow

Track messages through the system:

```bash
# Watch message directories
watch -n 1 'find .ai/tx/mesh -name "*.md" | sort'

# Check specific agent's messages
ls -la .ai/tx/mesh/mesh-name/agents/agent-name/msgs/
```

### Common Issues

1. **Agent not receiving messages**: Check routing in frontmatter (`to:` field)
2. **Test failing at Step 3**: Usually timing issue - agent still processing
3. **EPIPE errors**: Normal when processes terminate, handled gracefully
4. **Sessions not found**: Check UUID pattern matching for mesh instances

## Resources

### Building References
- Agent configuration options
- Capability templates
- Prompt design patterns

### Testing References
- **helpers.md** - Reusable utility functions
- **patterns.md** - Advanced patterns
- **debugging.md** - Common issues and solutions
- **checklist.md** - Pre-test, during-test, and post-test checklists

### Specialized Testing
- **multi-agent-testing.md** - Testing multi-agent communication
- **iterative-testing.md** - Testing iterative refinement workflows
- **hitl-testing.md** - Testing Human-In-The-Loop workflows

## Key Takeaways

### For Building:
1. Keep test agent prompts super lightweight (Role + Workflow only)
2. Use template variables (`{{ mesh }}`, `{{ agent }}`) for dynamic paths
3. Message-based communication only
4. Agents are reactive, not proactive

### For Testing:
1. Only inject text to core session
2. Let Claude handle all orchestration
3. Validate via session output first, then files
4. Use idle state to detect completion
5. Clean state between tests

This merged approach ensures you understand both how to build meshes correctly and how to validate they work as expected.