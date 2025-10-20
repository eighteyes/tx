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
