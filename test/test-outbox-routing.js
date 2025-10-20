const { Watcher } = require('../lib/watcher');
const { Queue } = require('../lib/queue');
const { EventBus } = require('../lib/event-bus');
const fs = require('fs-extra');
const path = require('path');

console.log('=== Outbox Routing Tests ===\n');

async function testOutboxRouting() {
  const sourceMesh = 'test-outbox-src';
  const sourceAgent = 'sender';
  const destMesh = 'test-outbox-dest';
  const destAgent = 'receiver';

  const meshDirSrc = `.ai/tx/mesh/${sourceMesh}`;
  const meshDirDest = `.ai/tx/mesh/${destMesh}`;

  // Setup source mesh
  fs.ensureDirSync(`${meshDirSrc}/agents/${sourceAgent}/msgs/outbox`);
  fs.writeJsonSync(`${meshDirSrc}/state.json`, { mesh: sourceMesh, current_agent: sourceAgent });

  // Setup destination mesh
  fs.ensureDirSync(`${meshDirDest}/agents/${destAgent}/msgs/inbox`);
  fs.writeJsonSync(`${meshDirDest}/state.json`, { mesh: destMesh, current_agent: destAgent });

  // Setup mesh configs for default agent lookup
  fs.ensureDirSync('meshes/mesh-configs');
  fs.writeJsonSync(`meshes/mesh-configs/${destMesh}.json`, {
    name: destMesh,
    entry_point: destAgent,
    agents: [destAgent]
  });

  // Track routing events
  let routingEvents = [];
  EventBus.on('file:agent-inbox:new', (data) => {
    routingEvents.push({ event: 'file:agent-inbox:new', mesh: data.mesh, agent: data.agent });
    console.log(`✓ Routed to: ${data.mesh}/${data.agent}/inbox`);
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

  // Test 1: Same-mesh agent routing (to: "receiver")
  console.log('Test 1: Same-mesh agent routing...');
  const timestamp1 = new Date().toISOString();
  const msg1 = `---
from: ${sourceMesh}/${sourceAgent}
to: sender
type: task-complete
status: complete
timestamp: ${timestamp1}
---

# Response

Same-mesh routing test`;

  const filepath1 = `${meshDirSrc}/agents/${sourceAgent}/msgs/outbox/msg1.md`;
  fs.writeFileSync(filepath1, msg1);

  // Wait for routing
  await new Promise(resolve => setTimeout(resolve, 500));

  let msg1Routed = fs.existsSync(`${meshDirSrc}/agents/${sourceAgent}/msgs/outbox/msg1.md`) === false;
  if (msg1Routed) {
    console.log('✓ Same-mesh routing working\n');
  } else {
    console.log('✗ Same-mesh routing failed\n');
  }

  // Test 2: Cross-mesh routing (to: "destMesh/destAgent")
  console.log('Test 2: Cross-mesh agent routing...');
  const timestamp2 = new Date().toISOString();
  const msg2 = `---
from: ${sourceMesh}/${sourceAgent}
to: ${destMesh}/${destAgent}
type: task
status: complete
timestamp: ${timestamp2}
---

# Response

Cross-mesh routing test`;

  const filepath2 = `${meshDirSrc}/agents/${sourceAgent}/msgs/outbox/msg2.md`;
  fs.writeFileSync(filepath2, msg2);

  // Wait for routing
  await new Promise(resolve => setTimeout(resolve, 500));

  let msg2Routed = fs.existsSync(`${meshDirDest}/agents/${destAgent}/msgs/inbox/msg2.md`);
  if (msg2Routed) {
    console.log('✓ Cross-mesh routing working\n');
  } else {
    console.log('✗ Cross-mesh routing failed\n');
  }

  // Test 3: Mesh-only routing (to: "destMesh" - uses default agent)
  console.log('Test 3: Mesh-only routing (uses default agent from config)...');
  const timestamp3 = new Date().toISOString();
  const msg3 = `---
from: ${sourceMesh}/${sourceAgent}
to: ${destMesh}
type: task
status: complete
timestamp: ${timestamp3}
---

# Response

Mesh-only routing test`;

  const filepath3 = `${meshDirSrc}/agents/${sourceAgent}/msgs/outbox/msg3.md`;
  fs.writeFileSync(filepath3, msg3);

  // Wait for routing
  await new Promise(resolve => setTimeout(resolve, 500));

  let msg3Routed = fs.existsSync(`${meshDirDest}/agents/${destAgent}/msgs/inbox/msg3.md`);
  if (msg3Routed) {
    console.log('✓ Mesh-only routing working\n');
  } else {
    console.log('✗ Mesh-only routing failed\n');
  }

  // Summary
  console.log('=== Routing Summary ===');
  console.log(`Total routing events fired: ${routingEvents.length}`);
  console.log(`Events: ${routingEvents.map(e => `${e.mesh}/${e.agent}`).join(', ')}`);

  const allPassed = msg1Routed && msg2Routed && msg3Routed;
  console.log(`Overall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);

  // Cleanup
  Watcher.stop();
  fs.removeSync(meshDirSrc);
  fs.removeSync(meshDirDest);
  fs.removeSync('meshes/mesh-configs');

  console.log('\n=== Test Complete ===');
  process.exit(allPassed ? 0 : 1);
}

testOutboxRouting();
