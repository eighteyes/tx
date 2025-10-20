const fs = require('fs-extra');
const path = require('path');

console.log('=== Cross-Mesh Routing Debug ===\n');

// Manually test the routing logic
const mesh = 'test-echo';
const to = 'core';
const file = 'task-complete-vp1tgc.md';

console.log('Input:');
console.log(`  mesh: ${mesh}`);
console.log(`  to: ${to}`);
console.log(`  file: ${file}`);
console.log('');

// Test the routing logic from the updated code
let destMesh = mesh;
let destAgent = to;
let isCrossMesh = false;

console.log('Step 1: Check if to.includes("/"): ', to.includes('/'));

if (to.includes('/')) {
  console.log('  → Using explicit format: destMesh/destAgent');
  [destMesh, destAgent] = to.split('/');
  isCrossMesh = destMesh !== mesh;
} else {
  console.log('  → Checking if to is a known mesh...');
  const possibleMeshPath = path.join('.ai/tx/mesh', to);
  console.log(`    possibleMeshPath: ${possibleMeshPath}`);
  console.log(`    exists: ${fs.existsSync(possibleMeshPath)}`);

  if (fs.existsSync(possibleMeshPath)) {
    console.log(`  → Found mesh: ${to}`);
    destMesh = to;
    destAgent = 'core';
    isCrossMesh = true;
  }
}

console.log('');
console.log('Step 2: Resolved routing:');
console.log(`  destMesh: ${destMesh}`);
console.log(`  destAgent: ${destAgent}`);
console.log(`  isCrossMesh: ${isCrossMesh}`);
console.log('');

// Validate destination mesh
const destMeshDir = path.join('.ai/tx/mesh', destMesh);
console.log('Step 3: Validate destination mesh:');
console.log(`  destMeshDir: ${destMeshDir}`);
console.log(`  exists: ${fs.existsSync(destMeshDir)}`);
console.log('');

// Check agent directory
const destAgentDir = path.join(destMeshDir, 'agents', destAgent, 'msgs', 'inbox');
console.log('Step 4: Destination agent inbox:');
console.log(`  destAgentDir: ${destAgentDir}`);
console.log(`  exists: ${fs.existsSync(destAgentDir)}`);

// Check agent directory structure
const agentPath = path.join(destMeshDir, 'agents', destAgent);
const msgsPath = path.join(agentPath, 'msgs');
console.log('');
console.log('Step 5: Check directory structure:');
console.log(`  agentPath (${agentPath}): ${fs.existsSync(agentPath)}`);
console.log(`  msgsPath (${msgsPath}): ${fs.existsSync(msgsPath)}`);

if (fs.existsSync(agentPath)) {
  console.log('  Contents of agent path:', fs.readdirSync(agentPath));
}
if (fs.existsSync(msgsPath)) {
  console.log('  Contents of msgs path:', fs.readdirSync(msgsPath));
}

console.log('');
console.log('Step 6: Test path resolution:');
const testDestAgentDir = path.join(destMeshDir, 'agents', destAgent, 'msgs', 'inbox');
console.log(`  Full path: ${testDestAgentDir}`);

// Try to ensure the directory
try {
  fs.ensureDirSync(testDestAgentDir);
  console.log('  ✓ Successfully ensured directory');
} catch (e) {
  console.log(`  ✗ Error ensuring directory: ${e.message}`);
}

console.log('');
console.log('Expected outcome:');
console.log(`  Message should move from:`);
console.log(`    .ai/tx/mesh/test-echo/agents/test-echo-hfcp/msgs/outbox/${file}`);
console.log(`  To:`);
console.log(`    .ai/tx/mesh/core/agents/core/msgs/inbox/${file}`);
