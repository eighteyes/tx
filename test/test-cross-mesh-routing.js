const { Watcher } = require('../lib/watcher');
const { Queue } = require('../lib/queue');
const { EventBus } = require('../lib/event-bus');
const fs = require('fs-extra');

console.log('=== Cross-Mesh Routing Tests ===\n');

async function testCrossMeshRouting() {
  const mesh1 = 'mesh-researcher';
  const agent1 = 'researcher';
  const mesh2 = 'mesh-analyzer';
  const agent2 = 'analyzer';

  const meshDir1 = `.ai/tx/mesh/${mesh1}`;
  const meshDir2 = `.ai/tx/mesh/${mesh2}`;

  // Setup both meshes
  fs.ensureDirSync(`${meshDir1}/agents/${agent1}/msgs/outbox`);
  fs.writeJsonSync(`${meshDir1}/state.json`, { mesh: mesh1, current_agent: agent1 });

  fs.ensureDirSync(`${meshDir2}/agents/${agent2}/msgs/active`);
  fs.writeJsonSync(`${meshDir2}/state.json`, { mesh: mesh2, current_agent: agent2 });

  // Setup mesh configs
  fs.ensureDirSync('meshes/mesh-configs');
  fs.writeJsonSync(`meshes/mesh-configs/${mesh1}.json`, { entry_point: agent1 });
  fs.writeJsonSync(`meshes/mesh-configs/${mesh2}.json`, { entry_point: agent2 });

  console.log('Setup:');
  console.log(`  Mesh 1: ${mesh1}/${agent1} (sender)`);
  console.log(`  Mesh 2: ${mesh2}/${agent2} (receiver)\n`);

  Queue.init();
  Watcher.start();

  await new Promise(resolve => {
    if (Watcher.watcher.listenerCount('ready') === 0) {
      Watcher.watcher.once('ready', resolve);
    } else {
      setTimeout(resolve, 100);
    }
  });

  console.log('✓ Watcher Ready!\n');

  // Test 1: Explicit format (to: "mesh/agent")
  console.log('Test 1: Explicit routing format (to: "mesh/agent")');
  const ts1 = new Date().toISOString();
  const msg1 = `---
from: ${mesh1}/${agent1}
to: ${mesh2}/${agent2}
type: task
status: complete
timestamp: ${ts1}
---

# Analysis Complete

Research findings from explicit routing`;

  fs.writeFileSync(`${meshDir1}/agents/${agent1}/msgs/outbox/msg1.md`, msg1);
  console.log(`  Route: ${mesh1}/${agent1}/outbox → ${mesh2}/${agent2}/[queue]`);
  
  await new Promise(resolve => setTimeout(resolve, 800));

  // Check all queues
  const queues = ['inbox', 'next', 'active'];
  let msg1Found = false;
  let msg1Location = '';
  queues.forEach(q => {
    const path = `${meshDir2}/agents/${agent2}/msgs/${q}/msg1.md`;
    if (fs.existsSync(path)) {
      msg1Found = true;
      msg1Location = q;
    }
  });

  console.log(`  Result: ${msg1Found ? `✓ Found in ${msg1Location} queue` : '✗ Not found'}\n`);

  // Test 2: Mesh-only format (to: "mesh")
  console.log('Test 2: Mesh-only routing format (to: "mesh" - uses config)');
  const ts2 = new Date().toISOString();
  const msg2 = `---
from: ${mesh1}/${agent1}
to: ${mesh2}
type: task
status: complete
timestamp: ${ts2}
---

# Full Report

Report using mesh-only routing via config lookup`;

  fs.writeFileSync(`${meshDir1}/agents/${agent1}/msgs/outbox/msg2.md`, msg2);
  console.log(`  Route: ${mesh1}/${agent1}/outbox → ${mesh2} (config lookup) → ${agent2}/[queue]`);
  console.log(`  Config: meshes/mesh-configs/${mesh2}.json → entry_point: "${agent2}"`);
  
  await new Promise(resolve => setTimeout(resolve, 800));

  let msg2Found = false;
  let msg2Location = '';
  queues.forEach(q => {
    const path = `${meshDir2}/agents/${agent2}/msgs/${q}/msg2.md`;
    if (fs.existsSync(path)) {
      msg2Found = true;
      msg2Location = q;
    }
  });

  console.log(`  Result: ${msg2Found ? `✓ Found in ${msg2Location} queue` : '✗ Not found'}\n`);

  // Summary
  const allPassed = msg1Found && msg2Found;
  console.log(`═══════════════════════════════════════════`);
  console.log(`Test Results:`);
  console.log(`  Test 1 (explicit): ${msg1Found ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Test 2 (mesh-config): ${msg2Found ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Overall: ${allPassed ? '✅ ALL PASSED' : '❌ FAILED'}`);
  console.log(`═══════════════════════════════════════════`);

  Watcher.stop();
  fs.removeSync(meshDir1);
  fs.removeSync(meshDir2);
  fs.removeSync('meshes/mesh-configs');

  process.exit(allPassed ? 0 : 1);
}

testCrossMeshRouting();
