#!/usr/bin/env node
const { EventLogManager } = require('./lib/event-log-manager');
const fs = require('fs-extra');
const path = require('path');

async function test() {
  console.log('=== Message Delivery Test ===\n');

  // Enable system
  EventLogManager.enable();
  console.log('✓ Enabled EventLogManager\n');

  // Start consumer for test agent
  const agentId = 'test-echo-316019/echo';
  console.log(`Starting consumer for: ${agentId}`);
  await EventLogManager.startConsumer(agentId);
  console.log('✓ Consumer started\n');

  // Wait for watcher to fully initialize
  console.log('⏳ Waiting 3 seconds for watcher to initialize...\n');
  await new Promise(r => setTimeout(r, 3000));

  // Create test message
  const msgFile = '.ai/tx/msgs/test-message.md';
  const content = `---
to: ${agentId}
from: core/core
type: task
msg-id: test-123
timestamp: ${new Date().toISOString()}
---

Test message
`;

  console.log(`Writing test message to: ${msgFile}`);
  await fs.writeFile(msgFile, content);
  console.log('✓ Message written\n');

  // Wait for processing
  console.log('Waiting 5 seconds for message processing...');
  await new Promise(r => setTimeout(r, 5000));

  // Check offset file
  const offsetFile = `.ai/tx/state/offsets/${agentId.replace(/\//g, '-')}.json`;
  console.log(`\nChecking offset file: ${offsetFile}`);
  if (fs.existsSync(offsetFile)) {
    const offset = await fs.readJson(offsetFile);
    console.log('✓ Offset file exists:', offset);
  } else {
    console.log('❌ Offset file not found');
  }

  // Get consumer status
  console.log('\nConsumer status:');
  const status = EventLogManager.getStatus();
  console.log(JSON.stringify(status, null, 2));

  // Cleanup
  await EventLogManager.stopConsumer(agentId);
  console.log('\n✓ Test complete');
  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
