---
name: testing-meshes
description: Guide for writing and debugging E2E tests for the tx mesh system. Use when creating tests that validate mesh spawning, inter-agent communication, and workflow completion. Covers test design principles, validation strategies using tmux sessions, and common debugging patterns.
---

# Testing Meshes

This skill provides guidance for writing effective E2E tests for the tx mesh system.

## 🔑 Key Principle: Session-Based File Validation

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

## ⚠️ CRITICAL: Injection Rule

**`TmuxInjector.injectText()` can ONLY be used with the 'core' session.**

- ✅ **ALLOWED**: `TmuxInjector.injectText('core', 'your instruction here')`
- ❌ **FORBIDDEN**: `TmuxInjector.injectText('mesh-agent', 'any text')`
- ❌ **FORBIDDEN**: `TmuxInjector.injectText(agentSession, 'any text')`

The 'core' session represents the user. Only users can type commands. Mesh agents communicate exclusively through the message routing system - they never receive direct text injection.

## 📝 Test Agent Prompt Design

**Test agent prompts must be SUPER LIGHTWEIGHT - only Role and Workflow sections.**

Test agents exist to validate system mechanics, not complex capabilities:

```markdown
# Role
You are a [test type] agent. [One sentence about what you do].

# Workflow
1. [Simple action 1]
2. [Simple action 2 with key details like `to: core/core`]
3. [Simple action 3 if needed]
```

**DO NOT INCLUDE:**
- Examples
- Output formats
- Detailed instructions
- Multiple sections
- Complex logic

**Example - Echo Test Agent:**
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

This minimal approach ensures tests focus on system behavior, not agent complexity.

## Core Principles

### 1. Minimal Test Injection

**Tests should inject ONLY the initial natural language instruction to core, nothing else. Let Claude do ALL the work.**

```javascript
// ✅ CORRECT: Single natural language instruction to CORE ONLY
TmuxInjector.injectText(coreSession, 'spawn a test-echo mesh and send it a simple echo task');

// ❌ WRONG: Creating files directly
fs.writeFileSync('.ai/tx/mesh/test-echo/msgs/task.md', taskContent);  // NEVER DO THIS!

// ❌ WRONG: Injecting to agent sessions
TmuxInjector.injectText(agentSession, 'Execute your task...');  // NEVER DO THIS!
```

**Critical Rules**:
- `TmuxInjector.injectText()` must ONLY be used with the 'core' session
- NEVER create message files directly - let Claude write them
- Send Enter to continue when Claude needs permission bypass
- Monitor tmux sessions to verify behavior, don't manipulate files

**Rationale**: Tests validate the system as users experience it. Only users (core) can inject text. Claude handles all the orchestration, message writing, and routing.

### 2. Dynamic Message Validation

**Validate by checking what files are actually written, not hardcoded patterns.**

```javascript
// ✅ CORRECT: Dynamically check what files were written
const coreMsgsDir = '.ai/tx/mesh/core/agents/core/msgs';
const files = fs.existsSync(coreMsgsDir) ? fs.readdirSync(coreMsgsDir) : [];
const hasMessages = files.filter(f => f.endsWith('.md')).length > 0;

// Check tmux output to see what Claude actually did
const coreOutput = execSync(`tmux capture-pane -t core -p -S -100`);
const wroteMessage = coreOutput.includes('Write(') && coreOutput.includes('/msgs/');

// ❌ WRONG: Looking for hardcoded patterns
const hasInboxRead = coreOutput.includes('inbox/') || coreOutput.includes('complete/');
```

**Rationale**: The system evolves. Check what's actually happening, not what used to happen.

### 3. Idle = Done

**Use session idle state to know when work is complete, not arbitrary timeouts.**

```javascript
// ✅ CORRECT: Wait for idle state
const isIdle = await TmuxInjector.waitForIdle(session, 5000, 60000);

// ❌ WRONG: Fixed wait time
await new Promise(resolve => setTimeout(resolve, 30000));
```

**Rationale**: Agents work at different speeds. Idle state is the reliable signal.

### 4. Proper Sequencing

**Wait for each step in the workflow to complete before checking the next.**

```javascript
// ✅ CORRECT: Sequential validation
// 1. Wait for core to send task
await TmuxInjector.waitForIdle(coreSession, 5000, 60000);

// 2. Wait for agent to complete task
await TmuxInjector.waitForIdle(agentSession, 5000, 60000);

// 3. Wait for core to receive completion
await TmuxInjector.waitForIdle(coreSession, 5000, 60000);

// ❌ WRONG: Check immediately
const result = checkForCompletion(); // Too early!
```

**Rationale**: Message passing takes time. Each agent must complete its work before the next step.

## Simplified E2E Workflow Pattern

The E2E workflow has been simplified to focus on pure human simulation:

```javascript
// Step 1: Inject natural language (human types)
TmuxInjector.injectText('core', 'spawn a test-echo mesh and send it a simple echo task');

// Step 3: Wait for mesh to spawn
const meshSpawned = await this._waitForMeshSpawn();

// Step 4: Send another Enter for message writing
TmuxInjector.send('core', 'Enter');  // Continue after message write
await new Promise(resolve => setTimeout(resolve, 5000));

// Step 5: Check if mesh received message
const meshReceivedMessage = await this._checkMeshReceivedMessage();

// Step 6: Check if mesh sent response back to core
const meshRespondedToCore = await this._checkMeshRespondedToCore();
```

**Key Points**:
- Only inject natural language to core
- Let Claude handle ALL orchestration
- Monitor tmux sessions to verify behavior
- Check for complete round-trip communication

## Test Structure

### 1. Setup

Ensure tmux server is running:

```javascript
try {
  execSync('tmux start-server', { stdio: 'pipe' });
  console.log('✅ Tmux server started');
} catch (e) {
  console.log('ℹ️  Tmux server already running');
}
```

### 2. System Initialization

Start the tx system and wait for core to be ready:

```javascript
// Start system
spawn('tx', ['start', '-d'], { cwd: process.cwd(), stdio: 'pipe' });

// Wait for core session
await waitForSession('core', 45000);

// Wait for Claude to initialize
const claudeReady = await TmuxInjector.claudeReadyCheck('core', 60000);

// Wait for idle state
const isIdle = await TmuxInjector.waitForIdle('core', 1000, 15000);
```

### 3. Execute Test

Inject natural language instruction:

```javascript
TmuxInjector.injectText('core', 'spawn a test-ask mesh and have asker ask answerer a question');
```

### 4. Wait for Workflow Completion

```javascript
// Wait for mesh agents to spawn
await new Promise(resolve => setTimeout(resolve, 10000));

// Wait for core to finish sending task
await TmuxInjector.waitForIdle('core', 5000, 60000);

// Wait for agent to complete
await TmuxInjector.waitForIdle('test-ask-asker', 5000, 60000);

// Wait for core to receive completion
await TmuxInjector.waitForIdle('core', 5000, 60000);
```

### 5. Message Format with Timestamps

**All agent messages must include timestamps at the beginning in `yymmdd-hhmm` format:**

```markdown
---
from: deep-research/analyst
to: deep-research/sourcer
type: ask
msg-id: q-hypothesis-b
status: pending
---

251020-1415

# Research Request: Topic

Find additional information about...
```

**Timestamp placement**: After frontmatter block, before the message body content.

**Format**: `yymmdd-hhmm` (e.g., `251020-1415` for Oct 20, 2025 at 2:15 PM)

**Rationale**: Timestamps help with debugging, tracing workflow timing, validating message sequencing, and understanding when operations occur.

### 6. Dynamic Validation

Check what actually happened by looking at files written and tmux output:

```javascript
// Check what files were created in each agent's msgs directory
function checkMessagesWritten(meshInstance, agentName) {
  const msgsDir = `.ai/tx/mesh/${meshInstance}/agents/${agentName}/msgs`;
  if (fs.existsSync(msgsDir)) {
    const files = fs.readdirSync(msgsDir).filter(f => f.endsWith('.md'));
    console.log(`Found ${files.length} messages in ${agentName}:`, files);
    return files;
  }
  return [];
}

// Validate by checking tmux output for actual work done
const coreOutput = execSync(`tmux capture-pane -t core -p -S -100`);
const meshOutput = execSync(`tmux capture-pane -t ${meshSession} -p -S -100`);

// Look for evidence of message writing and routing
const coreWroteMessage = coreOutput.includes('Write(') && coreOutput.includes('/msgs/');
const meshReceivedMessage = checkMessagesWritten(meshInstance, agentName).length > 0;
const meshWroteResponse = meshOutput.includes('Write(') || meshOutput.includes('-done.md');

if (coreWroteMessage && meshReceivedMessage && meshWroteResponse) {
  console.log('✅ Test passed - complete message flow verified');
} else {
  console.log('❌ Test failed');
  console.log('Core wrote message:', coreWroteMessage);
  console.log('Mesh received message:', meshReceivedMessage);
  console.log('Mesh wrote response:', meshWroteResponse);
}
```

### 7. Cleanup

Always cleanup sessions:

```javascript
try {
  execSync('tx stop', { stdio: 'pipe' });
} catch (e) {
  // May return error, that's ok
}
```

## Recent Improvements

### EPIPE Error Handling

The spawn command now handles EPIPE errors gracefully with a `safeConsoleLog` wrapper:

```javascript
function safeConsoleLog(...args) {
  try {
    console.log(...args);
  } catch (error) {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
      // Silently ignore - output stream was closed
    } else {
      throw error;
    }
  }
}
```

This prevents crashes when the parent process terminates or pipe is broken.

### Automatic Core Message Cleanup

The `tx start` command now automatically cleans up old messages from core:

```javascript
// On system start, clean core's message directory
const coreMsgsDir = '.ai/tx/mesh/core/agents/core/msgs';
if (fs.existsSync(coreMsgsDir)) {
  const files = fs.readdirSync(coreMsgsDir).filter(f => f.endsWith('.md'));
  files.forEach(file => fs.unlinkSync(path.join(coreMsgsDir, file)));
  console.log(`🧹 Cleaned ${files.length} old message file(s) from core`);
}
```

This ensures tests always start with a clean state.

### Mesh Instance UUIDs

Meshes now get unique 6-character UUIDs to allow parallel instances:

```javascript
// Sessions are named: {mesh}-{uuid}-{agent}
// Example: test-echo-a1b2c3-echo
const meshSession = sessions.find(s => {
  const pattern = new RegExp(`^${this.meshName}-[0-9a-f]{6}-${this.agentName}$`);
  return pattern.test(s);
});
```

### Complete Cleanup Pattern

```javascript
try {
  execSync('tx stop', { stdio: 'pipe' });
} catch (e) {
  // May return error, that's ok
}

const sessions = TmuxInjector.listSessions();
sessions.forEach(session => {
  if (session.startsWith('test-')) {
    TmuxInjector.killSession(session);
  }
});
```

## Resources

For detailed guidance, see:

- **[helpers.md](references/helpers.md)** - Reusable utility functions (waitForSession, captureSessionOutput, etc.)
- **[patterns.md](references/patterns.md)** - Advanced patterns (cleanup, session naming, multi-agent sequencing)
- **[debugging.md](references/debugging.md)** - Common issues and solutions (EPIPE, timeouts, sessions not found)
- **[checklist.md](references/checklist.md)** - Pre-test, during-test, and post-test checklists

## Quick Start Example

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
    const filePathsInSession = coreOutput.match(/\/msgs\/[^\/\s]+\.md/g) || [];

    console.log('Session shows Read operations:', sessionShowsRead);
    console.log('Session shows Write operations:', sessionShowsWrite);
    console.log('Files mentioned in session:', filePathsInSession);

    // 2. THEN verify those files actually exist on disk
    const coreMsgs = `.ai/tx/mesh/core/agents/core/msgs`;
    const filesOnDisk = fs.existsSync(coreMsgs) ?
      fs.readdirSync(coreMsgs).filter(f => f.endsWith('.md')) : [];
    console.log('Files actually on disk:', filesOnDisk);

    // Success requires session evidence AND files on disk
    const success = sessionShowsWrite && filesOnDisk.length > 0;
    console.log(success ? '✅ PASSED - Session validated' : '❌ FAILED - Check session output');
    process.exit(success ? 0 : 1);
  } finally {
    execSync('tx stop', { stdio: 'pipe' }).catch(() => {});
  }
}

test();
```

## Specialized Testing Patterns

For testing more complex workflows, see these specialized references:

### Multi-Agent Testing
For meshes with 2+ agents communicating (like ping-pong):
- **[multi-agent-testing.md](references/multi-agent-testing.md)** - Testing multi-agent communication patterns

### Iterative Workflow Testing
For meshes with feedback loops and multiple iterations:
- **[iterative-testing.md](references/iterative-testing.md)** - Testing iterative refinement workflows

### Human-In-The-Loop (HITL) Testing
For meshes requiring human interaction via ask/ask-response messages:
- **[hitl-testing.md](references/hitl-testing.md)** - Testing HITL workflows with Q&A patterns

Each reference covers:
- Key differences from basic tests
- Test patterns and code examples
- Real examples from the test suite
- Session-based validation techniques
- Common pitfalls and solutions
- Tips specific to that testing type
