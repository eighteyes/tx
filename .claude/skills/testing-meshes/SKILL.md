---
name: testing-meshes
description: Guide for writing and debugging E2E tests for the tx mesh system. Use when creating tests that validate mesh spawning, inter-agent communication, and workflow completion. Covers test design principles, validation strategies using tmux sessions, and common debugging patterns.
---

# Testing Meshes

This skill provides guidance for writing effective E2E tests for the tx mesh system.

## Core Principles

### 1. Minimal Test Injection

**Tests should inject ONLY the initial natural language instruction to core, nothing else.**

```javascript
// ✅ CORRECT: Single natural language instruction
TmuxInjector.injectText(coreSession, 'spawn a test-ask mesh and have asker ask answerer a question');
TmuxInjector.send(coreSession, 'Enter');

// ❌ WRONG: Orchestrating every step
TmuxInjector.injectText(coreSession, 'tx spawn test-ask');
// ... later ...
TmuxInjector.injectText(askerSession, 'Execute your task...');
```

**Rationale**: Tests validate the system as users experience it. Let Claude interpret the instruction and decide how to execute it.

### 2. Tmux Sessions Are Source of Truth

**Validate using tmux session output, not files.**

```javascript
// ✅ CORRECT: Check tmux for evidence of work
const coreOutput = execSync(`tmux capture-pane -t core -p -S -100`);
const hasInboxRead = coreOutput.includes('inbox/') || coreOutput.includes('complete/');

// ❌ WRONG: Check files directly
const files = fs.readdirSync('.ai/tx/mesh/core/agents/core/msgs/complete');
```

**Rationale**: Tmux shows what actually happened. Files are implementation details that may change.

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
TmuxInjector.send('core', 'Enter');
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

### 5. Validate via Tmux

Check tmux output for evidence of completion:

```javascript
const coreOutput = execSync(`tmux capture-pane -t core -p -S -100`);

const hasInboxRead = coreOutput.includes('inbox/') || coreOutput.includes('complete/');
const hasTaskComplete = coreOutput.includes('task-complete') || coreOutput.includes('status: complete');

if (hasInboxRead || hasTaskComplete) {
  console.log('✅ Test passed');
} else {
  console.log('❌ Test failed');
  console.log('Last 30 lines:', coreOutput.split('\n').slice(-30).join('\n'));
}
```

### 6. Cleanup

Always cleanup sessions:

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

    // Inject instruction
    TmuxInjector.injectText(CORE, `spawn a ${MESH} mesh and do work`);
    TmuxInjector.send(CORE, 'Enter');

    // Wait for work
    await TmuxInjector.waitForIdle(CORE, 5000, 60000);

    // Validate
    const output = execSync(`tmux capture-pane -t ${CORE} -p -S -100`);
    const success = output.includes('complete/');

    console.log(success ? '✅ PASSED' : '❌ FAILED');
    process.exit(success ? 0 : 1);
  } finally {
    execSync('tx stop', { stdio: 'pipe' }).catch(() => {});
  }
}

test();
```

## Multi-Agent Mesh Testing

For meshes with 2+ agents communicating with each other (like ping-pong):

### Key Differences from Single-Agent Tests

1. **Multiple Sessions Spawned**: Need to wait for all agent sessions, not just entry point
2. **Sequencing Critical**: Must validate proper idle sequencing
3. **Longer Timeouts**: Multi-agent exchanges take longer
4. **Message Validation**: Validate via tmux output, not filesystem

### Test Pattern

```javascript
// Step 1: Start system
execSync('tmux start-server');
spawn('tx', ['start', '-d']);

// Step 2: Instruction to core
// "spawn a test-ping-pong mesh and have agents exchange messages"

// Step 3: Wait for ALL agent sessions
const agents = ['pinger', 'ponger'];
for (const agent of agents) {
  await waitForSession(`${MESH}-${agent}`, 30000);
}

// Step 4: Idle sequencing - validate proper flow
const coreIdle1 = await TmuxInjector.waitForIdle('core', 5000, 60000);
const agentIdle = await TmuxInjector.waitForIdle(`${MESH}-pinger`, 5000, 60000);
const coreIdle2 = await TmuxInjector.waitForIdle('core', 5000, 60000);

// Step 5: Validate via tmux output
const coreOutput = execSync('tmux capture-pane -t core -p -S -100');
const hasMessaging = coreOutput.includes('outbox/') || coreOutput.includes('routing');
```

### Real Example: test-ping-pong

See `test/test-e2e-ping-pong.js` for complete working example.

**Key points from implementation:**
- 180 second timeout (agents exchanging messages take time)
- Polling for both agent sessions with 30 second wait
- Exact name matching AND suffix variant matching
- Tmux idle detection between sequential steps
- Core tmux output validation (look for `outbox/`, `message`, `routing`)

### Learnings from Ping-Pong Testing

1. **Agent Prompts Matter**: Simple, step-by-step prompts → successful exchanges
2. **Message Routing is Automatic**: System handles routing if frontmatter is correct
3. **Tmux is Source of Truth**: Validate via tmux output, not filesystem
4. **Idle Detection Reliable**: Use it to sequence handoffs
5. **Verbose Logging Helps**: Check agent prompts and output during debug

See: **[multi-agent-patterns.md](../building-meshes/references/multi-agent-patterns.md)** for design patterns.
```

## Iterative Workflow Testing

For meshes with feedback loops and multi-iteration workflows:

### Key Differences

1. **Longer Message Chains**: Multiple back-and-forth exchanges extend test duration
2. **Version State in Content**: Track progress via message content ("Version 1", "Version 2"), not files
3. **Conditional Logic**: Agents respond based on message content inspection
4. **Higher Timeout**: Iterative workflows need more time (180+ seconds)

### Test Pattern

```javascript
// Iterative workflows need even more patience
const TEST_TIMEOUT = 180000; // 3 minutes

// Instruction can be high-level (agent figures out iterations)
const instruction = "spawn a test-iterative mesh and have worker and reviewer iterate";

// Wait for all agent sessions
await waitForSession(`${MESH}-worker`);
await waitForSession(`${MESH}-reviewer`);

// Validate multiple iterations occurred
const workerOutput = execSync('tmux capture-pane -t test-iterative-worker -p');
const hasV1 = workerOutput.includes('Version 1');
const hasV2 = workerOutput.includes('Version 2');
const hasApproval = workerOutput.includes('approved');
```

### Real Example: test-iterative

See `test/test-e2e-iterative.js` for complete working example.

**Key points:**
- Simplified instruction to "iterate" - let agent figure out the workflow
- Both agent sessions spawned before validation
- Multiple idle waits: core → worker iteration → core completion
- Validates via message content (Version 1, Version 2, approval)
- 180 second timeout sufficient for 2 iteration cycles

### New Learnings from Iterative Testing

1. **Instruction Clarity**: Simple high-level instructions work better than detailed step-by-step for iterative workflows

2. **Version Markers Work Well**: Put "Version 1", "Version 2" directly in message content - simpler than state machines

3. **Conditional Response Based on Content**: Agents can inspect message content and respond accordingly (e.g., check version and respond with approval or rejection)

4. **Pseudo-Antagonistic Pattern**: Agents naturally implement approval gates when told "reject on v1, approve on v2"

5. **Message Content is State**: Don't overcomplicate - message body tracks progress better than external state files

6. **Simple Feedback Signals Work**: "approved", "needs revision", "rejected" - Claude understands these without elaboration

7. **Two Iterations Enough**: 2 cycles (submit → feedback → revise → approve) proves the pattern

8. **Agents Understand Approval Logic**: When instructed to implement approval gates or QA checks, Claude does it correctly

See: **[multi-agent-patterns.md](../building-meshes/references/multi-agent-patterns.md)** for iterative refinement pattern details.
```
