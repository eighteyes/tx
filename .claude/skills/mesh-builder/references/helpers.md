# Helper Functions

Reusable utility functions for E2E tests.

## Capture Session Output for Debugging

Display session content when tests fail:

```javascript
function captureSessionOutput(sessionName, numLines = 20) {
  try {
    const output = execSync(`tmux capture-pane -t ${sessionName} -p -S -${numLines}`, {
      stdio: 'pipe',
      encoding: 'utf-8'
    });
    return output;
  } catch (e) {
    return `(Could not capture output from ${sessionName})`;
  }
}

// Use in tests:
if (!testPassed) {
  console.log('\n📺 Last 30 lines from core session:\n');
  console.log(captureSessionOutput('core', 30));
}
```

## Wait for Session to Exist

Polling function for initial session creation:

```javascript
async function waitForSession(sessionName, timeout = 15000, pollInterval = 500) {
  console.log(`⏳ Waiting for session "${sessionName}" to be created...`);
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const sessions = TmuxInjector.listSessions();
    if (sessions.includes(sessionName)) {
      console.log(`✅ Session "${sessionName}" detected\n`);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.error(`❌ Session "${sessionName}" not found after ${timeout}ms`);
  return false;
}
```

## Wait for Claude Ready

Check that Claude has initialized:

```javascript
async function waitForClaudeReady(sessionName, timeout = 30000) {
  console.log(`⏳ Waiting for Claude to initialize in "${sessionName}"...`);
  const ready = await TmuxInjector.claudeReadyCheck(sessionName, timeout);
  if (ready) {
    console.log(`✅ Claude is ready in "${sessionName}"\n`);
  } else {
    console.error(`❌ Claude failed to initialize in "${sessionName}"`);
  }
  return ready;
}
```

## Poll for On-Demand Spawned Sessions

For agents spawned dynamically (via `/ask`, etc.):

```javascript
async function waitForSessionPattern(pattern, timeout = 30000) {
  console.log(`⏳ Waiting for session matching: ${pattern}...`);
  let matchingSession = null;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout && !matchingSession) {
    const allSessions = TmuxInjector.listSessions();
    // Match exact name OR name with UID suffix (e.g., "test-ask-answerer" or "test-ask-answerer-abc1")
    matchingSession = allSessions.find(s =>
      s === pattern || s.startsWith(`${pattern}-`)
    );

    if (!matchingSession) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  if (matchingSession) {
    console.log(`✅ Session found: ${matchingSession}\n`);
  } else {
    console.log(`❌ Session not found after ${timeout}ms\n`);
  }

  return matchingSession;
}
```

## Capture and Handle Process Output

When spawning tx system, capture stdout/stderr:

```javascript
const txProcess = spawn('tx', ['start', '-d'], {
  cwd: process.cwd(),
  stdio: 'pipe'
});

// Capture output for debugging
txProcess.stdout.on('data', (data) => {
  console.log(`   [tx stdout] ${data}`);
});

txProcess.stderr.on('data', (data) => {
  console.log(`   [tx stderr] ${data}`);
});

// Wait for spawn to complete
await new Promise(resolve => setTimeout(resolve, 2000));
```
