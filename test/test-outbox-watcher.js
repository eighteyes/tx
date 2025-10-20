const { Watcher } = require('../lib/watcher');
const { Queue } = require('../lib/queue');
const { EventBus } = require('../lib/event-bus');
const fs = require('fs-extra');
const path = require('path');

console.log('=== Outbox Watcher Tests ===\n');

async function testOutboxWatcher() {
  const testMesh = 'test-outbox-watcher';
  const testAgent = 'sender';
  const meshDir = `.ai/tx/mesh/${testMesh}`;

  // Setup
  fs.ensureDirSync(`${meshDir}/agents/${testAgent}/msgs/outbox`);
  fs.writeJsonSync(`${meshDir}/state.json`, {
    mesh: testMesh,
    status: 'active',
    current_agent: testAgent
  });

  // Track events
  let outboxEventsFired = [];
  EventBus.on('file:agent-outbox:new', (data) => {
    outboxEventsFired.push({ event: 'file:agent-outbox:new', data });
    console.log('✓ Event fired: file:agent-outbox:new', { agent: data.agent, file: data.file });
  });

  console.log('Initializing queue...');
  Queue.init();

  console.log('Starting watcher...');
  Watcher.start();

  // Wait for ready
  await new Promise(resolve => {
    if (Watcher.watcher.listenerCount('ready') === 0) {
      Watcher.watcher.once('ready', resolve);
    } else {
      setTimeout(resolve, 100);
    }
  });

  console.log('✓ Watcher ready!\n');

  // Create outbox message
  console.log('Creating agent outbox message...');
  const timestamp = new Date().toISOString();
  const responseMsg = `---
from: ${testMesh}/${testAgent}
to: core
type: task-complete
status: complete
timestamp: ${timestamp}
---

# Response from ${testAgent}

Task completed successfully.`;

  const outboxDir = `${meshDir}/agents/${testAgent}/msgs/outbox`;
  const filename = `${Date.now()}-response.md`;
  const filepath = path.join(outboxDir, filename);

  fs.writeFileSync(filepath, responseMsg);
  console.log(`✓ Created: ${filepath}\n`);

  // Wait for detection
  console.log('Waiting for watcher to detect outbox file...');
  let detected = false;
  let attempts = 0;

  await new Promise(resolve => {
    const interval = setInterval(() => {
      attempts++;
      if (outboxEventsFired.length > 0) {
        detected = true;
        clearInterval(interval);
        resolve();
      }
      if (attempts >= 20) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });

  if (detected) {
    console.log('✓ Watcher detected outbox file successfully!');
    console.log(`  Events captured: ${outboxEventsFired.length}`);
  } else {
    console.log('✗ Watcher did NOT detect outbox file after 2000ms');
    console.log('  Events captured: 0');
  }

  // Cleanup
  Watcher.stop();
  fs.removeSync(meshDir);
  console.log('\n=== Test Complete ===');
  process.exit(detected ? 0 : 1);
}

testOutboxWatcher();
