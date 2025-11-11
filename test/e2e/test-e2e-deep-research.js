const { execSync, spawn } = require('child_process');
const { TmuxInjector } = require('../../lib/tmux-injector');
const { E2EWorkflow } = require('../../lib/e2e-workflow');

/**
 * E2E Test: deep-research mesh
 *
 * Tests the comprehensive multi-agent research workflow with HITL requirements gathering:
 * - interviewer gathers requirements via Q&A (HITL)
 * - sourcer gathers sources (haiku)
 * - analyst proposes hypotheses (sonnet)
 * - researcher synthesizes theories (opus)
 * - disprover critiques (sonnet)
 * - loop continues until 95% confidence
 * - final report saved to workspace
 */

console.log('=== E2E Test: deep-research mesh (HITL + multi-agent research) ===\n');

const TEST_TIMEOUT = 360000; // 6 minutes - HITL + complex workflow
const CORE_SESSION = 'core';
const MESH = 'deep-research';
const ENTRY_AGENT = 'interviewer';

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
      console.log('⚠️  Warning: Core may not be fully idle, but continuing...\n');
    } else {
      console.log('✅ Core is idle\n');
    }

    console.log('\n📍 Step 3: Testing deep research workflow with HITL\n');

    // Define HITL responses for research requirements gathering
    const workflow = new E2EWorkflow(
      MESH,
      ENTRY_AGENT,
      'spawn deep-research mesh to research AI alignment techniques',
      {
        workflowTimeout: 180000, // 3 minutes for complex research workflow
        hitl: {
          enabled: true,
          autoRespond: true,
          maxQuestions: 10,
          questionTimeout: 60000, // 60s per question
          responses: {
            'default': `That's a great question. I'm looking for a comprehensive, evidence-based analysis that can guide practical implementation decisions. The research should be thorough but focused on actionable insights.`,
            'pattern:/research question|research topic|main.*topic/i': `I want to research the effectiveness of Constitutional AI and RLHF approaches in AI alignment. Specifically, how do these techniques compare in creating safer, more aligned AI systems?`,
            'pattern:/scope|boundaries|aspects|important/i': `Focus on: (1) technical mechanisms of both approaches, (2) empirical results from real deployments, (3) failure modes and limitations. Out of scope: general AI safety theory, non-technical governance aspects.`,
            'pattern:/depth|deep|level.*detail|overview.*analysis/i': `I need an analytical deep-dive. This is for a technical audience that needs to understand the trade-offs between these approaches to make implementation decisions.`,
            'pattern:/specific questions|questions.*answer|key questions/i': `Key questions: (1) What are the core technical differences? (2) Which approach scales better? (3) What are the failure modes of each? (4) Can they be combined effectively? (5) What does empirical evidence show about their effectiveness? (6) What are the computational costs?`,
            'pattern:/audience|use.*for|purpose/i': `This is for ML engineers and researchers evaluating which alignment approach to use in their systems. They need actionable insights backed by evidence.`,
            'pattern:/constraints|avoid|limitations|timeline/i': `No major constraints. Prioritize peer-reviewed sources and documented real-world results over speculation. No rush, but aim for thoroughness.`
          }
        }
      }
    );

    const workflowPassed = await workflow.test();

    if (workflowPassed) {
      console.log('✅ TEST PASSED: Deep research workflow with HITL successful!\n');
      testPassed = true;
    } else {
      console.log('❌ TEST FAILED: Deep research workflow incomplete\n');
      testPassed = false;
    }

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    testPassed = false;
  } finally {
    clearTimeout(overallTimeout);
    const testDuration = Date.now() - testStartTime;
    console.log(`📊 Test duration: ${testDuration}ms\n`);

    await cleanup();

    const exitCode = testPassed ? 0 : 1;
    console.log(`${testPassed ? '✅' : '❌'} E2E Test ${testPassed ? 'PASSED' : 'FAILED'}\n`);
    process.exit(exitCode);
  }
}

const overallTimeout = setTimeout(() => {
  console.error(`\n❌ TEST TIMEOUT: Test took longer than ${TEST_TIMEOUT / 1000} seconds`);
  testPassed = false;
  cleanup().then(() => process.exit(1));
}, TEST_TIMEOUT);

runE2ETest().catch(error => {
  console.error('Unhandled error:', error);
  clearTimeout(overallTimeout);
  cleanup().then(() => process.exit(1));
});
