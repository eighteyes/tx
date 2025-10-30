# Debugging Guide

Common issues, root causes, and solutions.

## EPIPE Error

**Symptom**: `Error: write EPIPE` during spawn

**Root Cause**: Tmux session creation failed, but spawn continued writing to closed pipe

**Solution**: Check return value of `createSession()`:

```javascript
const sessionCreated = TmuxInjector.createSession(sessionName, 'bash', true, mesh, agent);
if (!sessionCreated) {
  throw new Error(`Failed to create tmux session: ${sessionName}`);
}
```

**Prevention**: Always verify return values before continuing. This error often masks the real problem (tmux not available, server not running, etc.).

## "Core not ready"

**Symptom**: Test fails with "Core not ready" despite session existing

**Root Cause**: Checking for output length instead of actual Claude readiness

**Wrong Approach**:
```javascript
// ❌ This just checks if there's any output
const output = execSync('tmux capture-pane -t core -p');
const ready = output.length > 0;
```

**Correct Approach**:
```javascript
// ✅ This uses Claude's actual readiness indicator
const ready = await TmuxInjector.claudeReadyCheck('core', 5000);
```

**Why**: Session exists ≠ Claude ready. Use the readiness check method.

## Agent Not Completing Work

**Symptom**: Agent goes idle without producing expected output

**Root Cause**: Agent prompt has "START NOW" but should wait for task message from core

**Wrong Agent Prompt**:
```markdown
<!-- ❌ This makes agent start immediately -->
START NOW.
```

**Correct Agent Prompt**:
```markdown
<!-- ✅ This makes agent wait for core's task -->
Wait for a task message from core. When you receive it, execute the task.
```

**Why**: Agents are meant to be reactive, not proactive. They should receive work via messages.

## Sessions Not Found

**Symptom**: Test can't find spawned agent sessions

**Root Causes**:
1. **Checking too early** - On-demand agents spawn after they're needed
2. **Wrong pattern matching** - Missing exact name variant or UID suffix
3. **Sessions killed during cleanup** - Checking after cleanup phase

**Debugging Steps**:
```javascript
// Step 1: Check what sessions actually exist
const allSessions = TmuxInjector.listSessions();
console.error('Available sessions:', allSessions.join(', '));

// Step 2: Show expected patterns
const MESH = 'test-ask';
const AGENT = 'answerer';
console.error(`Looking for: ${MESH}-${AGENT} or ${MESH}-${AGENT}-*`);

// Step 3: Use proper matching
const found = allSessions.find(s =>
  s === `${MESH}-${AGENT}` ||
  s.startsWith(`${MESH}-${AGENT}-`)
);
```

**Solution**: Always check BOTH exact name and suffix pattern.

## Test Hangs / Timeouts

**Symptom**: Test runs indefinitely or hits timeout

**Common Causes**:
- Waiting for wrong session to be idle (typo in session name)
- Waiting for something that never happens (wrong event)
- Agent blocked on user input
- Tmux server crashed

**Debug**:
```javascript
// Capture output from all sessions before timeout
const allSessions = TmuxInjector.listSessions();
console.log('=== Session Outputs ===');
allSessions.forEach(session => {
  console.log(`\n--- ${session} ---`);
  try {
    const output = execSync(`tmux capture-pane -t ${session} -p -S -50`);
    console.log(output);
  } catch (e) {
    console.log('(Could not capture)');
  }
});
```

**Prevention**:
- Use explicit session names (not variables)
- Add logging before every wait
- Set reasonable timeouts

## Core Receives No Messages

**Symptom**: Core's msgs/complete is empty

**Root Cause**: Agent never sent response, or watcher blocked it

**Check What Happened**:
```javascript
// 1. Did agent write to outbox?
const agentMsgs = `.ai/tx/mesh/test-ask/agents/asker/msgs/`;
const outboxFiles = fs.readdirSync(agentOutbox);
console.log('Agent outbox:', outboxFiles);

// 2. Are there watcher violations?
const errorLog = fs.readFileSync('.ai/tx/logs/error.jsonl', 'utf-8');
const violations = errorLog.split('\n').filter(l => l.includes('INVALID'));
console.log('Violations:', violations);

// 3. Check tmux for evidence
const output = execSync('tmux capture-pane -t core -p -S -100');
console.log(output);
```

**Common Blocker**: Watcher blocks non-outbox writes. Agents must write to outbox only.

## Validation Fails But Tmux Looks Fine

**Symptom**: Core tmux shows activity but test validation fails

**Likely Cause**: Validation checking for wrong thing in tmux output

**Fix**: Align validation with what's actually visible:

```javascript
// What might be visible:
// - "Read(...inbox/...)"
// - "Read(...complete/...)"
// - "task-complete"
// - "status: complete"
// - Agent name in output

const coreOutput = execSync(`tmux capture-pane -t core -p -S -100`);

// Check broadly first
const hasMessageProcessing =
  coreOutput.includes('inbox/') ||
  coreOutput.includes('complete/') ||
  coreOutput.includes('task-complete') ||
  coreOutput.includes('status: complete');

if (!hasMessageProcessing) {
  // Debug: show what IS there
  console.log('Core output:\n', coreOutput);
}
```

**Key**: Be flexible with validation - Claude's output may vary. Look for evidence of work, not exact strings.

## HITL Directory Path Mismatch

**Symptom**: E2EWorkflow HITL reports "0 Q&A rounds" but agent is creating ask messages

**Root Cause**: Mesh instance directories include UUID suffix (e.g., `hitl-3qa-858fc7`) but HITL handler was constructing path without it

**Wrong Path Construction**:
```javascript
// ❌ Missing the UUID suffix
const agentMsgsDir = `.ai/tx/mesh/${this.mesh}/agents/${this.agentName}/msgs`;
// Looks in: .ai/tx/mesh/hitl-3qa/agents/interviewer/msgs
// But actual: .ai/tx/mesh/hitl-3qa-858fc7/agents/interviewer/msgs
```

**Correct Path Construction**:
```javascript
// ✅ Extract mesh instance ID from session name
const meshInstanceId = this.meshSession.replace(`-${this.agentName}`, '');
const agentMsgsDir = `.ai/tx/mesh/${meshInstanceId}/agents/${this.agentName}/msgs`;
// Correctly finds: .ai/tx/mesh/hitl-3qa-858fc7/agents/interviewer/msgs
```

**Session Name Pattern**: `{mesh}-{uid}-{agent}`
- Example: `hitl-3qa-858fc7-interviewer`
- Mesh instance ID: `hitl-3qa-858fc7` (includes mesh name + UID)
- Agent name: `interviewer`

**Fixed Location**: `lib/e2e-workflow.js:620` in `_handleHITL()` method

**Why This Matters**:
- Spawned meshes get unique instance directories with UIDs
- Session names reflect this: `{mesh}-{uid}-{agent}`
- Directory paths must match the actual instance directory
- Can't assume static mesh names without UID suffixes

**Debugging Steps**:
```javascript
// 1. Check actual session name
console.log('Session:', this.meshSession);
// Output: "hitl-3qa-858fc7-interviewer"

// 2. Extract mesh instance ID
const meshInstanceId = this.meshSession.replace(`-${this.agentName}`, '');
console.log('Mesh instance:', meshInstanceId);
// Output: "hitl-3qa-858fc7"

// 3. Verify directory exists
const agentMsgsDir = `.ai/tx/mesh/${meshInstanceId}/agents/${this.agentName}/msgs`;
console.log('Watching:', agentMsgsDir);
const exists = fs.existsSync(agentMsgsDir);
console.log('Directory exists:', exists);
```

**Test Validation**: Successfully tested with both `hitl-3qa` and `deep-research` meshes, confirming HITL auto-response works correctly.
