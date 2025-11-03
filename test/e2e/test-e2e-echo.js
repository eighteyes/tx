const { execSync, spawn } = require('child_process');
const { TmuxInjector } = require('../../lib/tmux-injector');
const { E2EWorkflow } = require('../../lib/e2e-workflow');

/**
 * E2E Test: test-echo mesh
 *
 * Tests the core->echo->core workflow:
 * 1. Start tx system in detached mode
 * 2. Wait for core session + Claude ready + idle
 * 3. Inject spawn command for test-echo mesh
 * 4. Monitor for all workflow stages to complete
 * 5. Cleanup
 */

console.log('=== E2E Test: test-echo mesh ===\n');

// Configuration
const TEST_TIMEOUT = 120000; // 2 minutes total timeout
const CORE_SESSION = 'core';
const MESH = 'test-echo';
const AGENT = 'echo';

// Tracking
let txProcess = null;
let testPassed = false;

/**
 * Wait for tmux session to exist with retries
 */
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

/**
 * Wait for Claude to be ready in a session
 */
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

/**
 * Cleanup function
 */
async function cleanup() {
  console.log('\n🧹 Cleaning up...\n');

  // Stop tx system
  console.log('   Stopping tx system...');
  try {
    execSync('tx stop', { stdio: 'pipe' });
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    console.log('   (tx stop returned error - may be expected)');
  }

  // Kill tx process if running
  if (txProcess && !txProcess.killed) {
    try {
      txProcess.kill();
    } catch (e) {
      // Ignore
    }
  }

  // Kill sessions
  const sessionsToKill = [CORE_SESSION];
  const allSessions = TmuxInjector.listSessions();
  const matchingSessions = allSessions.filter(s => s.startsWith(`${MESH}-${AGENT}-`));
  sessionsToKill.push(...matchingSessions);

  sessionsToKill.forEach(session => {
    try {
      if (TmuxInjector.sessionExists(session)) {
        console.log(`   Killing session: ${session}`);
        TmuxInjector.killSession(session);
      }
    } catch (e) {
      // Ignore
    }
  });

  console.log('✅ Cleanup complete\n');
}

/**
 * Main test flow
 */
async function runE2ETest() {
  const testStartTime = Date.now();

  try {
    // Step 1: Start tx in detached mode
    console.log('📍 Step 1: Starting tx system in detached mode\n');
    console.log('   Running: node bin/tx.js start -d\n');

    txProcess = spawn('node', ['bin/tx.js', 'start', '-d'], {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    txProcess.stdout.on('data', (data) => {
      console.log(`   [tx stdout] ${data}`);
    });

    txProcess.stderr.on('data', (data) => {
      console.log(`   [tx stderr] ${data}`);
    });

    // Give tx a moment to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Wait for core session to be created
    console.log('\n📍 Step 2: Waiting for system readiness\n');

    const coreReady = await waitForSession(CORE_SESSION, 20000);
    if (!coreReady) {
      throw new Error('Core session not created within timeout');
    }

    // Wait for Claude to be ready in core
    const claudeReady = await waitForClaudeReady(CORE_SESSION, 30000);
    if (!claudeReady) {
      throw new Error('Claude not ready in core session');
    }

    // Wait for session to be idle (1 second of no output changes)
    console.log('⏳ Waiting for session to be idle (1 second)...\n');
    const isIdle = await TmuxInjector.waitForIdle(CORE_SESSION, 1000, 10000);
    if (!isIdle) {
      console.log('⚠️  Warning: Session may not be fully idle, but continuing...\n');
    } else {
      console.log('✅ Session is idle\n');
    }

    // Step 3: Use E2EWorkflow to test the complete workflow
    console.log('\n📍 Step 3: Testing mesh workflow\n');

    const workflow = new E2EWorkflow(MESH, AGENT, `spawn a ${MESH} mesh and send it a simple echo task`);
    const workflowPassed = await workflow.test();

    if (workflowPassed) {
      console.log('✅ TEST PASSED: Workflow successful!\n');
      testPassed = true;
    } else {
      console.log('❌ TEST FAILED: Workflow incomplete\n');
      testPassed = false;
    }

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    testPassed = false;
  } finally {
    const testDuration = Date.now() - testStartTime;
    console.log(`📊 Test duration: ${testDuration}ms\n`);

    await cleanup();

    // Exit with appropriate code
    const exitCode = testPassed ? 0 : 1;
    console.log(`${testPassed ? '✅' : '❌'} E2E Test ${testPassed ? 'PASSED' : 'FAILED'}\n`);
    process.exit(exitCode);
  }
}

// Set overall timeout
const overallTimeout = setTimeout(() => {
  console.error('\n❌ TEST TIMEOUT: Test took longer than 120 seconds');
  testPassed = false;
  cleanup().then(() => process.exit(1));
}, TEST_TIMEOUT);

// Run test
runE2ETest().catch(error => {
  console.error('Unhandled error:', error);
  clearTimeout(overallTimeout);
  cleanup().then(() => process.exit(1));
});
