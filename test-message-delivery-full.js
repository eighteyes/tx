#!/usr/bin/env node
const { EventLogManager } = require('./lib/event-log-manager');
const { MessageWriter } = require('./lib/message-writer');
const fs = require('fs-extra');

async function test() {
  console.log('Testing full message delivery flow...\n');
  
  // Enable system
  EventLogManager.enable();
  console.log('✓ EventLogManager enabled\n');
  
  // Start consumer for test agent
  const agentId = 'test-echo-xyz789/echo';
  console.log(`Starting consumer for: ${agentId}`);
  await EventLogManager.startConsumer(agentId);
  console.log('✓ Consumer started\n');
  
  // Wait for watcher to be ready
  await new Promise(r => setTimeout(r, 2000));
  console.log('✓ Waited for watcher to be ready\n');
  
  // Write a message using MessageWriter
  console.log(`Writing message to ${agentId}...`);
  const msgWriter = new MessageWriter();
  const msgPath = await msgWriter.writeMessage({
    to: agentId,
    from: 'core/core',
    type: 'task',
    msgId: 'test-msg-123',
    content: 'Test message content'
  });
  console.log(`✓ Message written to: ${msgPath}\n`);
  
  // Wait for processing
  console.log('Waiting 5 seconds for message processing...');
  await new Promise(r => setTimeout(r, 5000));
  
  // Check offset file
  const offsetFile = `.ai/tx/state/offsets/${agentId.replace(/\//g, '-')}.json`;
  if (fs.existsSync(offsetFile)) {
    const offset = await fs.readJson(offsetFile);
    console.log(`✓ Offset file updated: ${offsetFile}`);
    console.log(`  Last processed: ${offset.lastProcessedTimestamp}`);
  } else {
    console.log(`✗ Offset file still not found`);
  }
  
  // Cleanup
  await EventLogManager.stopConsumer(agentId);
  if (fs.existsSync(msgPath)) {
    await fs.remove(msgPath);
  }
  console.log(`\n✓ Test complete`);
  process.exit(0);
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
