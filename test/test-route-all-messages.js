const fs = require('fs-extra');
const path = require('path');
const { Queue } = require('../lib/queue');

console.log('=== Routing All Undelivered Messages ===\n');

// Initialize Queue
Queue.init();

const testEchoOutbox = '.ai/tx/mesh/test-echo/agents/test-echo-hfcp/msgs/outbox';
const coreAgentInbox = '.ai/tx/mesh/core/agents/core/msgs/inbox';

// Get all messages
const outboxBefore = fs.readdirSync(testEchoOutbox).filter(f => f.endsWith('.md'));
const inboxBefore = fs.readdirSync(coreAgentInbox).filter(f => f.endsWith('.md'));

console.log(`Starting state:`);
console.log(`  test-echo outbox: ${outboxBefore.length} messages`);
console.log(`  core inbox: ${inboxBefore.length} messages\n`);

let routed = 0;
let failed = 0;

// Route each message
for (const file of outboxBefore) {
  const filepath = path.join(testEchoOutbox, file);
  try {
    Queue.processOutbox('test-echo', file, filepath);
    routed++;
    console.log(`✓ Routed: ${file}`);
  } catch (e) {
    failed++;
    console.log(`✗ Failed: ${file} - ${e.message}`);
  }
}

// Wait a moment for async operations
setTimeout(() => {
  const outboxAfter = fs.readdirSync(testEchoOutbox).filter(f => f.endsWith('.md'));
  const inboxAfter = fs.readdirSync(coreAgentInbox).filter(f => f.endsWith('.md'));

  console.log(`\n=== Results ===`);
  console.log(`Successfully routed: ${routed} messages`);
  console.log(`Failed: ${failed} messages`);
  console.log(`\nFinal state:`);
  console.log(`  test-echo outbox: ${outboxAfter.length} messages (was ${outboxBefore.length})`);
  console.log(`  core inbox: ${inboxAfter.length} messages (was ${inboxBefore.length})`);

  if (outboxAfter.length === 0) {
    console.log('\n✓✓✓ All messages successfully routed to core mesh!');
  } else {
    console.log('\n⚠ Some messages remain in outbox');
  }
}, 100);
