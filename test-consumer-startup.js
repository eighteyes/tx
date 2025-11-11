#!/usr/bin/env node
const { EventLogManager } = require('./lib/event-log-manager');
const fs = require('fs-extra');

async function test() {
  console.log('Testing consumer startup for spawned agent...\n');
  
  // Enable system
  EventLogManager.enable();
  console.log('✓ EventLogManager enabled\n');
  
  // Start consumer for a test agent (simulating what spawn does)
  const agentId = 'test-echo-abc123/echo';
  console.log(`Starting consumer for: ${agentId}`);
  
  try {
    await EventLogManager.startConsumer(agentId);
    console.log('✓ startConsumer() call completed\n');
    
    // Wait a bit for consumer to initialize
    await new Promise(r => setTimeout(r, 2000));
    
    // Check if offset file was created
    const offsetFile = `.ai/tx/state/offsets/${agentId.replace(/\//g, '-')}.json`;
    if (fs.existsSync(offsetFile)) {
      const offset = await fs.readJson(offsetFile);
      console.log(`✓ Offset file created: ${offsetFile}`);
      console.log(`  Last processed: ${offset.lastProcessedTimestamp}`);
    } else {
      console.log(`✗ Offset file NOT found: ${offsetFile}`);
    }
    
    // Check if consumer is in the active list
    const status = EventLogManager.getStatus();
    console.log(`\nActive consumers: ${status.activeConsumers}`);
    console.log('Consumer list:', Object.keys(status.consumers));
    
    if (status.consumers[agentId]) {
      console.log(`\n✓ Consumer for ${agentId} is active`);
      console.log('  Status:', JSON.stringify(status.consumers[agentId], null, 2));
    } else {
      console.log(`\n✗ Consumer for ${agentId} NOT in active list!`);
    }
    
    // Cleanup
    await EventLogManager.stopConsumer(agentId);
    console.log(`\n✓ Test complete`);
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
    console.error(error.stack);
  }
  
  process.exit(0);
}

test();
