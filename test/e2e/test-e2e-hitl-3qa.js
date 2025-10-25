const { execSync, spawn } = require('child_process');
const { TmuxInjector } = require('../../lib/tmux-injector');
const { E2EWorkflow } = require('../../lib/e2e-workflow');

/**
 * E2E Test: hitl-3qa mesh
 *
 * Tests the HITL (Human-In-The-Loop) workflow with 3 Q&A sessions:
 * - interviewer asks core 3 questions
 * - core (simulated human) responds to each
 * - interviewer compiles summary and reports completion
 */

console.log('=== E2E Test: hitl-3qa mesh (HITL 3 Q&A workflow) ===\n');

const TEST_TIMEOUT = 180000; // 3 minutes for 3 Q&A rounds
const CORE_SESSION = 'core';
const MESH = 'hitl-3qa';
const AGENT = 'interviewer';

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

async function runE2ETest() {
  const testStartTime = Date.now();

  try {
    // Ensure tmux server is running
    console.log('🔧 Ensuring tmux server is running...\n');
    try {
      execSync('tmux start-server', { stdio: 'pipe' });
      console.log('✅ Tmux server started\n');
    } catch (e) {
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
      console.log('⚠️  Warning: Session may not be fully idle, but continuing...\n');
    } else {
      console.log('✅ Session is idle\n');
    }

    console.log('\n📍 Step 3: Testing HITL 3 Q&A workflow with auto-response\n');

    // Define HITL responses for the 3 questions about AI safety
    const workflow = new E2EWorkflow(
      MESH,
      AGENT,
      `spawn hitl-3qa mesh to conduct an interview about AI safety`,
      {
        workflowTimeout: 120000,
        hitl: {
          enabled: true,
          autoRespond: true,
          maxQuestions: 3,
          responses: {
            'default': 'My primary concern about AI safety is ensuring alignment between AI systems and human values, particularly as systems become more capable.',
            'pattern:/concern|worry|primary/i': 'My primary concern about AI safety is ensuring alignment between AI systems and human values, particularly as systems become more capable.',
            'pattern:/solution|promising|approach/i': 'The most promising solutions include scalable oversight techniques, interpretability research, and robust testing frameworks that can verify alignment before deployment.',
            'pattern:/priority|next|future/i': 'For the next 5 years, the top priority should be developing international coordination mechanisms and establishing clear safety standards that can keep pace with rapid AI advancement.'
          }
        }
      }
    );

    const workflowPassed = await workflow.test();

    if (workflowPassed) {
      console.log('✅ TEST PASSED: HITL 3 Q&A workflow successful!\n');
      testPassed = true;
    } else {
      console.log('❌ TEST FAILED: HITL workflow incomplete\n');
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
