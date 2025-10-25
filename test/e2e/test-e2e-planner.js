#!/usr/bin/env node

/**
 * E2E Test: Planner Mesh (MAP Architecture)
 *
 * Tests the brain-inspired modular planning system with feedback loops.
 *
 * Workflow:
 * 1. Core spawns planner mesh
 * 2. Decomposer breaks task into subtasks
 * 3. Predictor predicts outcomes
 * 4. Evaluator scores paths
 * 5. Monitor checks for conflicts (rejects first time, approves second)
 * 6. Coordinator assembles final plan
 * 7. Validates iterative refinement works
 */

const { execSync, spawn } = require('child_process');
const { TmuxInjector } = require('../../lib/tmux-injector');
const { E2EWorkflow } = require('../../lib/e2e-workflow');

const MESH = 'planner';
const CORE = 'core';
const ENTRY_AGENT = 'decomposer';
const TEST_TIMEOUT = 480000; // 8 minutes for complex 5-agent iterative workflow with feedback loops

let txProcess = null;
let testPassed = false;

/**
 * Wait for a tmux session to exist
 */
async function waitForSession(sessionName, timeout = 30000) {
  console.log(`⏳ Waiting for session "${sessionName}" to be created...`);
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const sessions = TmuxInjector.listSessions();
    if (sessions.includes(sessionName)) {
      console.log(`✅ Session "${sessionName}" detected\n`);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
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

  const sessionsToKill = [CORE];
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

/**
 * Main test function
 */
async function runTest() {
  console.log('\n=== Planner Mesh E2E Test (MAP Architecture) ===\n');

  const testStart = Date.now();

  try {
    // Step 1: Start tmux server
    console.log('🔧 Ensuring tmux server is running...\n');
    try {
      execSync('tmux start-server', { stdio: 'pipe' });
      console.log('✅ Tmux server started\n');
    } catch (e) {
      console.log('ℹ️  Tmux server already running or started\n');
    }

    // Step 2: Start tx system
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

    // Wait for system to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Wait for core session
    console.log('\n📍 Step 2: Waiting for system readiness\n');

    const coreReady = await waitForSession(CORE, 45000);
    if (!coreReady) {
      throw new Error('Core session not created within timeout');
    }

    // Step 4: Wait for Claude to be ready
    const claudeReady = await waitForClaudeReady(CORE, 60000);
    if (!claudeReady) {
      throw new Error('Claude not ready in core session');
    }

    // Step 5: Wait for core to be idle
    console.log('⏳ Waiting for session to be idle (1 second)...\n');
    const isIdle = await TmuxInjector.waitForIdle(CORE, 1000, 15000);
    if (!isIdle) {
      console.log('⚠️  Warning: Core may not be fully idle, but continuing...\n');
    } else {
      console.log('✅ Core is idle\n');
    }

    // Step 6: Use E2EWorkflow to test the complete workflow
    console.log('\n📍 Step 3: Testing planner mesh workflow\n');

    // Use longer timeout for complex multi-agent workflow
    const workflow = new E2EWorkflow(
      MESH,
      ENTRY_AGENT,
      'spawn a planner mesh and create a plan for deploying a web application with zero downtime',
      { workflowTimeout: 120000 } // 2 minutes for complex planning workflow
    );
    const workflowPassed = await workflow.test();

    if (workflowPassed) {
      console.log('✅ TEST PASSED: Planner mesh workflow successful!\n');
      testPassed = true;
    } else {
      console.log('❌ TEST FAILED: Planner workflow incomplete\n');
      testPassed = false;
    }

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    testPassed = false;
  } finally {
    const testDuration = Date.now() - testStart;
    console.log(`📊 Test duration: ${testDuration}ms\n`);

    await cleanup();

    const exitCode = testPassed ? 0 : 1;
    console.log(`${testPassed ? '✅' : '❌'} E2E Test ${testPassed ? 'PASSED' : 'FAILED'}\n`);
    process.exit(exitCode);
  }
}

// Set overall timeout
const overallTimeout = setTimeout(() => {
  console.error('\n❌ TEST TIMEOUT: Test took longer than allowed duration');
  testPassed = false;
  cleanup().then(() => process.exit(1));
}, TEST_TIMEOUT);

// Run test
runTest().catch(error => {
  console.error('\n❌ Unhandled test error:', error);
  clearTimeout(overallTimeout);
  cleanup().then(() => process.exit(1));
});
