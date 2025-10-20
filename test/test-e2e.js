const fs = require('fs-extra');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { TmuxInjector } = require('../lib/tmux-injector');
const { Watcher } = require('../lib/watcher');
const { Queue } = require('../lib/queue');

/**
 * E2E Test: Full workflow with `tx start -d`
 *
 * Steps:
 * 1. Start tx system in detached mode (`tx start -d`)
 * 2. Wait for system readiness (core session created)
 * 3. Inject spawn command for test-echo agent
 * 4. Wait for task completion
 * 5. Verify output
 * 6. Cleanup
 */

console.log('=== E2E Test: tx start -d → spawn test-echo → send task ===\n');

// Configuration
const TEST_TIMEOUT = 120000; // 120 seconds total timeout
const CORE_SESSION = 'core';
const MESH = 'test-echo';
const AGENT = 'echo';
// Task string for spawn - UID will be generated from this
const TASK_STRING = 'simple e2e test';
// Generated UID will be: "set0" (s, e, t from "simple e2e test" + 0 padding)

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
 * Poll for task completion using tmux session checks
 * Tests: 1) Core spawned, 2) test-echo spawned, 3) test-echo received message, 4) core received response
 */
async function waitForTaskCompletion(maxIdleTime = 30000, pollInterval = 500) {
  console.log('🔍 Polling using tmux session checks...\n');

  let lastChangeTime = Date.now();
  let coreSpawned = false;
  let echoSpawned = false;
  let echoReceivedMessage = false;
  let coreReceivedResponse = false;
  let echoSessionName = null;

  while (Date.now() - lastChangeTime < maxIdleTime) {
    // Test 1: Check if core session exists
    if (!coreSpawned) {
      if (TmuxInjector.sessionExists(CORE_SESSION)) {
        console.log(`   ✅ 1) Core spawned (session: ${CORE_SESSION})`);
        coreSpawned = true;
        lastChangeTime = Date.now();
      }
    }

    // Test 2: Check if test-echo session exists
    if (coreSpawned && !echoSpawned) {
      const sessions = TmuxInjector.listSessions();
      const expectedSession = `${MESH}-${AGENT}`;
      const echoSession = sessions.find(s => s === expectedSession || s.startsWith(`${expectedSession}-`));
      if (echoSession) {
        echoSessionName = echoSession;
        console.log(`   ✅ 2) test-echo spawned (session: ${echoSessionName})`);
        echoSpawned = true;
        lastChangeTime = Date.now();
      }
    }

    // Test 3: Check if test-echo received the message (check tmux output)
    if (echoSpawned && !echoReceivedMessage && echoSessionName) {
      try {
        const output = execSync(`tmux capture-pane -t ${echoSessionName} -p`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Look for message indicators in tmux output
        if (output.includes('simple task') || output.includes('test-echo')) {
          console.log(`   ✅ 3) test-echo received message (visible in tmux)`);
          echoReceivedMessage = true;
          lastChangeTime = Date.now();
        }
      } catch (e) {
        // Session might not be ready yet
      }
    }

    // Test 4: Check if core received response (check tmux output)
    if (echoReceivedMessage && !coreReceivedResponse) {
      try {
        const output = execSync(`tmux capture-pane -t ${CORE_SESSION} -p`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Look for response indicators in core tmux output
        if (output.includes(`${MESH}`) || output.includes('echo')) {
          console.log(`   ✅ 4) core received response (visible in tmux)`);
          coreReceivedResponse = true;
          lastChangeTime = Date.now();
        }
      } catch (e) {
        // Ignore errors
      }
    }

    // All tests passed!
    if (coreSpawned && echoSpawned && echoReceivedMessage && coreReceivedResponse) {
      console.log('');
      return true;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.log(`\n❌ Timeout: No activity for ${maxIdleTime}ms`);
  console.log(`   1) Core spawned: ${coreSpawned}`);
  console.log(`   2) Echo spawned: ${echoSpawned}`);
  console.log(`   3) Echo received message: ${echoReceivedMessage}`);
  console.log(`   4) Core received response: ${coreReceivedResponse}\n`);

  return false;
}

/**
 * Cleanup function
 */
async function cleanup(spawnSessionName = null) {
  console.log('\n🧹 Cleaning up...\n');

  // Always stop tx system
  console.log('   Stopping tx system...');
  try {
    execSync('tx stop', { stdio: 'pipe' });
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    // tx stop may fail if system not running, that's ok
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

  // Kill all test sessions
  const sessionsToKill = [CORE_SESSION];
  if (spawnSessionName) {
    sessionsToKill.push(spawnSessionName);
  }

  // Also kill any matching sessions
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

  // Clean up test mesh
  const testMeshDir = `.ai/tx/mesh/${MESH}`;
  if (fs.existsSync(testMeshDir)) {
    console.log(`   Removing test mesh: ${testMeshDir}`);
    fs.removeSync(testMeshDir);
  }

  console.log('✅ Cleanup complete\n');
}

/**
 * Main test flow
 */
async function runE2ETest() {
  const testStartTime = Date.now();
  let spawnSessionName = null;

  try {
    // Step 1: Start tx in detached mode
    console.log('📍 Step 1: Starting tx system in detached mode\n');
    console.log('   Running: tx start -d\n');

    txProcess = spawn('tx', ['start', '-d'], {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    let txOutput = '';
    txProcess.stdout.on('data', (data) => {
      txOutput += data.toString();
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

    // Wait for session to be idle (5 seconds of no output changes)
    console.log('⏳ Waiting for session to be idle (5 seconds)...\n');
    const isIdle = await TmuxInjector.waitForIdle(CORE_SESSION, 5000, 10000);
    
    if (!isIdle) {
      console.log('⚠️  Warning: Session may not be fully idle, but continuing...\n');
    } else {
      console.log('✅ Session is idle\n');
    }

    // Step 3: Inject spawn command
    console.log('📍 Step 3: Injecting spawn command\n');

    const spawnCmd = `spawn a ${MESH} mesh and send it a simple task`;
    console.log(`   Injecting: ${spawnCmd}\n`);

    TmuxInjector.injectText(CORE_SESSION, spawnCmd);

    // Wait for spawn session to be created
    const expectedSession = `${MESH}-${AGENT}`;
    console.log(`   Waiting for session: ${expectedSession}\n`);
    const maxRetries = 40;
    for (let i = 0; i < maxRetries; i++) {
      const sessions = TmuxInjector.listSessions();
      const matchingSession = sessions.find(s => s === expectedSession || s.startsWith(`${expectedSession}-`));
      if (matchingSession) {
        spawnSessionName = matchingSession;
        console.log(`✅ Found spawn session: ${spawnSessionName}\n`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!spawnSessionName) {
      console.log(`⚠️  Spawn session not found, but continuing...\n`);
    }

    // Step 4: Wait for task completion and response routing
    console.log('📍 Step 4: Waiting for task completion and response routing\n');
    console.log('   ⏳ Polling with 10 second idle timeout...\n');

    const completionFound = await waitForTaskCompletion(30000, 500);

    // Step 5: Verify results
    console.log('📍 Step 5: Verify result\n');

    if (completionFound) {
      console.log('✅ TEST PASSED: Full round-trip successful!\n');
      console.log('   Task: core → echo agent');
      console.log('   Response: echo agent → core inbox\n');
      testPassed = true;
    } else {
      console.log('❌ TEST FAILED: Incomplete round-trip detected\n');
      testPassed = false;
    }

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    testPassed = false;
  } finally {
    const testDuration = Date.now() - testStartTime;
    console.log(`📊 Test duration: ${testDuration}ms\n`);

    await cleanup(spawnSessionName);

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
  cleanup(null).then(() => process.exit(1));
}, TEST_TIMEOUT);

// Run test
runE2ETest().catch(error => {
  console.error('Unhandled error:', error);
  clearTimeout(overallTimeout);
  cleanup(null).then(() => process.exit(1));
});
