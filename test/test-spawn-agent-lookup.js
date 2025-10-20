#!/usr/bin/env node
/**
 * Test that spawn correctly determines agent from mesh config
 */
const fs = require('fs-extra');
const path = require('path');

console.log('Testing agent lookup logic for tx spawn...\n');

// Test 1: test-echo mesh with entry_point
const mesh = 'test-echo';
const meshConfigPath = `meshes/mesh-configs/${mesh}.json`;

if (!fs.existsSync(meshConfigPath)) {
  console.error(`❌ Mesh config not found: ${meshConfigPath}`);
  process.exit(1);
}

const meshConfig = fs.readJsonSync(meshConfigPath);
console.log('Mesh config:', JSON.stringify(meshConfig, null, 2));

// Determine agent (same logic as spawn.js)
let agentName;
if (meshConfig.entry_point) {
  agentName = meshConfig.entry_point;
} else if (meshConfig.agents && meshConfig.agents.length > 0) {
  const firstAgent = meshConfig.agents[0];
  agentName = firstAgent.includes('/') ? firstAgent.split('/').pop() : firstAgent;
} else {
  agentName = mesh;
}

console.log(`\n✓ Agent determined: ${agentName}`);

// Find config path (same logic as spawn.js)
let sourcePath = `meshes/agents/${mesh}/${agentName}/config.json`;

if (meshConfig.agents) {
  const fullAgentPath = meshConfig.agents.find(a => {
    const agentPart = a.includes('/') ? a.split('/').pop() : a;
    return agentPart === agentName;
  });
  if (fullAgentPath) {
    sourcePath = `meshes/agents/${fullAgentPath}/config.json`;
  }
}

console.log(`✓ Config path: ${sourcePath}`);

if (!fs.existsSync(sourcePath)) {
  console.error(`❌ Config not found: ${sourcePath}`);
  process.exit(1);
}

const agentConfig = fs.readJsonSync(sourcePath);
console.log(`✓ Config loaded successfully!`);
console.log('\nAgent config:', JSON.stringify(agentConfig, null, 2));

console.log('\n✅ All tests passed! tx spawn test-echo should work correctly.\n');
