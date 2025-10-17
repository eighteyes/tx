const { Watcher } = require('../lib/watcher');
const { Message } = require('../lib/message');
const { Queue } = require('../lib/queue');
const fs = require('fs-extra');

console.log('=== Watcher Tests ===\n');

async function testWatcher() {
  // Initialize test mesh
  const testMesh = 'test-watcher';
  const meshDir = `.ai/tx/mesh/${testMesh}`;

  fs.ensureDirSync(`${meshDir}/msgs/inbox`);
  fs.ensureDirSync(`${meshDir}/msgs/next`);
  fs.ensureDirSync(`${meshDir}/msgs/active`);
  fs.ensureDirSync(`${meshDir}/msgs/complete`);
  fs.writeJsonSync(`${meshDir}/state.json`, {
    mesh: testMesh,
    status: 'active',
    current_agent: testMesh
  });

  // Initialize queue to listen for events
  console.log('Initializing queue listener...');
  Queue.init();

  // Start watcher
  console.log('Starting watcher...');
  Watcher.start();

  // Test file detection
  console.log('Sending test message...');
  Message.send(testMesh, 'Watcher test', 'Testing file detection');

  // Wait for watcher to process
  setTimeout(() => {
    const status = Watcher.getWatcherStatus();
    console.log('Watcher status:', status);

    // Check if message was processed
    const nextFiles = fs.readdirSync(`${meshDir}/msgs/next`);
    if (nextFiles.length > 0) {
      console.log('✓ Watcher detected and processed message');
    } else {
      console.log('✗ Message not processed');
    }

    // Stop watcher
    Watcher.stop();
    console.log('Watcher stopped');

    // Cleanup
    fs.removeSync(meshDir);
    console.log('\n=== Test Complete ===');
    process.exit(0);

  }, 2000);
}

testWatcher();