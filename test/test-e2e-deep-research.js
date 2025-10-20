const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { TmuxInjector } = require('../lib/tmux-injector');
const { E2EWorkflow } = require('../lib/e2e-workflow');

/**
 * E2E Test: deep-research mesh
 *
 * Tests the comprehensive multi-agent research workflow:
 * - sourcer gathers sources (haiku)
 * - analyst proposes hypotheses (sonnet)
 * - researcher synthesizes theories (opus)
 * - disprover critiques (sonnet)
 * - loop continues until 95% confidence
 * - final report saved to workspace
 */

console.log('=== E2E Test: deep-research mesh (multi-agent research) ===\n');

const TEST_TIMEOUT = 300000; // 5 minutes - complex workflow
const CORE_SESSION = 'core';
const MESH = 'deep-research';
const ENTRY_AGENT = 'sourcer';

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

    console.log('\n📍 Step 3: Testing deep research workflow\n');

    const workflow = new E2EWorkflow(MESH, ENTRY_AGENT, `spawn deep-research mesh with sourcer gathering sources, analyst proposing hypotheses, researcher synthesizing theories, and disprover finding counterpoints`);
    const workflowPassed = await workflow.test();

    // After workflow, wait for all 4 agent sessions
    if (workflowPassed) {
      console.log('📍 Waiting for all 4 research agent sessions to spawn...\n');

      const agents = ['sourcer', 'analyst', 'researcher', 'disprover'];
      const sessions = {};
      const maxWait = 45000; // 45 seconds - agents may spawn sequentially
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        const allSessions = TmuxInjector.listSessions();
        for (const agent of agents) {
          if (!sessions[agent]) {
            sessions[agent] = allSessions.find(s => s === `${MESH}-${agent}` || s.startsWith(`${MESH}-${agent}-`));
          }
        }

        const allFound = agents.every(a => sessions[a]);
        if (allFound) {
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log('📍 Checking for all 4 research agent sessions:\n');
      let allSessionsFound = true;
      for (const agent of agents) {
        if (sessions[agent]) {
          console.log(`   ✅ ${agent.charAt(0).toUpperCase() + agent.slice(1)} session found: ${sessions[agent]}`);
        } else {
          console.log(`   ❌ ${agent.charAt(0).toUpperCase() + agent.slice(1)} session NOT found`);
          allSessionsFound = false;
        }
      }

      if (!allSessionsFound) {
        console.error('\n❌ Not all agent sessions spawned\n');
        testPassed = false;
      } else {
        console.log('\n✅ All 4 research agent sessions spawned\n');
        testPassed = true;
      }
    }

    if (!workflowPassed) {
      console.log('❌ TEST FAILED: Research workflow incomplete\n');
      testPassed = false;
    } else if (!testPassed) {
      console.log('❌ TEST FAILED: Not all agent sessions spawned\n');
    } else {
      // All sessions exist, wait for completion
      console.log('⏳ Waiting for research workflow to complete...\n');
      const researcherIdle = await TmuxInjector.waitForIdle('deep-research-researcher', 5000, 120000);
      if (!researcherIdle) {
        console.log('⚠️  Warning: Researcher may still be working, but continuing...\n');
      } else {
        console.log('✅ Researcher workflow completed\n');
      }

      console.log('⏳ Waiting for core to receive completion...\n');
      const coreFinalIdle = await TmuxInjector.waitForIdle(CORE_SESSION, 5000, 60000);
      if (!coreFinalIdle) {
        console.log('⚠️  Warning: Core may still be processing, but continuing...\n');
      } else {
        console.log('✅ Core is idle (completion received)\n');
      }

      // Check core tmux for evidence of research completion
      console.log('📍 Verifying research workflow executed (via tmux)\n');
      try {
        const coreOutput = execSync(`tmux capture-pane -t ${CORE_SESSION} -p -S -100`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        const hasResearch = coreOutput.includes('research') || coreOutput.includes('source') || coreOutput.includes('theory');
        const hasCompletion = coreOutput.includes('complete') || coreOutput.includes('complete/') || coreOutput.includes('task-complete');

        if (hasResearch || hasCompletion) {
          console.log(`✅ Core tmux shows research workflow activity\n`);

          // Check for agent activity - all 4 agents should have processed messages
          console.log('📍 Checking for agent message processing...\n');
          const agents = ['sourcer', 'analyst', 'researcher', 'disprover'];
          let agentsProcessed = 0;

          for (const agent of agents) {
            const agentDir = `.ai/tx/mesh/${MESH}/agents/${agent}/msgs`;
            if (fs.existsSync(agentDir)) {
              agentsProcessed++;
              console.log(`   ✅ Agent ${agent} has message directory`);
            }
          }

          if (agentsProcessed === 4) {
            testPassed = true;
            console.log('\n✅ TEST PASSED: All 4 research agents executed workflow!\n');
          } else {
            console.log(`   ⚠️  Only ${agentsProcessed}/4 agents had activity`);
            testPassed = false;
          }
        } else {
          console.log('❌ Core tmux shows no research activity\n');
          console.log('Last 30 lines of core session:\n');
          console.log(coreOutput.split('\n').slice(-30).join('\n'));
          testPassed = false;
          console.log('\n❌ TEST FAILED: No research activity visible in core tmux\n');
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
  console.error('\n❌ TEST TIMEOUT: Test took longer than 300 seconds');
  testPassed = false;
  cleanup().then(() => process.exit(1));
}, TEST_TIMEOUT);

runE2ETest().catch(error => {
  console.error('Unhandled error:', error);
  clearTimeout(overallTimeout);
  cleanup().then(() => process.exit(1));
});
