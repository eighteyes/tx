const { MessageWriter } = require('./lib/message-writer');
const fs = require('fs-extra');

async function test() {
  try {
    console.log('Testing MessageWriter with dual-write...\n');

    // Clean up test directories
    await fs.remove('.ai/tx/msgs');
    await fs.remove('.ai/tx/mesh/test-mesh');

    // Test dual-write
    const oldPath = '.ai/tx/mesh/test-mesh/agents/test-agent/msgs/test-message.md';
    const eventLogPath = await MessageWriter.write(
      'core/core',
      'test-mesh/test-agent',
      'task',
      'test-123',
      'This is a test message',
      {
        from: 'core/core',
        to: 'test-mesh/test-agent',
        type: 'task',
        'msg-id': 'test-123',
        headline: 'Test Message'
      },
      { dualWrite: true, oldPath }
    );

    console.log('✅ Event log message created:', eventLogPath);

    // Check both locations
    const eventLogExists = await fs.pathExists(eventLogPath);
    const oldPathExists = await fs.pathExists(oldPath);

    console.log('✅ Event log exists:', eventLogExists);
    console.log('✅ Old path exists:', oldPathExists);

    if (eventLogExists && oldPathExists) {
      console.log('\n🎉 DUAL-WRITE SUCCESS!\n');

      // Show file contents
      const eventLogContent = await fs.readFile(eventLogPath, 'utf-8');
      const oldPathContent = await fs.readFile(oldPath, 'utf-8');

      console.log('Event log message:');
      console.log('='.repeat(60));
      console.log(eventLogContent);
      console.log('='.repeat(60));

      console.log('\nOld path message:');
      console.log('='.repeat(60));
      console.log(oldPathContent);
      console.log('='.repeat(60));

      // Verify they're identical
      if (eventLogContent === oldPathContent) {
        console.log('\n✅ Both messages are identical!');
      } else {
        console.log('\n⚠️  Messages differ!');
      }

      // Cleanup
      await fs.remove('.ai/tx/msgs');
      await fs.remove('.ai/tx/mesh/test-mesh');

      console.log('\n✅ Test passed - dual-write working correctly!');
      process.exit(0);
    } else {
      console.log('\n❌ DUAL-WRITE FAILED');
      console.log('Event log exists:', eventLogExists);
      console.log('Old path exists:', oldPathExists);
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test();
