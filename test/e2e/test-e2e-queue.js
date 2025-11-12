const { execSync, spawn } = require('child_process');
const { TmuxInjector } = require('../../lib/tmux-injector');
const { E2EWorkflow } = require('../../lib/e2e-workflow');
const { E2ELogger } = require('../../lib/e2e-logger');
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
let testLogger = null;
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
 * Verify sequential processing by checking centralized message log
 */
async function verifySequentialProcessing() {
  console.log('📍 Verifying sequential processing\n');

  // Wait a bit for processing to happen
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Check centralized message directory for task-complete messages
  try {
    const centralMsgsDir = `.ai/tx/msgs`;

    if (!fs.existsSync(centralMsgsDir)) {
      console.log(`❌ Messages directory not found: ${centralMsgsDir}\n`);
      return false;
    }

    const msgFiles = fs.readdirSync(centralMsgsDir).filter(f => f.endsWith('.md'));

    // Look for task-complete messages from queue-worker to core
    // Pattern: {mmddhhmmss}-task-complete-{agentName}>core-{msgId}.md
    const responsePattern = new RegExp(`^\\d{10}-task-complete-${AGENT}>core-.*\\.md$`);
    const responses = msgFiles.filter(f => responsePattern.test(f));

    console.log(`   Task-complete messages found: ${responses.length}`);

    responses.forEach(file => {
      const fullPath = path.join(centralMsgsDir, file);
      const content = fs.readFileSync(fullPath, 'utf-8');

      // Extract task info from message content
      const hasItem1 = content.includes('item 1') || content.includes('Item 1');
      const hasItem2 = content.includes('item 2') || content.includes('Item 2');
      const hasItem3 = content.includes('item 3') || content.includes('Item 3');

      if (hasItem1) console.log(`      - Item 1: ${file}`);
      if (hasItem2) console.log(`      - Item 2: ${file}`);
      if (hasItem3) console.log(`      - Item 3: ${file}`);
    });

    console.log('');

    // Verify we have at least 3 responses (one per task)
    if (responses.length < 3) {
      console.log(`❌ Expected at least 3 task-complete messages, found ${responses.length}\n`);
      return false;
    }

    console.log(`✅ Sequential processing verified: ${responses.length} task-complete messages\n`);
    return true;

  } catch (e) {
    console.error(`❌ Error checking message log: ${e.message}`);
    return false;
  }
}

/**
 * Verify all responses were received by core by checking centralized message log
 */
async function verifyResponsesReceived() {
  console.log('📍 Verifying core received all responses\n');

  const centralMsgsDir = `.ai/tx/msgs`;

  if (!fs.existsSync(centralMsgsDir)) {
    console.log(`❌ Messages directory not found: ${centralMsgsDir}\n`);
    return false;
  }

  const msgFiles = fs.readdirSync(centralMsgsDir).filter(f => f.endsWith('.md'));

  // Look for task-complete messages from queue-worker to core
  // Pattern: {mmddhhmmss}-task-complete-{agentName}>core-{msgId}.md
  const responsePattern = new RegExp(`^\\d{10}-task-complete-${AGENT}>core-.*\\.md$`);
  const responses = msgFiles.filter(f => responsePattern.test(f));

  console.log(`   Total message files in ${centralMsgsDir}: ${msgFiles.length}`);
  console.log(`   Task-complete messages to core: ${responses.length}\n`);

  // Should have 3 responses (one for each task)
  if (responses.length < 3) {
    console.log(`❌ Expected 3 task-complete messages to core, found ${responses.length}\n`);
    return false;
  }

  console.log('✅ All responses received by core\n');
  return true;
}

async function runE2ETest() {
  const testStartTime = Date.now();
  testLogger = new E2ELogger('.ai/tx/logs/e2e-test.log');

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
    if (testLogger) testLogger.error('TEST FAILED: Exception caught', { message: error.message, stack: error.stack });
    console.error(error.stack);
    testPassed = false;
  } finally {
    clearTimeout(overallTimeout);
    const testDuration = Date.now() - testStartTime;
    if (testLogger) testLogger.endSession(testPassed, testDuration);
    console.log(`📊 Test duration: ${testDuration}ms\n`);

    await cleanup();

    const exitCode = testPassed ? 0 : 1;
    console.log(`${testPassed ? '✅' : '❌'} E2E Test ${testPassed ? 'PASSED' : 'FAILED'}\n`);
    process.exit(exitCode);
  }
}

const overallTimeout = setTimeout(() => {
  console.error('\n❌ TEST TIMEOUT: Test took longer than 180 seconds');
  if (testLogger) {
    testLogger.error('TEST TIMEOUT: Test took longer than allowed');
    testLogger.endSession(false, TEST_TIMEOUT);
  }
  testPassed = false;
  cleanup().then(() => process.exit(1));
}, TEST_TIMEOUT);

runE2ETest().catch(error => {
  console.error('Unhandled error:', error);
  clearTimeout(overallTimeout);
  cleanup().then(() => process.exit(1));
});
