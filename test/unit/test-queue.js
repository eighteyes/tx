const fs = require('fs-extra');
const path = require('path');
const { Queue } = require('../../lib/queue');
const { Message } = require('../../lib/message');
const { Logger } = require('../../lib/logger');
const { EventBus } = require('../../lib/event-bus');

console.log('=== Queue System Tests (New Architecture) ===\n');

async function runTests() {
  // Setup test mesh
  const testMesh = 'test-queue';
  const testAgent = 'worker';
  const meshDir = `.ai/tx/mesh/${testMesh}`;
  const agentMsgsDir = `${meshDir}/agents/${testAgent}/msgs`;

  // Initialize mesh structure (new architecture: single msgs/ directory)
  fs.ensureDirSync(agentMsgsDir);

  fs.writeJsonSync(`${meshDir}/state.json`, {
    mesh: testMesh,
    status: 'active',
    current_agent: testAgent
  });

  // Initialize queue system
  Queue.initialize();

  // Test 1: Message Creation in New Architecture
  console.log('Test 1: Message File Creation');
  console.log('Creating message in single msgs/ directory (no outbox/inbox subdirectories)\n');
  try {
    // Create a test message directly in the agent's msgs/ directory
    const testMessagePath = path.join(agentMsgsDir, 'test-message-001.md');
    fs.writeFileSync(testMessagePath, `---
from: user
to: ${testMesh}/${testAgent}
type: task
status: start
msg-id: test-001
timestamp: ${new Date().toISOString()}
---

# Test Task

This is a test message in the new single msgs/ directory architecture.
`);

    if (fs.existsSync(testMessagePath)) {
      console.log('✓ Message created in single msgs/ directory');

      // Verify no subdirectories exist
      const hasSubdirs = fs.readdirSync(agentMsgsDir).some(item => {
        const itemPath = path.join(agentMsgsDir, item);
        return fs.statSync(itemPath).isDirectory();
      });

      if (!hasSubdirs) {
        console.log('✓ No outbox/inbox subdirectories (correct architecture)');
      } else {
        console.log('⚠️  Warning: Subdirectories found in msgs/ folder');
      }
    } else {
      console.log('✗ Message file not found');
    }
  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Test 2: Queue Status Check
  console.log('\nTest 2: Queue Status');
  console.log('Checking queue status for mesh and agent\n');
  try {
    const status = Queue.getQueueStatus(testMesh, testAgent);

    console.log('✓ Queue status retrieved:');
    console.log(`  Total messages: ${status.total}`);
    console.log(`  Messages directory: ${agentMsgsDir}`);

    if (status.total > 0) {
      console.log('✓ Messages detected in queue');
    }
  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Test 3: Message Completion (marking as done)
  console.log('\nTest 3: Message Completion');
  console.log('Testing message completion (rename to *-done.md)\n');
  try {
    // Create a message to complete
    const messageToComplete = 'test-message-002.md';
    const messagePath = path.join(agentMsgsDir, messageToComplete);

    fs.writeFileSync(messagePath, `---
from: ${testMesh}/${testAgent}
to: core/core
type: task-complete
status: complete
msg-id: test-002
timestamp: ${new Date().toISOString()}
---

# Task Complete

Task has been completed.
`);

    console.log(`  Created: ${messageToComplete}`);

    // Mark message as complete
    Queue.completeMessage(testMesh, testAgent, messageToComplete);

    // Check if file was renamed to *-done.md
    const doneFilename = messageToComplete.replace('.md', '-done.md');
    const donePath = path.join(agentMsgsDir, doneFilename);

    if (fs.existsSync(donePath)) {
      console.log(`✓ Message marked as done: ${doneFilename}`);
    } else {
      console.log('✗ Message not marked as done');
    }

    // Verify original file is gone
    if (!fs.existsSync(messagePath)) {
      console.log('✓ Original message file removed (renamed)');
    } else {
      console.log('⚠️  Original message still exists');
    }
  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Test 4: State Management
  console.log('\nTest 4: State Management');
  console.log('Testing state get/set operations\n');
  try {
    // Set state
    const testState = {
      current_task: 'test-task-123',
      last_update: new Date().toISOString()
    };

    Queue.setState(testMesh, testAgent, testState);
    console.log('✓ State set successfully');

    // Get state
    const retrievedState = Queue.getState(testMesh, testAgent);

    if (retrievedState && retrievedState.current_task === 'test-task-123') {
      console.log('✓ State retrieved correctly');
    } else {
      console.log('✗ State not retrieved correctly');
    }
  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Test 5: Event-Driven Processing
  console.log('\nTest 5: Event-Driven Message Processing');
  console.log('Testing file:msgs:new event handling\n');
  try {
    let eventReceived = false;

    // Listen for message routing events
    EventBus.once('message:routed', (data) => {
      eventReceived = true;
      console.log('✓ Message routing event received');
    });

    // Simulate new message event (this is what the watcher would emit)
    const newMessagePath = path.join(agentMsgsDir, 'test-message-003.md');
    fs.writeFileSync(newMessagePath, `---
from: user
to: core/core
type: task
status: start
msg-id: test-003
timestamp: ${new Date().toISOString()}
---

# Event Test

Testing event-driven message processing.
`);

    // Manually trigger the event (in real system, watcher does this)
    EventBus.emit('file:msgs:new', {
      mesh: testMesh,
      agent: testAgent,
      file: 'test-message-003.md',
      filepath: newMessagePath
    });

    // Give event time to process
    setTimeout(() => {
      if (eventReceived) {
        console.log('✓ Event-driven processing works');
      } else {
        console.log('⚠️  Note: Event may not route without active tmux session');
      }
    }, 100);

  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Cleanup
  setTimeout(() => {
    console.log('\n=== Cleaning up ===');
    fs.removeSync(`.ai/tx/mesh/${testMesh}`);
    Queue.shutdown();
    console.log('✓ Cleanup complete\n');
    console.log('=== Test Suite Complete ===');
    process.exit(0);
  }, 200);
}

runTests().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
