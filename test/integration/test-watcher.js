const { Watcher } = require('../../lib/watcher');
const { EventBus } = require('../../lib/event-bus');
const fs = require('fs-extra');
const path = require('path');

console.log('=== Watcher Tests (New Architecture) ===\n');

async function testWatcher() {
  // Initialize test mesh
  const testMesh = 'test-watcher';
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

  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Watcher Start/Stop
  console.log('Test 1: Watcher Start/Stop');
  try {
    Watcher.start();
    console.log('✓ Watcher started successfully');

    // Check watcher is running
    if (Watcher.watching) {
      console.log('✓ Watcher.watching flag is true');
      testsPassed++;
    } else {
      console.log('✗ Watcher.watching flag is false');
      testsFailed++;
    }
  } catch (error) {
    console.log(`✗ Failed to start watcher: ${error.message}`);
    testsFailed++;
  }

  // Test 2: File Detection in Agent msgs/ Directory
  console.log('\nTest 2: File Detection in Agent msgs/ Directory');
  console.log('Creating test message in single msgs/ directory...\n');

  let fileDetected = false;
  let eventData = null;

  // Listen for file:msgs:new event
  const eventListener = (data) => {
    if (data.mesh === testMesh && data.agent === testAgent) {
      fileDetected = true;
      eventData = data;
      console.log('✓ Watcher detected file and emitted event');
      console.log(`  Event data: mesh=${data.mesh}, agent=${data.agent}, file=${data.file}`);
    }
  };

  EventBus.on('file:msgs:new', eventListener);

  // Wait for watcher to be ready
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    // Create a test message file
    const testFilename = 'test-message-001.md';
    const testFilepath = path.join(agentMsgsDir, testFilename);

    fs.writeFileSync(testFilepath, `---
from: user
to: ${testMesh}/${testAgent}
type: task
status: start
msg-id: test-001
timestamp: ${new Date().toISOString()}
---

# Test Message

This is a test message in the new single msgs/ directory architecture.
`);

    console.log(`  Created: ${testFilepath}`);

    // Wait for watcher to detect the file
    await new Promise(resolve => setTimeout(resolve, 500));

    if (fileDetected) {
      console.log('✓ File detected successfully');
      testsPassed++;
    } else {
      console.log('✗ File not detected within timeout');
      testsFailed++;
    }

    // Verify event data
    if (eventData && eventData.file === testFilename) {
      console.log('✓ Event data contains correct filename');
      testsPassed++;
    } else {
      console.log('✗ Event data incorrect or missing');
      testsFailed++;
    }

  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
    testsFailed++;
  }

  // Remove listener
  EventBus.off('file:msgs:new', eventListener);

  // Test 3: Ignore Mechanism
  console.log('\nTest 3: Ignore Mechanism');
  console.log('Testing ignoreNextOperation functionality...\n');

  let ignoredFileDetected = false;
  const ignoreListener = (data) => {
    if (data.file === 'ignored-message.md') {
      ignoredFileDetected = true;
    }
  };

  EventBus.on('file:msgs:new', ignoreListener);

  try {
    const ignoredFilepath = path.join(agentMsgsDir, 'ignored-message.md');

    // Mark file to be ignored
    Watcher.ignoreNextOperation(ignoredFilepath);
    console.log('  Marked file to be ignored');

    // Create the file
    fs.writeFileSync(ignoredFilepath, `---
from: test
to: test
type: task
status: start
msg-id: test-ignore
timestamp: ${new Date().toISOString()}
---

# Ignored Message
`);

    // Wait for watcher
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!ignoredFileDetected) {
      console.log('✓ Ignored file was not detected (correct behavior)');
      testsPassed++;
    } else {
      console.log('✗ Ignored file was detected (should have been ignored)');
      testsFailed++;
    }

  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
    testsFailed++;
  }

  EventBus.off('file:msgs:new', ignoreListener);

  // Test 4: -done.md Files Are Skipped
  console.log('\nTest 4: Completed Messages (-done.md) Are Skipped');
  console.log('Creating -done.md file...\n');

  let doneFileDetected = false;
  const doneListener = (data) => {
    if (data.file.endsWith('-done.md')) {
      doneFileDetected = true;
    }
  };

  EventBus.on('file:msgs:new', doneListener);

  try {
    const doneFilepath = path.join(agentMsgsDir, 'completed-message-done.md');

    fs.writeFileSync(doneFilepath, `---
from: test
to: test
type: task-complete
status: complete
msg-id: test-done
timestamp: ${new Date().toISOString()}
---

# Done Message
`);

    // Wait for watcher
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!doneFileDetected) {
      console.log('✓ -done.md file was skipped (correct behavior)');
      testsPassed++;
    } else {
      console.log('✗ -done.md file was detected (should have been skipped)');
      testsFailed++;
    }

  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
    testsFailed++;
  }

  EventBus.off('file:msgs:new', doneListener);

  // Cleanup and Summary
  console.log('\n=== Stopping Watcher ===');
  await Watcher.stop();

  if (!Watcher.watching) {
    console.log('✓ Watcher stopped successfully');
    testsPassed++;
  } else {
    console.log('✗ Watcher still running');
    testsFailed++;
  }

  console.log('\n=== Cleaning up ===');
  fs.removeSync(meshDir);
  console.log('✓ Test directory removed');

  console.log('\n=== Test Summary ===');
  console.log(`Tests Passed: ${testsPassed}`);
  console.log(`Tests Failed: ${testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  }
}

testWatcher().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
});
