const fs = require('fs-extra');
const path = require('path');
const { Queue } = require('../lib/queue');
const { Message } = require('../lib/message');
const { Logger } = require('../lib/logger');

console.log('=== Two-Tier Queue Synchronization Tests ===\n');

async function runTests() {
  let testsPassed = 0;
  let testsFailed = 0;

  // Setup test mesh with agent
  const testMesh = 'test-sync-mesh';
  const testAgent = 'test-agent';
  const meshDir = `.ai/tx/mesh/${testMesh}`;
  const agentDir = `${meshDir}/agents/${testAgent}`;

  function setup() {
    // Initialize mesh structure
    fs.ensureDirSync(`${meshDir}/msgs/inbox`);
    fs.ensureDirSync(`${meshDir}/msgs/next`);
    fs.ensureDirSync(`${meshDir}/msgs/active`);
    fs.ensureDirSync(`${meshDir}/msgs/complete`);
    fs.ensureDirSync(`${meshDir}/msgs/archive`);

    // Initialize agent structure
    fs.ensureDirSync(`${agentDir}/msgs/inbox`);
    fs.ensureDirSync(`${agentDir}/msgs/next`);
    fs.ensureDirSync(`${agentDir}/msgs/active`);
    fs.ensureDirSync(`${agentDir}/msgs/complete`);
    fs.ensureDirSync(`${agentDir}/msgs/archive`);

    fs.writeJsonSync(`${meshDir}/state.json`, {
      mesh: testMesh,
      status: 'active',
      current_agent: testAgent
    });
  }

  function cleanup() {
    fs.removeSync(meshDir);
  }

  // Test 1: Unit Test - Mesh Active Cleanup in completeAgentTask()
  console.log('Test 1: Mesh Active Cleanup on Agent Completion');
  console.log('Try creating a test message: const messageFile = "250928123000-test-task.md"; fs.writeFileSync(...)\n');
  try {
    setup();

    // Create test message file
    const messageFile = '250928123000-test-task.md';
    const messageContent = '---\nfrom: core\nto: test-agent\n---\n\nTest task content';

    // Place file in both mesh active and agent active
    fs.writeFileSync(`${meshDir}/msgs/active/${messageFile}`, messageContent);
    fs.writeFileSync(`${agentDir}/msgs/active/${messageFile}`, messageContent);

    // Verify files exist
    const meshActiveExists = fs.existsSync(`${meshDir}/msgs/active/${messageFile}`);
    const agentActiveExists = fs.existsSync(`${agentDir}/msgs/active/${messageFile}`);

    if (!meshActiveExists || !agentActiveExists) {
      throw new Error('Setup failed: Files not created');
    }

    // Complete agent task
    Queue.completeAgentTask(testMesh, testAgent, messageFile);

    // Verify agent active → agent complete
    const agentCompleteExists = fs.existsSync(`${agentDir}/msgs/complete/${messageFile}`);
    const agentActiveStillExists = fs.existsSync(`${agentDir}/msgs/active/${messageFile}`);

    // Verify mesh active → mesh complete (this is the fix)
    const meshCompleteExists = fs.existsSync(`${meshDir}/msgs/complete/${messageFile}`);
    const meshActiveStillExists = fs.existsSync(`${meshDir}/msgs/active/${messageFile}`);

    if (agentCompleteExists && !agentActiveStillExists &&
        meshCompleteExists && !meshActiveStillExists) {
      console.log('✓ Agent active → agent complete');
      console.log('✓ Mesh active → mesh complete (synchronized cleanup)');
      testsPassed++;
    } else {
      console.log('✗ Queue synchronization failed:');
      console.log(`  Agent: active=${agentActiveStillExists}, complete=${agentCompleteExists}`);
      console.log(`  Mesh: active=${meshActiveStillExists}, complete=${meshCompleteExists}`);
      testsFailed++;
    }

    cleanup();
  } catch (error) {
    console.log(`✗ Test failed: ${error.message}`);
    testsFailed++;
    cleanup();
  }

  // Test 2: Edge Case - Mesh Active File Doesn't Exist
  console.log('\nTest 2: Edge Case - Mesh Active File Missing');
  console.log('Try creating a test message with missing mesh active: fs.writeFileSync(`${agentDir}/msgs/active/${messageFile}`, ...)\n');
  try {
    setup();

    const messageFile = '250928123100-test-task-2.md';
    const messageContent = '---\nfrom: core\nto: test-agent\n---\n\nTest task content';

    // Only place file in agent active (not mesh active)
    fs.writeFileSync(`${agentDir}/msgs/active/${messageFile}`, messageContent);

    // Complete agent task - should not error even though mesh active doesn't exist
    Queue.completeAgentTask(testMesh, testAgent, messageFile);

    // Verify agent active → agent complete still works
    const agentCompleteExists = fs.existsSync(`${agentDir}/msgs/complete/${messageFile}`);
    const agentActiveStillExists = fs.existsSync(`${agentDir}/msgs/active/${messageFile}`);

    if (agentCompleteExists && !agentActiveStillExists) {
      console.log('✓ Agent task completed successfully');
      console.log('✓ No error when mesh active file missing');
      testsPassed++;
    } else {
      console.log('✗ Agent task completion failed');
      testsFailed++;
    }

    cleanup();
  } catch (error) {
    console.log(`✗ Test failed with error: ${error.message}`);
    testsFailed++;
    cleanup();
  }

  // Test 3: Edge Case - File Already in Mesh Complete
  console.log('\nTest 3: Edge Case - File Already in Mesh Complete');
  console.log('Try creating a test message already in complete: fs.writeFileSync(`${meshDir}/msgs/complete/${messageFile}`, ...)\n');
  try {
    setup();

    const messageFile = '250928123200-test-task-3.md';
    const messageContent = '---\nfrom: core\nto: test-agent\n---\n\nTest task content';

    // Place file in agent active and mesh complete (unusual but possible)
    fs.writeFileSync(`${agentDir}/msgs/active/${messageFile}`, messageContent);
    fs.writeFileSync(`${meshDir}/msgs/complete/${messageFile}`, messageContent);

    // Complete agent task - moveSync with overwrite:false should handle gracefully
    try {
      Queue.completeAgentTask(testMesh, testAgent, messageFile);

      // Verify agent task completed
      const agentCompleteExists = fs.existsSync(`${agentDir}/msgs/complete/${messageFile}`);

      if (agentCompleteExists) {
        console.log('✓ Agent task completed');
        console.log('✓ Handled existing mesh complete file gracefully');
        testsPassed++;
      } else {
        console.log('✗ Agent task completion failed');
        testsFailed++;
      }
    } catch (err) {
      // If it errors because file exists, that's expected behavior with overwrite:false
      if (err.message.includes('already exists') || err.code === 'EEXIST') {
        console.log('✓ Correctly prevented overwrite of existing file');
        testsPassed++;
      } else {
        throw err;
      }
    }

    cleanup();
  } catch (error) {
    console.log(`✗ Test failed: ${error.message}`);
    testsFailed++;
    cleanup();
  }

  // Test 4: Integration Test - Full Workflow
  console.log('\nTest 4: Integration Test - Full Two-Tier Workflow');
  console.log('Try running a full workflow: fs.writeFileSync(`${meshDir}/msgs/inbox/${messageFile}`, ...); Queue.processInbox(testMesh); ...\n');
  try {
    setup();

    const messageFile = '250928123300-integration-test.md';
    const messageContent = '---\nfrom: core\nto: test-agent\npriority: normal\n---\n\nIntegration test task';

    // 1. Message arrives at mesh inbox
    fs.writeFileSync(`${meshDir}/msgs/inbox/${messageFile}`, messageContent);
    console.log('  Step 1: Message in mesh inbox');

    // 2. Mesh processes inbox → next
    Queue.processInbox(testMesh);
    const inMeshNext = fs.existsSync(`${meshDir}/msgs/next/${messageFile}`);
    if (!inMeshNext) {
      throw new Error('Mesh inbox → next failed');
    }
    console.log('  Step 2: Mesh inbox → next ✓');

    // 3. Mesh processes next → active
    Queue.processNext(testMesh);
    const inMeshActive = fs.existsSync(`${meshDir}/msgs/active/${messageFile}`);
    if (!inMeshActive) {
      throw new Error('Mesh next → active failed');
    }
    console.log('  Step 3: Mesh next → active ✓');

    // 4. Watcher would copy mesh active → agent inbox (simulate this)
    fs.copyFileSync(`${meshDir}/msgs/active/${messageFile}`, `${agentDir}/msgs/inbox/${messageFile}`);
    console.log('  Step 4: Watcher copies to agent inbox ✓');

    // 5. Agent processes inbox → next → active
    Queue.processAgentInbox(testMesh, testAgent);
    Queue.processAgentNext(testMesh, testAgent);
    const inAgentActive = fs.existsSync(`${agentDir}/msgs/active/${messageFile}`);
    if (!inAgentActive) {
      throw new Error('Agent inbox → active failed');
    }
    console.log('  Step 5: Agent inbox → next → active ✓');

    // 6. Agent completes task (THE CRITICAL STEP)
    Queue.completeAgentTask(testMesh, testAgent, messageFile);

    // Verify synchronized cleanup
    const agentInComplete = fs.existsSync(`${agentDir}/msgs/complete/${messageFile}`);
    const meshInComplete = fs.existsSync(`${meshDir}/msgs/complete/${messageFile}`);
    const agentActiveGone = !fs.existsSync(`${agentDir}/msgs/active/${messageFile}`);
    const meshActiveGone = !fs.existsSync(`${meshDir}/msgs/active/${messageFile}`);

    if (agentInComplete && meshInComplete && agentActiveGone && meshActiveGone) {
      console.log('  Step 6: Agent completion synchronized cleanup ✓');
      console.log('✓ Full two-tier workflow successful');
      console.log('✓ No orphaned files in mesh active');
      testsPassed++;
    } else {
      console.log('✗ Synchronized cleanup failed:');
      console.log(`  Agent complete: ${agentInComplete}, Agent active gone: ${agentActiveGone}`);
      console.log(`  Mesh complete: ${meshInComplete}, Mesh active gone: ${meshActiveGone}`);
      testsFailed++;
    }

    cleanup();
  } catch (error) {
    console.log(`✗ Integration test failed: ${error.message}`);
    testsFailed++;
    cleanup();
  }

  // Test 5: No Active Messages Edge Case
  console.log('\nTest 5: Edge Case - No Active Messages');
  console.log('Try completing a task when none exist: Queue.completeAgentTask(testMesh, testAgent)\n');
  try {
    setup();

    // Try to complete when no active messages exist
    const result = Queue.completeAgentTask(testMesh, testAgent);

    if (result === false) {
      console.log('✓ Correctly returned false for no active messages');
      testsPassed++;
    } else {
      console.log('✗ Should have returned false');
      testsFailed++;
    }

    cleanup();
  } catch (error) {
    console.log(`✗ Test failed: ${error.message}`);
    testsFailed++;
    cleanup();
  }

  // Summary
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log(`Total: ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n✓ All tests passed! Queue synchronization working correctly.');
  } else {
    console.log('\n✗ Some tests failed. Review the output above.');
    process.exit(1);
  }
}

runTests();
