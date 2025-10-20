const fs = require('fs-extra');
const path = require('path');
const { Queue } = require('../lib/queue');
const { Watcher } = require('../lib/watcher');
const { EventBus } = require('../lib/event-bus');
const { Message } = require('../lib/message');

console.log('=== Agent Inbox Watcher Test ===\n');

// Track events
let agentInboxNewCount = 0;
let agentInboxProcessed = false;

// Listen for agent inbox events
EventBus.on('file:agent-inbox:new', (event) => {
  agentInboxNewCount++;
  console.log(`✓ Received file:agent-inbox:new event`);
  console.log(`  mesh: ${event.mesh}, agent: ${event.agent}, file: ${event.file}`);
});

// Initialize Queue to set up listeners
Queue.init();
console.log('✓ Queue initialized\n');

// Start watcher
console.log('Starting watcher...');
Watcher.start();
console.log('✓ Watcher started\n');

// Create a test message in agent inbox
const coreAgentInbox = '.ai/tx/mesh/core/agents/core/msgs/inbox';
const testMsgPath = path.join(coreAgentInbox, 'test-agent-inbox-watch.md');

console.log('Creating test message in agent inbox...');
const testMessage = `---
from: test-echo-hfcp
to: core
type: test
status: pending
timestamp: ${new Date().toISOString()}
---

# Test message for agent inbox watcher`;

fs.ensureDirSync(coreAgentInbox);
fs.writeFileSync(testMsgPath, testMessage);
console.log(`✓ Created: ${testMsgPath}\n`);

// Wait for watcher to detect
setTimeout(async () => {
  console.log(`Checking for agent inbox events...\n`);

  if (agentInboxNewCount > 0) {
    console.log(`✅ SUCCESS: Watcher detected agent inbox file!`);
    console.log(`   Events received: ${agentInboxNewCount}`);
  } else {
    console.log(`⚠ No agent inbox events detected`);
  }

  // Check what's in agent next (should be moved there by processAgentInbox)
  const agentNextDir = '.ai/tx/mesh/core/agents/core/msgs/next';
  const nextFiles = fs.existsSync(agentNextDir)
    ? fs.readdirSync(agentNextDir).filter(f => f.endsWith('.md'))
    : [];

  console.log(`\nAgent next queue: ${nextFiles.length} messages`);
  if (nextFiles.includes('test-agent-inbox-watch.md')) {
    console.log(`  ✓ Message moved to next (processAgentInbox worked!)`);
    agentInboxProcessed = true;
  }

  // Clean up
  console.log(`\nCleaning up...`);
  fs.removeSync(testMsgPath);
  await Watcher.stop();
  console.log('✓ Watcher stopped');

  // Summary
  console.log(`\n=== Summary ===`);
  if (agentInboxNewCount > 0 && agentInboxProcessed) {
    console.log(`✅ Agent inbox watcher is working!`);
    console.log(`   - Watcher detected new agent inbox files`);
    console.log(`   - Queue processed agent inbox automatically`);
  } else {
    console.log(`⚠ Issues detected:`);
    if (agentInboxNewCount === 0) console.log(`   - Watcher didn't detect agent inbox events`);
    if (!agentInboxProcessed) console.log(`   - Queue didn't process agent inbox`);
  }

  process.exit(agentInboxNewCount > 0 && agentInboxProcessed ? 0 : 1);
}, 500);
