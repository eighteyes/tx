const { Watcher } = require('../lib/watcher');
const { Message } = require('../lib/message');
const { Queue } = require('../lib/queue');
const fs = require('fs-extra');

console.log('=== Watcher Tests ===\n');

async function testWatcher() {
  // Initialize test mesh
  const testMesh = 'test-watcher';
  const meshDir = `.ai/tx/mesh/${testMesh}`;

  // Initialize mesh structure
  fs.ensureDirSync(`${meshDir}/msgs/inbox`);
  fs.ensureDirSync(`${meshDir}/msgs/next`);
  fs.ensureDirSync(`${meshDir}/msgs/active`);
  fs.ensureDirSync(`${meshDir}/msgs/complete`);

  // Initialize agent structure (new architecture)
  fs.ensureDirSync(`${meshDir}/agents/${testMesh}/msgs/inbox`);
  fs.ensureDirSync(`${meshDir}/agents/${testMesh}/msgs/next`);
  fs.ensureDirSync(`${meshDir}/agents/${testMesh}/msgs/active`);
  fs.ensureDirSync(`${meshDir}/agents/${testMesh}/msgs/complete`);

  fs.writeJsonSync(`${meshDir}/state.json`, {
    mesh: testMesh,
    status: 'active',
    current_agent: testMesh
  });

  // Initialize queue to listen for events
  console.log('Initializing queue listener...');
  Queue.init();

  // Function to check for message processing
  function checkForMessage() {
    // Wait for watcher to process (increased timeout and check periodically)
    let attempts = 0;
    const maxAttempts = 10;
    const checkInterval = setInterval(() => {
      attempts++;
      const status = Watcher.getWatcherStatus();

      // Check if message was processed through the queue pipeline
      // The file moves very quickly: inbox (1ms) → next (100ms) → active (stable)
      // So we check for agent next or agent active (more stable queues)
      const agentNextDir = `${meshDir}/agents/${testMesh}/msgs/next`;
      const agentActiveDir = `${meshDir}/agents/${testMesh}/msgs/active`;

      const nextFiles = fs.existsSync(agentNextDir) ? fs.readdirSync(agentNextDir).filter(f => f.endsWith('.md')) : [];
      const activeFiles = fs.existsSync(agentActiveDir) ? fs.readdirSync(agentActiveDir).filter(f => f.endsWith('.md')) : [];

      if (nextFiles.length > 0 || activeFiles.length > 0) {
        console.log('Watcher status:', status);
        console.log('✓ Watcher detected and routed message to agent queues');
        console.log(`  - Agent next queue: ${nextFiles.length} file(s)`);
        console.log(`  - Agent active queue: ${activeFiles.length} file(s)`);
        clearInterval(checkInterval);

        // Stop watcher
        Watcher.stop();
        console.log('Watcher stopped');

        // Cleanup
        fs.removeSync(meshDir);
        console.log('\n=== Test Complete ===');
        process.exit(0);
      }

      if (attempts >= maxAttempts) {
        console.log('Watcher status:', status);
        console.log('✗ Message not processed after', attempts * 300, 'ms');

        // Debug: check all queues
        const queues = ['inbox', 'next', 'active', 'complete'];
        console.log('Queue status:');
        queues.forEach(q => {
          const dir = `${meshDir}/agents/${testMesh}/msgs/${q}`;
          const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')) : [];
          console.log(`  - ${q}: ${files.length} file(s)`);
        });

        clearInterval(checkInterval);

        // Stop watcher
        Watcher.stop();
        console.log('Watcher stopped');

        // Cleanup
        fs.removeSync(meshDir);
        console.log('\n=== Test Complete ===');
        process.exit(1);
      }
    }, 300);
  }

  // Start watcher
  console.log('Starting watcher...');
  Watcher.start();

  // Wait for watcher to be ready before sending message
  console.log('Waiting for watcher to be ready...');

  // Use a promise-based approach to handle ready event
  const waitForReady = new Promise((resolve) => {
    if (Watcher.watcher.listenerCount('ready') === 0) {
      Watcher.watcher.once('ready', resolve);
    } else {
      // Already ready
      setTimeout(resolve, 100);
    }
  });

  waitForReady.then(() => {
    console.log('Watcher ready!');

    // Test file detection
    console.log('Sending test message...');
    console.log('Try sending a sample task: Message.send(testMesh, "Watcher test", "Testing file detection")\n');
    Message.send(testMesh, 'Watcher test', 'Testing file detection');

    checkForMessage();
  });
}

testWatcher();