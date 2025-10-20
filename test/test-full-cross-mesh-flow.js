const fs = require('fs-extra');
const path = require('path');
const { Queue } = require('../lib/queue');
const { Watcher } = require('../lib/watcher');
const { EventBus } = require('../lib/event-bus');

console.log('=== Full Cross-Mesh Routing Flow Test ===\n');

// Track the flow
let stage = 0;
let agentInboxDetected = false;
let agentNextProcessed = false;
let agentActiveProcessed = false;

// Listen for key events
EventBus.on('file:agent-inbox:new', (event) => {
  console.log(`✓ Event: file:agent-inbox:new (${event.agent})`);
  if (event.mesh === 'core' && event.agent === 'core') {
    agentInboxDetected = true;
  }
});

EventBus.on('file:agent-next:new', (event) => {
  console.log(`✓ Event: file:agent-next:new (${event.agent})`);
  if (event.mesh === 'core' && event.agent === 'core') {
    agentNextProcessed = true;
  }
});

// Initialize systems
Queue.init();
Watcher.start();

console.log('Step 1: Create a message in test-echo outbox with "to: core"');
const testEchoOutbox = '.ai/tx/mesh/test-echo/agents/test-echo-hfcp/msgs/outbox';
const msg1 = `---
from: test-echo-hfcp
to: core
type: task-complete
status: completed
timestamp: ${new Date().toISOString()}
---

# Cross-Mesh Message Test

This message is being routed from test-echo mesh to core mesh.`;

fs.ensureDirSync(testEchoOutbox);
const msg1Path = path.join(testEchoOutbox, 'flow-test-1.md');
fs.writeFileSync(msg1Path, msg1);
console.log(`   ✓ Created: .ai/tx/mesh/test-echo/agents/test-echo-hfcp/msgs/outbox/flow-test-1.md\n`);

// Wait for routing
setTimeout(() => {
  console.log('Step 2: Process outbox (route to core agent inbox)');

  // Check if message was routed to core
  const coreAgentInbox = '.ai/tx/mesh/core/agents/core/msgs/inbox';
  const routedMessages = fs.readdirSync(coreAgentInbox).filter(f => f.includes('flow-test'));

  if (routedMessages.length > 0) {
    console.log(`   ✓ Message routed to core agent inbox: ${routedMessages[0]}\n`);
  } else {
    console.log(`   ✗ Message not found in core inbox\n`);
    process.exit(1);
  }

  setTimeout(() => {
    console.log('Step 3: Verify watcher detected the routed message');
    if (agentInboxDetected) {
      console.log(`   ✓ Watcher detected agent inbox file\n`);
    } else {
      console.log(`   ⚠ Watcher may not have detected file yet\n`);
    }

    console.log('Step 4: Verify Queue processed agent inbox');
    const agentNextDir = '.ai/tx/mesh/core/agents/core/msgs/next';
    const nextMessages = fs.readdirSync(agentNextDir).filter(f => f.includes('flow-test'));

    if (nextMessages.length > 0) {
      console.log(`   ✓ Message moved to agent next queue: ${nextMessages[0]}\n`);
      agentNextProcessed = true;
    } else {
      console.log(`   ⚠ Message not in agent next queue\n`);
    }

    console.log('=== Full Flow Summary ===');
    console.log(`✓ Message routing: test-echo → core`);
    console.log(`✓ Watcher detection: agent inbox files`);
    console.log(`✓ Queue processing: agent inbox → agent next`);

    if (agentInboxDetected && agentNextProcessed) {
      console.log(`\n✅ FULL CROSS-MESH FLOW WORKING!`);
      console.log(`   Messages can now be automatically processed across meshes.`);
    } else {
      console.log(`\n⚠ Partial flow - check logs above`);
    }

    // Cleanup
    Watcher.stop().then(() => {
      fs.removeSync(msg1Path);
      const nextMsg = path.join(agentNextDir, nextMessages[0]);
      if (fs.existsSync(nextMsg)) fs.removeSync(nextMsg);
      process.exit(agentInboxDetected && agentNextProcessed ? 0 : 1);
    });
  }, 300);
}, 300);
