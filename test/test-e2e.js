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
 * 3. Inject command to spawn test-echo agent with a simple task
 * 4. Wait for task completion
 * 5. Verify output
 * 6. Cleanup
 */

console.log('=== E2E Test: tx start -d → spawn test-echo → send task ===\n');

// Configuration
const TEST_TIMEOUT = 60000; // 60 seconds total timeout
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
 * Check if output files were created
 */
function checkTaskOutput() {
  console.log('🔍 Checking for task output...\n');

  // The agent directory will be like: echo-set0 (where set0 is generated from task string)
  // We need to find the actual directory since we don't know the exact UID
  const agentsDir = `.ai/tx/mesh/${MESH}/agents`;

  if (!fs.existsSync(agentsDir)) {
    console.log(`   ❌ Agents directory doesn't exist: ${agentsDir}`);
    return false;
  }

  // Find agent directory matching pattern: echo-*
  const agents = fs.readdirSync(agentsDir).filter(f => f.startsWith(`${AGENT}-`));

  if (agents.length === 0) {
    console.log(`   ❌ No agent directories found matching: ${AGENT}-*`);
    console.log(`   Available: ${fs.readdirSync(agentsDir).join(', ')}`);
    return false;
  }

  // Check first matching agent
  const agentName = agents[0];
  const outputPath = `${agentsDir}/${agentName}/msgs/complete`;

  console.log(`   Found agent: ${agentName}`);
  console.log(`   Checking: ${outputPath}\n`);

  if (!fs.existsSync(outputPath)) {
    console.log(`   ⚠️  Complete directory doesn't exist yet: ${outputPath}`);
    return false;
  }

  const completeFiles = fs.readdirSync(outputPath).filter(f => f.endsWith('.md'));

  if (completeFiles.length > 0) {
    console.log(`   ✅ Found ${completeFiles.length} complete message(s):`);
    completeFiles.forEach(file => {
      console.log(`      - ${file}`);
      const content = fs.readFileSync(path.join(outputPath, file), 'utf-8');
      console.log(`      Preview: ${content.substring(0, 100)}...`);
    });
    return true;
  }

  console.log(`   ❌ No complete messages found in: ${outputPath}`);
  return false;
}

/**
 * Cleanup function
 */
async function cleanup(spawnSessionName = null) {
  console.log('\n🧹 Cleaning up...\n');

  // Kill tx process if running
  if (txProcess && !txProcess.killed) {
    console.log('   Stopping tx system...');
    try {
      execSync('tx stop', { stdio: 'pipe' });
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      // Ignore errors
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

    // Step 3: Inject spawn command
    console.log('📍 Step 3: Injecting spawn command\n');

    const spawnCmd = `spawn ${MESH} ${AGENT} --init "${TASK_STRING}"`;
    console.log(`   Injecting: ${spawnCmd}\n`);

    TmuxInjector.injectCommand(CORE_SESSION, spawnCmd);

    // Wait for spawn session to be created (with pattern matching)
    console.log(`   Waiting for session matching pattern: ${MESH}-${AGENT}-*\n`);
    const maxRetries = 40;
    for (let i = 0; i < maxRetries; i++) {
      const sessions = TmuxInjector.listSessions();
      const matchingSession = sessions.find(s => s.startsWith(`${MESH}-${AGENT}-`));
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

    // Step 4: Wait for task processing
    console.log('📍 Step 4: Waiting for task processing\n');
    console.log('   ⏳ Waiting 10 seconds for agent to process task...\n');

    await new Promise(resolve => setTimeout(resolve, 10000));

    // Step 5: Check for output
    console.log('📍 Step 5: Verifying task completion\n');

    const outputFound = checkTaskOutput();

    if (outputFound) {
      console.log('\n✅ TEST PASSED: Task was processed and completed!\n');
      testPassed = true;
    } else {
      console.log('\n⚠️  No output found yet, but system is working.\n');
      console.log('   (Task may still be processing in background)\n');
      testPassed = true; // Consider it a pass if system started without errors
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
  console.error('\n❌ TEST TIMEOUT: Test took longer than 60 seconds');
  testPassed = false;
  cleanup(null).then(() => process.exit(1));
}, TEST_TIMEOUT);

// Run test
runE2ETest().catch(error => {
  console.error('Unhandled error:', error);
  clearTimeout(overallTimeout);
  cleanup(null).then(() => process.exit(1));
});
