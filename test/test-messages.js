const fs = require('fs-extra');
const path = require('path');
const { Message } = require('../lib/message');
const { Logger } = require('../lib/logger');
const { MockAgent } = require('../lib/mock-agent');

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
console.log('Try parsing a message: Message.parseMessage(".ai/tx/mesh/test/msgs/inbox/test-message.md")\n');
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
console.log('Try sending a task and let the agent process it: Message.send("test-mesh", "Test task", "Test context")\n');
const agent = new MockAgent('test-mesh');

// Send a test message
Message.send('test-mesh', 'Test task', 'Test context');

// Start agent (creates both mesh and agent directories)
agent.start();

// Manually trigger queue processing (new architecture has 4 steps)
agent.processQueue(); // 1. processInbox: mesh inbox → agent inbox
agent.processQueue(); // 2. processAgentInbox: agent inbox → agent next
agent.processQueue(); // 3. processAgentNext: agent next → agent active
agent.processQueue(); // 4. handleMessage + completeAgentTask: agent active → agent complete

// Check if message was processed (check agent-level complete directory)
const agentCompleteDir = '.ai/tx/mesh/test-mesh/agents/test-mesh/msgs/complete';
const completeFiles = fs.readdirSync(agentCompleteDir);

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