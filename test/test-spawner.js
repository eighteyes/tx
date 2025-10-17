const { Spawner } = require('../lib/spawner');
const { SessionManager } = require('../lib/session-manager');
const { PromptBuilder } = require('../lib/prompt-builder');
const fs = require('fs-extra');

async function testSpawning() {
  console.log('=== Spawner Tests ===\n');

  // Test 1: Prompt Building
  console.log('Test 1: Building Prompt');
  try {
    // Initialize test mesh directories first
    const dirs = [
      '.ai/tx/mesh/test-mesh/msgs/inbox',
      '.ai/tx/mesh/test-mesh/msgs/next',
      '.ai/tx/mesh/test-mesh/msgs/active',
      '.ai/tx/mesh/test-mesh/msgs/complete'
    ];
    dirs.forEach(dir => fs.ensureDirSync(dir));

    // Create test state
    fs.writeJsonSync('.ai/tx/mesh/test-mesh/state.json', {
      mesh: 'test-mesh',
      status: 'active',
      workflow: ['test-mesh'],
      workflow_position: 0,
      current_agent: 'test-mesh'
    });

    const prompt = await PromptBuilder.build('test-mesh');
    console.log('✓ Prompt built, length:', prompt.length);
    console.log('✓ Prompt preview:', prompt.substring(0, 200) + '...');

    // Cleanup
    fs.removeSync('.ai/tx/mesh/test-mesh');
  } catch (error) {
    console.log('✗ Failed:', error.message);
  }

  // Test 2: Session Management (Mock Mode)
  console.log('\nTest 2: Session Management');
  try {
    // In mock mode, session creation should work
    process.env.MOCK_MODE = 'true';

    const created = await SessionManager.createSession('test-session');
    if (created) {
      console.log('✓ Mock session created');

      // In mock mode, hasSession won't actually find tmux session
      const hasSession = SessionManager.hasSession('test-session');
      console.log('✓ Session check completed:', hasSession ? 'exists' : 'mock mode');

      const killed = SessionManager.killSession('test-session');
      console.log('✓ Session cleanup completed');
    }
  } catch (error) {
    console.log('✗ Failed:', error.message);
  }

  // Test 3: Configuration Loading
  console.log('\nTest 3: Mesh Configuration');
  try {
    const { MeshConfig } = require('../lib/mesh-config');

    // Test loading existing config
    const coreConfig = MeshConfig.load('core');
    console.log('✓ Core config loaded:', coreConfig.name);
    console.log('✓ Config type:', coreConfig.type);
    console.log('✓ Agents:', coreConfig.agents.length);

    // Test default config
    const testConfig = MeshConfig.load('non-existent-mesh');
    console.log('✓ Default config generated:', testConfig.name);

    // Test config validation
    const validation = MeshConfig.validateConfig(coreConfig);
    console.log('✓ Config validation:', validation.valid ? 'valid' : 'invalid');
  } catch (error) {
    console.log('✗ Failed:', error.message);
  }

  // Test 4: Full Mesh Spawn (Mock Mode)
  console.log('\nTest 4: Full Mesh Spawn (Mock Mode)');
  try {
    process.env.MOCK_MODE = 'true';

    const spawned = await Spawner.spawnMesh('test-spawn-mesh');
    console.log('✓ Mock mesh spawn:', spawned ? 'success' : 'failed');

    // Check that directories were created
    const meshDir = '.ai/tx/mesh/test-spawn-mesh';
    if (fs.existsSync(meshDir)) {
      console.log('✓ Mesh directories created');

      // Check state file
      const state = fs.readJsonSync(`${meshDir}/state.json`);
      console.log('✓ State initialized:', state.mesh);

      // Check prompt storage
      const promptPath = '.ai/tx/prompts/test-spawn-mesh.md';
      if (fs.existsSync(promptPath)) {
        console.log('✓ Prompt stored for retrieval');
        fs.removeSync(promptPath);
      }

      // Cleanup
      fs.removeSync(meshDir);
    }
  } catch (error) {
    console.log('✗ Failed:', error.message);
  }

  // Test 5: List Sessions
  console.log('\nTest 5: List Sessions');
  try {
    const sessions = SessionManager.listSessions();
    console.log('✓ Sessions listed:', sessions.length, 'session(s)');
    if (sessions.length > 0) {
      console.log('  Sessions:', sessions.join(', '));
    }
  } catch (error) {
    console.log('✗ Failed:', error.message);
  }

  console.log('\n=== Tests Complete ===');
}

testSpawning();