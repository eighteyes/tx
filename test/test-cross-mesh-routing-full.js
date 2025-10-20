const fs = require('fs-extra');
const path = require('path');
const { Queue } = require('../lib/queue');
const { Message } = require('../lib/message');
const { Logger } = require('../lib/logger');
const { EventBus } = require('../lib/event-bus');

console.log('=== Full Cross-Mesh Routing Test ===\n');

// Initialize the Queue to set up event listeners
Queue.init();
console.log('✓ Queue initialized\n');

// Step 1: Check current state
const testEchoOutbox = '.ai/tx/mesh/test-echo/agents/test-echo-hfcp/msgs/outbox';
const coreAgentInbox = '.ai/tx/mesh/core/agents/core/msgs/inbox';

const outboxBefore = fs.readdirSync(testEchoOutbox).filter(f => f.endsWith('.md'));
const inboxBefore = fs.readdirSync(coreAgentInbox).filter(f => f.endsWith('.md'));

console.log('Before routing:');
console.log(`  test-echo outbox: ${outboxBefore.length} messages`);
console.log(`  core inbox: ${inboxBefore.length} messages`);
console.log('');

// Step 2: Get the first message
const firstMsg = outboxBefore[0];
const firstMsgPath = path.join(testEchoOutbox, firstMsg);

console.log(`Processing: ${firstMsg}`);

// Step 3: Parse the message to verify it
try {
  const msg = Message.parseMessage(firstMsgPath);
  console.log(`  from: ${msg.metadata.from}`);
  console.log(`  to: ${msg.metadata.to}`);
  console.log(`  type: ${msg.metadata.type}`);
  console.log('');
} catch (e) {
  console.log(`  Error parsing message: ${e.message}`);
}

// Step 4: Process the outbox
console.log('Processing outbox...');
try {
  Queue.processOutbox('test-echo', firstMsg, firstMsgPath);
  console.log('✓ processOutbox completed\n');
} catch (error) {
  console.log(`✗ Error: ${error.message}\n`);
  console.log(error.stack);
}

// Step 5: Check after processing
setTimeout(() => {
  const outboxAfter = fs.readdirSync(testEchoOutbox).filter(f => f.endsWith('.md'));
  const inboxAfter = fs.readdirSync(coreAgentInbox).filter(f => f.endsWith('.md'));

  console.log('After routing:');
  console.log(`  test-echo outbox: ${outboxAfter.length} messages (was ${outboxBefore.length})`);
  console.log(`  core inbox: ${inboxAfter.length} messages (was ${inboxBefore.length})`);
  console.log('');

  if (outboxAfter.length < outboxBefore.length) {
    console.log('✓ Message removed from source outbox');
  } else {
    console.log('✗ Message still in source outbox');
  }

  if (inboxAfter.length > inboxBefore.length) {
    const newMsgs = inboxAfter.filter(m => !inboxBefore.includes(m));
    console.log('✓ Message delivered to core inbox!');
    console.log('  New messages:', newMsgs);
  } else {
    console.log('✗ Message not in core inbox');
  }

  console.log('');
  console.log('=== Test Complete ===');
}, 100);
