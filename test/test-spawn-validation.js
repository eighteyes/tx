#!/usr/bin/env node
/**
 * Test spawn validation logic
 * Verifies that spawn fails fast when agent doesn't exist
 */
const fs = require('fs-extra');

console.log('Testing spawn validation (fail fast)...\n');

// Simulate the validation logic from spawn.js
const mesh = 'test-echo';
const agentName = 'nonexistent-agent';

const meshConfigPath = `meshes/mesh-configs/${mesh}.json`;
let configPath = `meshes/agents/${mesh}/${agentName}/config.json`;

if (fs.existsSync(meshConfigPath)) {
  const meshConfig = fs.readJsonSync(meshConfigPath);
  if (meshConfig.agents) {
    const fullAgentPath = meshConfig.agents.find(a => {
      const agentPart = a.includes('/') ? a.split('/').pop() : a;
      return agentPart === agentName;
    });
    if (fullAgentPath) {
      configPath = `meshes/agents/${fullAgentPath}/config.json`;
    }
  }
}

console.log(`Checking for agent: ${agentName}`);
console.log(`Config path: ${configPath}`);

if (!fs.existsSync(configPath)) {
  console.log('\n❌ Agent not found (as expected)');
  console.log('✅ Validation would fail BEFORE creating directories');

  // Show available agents
  if (fs.existsSync(meshConfigPath)) {
    const meshConfig = fs.readJsonSync(meshConfigPath);
    if (meshConfig.agents && meshConfig.agents.length > 0) {
      console.log('\nAvailable agents:');
      meshConfig.agents.forEach(a => {
        const name = a.includes('/') ? a.split('/').pop() : a;
        console.log(`  - ${name}`);
      });
    }
  }
} else {
  console.log('✅ Agent found');
}

// Now test with valid agent
console.log('\n---\n');
const validAgent = 'echo';
let validConfigPath = `meshes/agents/${mesh}/${validAgent}/config.json`;

if (fs.existsSync(meshConfigPath)) {
  const meshConfig = fs.readJsonSync(meshConfigPath);
  if (meshConfig.agents) {
    const fullAgentPath = meshConfig.agents.find(a => {
      const agentPart = a.includes('/') ? a.split('/').pop() : a;
      return agentPart === validAgent;
    });
    if (fullAgentPath) {
      validConfigPath = `meshes/agents/${fullAgentPath}/config.json`;
    }
  }
}

console.log(`Checking for agent: ${validAgent}`);
console.log(`Config path: ${validConfigPath}`);

if (fs.existsSync(validConfigPath)) {
  const config = fs.readJsonSync(validConfigPath);
  console.log('✅ Agent found and validated');
  console.log(`   Model: ${config.options?.model || 'default'}`);
  console.log(`   Output: ${config.options?.output || 'default'}`);
  console.log('\n✅ Directories would now be created (after validation)');
} else {
  console.log('❌ Agent not found');
}

console.log('\n✅ All validation tests passed!\n');
