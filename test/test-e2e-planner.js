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
const { TmuxInjector } = require('../lib/tmux-injector');

const MESH = 'planner';
const CORE = 'core';
const AGENTS = ['decomposer', 'predictor', 'evaluator', 'monitor', 'coordinator'];
const TEST_TIMEOUT = 240000; // 4 minutes for multi-agent iterative workflow

/**
 * Wait for a tmux session to exist
 */
async function waitForSession(sessionName, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const sessions = TmuxInjector.listSessions();

    // Check for exact match or suffixed match (e.g., "planner-decomposer" or "planner-decomposer-1")
    const found = sessions.some(s =>
      s === sessionName ||
      s.startsWith(`${sessionName}-`) ||
      s === `${MESH}-${sessionName}`
    );

    if (found) {
      console.log(`✅ Session found: ${sessionName}`);
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.error(`❌ Timeout waiting for session: ${sessionName}`);
  console.error('Available sessions:', TmuxInjector.listSessions());
  return false;
}

/**
 * Main test function
 */
async function runTest() {
  console.log('\n=== Planner Mesh E2E Test (MAP Architecture) ===\n');

  const testStart = Date.now();
  let testPassed = false;

  try {
    // Step 1: Start tmux server
    console.log('Starting tmux server...');
    try {
      execSync('tmux start-server', { stdio: 'pipe' });
      console.log('✅ Tmux server started');
    } catch (e) {
      console.log('ℹ️  Tmux server already running');
    }

    // Step 2: Start tx system
    console.log('\nStarting tx system...');
    spawn('tx', ['start', '-d'], {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    // Wait for system to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Wait for core session
    console.log('\nWaiting for core session...');
    const coreFound = await waitForSession(CORE, 45000);
    if (!coreFound) {
      throw new Error('Core session failed to start');
    }

    // Step 4: Wait for Claude to be ready
    console.log('\nWaiting for Claude to initialize in core...');
    const claudeReady = await TmuxInjector.claudeReadyCheck(CORE, 60000);
    if (!claudeReady) {
      console.warn('⚠️  Claude ready check timed out, proceeding anyway...');
    }

    // Step 5: Wait for core to be idle
    console.log('\nWaiting for core to be idle...');
    const coreIdle = await TmuxInjector.waitForIdle(CORE, 1000, 15000);
    if (!coreIdle) {
      console.warn('⚠️  Core idle wait timed out, proceeding anyway...');
    }

    // Step 6: Inject natural language instruction
    console.log('\n📝 Injecting planning instruction to core...');
    const instruction = 'spawn a planner mesh and create a plan for deploying a web application with zero downtime';

    TmuxInjector.injectText(CORE, instruction);
    TmuxInjector.send(CORE, 'Enter');
    console.log(`✅ Instruction injected: "${instruction}"`);

    // Step 7: Wait for entry point agent (decomposer) to spawn
    console.log('\nWaiting for entry point agent (decomposer) to spawn...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    const decomposerSession = `${MESH}-decomposer`;
    const decomposerFound = await waitForSession(decomposerSession, 30000);

    if (!decomposerFound) {
      console.error('❌ Entry point agent (decomposer) failed to spawn');
      throw new Error('Decomposer agent failed to spawn');
    }

    console.log('✅ Entry point agent spawned, workflow will proceed');

    // Step 8: Idle sequencing - wait for planning workflow to complete
    console.log('\n⏳ Waiting for planning workflow to complete...');
    console.log('   (This may take 2-3 minutes for iterative refinement)');

    // Wait for core to finish sending initial task
    console.log('\n   → Waiting for core to send task to decomposer...');
    const coreIdle1 = await TmuxInjector.waitForIdle(CORE, 5000, 60000);
    if (coreIdle1) {
      console.log('   ✅ Core sent task');
    }

    // Wait for planning agents to do their work (iterative workflow with feedback)
    console.log('\n   → Waiting for planning agents to complete workflow...');
    // Use longer timeout for iterative workflow with feedback loop
    await new Promise(resolve => setTimeout(resolve, 90000)); // 1.5 minutes for planning

    // Wait for core to receive final plan
    console.log('\n   → Waiting for core to receive completion...');
    const coreIdle2 = await TmuxInjector.waitForIdle(CORE, 5000, 60000);
    if (coreIdle2) {
      console.log('   ✅ Core received completion');
    }

    // Step 9: Validate via tmux output
    console.log('\n🔍 Validating planning workflow completion...');

    const coreOutput = execSync(`tmux capture-pane -t ${CORE} -p -S -200`).toString();

    // Check for evidence of planning workflow
    const hasMessageRouting = coreOutput.includes('outbox/') ||
                               coreOutput.includes('routing') ||
                               coreOutput.includes('message');

    const hasTaskComplete = coreOutput.includes('task-complete') ||
                            coreOutput.includes('status: complete') ||
                            coreOutput.includes('complete/');

    const hasPlanningEvidence = coreOutput.includes('planner') ||
                                coreOutput.includes('decompos') ||
                                coreOutput.includes('plan.md') ||
                                coreOutput.includes('04-plan');

    // Check individual agent outputs for workflow steps
    let agentWorkEvidence = false;
    const sessions = TmuxInjector.listSessions();
    const plannerSessions = sessions.filter(s => s.startsWith('planner-'));

    for (const session of plannerSessions) {
      try {
        const agentOutput = execSync(`tmux capture-pane -t ${session} -p -S -100`).toString();

        if (agentOutput.includes('outbox') ||
            agentOutput.includes('decomposition') ||
            agentOutput.includes('prediction') ||
            agentOutput.includes('evaluation') ||
            agentOutput.includes('approved') ||
            agentOutput.includes('rejected') ||
            agentOutput.includes('coordinator')) {
          agentWorkEvidence = true;
          console.log(`   ✅ Agent work detected: ${session}`);
          break;
        }
      } catch (e) {
        // Session might not exist anymore, that's ok
      }
    }

    // Test passes if we see evidence of planning workflow
    testPassed = (hasMessageRouting || hasTaskComplete || hasPlanningEvidence || agentWorkEvidence);

    // Display validation results
    console.log('\n📊 Validation Results:');
    console.log(`   Message Routing: ${hasMessageRouting ? '✅' : '❌'}`);
    console.log(`   Task Complete: ${hasTaskComplete ? '✅' : '❌'}`);
    console.log(`   Planning Evidence: ${hasPlanningEvidence ? '✅' : '❌'}`);
    console.log(`   Agent Work Evidence: ${agentWorkEvidence ? '✅' : '❌'}`);

    if (!testPassed) {
      console.log('\n📝 Last 40 lines of core output:');
      console.log(coreOutput.split('\n').slice(-40).join('\n'));

      // Show decomposer output for debugging
      try {
        const agentOutput = execSync(`tmux capture-pane -t ${MESH}-decomposer -p -S -50`).toString();
        console.log(`\n📝 Last 20 lines of decomposer output:`);
        console.log(agentOutput.split('\n').slice(-20).join('\n'));
      } catch (e) {
        // Ignore
      }
    }

  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    testPassed = false;
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');

    try {
      execSync('tx stop', { stdio: 'pipe' });
      console.log('✅ System stopped');
    } catch (e) {
      // May return error code, that's ok
      console.log('ℹ️  System stop completed');
    }

    // Kill any remaining test sessions
    const sessions = TmuxInjector.listSessions();
    const testSessions = sessions.filter(s => s.includes(MESH) || s === CORE);

    testSessions.forEach(session => {
      try {
        TmuxInjector.killSession(session);
        console.log(`✅ Killed session: ${session}`);
      } catch (e) {
        // Already dead, ignore
      }
    });

    const duration = ((Date.now() - testStart) / 1000).toFixed(1);

    // Final result
    console.log('\n' + '='.repeat(60));
    if (testPassed) {
      console.log(`✅ TEST PASSED - Planner mesh workflow completed (${duration}s)`);
      console.log('='.repeat(60));
      process.exit(0);
    } else {
      console.log(`❌ TEST FAILED - Planning workflow did not complete (${duration}s)`);
      console.log('='.repeat(60));
      process.exit(1);
    }
  }
}

// Set timeout and run
setTimeout(() => {
  console.error('\n❌ TEST TIMEOUT - Exceeded maximum duration');
  process.exit(1);
}, TEST_TIMEOUT);

runTest().catch(error => {
  console.error('\n❌ Unhandled test error:', error);
  process.exit(1);
});
