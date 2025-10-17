const fs = require('fs-extra');
const path = require('path');
const { Message } = require('../lib/message');
const { Logger } = require('../lib/logger');
const { MockAgent } = require('../lib/mock-agent');

console.log('=== TX Watch Test Suite ===\n');

// Test 1: Message Creation
console.log('Test 1: Message Creation');
try {
  const result = Message.send('brain', 'Analyze codebase', 'Looking for patterns');
  console.log('✓ Message created:', result.id);

  // Verify file exists
  if (fs.existsSync(result.filepath)) {
    console.log('✓ Message file exists');
  } else {
    console.log('✗ Message file not found');
  }
} catch (error) {
  console.log('✗ Failed:', error.message);
}

// Test 2: Message Parsing
console.log('\nTest 2: Message Parsing');
try {
  // Create a test message
  const testPath = '.ai/tx/mesh/test/msgs/inbox/test-message.md';
  fs.ensureDirSync(path.dirname(testPath));
  fs.writeFileSync(testPath, `---
from: test
to: brain
task: test-task
timestamp: 2025-01-01T00:00:00Z
id: test-123
---

## Task
Test task content

## Context
Test context`);

  const parsed = Message.parseMessage(testPath);
  console.log('✓ Message parsed:', parsed.metadata.id);

  // Cleanup
  fs.removeSync('.ai/tx/mesh/test');
} catch (error) {
  console.log('✗ Failed:', error.message);
}

// Test 3: Mock Agent Processing
console.log('\nTest 3: Mock Agent Processing');
const agent = new MockAgent('test-mesh');

// Initialize test mesh
fs.ensureDirSync('.ai/tx/mesh/test-mesh/msgs/inbox');
fs.ensureDirSync('.ai/tx/mesh/test-mesh/msgs/next');
fs.ensureDirSync('.ai/tx/mesh/test-mesh/msgs/active');
fs.ensureDirSync('.ai/tx/mesh/test-mesh/msgs/complete');
fs.writeJsonSync('.ai/tx/mesh/test-mesh/state.json', {
  mesh: 'test-mesh',
  status: 'active'
});

// Send a test message
Message.send('test-mesh', 'Test task', 'Test context');

// Start agent
agent.start();

// Manually trigger queue processing (processNext returns after each step)
agent.processQueue(); // 1. processInbox: inbox → next
agent.processQueue(); // 2. processNext: next → active
agent.processQueue(); // 3. handleMessage: active → complete

// COMMENTED: No longer needed since mock agent processes synchronously now
// Wait for processing
// setTimeout(() => {
  // Check if message was processed
  const completeDir = '.ai/tx/mesh/test-mesh/msgs/complete';
  const completeFiles = fs.readdirSync(completeDir);

  if (completeFiles.length > 0) {
    console.log('✓ Mock agent processed message');
  } else {
    console.log('✗ Mock agent failed to process message');
  }

  // Stop agent and cleanup
  agent.stop();
  fs.removeSync('.ai/tx/mesh/test-mesh');

  console.log('\n=== Test Suite Complete ===');
  process.exit(0);
// }, 3000);

// Test 4: Logging
console.log('\nTest 4: Logging System');
try {
  Logger.log('test', 'Test log entry', { data: 'test' });
  Logger.warn('test', 'Test warning');
  Logger.error('test', 'Test error');

  const logs = Logger.tail(3, 'test');
  if (logs.length > 0) {
    console.log('✓ Logging system working:', logs.length, 'entries');
  } else {
    console.log('✗ No logs found');
  }
} catch (error) {
  console.log('✗ Logging failed:', error.message);
}