const { EventLogConsumer } = require('./lib/event-log-consumer');
const { MessageWriter } = require('./lib/message-writer');
const fs = require('fs-extra');

async function test() {
  console.log('🧪 Testing Event Log Consumer Message Parsing\n');

  // Setup
  const logDir = '.ai/tx/msgs';
  const offsetDir = '.ai/tx/state/offsets';
  await fs.emptyDir(logDir);
  await fs.emptyDir(offsetDir);

  // Write a test message
  console.log('📝 Writing test message...');
  const msgPath = await MessageWriter.write(
    'core/core',
    'test-mesh/agent',
    'task',
    'test-msg-1',
    '# Test',
    {
      to: 'test-mesh/agent',
      from: 'core/core',
      type: 'task',
      'msg-id': 'test-msg-1'
    }
  );
  console.log(`   Written to: ${msgPath}\n`);

  // Create consumer and manually test parsing
  const consumer = new EventLogConsumer('test-mesh/agent');
  const msg = await consumer.parseMessage(msgPath);

  console.log('📊 Parsed message:');
  console.log(`   to: "${msg.to}"`);
  console.log(`   from: "${msg.from}"`);
  console.log(`   type: "${msg.type}"`);
  console.log(`   timestamp: ${msg.timestamp}`);
  console.log(`   msgId: "${msg.msgId}"\n`);

  console.log('🔍 Testing isForMe():');
  console.log(`   Consumer agentId: "${consumer.agentId}"`);
  console.log(`   isForMe(msg): ${consumer.isForMe(msg)}\n`);

  // Test with different agent ID formats
  const consumer2 = new EventLogConsumer('test-mesh/agent');
  console.log(`   With "test-mesh/agent": ${consumer2.isForMe(msg)}`);

  const consumer3 = new EventLogConsumer('test/agent');
  console.log(`   With "test/agent": ${consumer3.isForMe(msg)}`);
}

test().catch(console.error);
