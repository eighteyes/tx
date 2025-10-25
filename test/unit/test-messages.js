const fs = require('fs-extra');
const path = require('path');
const { Message } = require('../../lib/message');
const { Logger } = require('../../lib/logger');

console.log('=== Agent Orchestration Test Suite ===\n');

// Test 1: Message Creation
console.log('Test 1: Message Creation');
console.log('Try sending a sample task: Message.send("brain", "Analyze codebase", "Looking for patterns")\n');
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
console.log('Try parsing a message: Message.parseMessage(".ai/tx/mesh/test/agents/test/msgs/test-message.md")\n');
try {
  // Create a test message in the new single msgs/ directory
  const testPath = '.ai/tx/mesh/test/agents/test/msgs/test-message.md';
  fs.ensureDirSync(path.dirname(testPath));
  fs.writeFileSync(testPath, `---
from: test
to: brain
type: task
status: start
timestamp: 2025-01-01T00:00:00Z
msg-id: test-123
---

# Task
Test task content

## Context
Test context`);

  const parsed = Message.parseMessage(testPath);
  console.log('✓ Message parsed:', parsed.metadata['msg-id']);

  // Cleanup
  fs.removeSync('.ai/tx/mesh/test');
} catch (error) {
  console.log('✗ Failed:', error.message);
}

// Test 3: Message File Creation in New Architecture
console.log('\nTest 3: Message File Creation in New Architecture');
console.log('Try sending a task and verify file structure: Message.send("test-mesh", "Test task", "Test context")\n');
try {
  // Send a test message to create file structure
  const result = Message.send('test-mesh', 'Test task', 'Test context');

  console.log('✓ Message sent:', result.id);
  console.log('  Path:', result.filepath);

  // Verify file was created in the correct location
  // New architecture: .ai/tx/mesh/{mesh}/msgs/ (no subdirectories)
  const expectedDir = '.ai/tx/mesh/test-mesh/msgs';
  if (fs.existsSync(result.filepath)) {
    console.log('✓ Message file exists in correct location');

    // Verify it's in the msgs/ directory (not in outbox/inbox subdirs)
    if (result.filepath.includes('/msgs/') && !result.filepath.includes('/outbox/') && !result.filepath.includes('/inbox/')) {
      console.log('✓ Message file in single msgs/ directory (new architecture)');
    } else {
      console.log('✗ Message file in wrong directory structure');
    }
  } else {
    console.log('✗ Message file not found');
  }

  // Cleanup
  fs.removeSync('.ai/tx/mesh/test-mesh');
} catch (error) {
  console.log('✗ Failed:', error.message);
}

  console.log('\n=== Test Suite Complete ===');
  process.exit(0);
// }, 3000);

// Test 4: Logging
console.log('\nTest 4: Logging System');
console.log('Try creating a log entry: Logger.log("test", "Test log entry", { data: "test" })\n');
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