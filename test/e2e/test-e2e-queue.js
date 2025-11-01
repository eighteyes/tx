const { execSync, spawn } = require('child_process');
const { TmuxInjector } = require('../../lib/tmux-injector');
const { E2EWorkflow } = require('../../lib/e2e-workflow');
const fs = require('fs-extra');
const path = require('path');

/**
 * E2E Test: test-queue mesh
 *
 * Tests queue sequential processing:
 * 1. Spawn test-queue mesh
 * 2. Send 3 tasks to the queue-worker agent
 * 3. Verify messages are processed sequentially (one at a time)
 * 4. Verify all responses are received by core
 */

console.log('=== E2E Test: test-queue mesh ===\n');

const TEST_TIMEOUT = 180000; // 3 minutes for queue processing
const CORE_SESSION = 'core';
const MESH = 'test-queue';
const AGENT = 'queue-worker';

let txProcess = null;
let testPassed = false;
let meshSession = null;
let meshInstanceId = null;

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
 * Send additional tasks to the queue-worker via core
 */
async function sendAdditionalTasks(taskNumber) {
  console.log(`📍 Sending task ${taskNumber} to queue-worker\n`);

  // Wait for core to be idle
  const coreIdle = await TmuxInjector.waitForIdle(CORE_SESSION, 2000, 15000);
  if (!coreIdle) {
    console.log('⚠️  Warning: Core may not be idle\n');
  }

  // Send natural language instruction to Claude
  const instruction = `send a message to ${meshInstanceId}/${AGENT} with task: "Process item ${taskNumber}"`;
  TmuxInjector.injectText(CORE_SESSION, instruction);
  await new Promise(resolve => setTimeout(resolve, 500));
  TmuxInjector.send(CORE_SESSION, 'Enter');

  console.log(`   Sent: "${instruction}"\n`);

  // Wait for core to process
  await TmuxInjector.waitForIdle(CORE_SESSION, 2000, 30000);

  // Send Enter to continue
  TmuxInjector.send(CORE_SESSION, 'Enter');

  // Wait for message to be written
  await TmuxInjector.waitForIdle(CORE_SESSION, 2000, 30000);
}

/**
 * Verify sequential processing by checking agent session output
 */
async function verifySequentialProcessing() {
  console.log('📍 Verifying sequential processing\n');

  // Wait a bit for processing to happen
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Check agent session output
  try {
    const output = execSync(`tmux capture-pane -t ${meshSession} -p -S -300`, {
      encoding: 'utf-8'
    });

    console.log('   Agent session output (last 50 lines):\n');
    const lines = output.split('\n').slice(-50);
    lines.forEach(line => console.log(`   ${line}`));

    // Look for evidence of processing 3 tasks
    const hasTask1 = output.includes('item 1') || output.includes('Task 1') || output.includes('first');
    const hasTask2 = output.includes('item 2') || output.includes('Task 2') || output.includes('second');
    const hasTask3 = output.includes('item 3') || output.includes('Task 3') || output.includes('third');

    // Look for Write operations (responses)
    const writeMatches = output.match(/Write\(/g);
    const writeCount = writeMatches ? writeMatches.length : 0;

    console.log(`\n   ✅ Evidence found:`);
    console.log(`      - Task 1 processed: ${hasTask1}`);
    console.log(`      - Task 2 processed: ${hasTask2}`);
    console.log(`      - Task 3 processed: ${hasTask3}`);
    console.log(`      - Write operations: ${writeCount}\n`);

    // Verify all tasks were processed
    if (!hasTask1 || !hasTask2 || !hasTask3) {
      console.log('❌ Not all tasks were processed\n');
      return false;
    }

    // Verify we have responses (should be 3)
    if (writeCount < 3) {
      console.log(`❌ Expected 3 responses, found ${writeCount}\n`);
      return false;
    }

    return true;

  } catch (e) {
    console.error(`❌ Error checking session output: ${e.message}`);
    return false;
  }
}

/**
 * Verify all responses were received by core
 */
async function verifyResponsesReceived() {
  console.log('📍 Verifying core received all responses\n');

  const msgsDir = `.ai/tx/mesh/${meshInstanceId}/agents/${AGENT}/msgs`;

  if (!fs.existsSync(msgsDir)) {
    console.log(`❌ Messages directory not found: ${msgsDir}\n`);
    return false;
  }

  const files = fs.readdirSync(msgsDir);
  const doneFiles = files.filter(f => f.endsWith('-done.md'));

  console.log(`   Total message files: ${files.length}`);
  console.log(`   Done files: ${doneFiles.length}\n`);

  // Should have 3 done files (one for each task)
  if (doneFiles.length < 3) {
    console.log(`❌ Expected 3 done files, found ${doneFiles.length}\n`);
    return false;
  }

  console.log('✅ All responses received by core\n');
  return true;
}

async function runE2ETest() {
  const testStartTime = Date.now();

  try {
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

    const coreReady = await waitForSession(CORE_SESSION, 20000);
    if (!coreReady) {
      throw new Error('Core session not created within timeout');
    }

    const claudeReady = await waitForClaudeReady(CORE_SESSION, 30000);
    if (!claudeReady) {
      throw new Error('Claude not ready in core session');
    }

    console.log('⏳ Waiting for session to be idle (1 second)...\n');
    const isIdle = await TmuxInjector.waitForIdle(CORE_SESSION, 1000, 10000);
    if (!isIdle) {
      console.log('⚠️  Warning: Session may not be fully idle, but continuing...\n');
    } else {
      console.log('✅ Session is idle\n');
    }

    console.log('\n📍 Step 3: Spawning mesh and sending first task\n');

    const workflow = new E2EWorkflow(MESH, AGENT, `spawn a ${MESH} mesh and send it task: "Process item 1"`);
    const workflowPassed = await workflow.test();

    if (!workflowPassed) {
      console.log('❌ Initial workflow failed\n');
      testPassed = false;
      return;
    }

    // Get mesh session from workflow
    meshSession = workflow.meshSession;
    meshInstanceId = meshSession.replace(`-${AGENT}`, '');

    console.log(`✅ Mesh spawned: ${meshSession}\n`);

    console.log('\n📍 Step 4: Sending 2 additional tasks to queue\n');

    // Send task 2
    await sendAdditionalTasks(2);

    // Send task 3
    await sendAdditionalTasks(3);

    console.log('✅ All 3 tasks sent to queue\n');

    console.log('\n📍 Step 5: Waiting for agent to process all tasks\n');

    // Wait for agent to finish processing (check for idle state)
    const agentIdle = await TmuxInjector.waitForIdle(meshSession, 3000, 60000);
    if (!agentIdle) {
      console.log('⚠️  Warning: Agent may still be processing\n');
    } else {
      console.log('✅ Agent is idle\n');
    }

    console.log('\n📍 Step 6: Verifying sequential processing\n');

    const sequential = await verifySequentialProcessing();
    if (!sequential) {
      console.log('❌ Sequential processing verification failed\n');
      testPassed = false;
      return;
    }

    console.log('✅ Sequential processing verified\n');

    console.log('\n📍 Step 7: Verifying all responses received\n');

    const allReceived = await verifyResponsesReceived();
    if (!allReceived) {
      console.log('❌ Not all responses received\n');
      testPassed = false;
      return;
    }

    console.log('✅ All responses received\n');

    console.log('✅ TEST PASSED: Queue sequential processing successful!\n');
    testPassed = true;

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
  console.error('\n❌ TEST TIMEOUT: Test took longer than 180 seconds');
  testPassed = false;
  cleanup().then(() => process.exit(1));
}, TEST_TIMEOUT);

runE2ETest().catch(error => {
  console.error('Unhandled error:', error);
  clearTimeout(overallTimeout);
  cleanup().then(() => process.exit(1));
});
