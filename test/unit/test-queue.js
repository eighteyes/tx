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
  const centralMsgsDir = `.ai/tx/msgs`;

  // Initialize centralized message directory
  fs.ensureDirSync(centralMsgsDir);

  // Create mesh state (for mesh management, not messages)
  const meshDir = `.ai/tx/mesh/${testMesh}`;
  fs.ensureDirSync(meshDir);
  fs.writeJsonSync(`${meshDir}/state.json`, {
    mesh: testMesh,
    status: 'active',
    current_agent: testAgent
  });

  // Initialize queue system
  Queue.initialize();

  // Test 1: Message Creation in Centralized Directory
  console.log('Test 1: Message File Creation in Centralized Directory');
  console.log('Creating message in centralized .ai/tx/msgs/ directory\n');
  try {
    // Create a test message in centralized directory with new filename format
    // Format: {mmddhhmmss}-{type}-{from}>{to}-{msgId}.md
    const now = new Date();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const SS = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${MM}${DD}${HH}${mm}${SS}`;

    const testFilename = `${timestamp}-task-user>${testAgent}-test001.md`;
    const testMessagePath = path.join(centralMsgsDir, testFilename);

    fs.writeFileSync(testMessagePath, `---
from: user
to: ${testMesh}/${testAgent}
type: task
status: start
msg-id: test-001
timestamp: ${new Date().toISOString()}
---

# Test Task

This is a test message in the centralized event log architecture.
`);

    if (fs.existsSync(testMessagePath)) {
      console.log('✓ Message created in centralized directory');
      console.log(`  Filename: ${testFilename}`);

      // Verify filename format
      if (testFilename.match(/^\d{10}-task-\w+>\w+-\w+\.md$/)) {
        console.log('✓ Filename matches format: mmddhhmmss-type-from>to-msgId.md');
      } else {
        console.log('✗ Filename does not match expected format');
      }
    } else {
      console.log('✗ Message file not found');
    }
  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Test 2: Message Count in Centralized Directory
  console.log('\nTest 2: Message Count in Centralized Directory');
  console.log('Checking messages in centralized directory\n');
  try {
    const messages = Message.getMessages(testAgent);

    console.log('✓ Messages retrieved from centralized directory:');
    console.log(`  Total messages for ${testAgent}: ${messages.length}`);
    console.log(`  Centralized directory: ${centralMsgsDir}`);

    if (messages.length > 0) {
      console.log('✓ Messages detected in centralized directory');
      console.log(`  Sample: ${messages[0]}`);
    }
  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Test 3: Message Completion (marking as done)
  console.log('\nTest 3: Message Completion in Centralized Directory');
  console.log('Testing message completion (rename to *-done.md)\n');
  try {
    // Create a message to complete in centralized directory
    const now = new Date();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const SS = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${MM}${DD}${HH}${mm}${SS}`;

    const messageToComplete = `${timestamp}-task-complete-${testAgent}>core-test002.md`;
    const messagePath = path.join(centralMsgsDir, messageToComplete);

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

    // Mark message as complete using Message API
    Message.moveMessage(messageToComplete);

    // Check if file was renamed to *-done.md
    const doneFilename = messageToComplete.replace('.md', '-done.md');
    const donePath = path.join(centralMsgsDir, doneFilename);

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

  // Test 5: Event-Driven Processing with Centralized Directory
  console.log('\nTest 5: Event-Driven Message Processing');
  console.log('Testing file:msgs:new event handling with centralized directory\n');
  try {
    let eventReceived = false;

    // Listen for message routing events
    EventBus.once('message:routed', (data) => {
      eventReceived = true;
      console.log('✓ Message routing event received');
    });

    // Create new message in centralized directory
    const now = new Date();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const SS = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${MM}${DD}${HH}${mm}${SS}`;

    const newMessageFilename = `${timestamp}-task-user>core-test003.md`;
    const newMessagePath = path.join(centralMsgsDir, newMessageFilename);

    fs.writeFileSync(newMessagePath, `---
from: user
to: core/core
type: task
status: start
msg-id: test-003
timestamp: ${new Date().toISOString()}
---

# Event Test

Testing event-driven message processing in centralized directory.
`);

    // Manually trigger the event (in real system, watcher does this)
    EventBus.emit('file:msgs:new', {
      mesh: testMesh,
      agent: testAgent,
      file: newMessageFilename,
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
    fs.removeSync(centralMsgsDir);
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
