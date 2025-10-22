const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { TmuxInjector } = require('../lib/tmux-injector');
const { E2EWorkflow } = require('../lib/e2e-workflow');

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
const INTERVIEWER_SESSION = `${MESH}-${AGENT}`;

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
 * Simulate human responses to interviewer's questions
 */
async function simulateHumanResponses() {
  console.log('\n📍 Step 4: Simulating human responses to 3 questions\n');

  const agentMsgsDir = `.ai/tx/mesh/${MESH}/agents/${AGENT}/msgs`;
  const coreMsgsDir = `.ai/tx/mesh/core/agents/core/msgs`;

  // Wait for interviewer to ask questions and respond to each
  for (let i = 1; i <= 3; i++) {
    console.log(`\n⏳ Waiting for question ${i}...\n`);

    // Wait for ask message to appear - it's created in the agent's msgs folder
    let askFile = null;
    const maxWait = 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait && !askFile) {
      try {
        const files = fs.readdirSync(agentMsgsDir).filter(f => f.endsWith('.md'));
        // Look for a file containing the msg-id or question number
        askFile = files.find(f => {
          const content = fs.readFileSync(path.join(agentMsgsDir, f), 'utf-8');
          return content.includes(`msg-id: hitl-qa-${i}`) || content.includes(`hitl-qa-${i}`) || f.includes(`qa-${i}`);
        });
      } catch (e) {
        // Directory might not exist yet
      }

      if (!askFile) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!askFile) {
      console.error(`❌ Question ${i} not received within timeout`);
      console.log(`   Looking for files containing: hitl-qa-${i}`);
      console.log(`   Files in directory:`);
      try {
        const files = fs.readdirSync(agentMsgsDir);
        files.forEach(f => console.log(`     - ${f}`));
      } catch (e) {
        console.log(`     (Could not list directory: ${e.message})`);
      }
      return false;
    }

    console.log(`✅ Question ${i} received: ${askFile}\n`);

    // Read the question
    const askContent = fs.readFileSync(path.join(agentMsgsDir, askFile), 'utf-8');
    console.log('📋 Question content:\n');
    console.log(askContent.split('\n').slice(0, 15).join('\n'));
    console.log('\n');

    // Extract msg-id from the ask
    const msgIdMatch = askContent.match(/msg-id:\s*(.+)/);
    const msgId = msgIdMatch ? msgIdMatch[1].trim() : `hitl-qa-${i}`;

    // Create response based on question number
    const responses = [
      'My primary concern about AI safety is ensuring alignment between AI systems and human values, particularly as systems become more capable.',
      'The most promising solutions include scalable oversight techniques, interpretability research, and robust testing frameworks that can verify alignment before deployment.',
      'For the next 5 years, the top priority should be developing international coordination mechanisms and establishing clear safety standards that can keep pace with rapid AI advancement.'
    ];

    // Create ask-response message file in interviewer's msgs folder
    console.log(`📍 Creating ask-response ${i} in interviewer msgs folder...\n`);

    const responseFileName = `response-qa-${i}.md`;
    const responseFilePath = path.join(agentMsgsDir, responseFileName);
    const responseContent = `---
to: ${MESH}/${AGENT}
from: core/core
type: ask-response
msg-id: ${msgId}
status: complete
timestamp: ${new Date().toISOString()}
headline: Response to question ${i}
---

# Response

${responses[i - 1]}
`;

    fs.writeFileSync(responseFilePath, responseContent);
    console.log(`✅ Sent response ${i}: ${responseFileName}\n`);

    // Notify interviewer to check for the response
    console.log(`📍 Notifying interviewer of new response...\n`);
    TmuxInjector.injectText(INTERVIEWER_SESSION, `You have a new ask-response message (${responseFileName}) in your msgs folder. Please read and process it.`);
    await new Promise(resolve => setTimeout(resolve, 500));
    TmuxInjector.send(INTERVIEWER_SESSION, 'Enter');

    // Wait for agent to process the response and ask next question (if applicable)
    if (i < 3) {
      console.log(`⏳ Waiting for interviewer to process response and ask question ${i + 1} (15 seconds)...\n`);
      await new Promise(resolve => setTimeout(resolve, 15000));
    } else {
      console.log(`⏳ Waiting for interviewer to compile summary (15 seconds)...\n`);
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }

  console.log('✅ All 3 responses sent\n');
  return true;
}

/**
 * Verify the interview summary was created
 */
async function verifySummary() {
  console.log('\n📍 Step 5: Verifying interview summary\n');

  const summaryPath = `.ai/tx/mesh/${MESH}/workspace/interview-summary.md`;

  // Wait for summary file
  const maxWait = 30000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    if (fs.existsSync(summaryPath)) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (!fs.existsSync(summaryPath)) {
    console.error(`❌ Summary file not found: ${summaryPath}`);
    return false;
  }

  const summary = fs.readFileSync(summaryPath, 'utf-8');

  console.log('📋 Interview summary:\n');
  console.log(summary);
  console.log('\n');

  // Verify summary contains key elements
  const checks = [
    { pattern: /question\s+1/i, name: 'Question 1 reference' },
    { pattern: /question\s+2/i, name: 'Question 2 reference' },
    { pattern: /question\s+3/i, name: 'Question 3 reference' },
    { pattern: /alignment|safety/i, name: 'AI safety topic' }
  ];

  let allChecksPass = true;
  checks.forEach(check => {
    if (check.pattern.test(summary)) {
      console.log(`   ✅ ${check.name} found`);
    } else {
      console.log(`   ❌ ${check.name} NOT found`);
      allChecksPass = false;
    }
  });

  if (!allChecksPass) {
    console.error('\n❌ Summary verification failed\n');
    return false;
  }

  console.log('\n✅ Summary verified successfully\n');
  return true;
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

    console.log('\n📍 Step 3: Spawning hitl-3qa mesh\n');

    const workflow = new E2EWorkflow(MESH, AGENT, `spawn hitl-3qa mesh and send it the task from .ai/tx/mesh/core/agents/core/msgs/task-hitl-3qa-test.md`);
    const workflowPassed = await workflow.test();

    if (!workflowPassed) {
      console.log('❌ TEST FAILED: Workflow did not complete\n');
      testPassed = false;
      return;
    }

    // Wait for interviewer session to spawn
    const interviewerReady = await waitForSession(INTERVIEWER_SESSION, 45000);
    if (!interviewerReady) {
      throw new Error('Interviewer session not created');
    }

    const interviewerClaudeReady = await waitForClaudeReady(INTERVIEWER_SESSION, 60000);
    if (!interviewerClaudeReady) {
      throw new Error('Claude not ready in interviewer session');
    }

    // Wait for interviewer to be idle (loaded and ready)
    console.log('⏳ Waiting for interviewer to be idle and ready...\n');
    const interviewerIdle = await TmuxInjector.waitForIdle(INTERVIEWER_SESSION, 2000, 30000);
    if (!interviewerIdle) {
      console.log('⚠️  Warning: Interviewer may not be fully idle, but continuing...\n');
    } else {
      console.log('✅ Interviewer is idle and ready\n');
    }

    // Manually deliver task message to interviewer
    console.log('📍 Manually delivering task message to interviewer...\n');
    const taskMsgPath = `.ai/tx/mesh/${MESH}/agents/${AGENT}/msgs`;
    const taskSourcePath = `.ai/tx/mesh/core/agents/core/msgs/task-hitl-3qa-test.md`;
    const taskDestPath = path.join(taskMsgPath, 'task-hitl-3qa-test.md');

    try {
      const taskContent = fs.readFileSync(taskSourcePath, 'utf-8');
      fs.writeFileSync(taskDestPath, taskContent);
      console.log(`✅ Task message delivered: ${taskDestPath}\n`);
    } catch (e) {
      console.log(`❌ Failed to deliver task message: ${e.message}\n`);
    }

    // Instruct the interviewer to read and process the task
    console.log('📍 Instructing interviewer to process task...\n');
    TmuxInjector.injectText(INTERVIEWER_SESSION, 'Read and process the task message in your msgs folder');
    await new Promise(resolve => setTimeout(resolve, 500));
    TmuxInjector.send(INTERVIEWER_SESSION, 'Enter');

    // Give interviewer time to read and start processing the task
    console.log('⏳ Waiting for interviewer to process task and ask first question (15 seconds)...\n');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Check what the interviewer session shows
    console.log('📍 Checking interviewer session output...\n');
    try {
      const interviewerOutput = execSync(`tmux capture-pane -t ${INTERVIEWER_SESSION} -p -S -50`, {
        stdio: 'pipe',
        encoding: 'utf-8'
      });
      console.log('Last 20 lines of interviewer session:\n');
      console.log(interviewerOutput.split('\n').slice(-20).join('\n'));
      console.log('\n');
    } catch (e) {
      console.log(`Could not capture interviewer output: ${e.message}\n`);
    }

    // Simulate human responses to 3 questions
    const responsesSuccessful = await simulateHumanResponses();
    if (!responsesSuccessful) {
      console.log('❌ TEST FAILED: Failed to simulate human responses\n');
      testPassed = false;
      return;
    }

    // Verify summary was created
    const summaryValid = await verifySummary();
    if (!summaryValid) {
      console.log('❌ TEST FAILED: Summary verification failed\n');
      testPassed = false;
      return;
    }

    // Check for task-complete message to core
    console.log('\n📍 Step 6: Verifying task-complete sent to core\n');
    const agentMsgsDir = `.ai/tx/mesh/${MESH}/agents/${AGENT}/msgs`;
    const files = fs.readdirSync(agentMsgsDir).filter(f => f.endsWith('.md'));
    const completeFile = files.find(f => {
      const content = fs.readFileSync(path.join(agentMsgsDir, f), 'utf-8');
      return content.includes('type: task-complete');
    });

    if (completeFile) {
      console.log(`✅ Task-complete message found: ${completeFile}\n`);
      testPassed = true;
      console.log('✅ TEST PASSED: HITL 3 Q&A workflow complete!\n');
    } else {
      console.log('❌ Task-complete message not found\n');
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
  console.error('\n❌ TEST TIMEOUT: Test took longer than 120 seconds');
  testPassed = false;
  cleanup().then(() => process.exit(1));
}, TEST_TIMEOUT);

runE2ETest().catch(error => {
  console.error('Unhandled error:', error);
  clearTimeout(overallTimeout);
  cleanup().then(() => process.exit(1));
});
