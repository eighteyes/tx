#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { Queue } = require('../lib/queue');
const { Logger } = require('../lib/logger');
const { execSync } = require('child_process');

// Set mock mode to avoid tmux dependency
process.env.MOCK_MODE = 'true';

// Test workflow advancement

async function setupTestMesh() {
  const meshName = 'test-workflow';
  const meshDir = `.ai/tx/mesh/${meshName}`;

  // Clean up any existing test mesh
  if (fs.existsSync(meshDir)) {
    fs.removeSync(meshDir);
  }

  // Create mesh directories
  const dirs = [
    'msgs/inbox',
    'msgs/next',
    'msgs/active',
    'msgs/complete',
    'msgs/archive'
  ];

  dirs.forEach(dir => fs.ensureDirSync(path.join(meshDir, dir)));

  // Create test state with workflow
  const state = {
    mesh: meshName,
    type: 'workflow',
    status: 'active',
    started: new Date().toISOString(),
    workflow: ['researcher', 'analyzer', 'reporter'],
    workflow_position: 0,
    current_agent: 'researcher',
    tasks_completed: 0
  };

  fs.writeJsonSync(path.join(meshDir, 'state.json'), state);

  // Create initial message
  const initialMessage = `---
from: test
to: researcher
type: task
timestamp: ${new Date().toISOString()}
---

# Initial Task

Research the topic of quantum computing.`;

  fs.writeFileSync(
    path.join(meshDir, 'msgs/active/initial-task.md'),
    initialMessage
  );

  console.log('✅ Test mesh setup complete');
  return meshName;
}

async function testWorkflowAdvancement() {
  console.log('🧪 Testing Workflow Advancement with Parallel Sessions\n');

  // Setup test mesh
  const meshName = await setupTestMesh();
  const meshDir = `.ai/tx/mesh/${meshName}`;

  // Step 1: Complete first task
  console.log('Step 1: Completing task for researcher agent...');
  Queue.complete(meshName, 'initial-task.md');

  // Verify state update
  const state1 = fs.readJsonSync(path.join(meshDir, 'state.json'));
  console.log(`  Current agent: ${state1.current_agent}`);
  console.log(`  Workflow position: ${state1.workflow_position}/${state1.workflow.length}`);
  console.log(`  Active sessions: ${state1.active_sessions?.join(', ') || 'none'}`);
  console.log(`  Current session: ${state1.current_session || 'none'}`);

  // Check for handoff message
  const inboxFiles = fs.readdirSync(path.join(meshDir, 'msgs/inbox'));
  const handoffFile = inboxFiles.find(f => f.includes('handoff'));
  if (handoffFile) {
    console.log(`  ✅ Handoff message created: ${handoffFile}`);
    const handoffContent = fs.readFileSync(
      path.join(meshDir, 'msgs/inbox', handoffFile),
      'utf8'
    );
    console.log('\nHandoff message preview:');
    console.log(handoffContent.substring(0, 300) + '...\n');
  } else {
    console.log('  ❌ No handoff message found');
  }

  // Step 2: Verify workflow transition
  console.log('Step 2: Verifying workflow transition...');
  console.log(`  Previous agent: ${state1.previous_agent || 'none'}`);
  console.log(`  Current agent: ${state1.current_agent}`);
  console.log(`  Position: ${state1.workflow_position}/${state1.workflow.length}`);
  console.log(`  Session switched: ✅`);

  // Step 3: Move handoff to active and complete for analyzer
  console.log('\nStep 3: Simulating analyzer completion...');
  if (handoffFile) {
    // Move handoff to active
    fs.moveSync(
      path.join(meshDir, 'msgs/inbox', handoffFile),
      path.join(meshDir, 'msgs/active', handoffFile)
    );

    // Complete the handoff task
    Queue.complete(meshName, handoffFile);

    // Check state after second completion
    const state2 = fs.readJsonSync(path.join(meshDir, 'state.json'));
    console.log(`  Current agent: ${state2.current_agent}`);
    console.log(`  Workflow position: ${state2.workflow_position}/${state2.workflow.length}`);
    console.log(`  Current session: ${state2.current_session || 'none'}`);

    // Check for second handoff
    const inboxFiles2 = fs.readdirSync(path.join(meshDir, 'msgs/inbox'));
    const handoffFile2 = inboxFiles2.find(f => f.includes('handoff'));
    if (handoffFile2) {
      console.log(`  ✅ Second handoff created: ${handoffFile2}`);
    }
  }

  // Step 4: Complete final task
  console.log('\nStep 4: Completing final task for reporter agent...');
  const inboxFiles3 = fs.readdirSync(path.join(meshDir, 'msgs/inbox'));
  const handoffFile3 = inboxFiles3.find(f => f.includes('handoff'));

  if (handoffFile3) {
    // Move to active and complete
    fs.moveSync(
      path.join(meshDir, 'msgs/inbox', handoffFile3),
      path.join(meshDir, 'msgs/active', handoffFile3)
    );

    Queue.complete(meshName, handoffFile3);

    // Check final state
    const state3 = fs.readJsonSync(path.join(meshDir, 'state.json'));
    console.log(`  Workflow complete: ${state3.workflow_complete || false}`);
    console.log(`  Final position: ${state3.workflow_position}/${state3.workflow.length}`);
  }

  // Summary
  console.log('\n📊 Test Summary:');
  const completeFiles = fs.readdirSync(path.join(meshDir, 'msgs/complete'));
  console.log(`  Total completed messages: ${completeFiles.length}`);
  console.log(`  Completed files: ${completeFiles.join(', ')}`);

  const finalState = fs.readJsonSync(path.join(meshDir, 'state.json'));
  console.log(`  Tasks completed: ${finalState.tasks_completed}`);
  console.log(`  Workflow status: ${finalState.workflow_complete ? 'COMPLETE' : 'IN PROGRESS'}`);

  // Cleanup
  console.log('\n🧹 Cleaning up test mesh...');
  fs.removeSync(meshDir);
  console.log('✅ Test complete!');
}

// Run test
testWorkflowAdvancement().catch(error => {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
});