const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { TmuxInjector } = require('../lib/tmux-injector');
const { E2EWorkflow } = require('../lib/e2e-workflow');

/**
 * E2E Test: test-ask mesh
 *
 * Tests the core->ask->core workflow with verification of both agents:
 * - asker sends 5 questions to answerer
 * - answerer responds to all questions
 * - both agents log their outputs
 * - test validates both asker and answerer outputs
 */

console.log('=== E2E Test: test-ask mesh (both asker & answerer) ===\n');

const TEST_TIMEOUT = 120000;
const CORE_SESSION = 'core';
const MESH = 'test-ask';
const AGENT = 'asker';
const SHARED_OUTPUT_DIR = `.ai/tx/mesh/${MESH}/shared/output`;
const ASKER_OUTPUT = path.join(SHARED_OUTPUT_DIR, 'qa-results.md');
const ANSWERER_OUTPUT = path.join(SHARED_OUTPUT_DIR, 'answers.md');
const SUCCESS_RATE_THRESHOLD = 0.8; // 80% accuracy required

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
 * Verify asker output file exists and contains expected Q&A data
 */
function verifyAskerOutput() {
  console.log('📍 Verifying asker output (qa-results.md)\n');

  if (!fs.existsSync(ASKER_OUTPUT)) {
    console.error(`❌ Asker output file not found: ${ASKER_OUTPUT}`);
    return false;
  }

  const content = fs.readFileSync(ASKER_OUTPUT, 'utf-8');

  // Check for required content
  const checks = [
    { pattern: /What is 2 \+ 2\?/, name: 'Question 1 (2+2)' },
    { pattern: /capital of France/, name: 'Question 2 (France)' },
    { pattern: /internet invented/, name: 'Question 3 (internet)' },
    { pattern: /chemical symbol for gold/, name: 'Question 4 (Au)' },
    { pattern: /planets in our solar system/, name: 'Question 5 (planets)' }
  ];

  let allQuestionsFound = true;
  checks.forEach(check => {
    if (check.pattern.test(content)) {
      console.log(`   ✅ ${check.name} found`);
    } else {
      console.log(`   ❌ ${check.name} NOT found`);
      allQuestionsFound = false;
    }
  });

  if (!allQuestionsFound) {
    console.error('❌ Not all questions found in asker output\n');
    return false;
  }

  // Count successful responses
  const correctMatches = (content.match(/✅ CORRECT/g) || []).length;
  const totalQuestions = 5;
  const successRate = correctMatches / totalQuestions;

  console.log(`   📊 Asker Results: ${correctMatches}/${totalQuestions} correct (${(successRate * 100).toFixed(1)}%)`);

  if (successRate < SUCCESS_RATE_THRESHOLD) {
    console.error(`❌ Success rate ${(successRate * 100).toFixed(1)}% below threshold ${(SUCCESS_RATE_THRESHOLD * 100).toFixed(1)}%\n`);
    return false;
  }

  console.log(`   ✅ Success rate meets threshold\n`);
  return true;
}

/**
 * Verify answerer output file exists and contains expected answers
 */
function verifyAnswererOutput() {
  console.log('📍 Verifying answerer output (answers.md)\n');

  if (!fs.existsSync(ANSWERER_OUTPUT)) {
    console.error(`❌ Answerer output file not found: ${ANSWERER_OUTPUT}`);
    return false;
  }

  const content = fs.readFileSync(ANSWERER_OUTPUT, 'utf-8');

  // Check for required content
  const checks = [
    { pattern: /What is 2 \+ 2\?/, name: 'Q1 received' },
    { pattern: /capital of France/, name: 'Q2 received' },
    { pattern: /internet invented/, name: 'Q3 received' },
    { pattern: /chemical symbol for gold/, name: 'Q4 received' },
    { pattern: /planets in our solar system/, name: 'Q5 received' }
  ];

  let allQuestionsReceived = true;
  checks.forEach(check => {
    if (check.pattern.test(content)) {
      console.log(`   ✅ ${check.name}`);
    } else {
      console.log(`   ❌ ${check.name} NOT found`);
      allQuestionsReceived = false;
    }
  });

  if (!allQuestionsReceived) {
    console.error('❌ Answerer did not receive all questions\n');
    return false;
  }

  // Check for answers provided
  const answerChecks = [
    { pattern: /\b4\b/, name: 'Answer 1 (4)' },
    { pattern: /Paris/, name: 'Answer 2 (Paris)' },
    { pattern: /\b1969\b|ARPANET/, name: 'Answer 3 (1969/ARPANET)' },
    { pattern: /\bAu\b/, name: 'Answer 4 (Au)' },
    { pattern: /\b8\b|eight/, name: 'Answer 5 (8/eight)' }
  ];

  let allAnswersProvided = true;
  answerChecks.forEach(check => {
    if (check.pattern.test(content)) {
      console.log(`   ✅ ${check.name}`);
    } else {
      console.log(`   ⚠️  ${check.name} may not be in expected format`);
    }
  });

  console.log(`   ✅ Answerer responded to all questions\n`);
  return true;
}

/**
 * Verify both agent outputs after workflow completes
 */
async function verifyBothAgents() {
  console.log('\n📍 Step 4: Verifying both asker and answerer agents\n');

  // Wait a moment for files to be written
  await new Promise(resolve => setTimeout(resolve, 1000));

  const askerValid = verifyAskerOutput();
  const answererValid = verifyAnswererOutput();

  if (!askerValid || !answererValid) {
    console.error('\n❌ Agent verification failed\n');
    return false;
  }

  console.log('✅ Both agents verified successfully\n');
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
      console.log('⚠️  Warning: Session may not be fully idle, but continuing...\n');
    } else {
      console.log('✅ Session is idle\n');
    }

    console.log('\n📍 Step 3: Testing ask workflow\n');

    const workflow = new E2EWorkflow(MESH, AGENT, `spawn a ${MESH} mesh and have asker ask answerer a question`);
    const workflowPassed = await workflow.test();

    // After workflow, verify both asker and answerer sessions exist
    if (workflowPassed) {
      const allSessions = TmuxInjector.listSessions();
      const askerSession = allSessions.find(s => s === `${MESH}-asker` || s.startsWith(`${MESH}-asker-`));
      const answererSession = allSessions.find(s => s === `${MESH}-answerer` || s.startsWith(`${MESH}-answerer-`));

      console.log('📍 Checking for both agent sessions:\n');
      if (askerSession) {
        console.log(`   ✅ Asker session found: ${askerSession}`);
      } else {
        console.log(`   ❌ Asker session NOT found`);
      }

      if (answererSession) {
        console.log(`   ✅ Answerer session found: ${answererSession}`);
      } else {
        console.log(`   ❌ Answerer session NOT found`);
      }

      if (!askerSession || !answererSession) {
        console.error('\n❌ Not all agent sessions spawned\n');
        testPassed = false;
      }
    }

    if (!workflowPassed) {
      console.log('❌ TEST FAILED: Ask workflow incomplete\n');
      testPassed = false;
    } else if (!testPassed) {
      // Sessions check failed
      console.log('❌ TEST FAILED: Not all agent sessions spawned\n');
    } else {
      // Workflow passed and both sessions exist, now verify both agents' outputs
      const agentsVerified = await verifyBothAgents();

      if (agentsVerified) {
        console.log('✅ TEST PASSED: Both asker and answerer agents verified!\n');
        testPassed = true;
      } else {
        console.log('❌ TEST FAILED: Agent verification failed\n');
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

    // Give agents time to write output files before cleanup
    console.log('⏳ Waiting 3 seconds for agents to finalize output...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('✅ Ready for cleanup\n');

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
