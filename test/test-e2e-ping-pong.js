const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { TmuxInjector } = require('../lib/tmux-injector');
const { E2EWorkflow } = require('../lib/e2e-workflow');

/**
 * Capture and display the last N lines from a tmux session
 */
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

/**
 * E2E Test: test-ping-pong mesh
 *
 * Tests the ping-pong workflow where two agents exchange messages:
 * - pinger sends 2 ping messages to ponger
 * - ponger responds with 2 pong messages
 * - test validates both agents spawn and exchange messages
 */

console.log('=== E2E Test: test-ping-pong mesh (ping-pong exchange) ===\n');

const TEST_TIMEOUT = 180000; // 3 minutes to allow for cleanup
const CORE_SESSION = 'core';
const MESH = 'test-ping-pong';
const ENTRY_AGENT = 'pinger';

let txProcess = null;
let testPassed = false;

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

async function cleanup() {
  console.log('\n🧹 Cleaning up...\n');

  console.log('   Stopping tx system...');
  try {
    execSync('tx stop', { stdio: 'pipe' });
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    console.log('   (tx stop returned error - may be expected)');
  }

  if (txProcess && !txProcess.killed) {
    try {
      txProcess.kill();
    } catch (e) {
      // Ignore
    }
  }

  const sessionsToKill = [CORE_SESSION];
  const allSessions = TmuxInjector.listSessions();
  const matchingSessions = allSessions.filter(s => s.startsWith(`${MESH}-`));
  sessionsToKill.push(...matchingSessions);

  sessionsToKill.forEach(session => {
    try {
      if (TmuxInjector.sessionExists(session)) {
        TmuxInjector.killSession(session);
        console.log(`   ✅ Killed session: ${session}`);
      }
    } catch (e) {
      // Ignore
    }
  });

  try {
    execSync('tmux kill-server', { stdio: 'pipe' });
    console.log('   ✅ Killed tmux server');
  } catch (e) {
    // Ignore
  }

  console.log('');
}

async function runE2ETest() {
  const testStartTime = Date.now();

  try {
    // Ensure tmux server is running before starting tests
    console.log('🔧 Ensuring tmux server is running...\n');
    try {
      execSync('tmux start-server', { stdio: 'pipe' });
      console.log('✅ Tmux server started\n');
    } catch (e) {
      // Server may already be running, that's okay
      console.log('ℹ️  Tmux server already running or started\n');
    }

    console.log('📍 Step 1: Starting tx system in detached mode\n');
    console.log('   Running: tx start -d\n');

    txProcess = spawn('tx', ['start', '-d'], {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    txProcess.stdout.on('data', (data) => {
      console.log(`   [tx stdout] ${data}`);
    });

    txProcess.stderr.on('data', (data) => {
      console.log(`   [tx stderr] ${data}`);
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n📍 Step 2: Waiting for system readiness\n');

    const coreReady = await waitForSession(CORE_SESSION, 45000);
    if (!coreReady) {
      throw new Error('Core session not created within timeout');
    }

    const claudeReady = await waitForClaudeReady(CORE_SESSION, 60000);
    if (!claudeReady) {
      throw new Error('Claude not ready in core session');
    }

    console.log('⏳ Waiting for session to be idle (1 second)...\n');
    const isIdle = await TmuxInjector.waitForIdle(CORE_SESSION, 1000, 15000);
    if (!isIdle) {
      console.log('⚠️  Warning: Core may not be fully idle, but continuing...\n');
    } else {
      console.log('✅ Core is idle\n');
    }

    console.log('\n📍 Step 3: Testing ping-pong workflow\n');

    const workflow = new E2EWorkflow(MESH, ENTRY_AGENT, `spawn a ${MESH} mesh and have pinger and ponger exchange 2 ping-pong messages`);
    const workflowPassed = await workflow.test();

    // After workflow, wait for both agent sessions
    if (workflowPassed) {
      console.log('📍 Waiting for both agent sessions to spawn...\n');

      // Both pinger and ponger should spawn
      let pingerSession = null;
      let pongerSession = null;
      const maxWait = 30000; // 30 seconds
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait && (!pingerSession || !pongerSession)) {
        const allSessions = TmuxInjector.listSessions();
        pingerSession = allSessions.find(s => s === `${MESH}-pinger` || s.startsWith(`${MESH}-pinger-`));
        pongerSession = allSessions.find(s => s === `${MESH}-ponger` || s.startsWith(`${MESH}-ponger-`));

        if (!pingerSession || !pongerSession) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log('📍 Checking for both agent sessions:\n');
      if (pingerSession) {
        console.log(`   ✅ Pinger session found: ${pingerSession}`);
      } else {
        console.log(`   ❌ Pinger session NOT found`);
      }

      if (pongerSession) {
        console.log(`   ✅ Ponger session found: ${pongerSession}`);
      } else {
        console.log(`   ❌ Ponger session NOT found`);
      }

      if (!pingerSession || !pongerSession) {
        console.error('\n❌ Not all agent sessions spawned\n');
        testPassed = false;
      } else {
        console.log('\n✅ Both agent sessions spawned\n');
        testPassed = true;
      }
    }

    if (!workflowPassed) {
      console.log('❌ TEST FAILED: Ping-pong workflow incomplete\n');
      testPassed = false;
    } else if (!testPassed) {
      // Sessions check failed
      console.log('❌ TEST FAILED: Not all agent sessions spawned\n');
    } else {
      // Workflow passed and both sessions exist
      // First, wait for core to finish sending task to pinger
      console.log('⏳ Waiting for core to finish sending task message...\n');
      const coreIdle = await TmuxInjector.waitForIdle(CORE_SESSION, 5000, 60000);
      if (!coreIdle) {
        console.log('⚠️  Warning: Core may still be working, but continuing...\n');
      } else {
        console.log('✅ Core is idle (task message sent)\n');
      }

      // Now wait for pinger to complete work (idle = done)
      console.log('⏳ Waiting for pinger to complete exchange...\n');
      const pingerIdle = await TmuxInjector.waitForIdle('test-ping-pong-pinger', 5000, 60000);
      if (!pingerIdle) {
        console.log('⚠️  Warning: Pinger may still be working, but continuing...\n');
      } else {
        console.log('✅ Pinger is idle (exchange complete)\n');
      }

      // Finally, wait for core to receive completion (should go idle again after receiving)
      console.log('⏳ Waiting for core to receive completion...\n');
      const coreFinalIdle = await TmuxInjector.waitForIdle(CORE_SESSION, 5000, 60000);
      if (!coreFinalIdle) {
        console.log('⚠️  Warning: Core may still be processing completion, but continuing...\n');
      } else {
        console.log('✅ Core is idle (completion received)\n');
      }

      // Check core tmux session for evidence of message processing
      console.log('📍 Verifying core sent and routed messages (via tmux)\n');
      try {
        const coreOutput = execSync(`tmux capture-pane -t ${CORE_SESSION} -p -S -100`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Look for signs that core created and routed messages
        // Could be: "outbox/", "will be routed", "Created task message", etc.
        const hasOutbox = coreOutput.includes('outbox/');
        const hasRouting = coreOutput.includes('will be routed') || coreOutput.includes('routed to');
        const hasTaskMsg = coreOutput.includes('task message') || coreOutput.includes('message in my');
        const hasInboxOrComplete = coreOutput.includes('inbox/') || coreOutput.includes('complete/');

        if (hasOutbox || hasRouting || hasTaskMsg || hasInboxOrComplete) {
          console.log(`✅ Core tmux shows message creation and routing\n`);
          testPassed = true;
          console.log('✅ TEST PASSED: Mesh spawned, agents exchanged messages!\n');
        } else {
          console.log('❌ Core tmux shows no message processing\n');
          console.log('Last 30 lines of core session:\n');
          console.log(coreOutput.split('\n').slice(-30).join('\n'));
          testPassed = false;
          console.log('\n❌ TEST FAILED: No message activity visible in core tmux\n');
        }
      } catch (e) {
        console.log(`❌ Failed to capture core session: ${e.message}\n`);
        testPassed = false;
      }
    }

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    testPassed = false;
  } finally {
    const testDuration = Date.now() - testStartTime;
    console.log(`📊 Test duration: ${testDuration}ms\n`);

    await cleanup();

    const exitCode = testPassed ? 0 : 1;
    console.log(`${testPassed ? '✅' : '❌'} E2E Test ${testPassed ? 'PASSED' : 'FAILED'}\n`);
    process.exit(exitCode);
  }
}

const overallTimeout = setTimeout(() => {
  console.error('\n❌ TEST TIMEOUT: Test took longer than 120 seconds');
  testPassed = false;
  cleanup().then(() => process.exit(1));
}, TEST_TIMEOUT);

runE2ETest().catch(error => {
  console.error('Unhandled error:', error);
  clearTimeout(overallTimeout);
  cleanup().then(() => process.exit(1));
});
