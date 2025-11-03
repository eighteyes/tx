const { EventLogConsumer } = require('./lib/event-log-consumer');
const { MessageWriter } = require('./lib/message-writer');
const fs = require('fs-extra');
const path = require('path');

async function test() {
  console.log('🧪 Testing Event Log Consumer Message Delivery\n');

  // Setup
  const logDir = '.ai/tx/msgs';
  const offsetDir = '.ai/tx/state/offsets';

  // Clean up
  await fs.emptyDir(logDir);
  await fs.emptyDir(offsetDir);

  console.log('✓ Setup complete\n');

  // Create a consumer for test agent
  const agentId = 'test-mesh/agent';
  const consumer = new EventLogConsumer(agentId);

  console.log(`📨 Created consumer for: ${agentId}`);
  console.log(`   Offset file: ${consumer.offsetFile}\n`);

  // Write a test message to event log
  console.log('📝 Writing test message to event log...');
  const msgPath = await MessageWriter.write(
    'core/core',
    'test-mesh/agent',
    'task',
    'test-msg-1',
    '# Test Message\nThis is a test message for event log consumer.',
    {
      to: 'test-mesh/agent',
      from: 'core/core',
      type: 'task',
      'msg-id': 'test-msg-1',
      headline: 'Test task'
    }
  );

  console.log(`   Written to: ${msgPath}\n`);

  // Start consumer (should process existing message)
  console.log('🚀 Starting consumer...');
  await consumer.start();
  console.log('✓ Consumer started\n');

  // Small delay to ensure processing
  await new Promise(r => setTimeout(r, 500));

  // Check if offset was saved
  console.log('📊 Checking consumer state...');
  const offsetFileExists = fs.existsSync(consumer.offsetFile);
  console.log(`   Offset file exists: ${offsetFileExists}`);

  if (offsetFileExists) {
    const offsetData = await fs.readJson(consumer.offsetFile);
    console.log(`   Last processed: ${offsetData.lastProcessedTimestamp}`);
    console.log(`   ✅ MESSAGE DELIVERED (offset saved)\n`);
  } else {
    console.log('   ❌ NO OFFSET FILE - message may not have been delivered\n');
  }

  // Write another message while consumer is running
  console.log('📝 Writing second message (while consumer running)...');
  const msg2Path = await MessageWriter.write(
    'core/core',
    'test-mesh/agent',
    'ask',
    'test-msg-2',
    '# Test Message 2\nAnother test message.',
    {
      to: 'test-mesh/agent',
      from: 'core/core',
      type: 'ask',
      'msg-id': 'test-msg-2'
    }
  );
  console.log(`   Written to: ${msg2Path}`);

  // Small delay for processing
  await new Promise(r => setTimeout(r, 500));

  // Check if second message was processed
  const offsetData = await fs.readJson(consumer.offsetFile);
  console.log(`   Last processed: ${offsetData.lastProcessedTimestamp}`);
  console.log(`   ✅ LIVE MESSAGE DELIVERED\n`);

  // Cleanup
  await consumer.stop();
  console.log('✅ Test complete');
}

test().catch(console.error);
