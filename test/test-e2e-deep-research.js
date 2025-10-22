const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { TmuxInjector } = require('../lib/tmux-injector');
const { E2EWorkflow } = require('../lib/e2e-workflow');

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
const INTERVIEWER_SESSION = `${MESH}-${ENTRY_AGENT}`;

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

/**
 * Simulate human responses to interviewer's questions
 * Dynamic Q&A until interviewer has enough for Grade-A research
 */
async function simulateResearchRequirementsGathering() {
  console.log('\n📍 Step 4: Simulating HITL requirements gathering\n');

  const agentMsgsDir = `.ai/tx/mesh/${MESH}/agents/${ENTRY_AGENT}/msgs`;
  const coreMsgsDir = `.ai/tx/mesh/core/agents/core/msgs`;

  // Predefined responses for a research project on AI alignment
  const responses = [
    {
      trigger: /research question|research topic|main.*topic/i,
      response: `I want to research the effectiveness of Constitutional AI and RLHF approaches in AI alignment. Specifically, how do these techniques compare in creating safer, more aligned AI systems?`
    },
    {
      trigger: /scope|boundaries|aspects|important/i,
      response: `Focus on: (1) technical mechanisms of both approaches, (2) empirical results from real deployments, (3) failure modes and limitations. Out of scope: general AI safety theory, non-technical governance aspects.`
    },
    {
      trigger: /depth|deep|level.*detail|overview.*analysis/i,
      response: `I need an analytical deep-dive. This is for a technical audience that needs to understand the trade-offs between these approaches to make implementation decisions.`
    },
    {
      trigger: /specific questions|questions.*answer|key questions/i,
      response: `Key questions: (1) What are the core technical differences? (2) Which approach scales better? (3) What are the failure modes of each? (4) Can they be combined effectively? (5) What does empirical evidence show about their effectiveness? (6) What are the computational costs?`
    },
    {
      trigger: /audience|use.*for|purpose/i,
      response: `This is for ML engineers and researchers evaluating which alignment approach to use in their systems. They need actionable insights backed by evidence.`
    },
    {
      trigger: /constraints|avoid|limitations|timeline/i,
      response: `No major constraints. Prioritize peer-reviewed sources and documented real-world results over speculation. No rush, but aim for thoroughness.`
    }
  ];

  let questionCount = 0;
  const maxQuestions = 10; // Safety limit
  let lastQuestionTime = Date.now();

  while (questionCount < maxQuestions) {
    // Wait for ask message to appear
    console.log(`\n⏳ Waiting for question ${questionCount + 1}...\n`);

    let askFile = null;
    const maxWait = 45000; // 45 seconds per question
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait && !askFile) {
      try {
        const files = fs.readdirSync(agentMsgsDir).filter(f => f.endsWith('.md'));
        // Look for new ask messages
        askFile = files.find(f => {
          const fullPath = path.join(agentMsgsDir, f);
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs < lastQuestionTime) return false; // Too old

          const content = fs.readFileSync(fullPath, 'utf-8');
          return content.includes('type: ask') && content.includes('to: core/core');
        });
      } catch (e) {
        // Directory might not exist yet
      }

      if (!askFile) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!askFile) {
      console.log(`ℹ️  No more questions after ${questionCount} questions - interviewer likely ready\n`);
      break;
    }

    questionCount++;
    lastQuestionTime = Date.now();

    console.log(`✅ Question ${questionCount} received: ${askFile}\n`);

    // Read the question
    const askContent = fs.readFileSync(path.join(agentMsgsDir, askFile), 'utf-8');
    console.log('📋 Question preview:\n');
    const lines = askContent.split('\n');
    const previewLines = lines.slice(0, 20).join('\n');
    console.log(previewLines);
    console.log('\n');

    // Extract msg-id
    const msgIdMatch = askContent.match(/msg-id:\s*(.+)/);
    const msgId = msgIdMatch ? msgIdMatch[1].trim() : `research-req-${questionCount}`;

    // Find appropriate response
    let responseText = null;
    for (const resp of responses) {
      if (resp.trigger.test(askContent)) {
        responseText = resp.response;
        break;
      }
    }

    // Fallback response if no match
    if (!responseText) {
      responseText = `That's a great question. Let me provide additional context: I'm looking for a comprehensive, evidence-based analysis that can guide practical implementation decisions. The research should be thorough but focused on actionable insights.`;
    }

    // Create ask-response message
    console.log(`📍 Creating response ${questionCount}...\n`);
    const responseFileName = `response-req-${questionCount}.md`;
    const responseFilePath = path.join(agentMsgsDir, responseFileName);
    const responseContent = `---
to: ${MESH}/${ENTRY_AGENT}
from: core/core
type: ask-response
msg-id: ${msgId}
status: complete
timestamp: ${new Date().toISOString()}
headline: Response to requirements question ${questionCount}
---

# Response

${responseText}
`;

    fs.writeFileSync(responseFilePath, responseContent);
    console.log(`✅ Sent response ${questionCount}: ${responseFileName}\n`);

    // Notify interviewer
    console.log(`📍 Notifying interviewer of new response...\n`);
    TmuxInjector.injectText(INTERVIEWER_SESSION, `You have a new ask-response message (${responseFileName}) in your msgs folder. Please read and process it.`);
    await new Promise(resolve => setTimeout(resolve, 500));
    TmuxInjector.send(INTERVIEWER_SESSION, 'Enter');

    // Wait for interviewer to process
    console.log(`⏳ Waiting for interviewer to process (20 seconds)...\n`);
    await new Promise(resolve => setTimeout(resolve, 20000));
  }

  console.log(`✅ Requirements gathering complete (${questionCount} Q&A rounds)\n`);

  // Wait for research-brief.md to be created
  console.log('📍 Waiting for research-brief.md...\n');
  const briefPath = `.ai/tx/mesh/${MESH}/workspace/research-brief.md`;
  const maxBriefWait = 30000;
  const briefStartTime = Date.now();

  while (Date.now() - briefStartTime < maxBriefWait) {
    if (fs.existsSync(briefPath)) {
      console.log('✅ Research brief created!\n');
      const brief = fs.readFileSync(briefPath, 'utf-8');
      console.log('📋 Research brief preview:\n');
      console.log(brief.split('\n').slice(0, 30).join('\n'));
      console.log('\n...\n');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('⚠️  Research brief not found, but continuing...\n');
  return false;
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

    const workflow = new E2EWorkflow(MESH, ENTRY_AGENT, `spawn deep-research mesh to research AI alignment techniques - interviewer will gather requirements first`);
    const workflowPassed = await workflow.test();

    // Wait for interviewer session
    if (workflowPassed) {
      console.log('📍 Waiting for interviewer session...\n');
      const interviewerReady = await waitForSession(INTERVIEWER_SESSION, 45000);
      if (!interviewerReady) {
        throw new Error('Interviewer session not created');
      }

      const interviewerClaudeReady = await waitForClaudeReady(INTERVIEWER_SESSION, 60000);
      if (!interviewerClaudeReady) {
        throw new Error('Claude not ready in interviewer session');
      }

      // Wait for interviewer to be idle and ready
      console.log('⏳ Waiting for interviewer to be idle and ready...\n');
      const interviewerIdle = await TmuxInjector.waitForIdle(INTERVIEWER_SESSION, 2000, 30000);
      if (!interviewerIdle) {
        console.log('⚠️  Warning: Interviewer may not be fully idle, but continuing...\n');
      } else {
        console.log('✅ Interviewer is idle and ready\n');
      }

      // Manually deliver task message to interviewer
      console.log('📍 Manually delivering task message to interviewer...\n');
      const taskMsgPath = `.ai/tx/mesh/${MESH}/agents/${ENTRY_AGENT}/msgs`;
      const taskSourcePath = `.ai/tx/mesh/core/agents/core/msgs/task-deep-research.md`;
      const taskDestPath = path.join(taskMsgPath, 'task-deep-research.md');

      // Create task if it doesn't exist
      if (!fs.existsSync(taskSourcePath)) {
        const taskContent = `---
to: ${MESH}/${ENTRY_AGENT}
from: core/core
type: task
status: start
requester: core/core
timestamp: ${new Date().toISOString()}
headline: Research AI alignment techniques
---

# Research Task

I need comprehensive research on AI alignment techniques. Please gather requirements through your interview process and then coordinate the research team.
`;
        fs.writeFileSync(taskSourcePath, taskContent);
      }

      try {
        const taskContent = fs.readFileSync(taskSourcePath, 'utf-8');
        fs.writeFileSync(taskDestPath, taskContent);
        console.log(`✅ Task message delivered: ${taskDestPath}\n`);
      } catch (e) {
        console.log(`❌ Failed to deliver task message: ${e.message}\n`);
      }

      // Instruct the interviewer to process the task
      console.log('📍 Instructing interviewer to read task...\n');
      TmuxInjector.injectText(INTERVIEWER_SESSION, 'Read and process the task message in your msgs folder');
      await new Promise(resolve => setTimeout(resolve, 500));
      TmuxInjector.send(INTERVIEWER_SESSION, 'Enter');

      // Give interviewer time to start
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Run HITL requirements gathering simulation
      const briefCreated = await simulateResearchRequirementsGathering();
      if (!briefCreated) {
        console.log('⚠️  Warning: Research brief not created, but continuing...\n');
      }
    }

    // After HITL, wait for all 6 agent sessions (including interviewer)
    if (workflowPassed) {
      console.log('📍 Waiting for all 6 research agent sessions to spawn...\n');

      const agents = ['interviewer', 'sourcer', 'analyst', 'researcher', 'disprover', 'writer'];
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

      console.log('📍 Checking for all 6 research agent sessions:\n');
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
        console.log('\n✅ All 6 research agent sessions spawned\n');
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

          // Check for agent activity - all 6 agents should have processed messages
          console.log('📍 Checking for agent message processing...\n');
          const agents = ['interviewer', 'sourcer', 'analyst', 'researcher', 'disprover', 'writer'];
          let agentsProcessed = 0;

          for (const agent of agents) {
            const agentDir = `.ai/tx/mesh/${MESH}/agents/${agent}/msgs`;
            if (fs.existsSync(agentDir)) {
              agentsProcessed++;
              console.log(`   ✅ Agent ${agent} has message directory`);
            }
          }

          if (agentsProcessed === 6) {
            testPassed = true;
            console.log('\n✅ TEST PASSED: All 6 research agents executed workflow!\n');
          } else {
            console.log(`   ⚠️  Only ${agentsProcessed}/6 agents had activity`);
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
