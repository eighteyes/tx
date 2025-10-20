# Advanced Patterns

Production-ready patterns from real E2E tests.

## Cleanup with Multiple Sessions

Always use try/catch blocks and filter-based cleanup:

```javascript
async function cleanup() {
  console.log('\n🧹 Cleaning up...\n');

  // Stop tx system
  try {
    execSync('tx stop', { stdio: 'pipe' });
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    console.log('(tx stop error - may be expected)');
  }

  // Kill individual sessions
  const sessionsToKill = ['core'];
  const allSessions = TmuxInjector.listSessions();

  // Add mesh sessions (filter by mesh prefix)
  const meshSessions = allSessions.filter(s => s.startsWith('test-ask-'));
  sessionsToKill.push(...meshSessions);

  // Kill each session
  sessionsToKill.forEach(session => {
    try {
      if (TmuxInjector.sessionExists(session)) {
        console.log(`   Killing session: ${session}`);
        TmuxInjector.killSession(session);
      }
    } catch (e) {
      // Ignore individual kill failures
    }
  });

  console.log('✅ Cleanup complete\n');
}

// Call in finally block
try {
  await runTest();
} finally {
  await cleanup();
  process.exit(testPassed ? 0 : 1);
}
```

## Session Naming Patterns

How agents are named and how to match them reliably:

```javascript
// Exact name (no task)
const coreSession = 'core';

// Mesh-agent pattern (most common)
const baseAgent = `${MESH}-${AGENT}`;  // "test-ask-asker"

// With task UID suffix (when spawned with --init)
const withUID = `${MESH}-${AGENT}-abc1`;  // "test-ask-asker-abc1"

// Matching pattern (find either variant) - ALWAYS use both checks
const sessionName = allSessions.find(s =>
  s === baseAgent ||
  s.startsWith(`${baseAgent}-`)
);

// Filter all matching sessions
const allMatchingSessions = allSessions.filter(s =>
  s === baseAgent ||
  s.startsWith(`${baseAgent}-`)
);
```

**Critical**: Always check BOTH exact name and suffix variant. Session names may include UID suffixes.

## Multi-Agent Sequencing

Waiting for the right idle points in core → agent → core workflows:

```javascript
// 1. Core finishes sending task message
console.log('⏳ Waiting for core to send task...\n');
const coreIdle1 = await TmuxInjector.waitForIdle('core', 5000, 60000);

// 2. Agent completes work
console.log('⏳ Waiting for agent to complete...\n');
const agentIdle = await TmuxInjector.waitForIdle('test-ask-asker', 5000, 60000);

// 3. Core finishes processing agent response
console.log('⏳ Waiting for core to receive completion...\n');
const coreIdle2 = await TmuxInjector.waitForIdle('core', 5000, 60000);

// Now validate via tmux
const coreOutput = execSync(`tmux capture-pane -t core -p -S -100`);
const success = coreOutput.includes('complete/') || coreOutput.includes('task-complete');
```

This pattern ensures you're waiting at the right moments and not checking too early.

## On-Demand Agent Spawning

Pattern for agents spawned dynamically (e.g., via `/ask`):

```javascript
// After workflow that spawns agents, wait for them to appear
let answererSession = null;
const maxWait = 30000; // 30 seconds
const startTime = Date.now();

while (Date.now() - startTime < maxWait && !answererSession) {
  const allSessions = TmuxInjector.listSessions();
  answererSession = allSessions.find(s =>
    s === 'test-ask-answerer' ||
    s.startsWith('test-ask-answerer-')
  );

  if (!answererSession) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

if (!answererSession) {
  // Debug output
  const allSessions = TmuxInjector.listSessions();
  console.error('Available sessions:', allSessions.join(', '));
  throw new Error('Answerer session not found');
}
```

Key: Use polling with timeout for on-demand agents, not immediate checks.
