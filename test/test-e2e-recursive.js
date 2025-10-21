const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { TmuxInjector } = require('../lib/tmux-injector');
const { E2EWorkflow } = require('../lib/e2e-workflow');

/**
 * Capture and display the last N lines from a tmux session
 */
function captureSessionOutput(sessionName, numLines = 20) {
  try {
    const output = execSync(`tmux capture-pane -t ${sessionName} -p -S -${numLines}`, {
      stdio: 'pipe',
      encoding: 'utf-8'
    });
    return output;
  } catch (e) {
    return `(Could not capture output from ${sessionName})`;
  }
}

/**
 * E2E Test: test-recursive mesh
 *
 * Tests the recursive self-improvement workflow where an agent sends messages to itself:
 * - self-improver sends 3 messages to itself
 * - each message contains a self-improvement suggestion
 * - test validates the agent spawns and sends messages to itself
 */

console.log('=== E2E Test: test-recursive mesh (self-messaging agent) ===\n');

const TEST_TIMEOUT = 180000; // 3 minutes to allow for cleanup
const CORE_SESSION = 'core';
const MESH = 'test-recursive';
const ENTRY_AGENT = 'self-improver';

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
    // Ensure tmux server is running before starting tests
    console.log('🔧 Ensuring tmux server is running...\n');
    try {
      execSync('tmux start-server', { stdio: 'pipe' });
      console.log('✅ Tmux server started\n');
    } catch (e) {
      // Server may already be running, that's okay
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

    console.log('\n📍 Step 3: Testing recursive self-improvement workflow\n');

    const workflow = new E2EWorkflow(MESH, ENTRY_AGENT, `spawn a ${MESH} mesh and have self-improver send 3 self-improvement messages to itself`);
    const workflowPassed = await workflow.test();

    // After workflow, wait for agent session
    if (workflowPassed) {
      console.log('📍 Waiting for self-improver agent session to spawn...\n');

      let improverSession = null;
      const maxWait = 30000; // 30 seconds
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait && !improverSession) {
        const allSessions = TmuxInjector.listSessions();
        improverSession = allSessions.find(s => s === `${MESH}-self-improver` || s.startsWith(`${MESH}-self-improver-`));

        if (!improverSession) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log('📍 Checking for self-improver agent session:\n');
      if (improverSession) {
        console.log(`   ✅ Self-improver session found: ${improverSession}`);
        testPassed = true;
      } else {
        console.log(`   ❌ Self-improver session NOT found`);
        testPassed = false;
      }

      if (!improverSession) {
        console.error('\n❌ Self-improver agent session did not spawn\n');
        testPassed = false;
      } else {
        console.log('\n✅ Self-improver agent session spawned\n');

        // Give the agents some time to process messages
        // Self-recursive messaging takes time as the agent sends multiple messages to itself
        console.log('⏳ Waiting for agents to process self-messages (90 seconds)...\n');
        await new Promise(resolve => setTimeout(resolve, 90000));

        // Check for evidence of self-messaging in simplified msgs/ directory
        console.log('📍 Verifying self-improver sent messages to itself\n');
        const msgsPath = path.join(process.cwd(), '.ai/tx/mesh/test-recursive/agents/self-improver/msgs');

        try {
          let selfMessageCount = 0;

          // Check msgs directory for self-messages (simplified queue with single folder)
          if (fs.existsSync(msgsPath)) {
            const msgFiles = fs.readdirSync(msgsPath).filter(f => f.endsWith('.md'));

            const selfMessages = msgFiles.filter(f => {
              const content = fs.readFileSync(path.join(msgsPath, f), 'utf-8');
              // Look for messages sent to self (from self-improver to self-improver)
              return content.includes('to: test-recursive/self-improver');
            });

            selfMessageCount = selfMessages.length;
            console.log(`   Found ${selfMessages.length} self-addressed messages in msgs/\n`);

            if (selfMessages.length > 0) {
              console.log(`   Self-message files: ${selfMessages.join(', ')}\n`);
            }
          } else {
            console.log(`   ⚠️  msgs/ directory does not exist: ${msgsPath}\n`);
          }

          // Also check for completion message to core
          const coreMsgsPath = path.join(process.cwd(), '.ai/tx/mesh/core/agents/core/msgs');
          let hasCompletion = false;
          if (fs.existsSync(coreMsgsPath)) {
            const coreFiles = fs.readdirSync(coreMsgsPath).filter(f => f.endsWith('.md'));
            const completionMsg = coreFiles.find(f => {
              const content = fs.readFileSync(path.join(coreMsgsPath, f), 'utf-8');
              return content.includes('from: test-recursive/self-improver') &&
                     content.includes('type: task-complete');
            });
            if (completionMsg) {
              hasCompletion = true;
              console.log('✅ Found completion message to core\n');
            }
          }

          console.log(`   Total self-messages found: ${selfMessageCount}\n`);

          // Test passes if we find at least 1 self-message (proves recursive messaging capability)
          // Completion message is nice to have but not required for this test
          if (selfMessageCount >= 1) {
            console.log('✅ Self-improver sent messages to itself (recursive messaging verified)\n');
            testPassed = true;
            if (hasCompletion) {
              console.log('✅ BONUS: Task also completed with completion message\n');
            }
            console.log('✅ TEST PASSED: Agent sent messages to itself recursively!\n');
          } else {
            console.log(`❌ Expected at least 1 self-message, found ${selfMessageCount}\n`);
            testPassed = false;
          }
        } catch (e) {
          console.log(`❌ Failed to check messages: ${e.message}\n`);
          testPassed = false;
        }

        // Also check tmux session for evidence
        console.log('📍 Verifying agent activity in tmux session\n');
        try {
          const improverOutput = execSync(`tmux capture-pane -t ${improverSession} -p -S -100`, {
            stdio: 'pipe',
            encoding: 'utf-8'
          });

          const hasOutbox = improverOutput.includes('outbox/');
          const hasSelfMessage = improverOutput.includes('self-improver') || improverOutput.includes('improvement');

          if (hasOutbox || hasSelfMessage) {
            console.log(`✅ Self-improver tmux shows message activity\n`);
          } else {
            console.log('⚠️  Warning: Limited message activity visible in tmux\n');
          }
        } catch (e) {
          console.log(`⚠️  Could not capture self-improver session: ${e.message}\n`);
        }
      }
    }

    if (!workflowPassed) {
      console.log('❌ TEST FAILED: Recursive workflow incomplete\n');
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
