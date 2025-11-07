const fs = require('fs-extra');
const path = require('path');
const { Message } = require('../../lib/message');
const { Logger } = require('../../lib/logger');

console.log('=== Agent Orchestration Test Suite ===\n');

// Test 1: Message Creation in Centralized Directory
console.log('Test 1: Message Creation in Centralized Directory');
console.log('Try sending a sample task: Message.send("brain", "Analyze codebase", "Looking for patterns")\n');
try {
  const result = Message.send('brain', 'Analyze codebase', 'Looking for patterns');
  console.log('✓ Message created:', result.id);
  console.log('  Filename:', result.filename);

  // Verify file exists in centralized directory
  if (fs.existsSync(result.filepath)) {
    console.log('✓ Message file exists');

    // Verify it's in centralized directory
    if (result.filepath.includes('.ai/tx/msgs/')) {
      console.log('✓ Message in centralized directory (.ai/tx/msgs/)');
    } else {
      console.log('✗ Message not in centralized directory');
    }

    // Verify new filename format: {mmddhhmmss}-{type}-{from}>{to}-{msgId}.md
    if (result.filename.match(/^\d{10}-(task|ask)-\w+>\w+-\w+\.md$/)) {
      console.log('✓ Filename matches new format: mmddhhmmss-type-from>to-msgId.md');
    } else {
      console.log('✗ Filename does not match new format');
      console.log('  Got:', result.filename);
    }
  } else {
    console.log('✗ Message file not found');
  }
} catch (error) {
  console.log('✗ Failed:', error.message);
}

// Test 2: Message Parsing from Centralized Directory
console.log('\nTest 2: Message Parsing from Centralized Directory');
console.log('Try parsing a message from centralized directory\n');
try {
  // Create a test message in centralized directory with new filename format
  const testFilename = '1102083000-task-test>brain-abc123.md';
  const testPath = `.ai/tx/msgs/${testFilename}`;
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
  console.log('  Filename:', parsed.filename);

  // Verify parsed data
  if (parsed.metadata.to === 'brain' && parsed.metadata.from === 'test') {
    console.log('✓ Routing information parsed correctly');
  } else {
    console.log('✗ Routing information incorrect');
  }

  // Cleanup
  fs.removeSync(testPath);
} catch (error) {
  console.log('✗ Failed:', error.message);
}

// Test 3: Message Filtering by Agent
console.log('\nTest 3: Message Filtering by Agent');
console.log('Try filtering messages by target agent: Message.getMessages("brain")\n');
try {
  // Create multiple test messages
  Message.send('brain', 'Task for brain', 'Context 1');
  Message.send('coordinator', 'Task for coordinator', 'Context 2');
  Message.send('brain', 'Another task for brain', 'Context 3');

  // Get all messages for brain
  const brainMessages = Message.getMessages('brain');
  console.log(`✓ Found ${brainMessages.length} messages for brain`);

  if (brainMessages.length === 2) {
    console.log('✓ Correct number of filtered messages');
  } else {
    console.log('✗ Expected 2 messages, got', brainMessages.length);
  }

  // Verify filenames contain >brain-
  const allMatchPattern = brainMessages.every(f => f.includes('>brain-'));
  if (allMatchPattern) {
    console.log('✓ All filtered messages match >brain- pattern');
  } else {
    console.log('✗ Some messages do not match pattern');
  }

  // Cleanup
  fs.removeSync('.ai/tx/msgs');
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