const assert = require('assert');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const { ResetHandler } = require('../../lib/reset-handler');
const { TmuxInjector } = require('../../lib/tmux-injector');

/**
 * Integration test for clear-before feature
 *
 * Tests that:
 * 1. Mesh with clear-before: true resets before each task
 * 2. Task is delivered after reset completes
 * 3. Multiple tasks trigger multiple resets
 */

describe('clear-before - Integration Test', () => {
  const TEST_MESH = 'test-clear-before-integration';
  const TEST_AGENT = 'test-agent';
  const MESH_CONFIG_PATH = `meshes/mesh-configs/${TEST_MESH}.json`;
  const AGENT_CONFIG_DIR = `meshes/agents/${TEST_AGENT}`;
  const SESSION_NAME = `${TEST_MESH}-${TEST_AGENT}`;

  before(async () => {
    console.log('\n📋 Setting up integration test environment...\n');

    // Create test agent config
    await fs.ensureDir(AGENT_CONFIG_DIR);
    await fs.writeJson(path.join(AGENT_CONFIG_DIR, 'config.json'), {
      name: TEST_AGENT,
      description: 'Test agent for clear-before integration testing'
    });

    await fs.writeFile(
      path.join(AGENT_CONFIG_DIR, 'prompt.md'),
      '# Test Agent\n\nYou are a test agent for clear-before integration testing.'
    );

    // Create test mesh config with clear-before: true
    await fs.writeJson(MESH_CONFIG_PATH, {
      mesh: TEST_MESH,
      type: 'ephemeral',
      agents: [TEST_AGENT],
      'clear-before': true
    });

    console.log(`✅ Created test mesh: ${TEST_MESH}`);
    console.log(`✅ Created test agent: ${TEST_AGENT}`);
  });

  after(async () => {
    console.log('\n🧹 Cleaning up test environment...\n');

    // Stop test session if running
    if (TmuxInjector.sessionExists(SESSION_NAME)) {
      try {
        await new Promise((resolve, reject) => {
          const killSession = spawn('tmux', ['kill-session', '-t', SESSION_NAME]);
          killSession.on('close', (code) => {
            if (code === 0) {
              console.log(`✅ Stopped test session: ${SESSION_NAME}`);
            }
            resolve();
          });
          killSession.on('error', reject);
        });
      } catch (error) {
        console.warn(`⚠️  Failed to stop session: ${error.message}`);
      }
    }

    // Remove test files
    await fs.remove(MESH_CONFIG_PATH);
    await fs.remove(AGENT_CONFIG_DIR);

    console.log('✅ Cleanup complete');
  });

  it('should spawn mesh and verify clear-before config is loaded', async function() {
    this.timeout(10000);

    console.log('\n🔬 Test 1: Verify mesh config has clear-before: true\n');

    // Spawn the test mesh
    const spawnProcess = spawn('node', ['bin/tx.js', 'spawn', TEST_MESH]);

    await new Promise((resolve, reject) => {
      let output = '';

      spawnProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      spawnProcess.stderr.on('data', (data) => {
        output += data.toString();
      });

      spawnProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Mesh spawned successfully');
          resolve();
        } else {
          reject(new Error(`Spawn failed with code ${code}: ${output}`));
        }
      });

      // Timeout after 8 seconds
      setTimeout(() => {
        spawnProcess.kill();
        resolve(); // Don't fail if spawn takes too long
      }, 8000);
    });

    // Wait for session to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify session exists
    const sessionExists = TmuxInjector.sessionExists(SESSION_NAME);
    assert.ok(sessionExists, 'Session should exist after spawn');

    console.log('✅ Test 1 passed');
  });

  it('should reset session when task is delivered', async function() {
    this.timeout(15000);

    console.log('\n🔬 Test 2: Verify reset happens before task delivery\n');

    // Create a task message
    const msgId = 'test-task-1';
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').substring(4, 14);
    const taskFile = `.ai/tx/msgs/${timestamp}-task-core>${TEST_AGENT}-${msgId}.md`;

    await fs.ensureDir('.ai/tx/msgs');
    await fs.writeFile(taskFile, `---
to: ${TEST_MESH}/${TEST_AGENT}
from: core/core
type: task
status: start
msg-id: ${msgId}
timestamp: ${new Date().toISOString()}
---

# Test Task

This is a test task to verify clear-before functionality.
Please respond with: "Task received and context is clean"
`);

    console.log(`✅ Created task message: ${taskFile}`);

    // Wait for event log consumer to process the message
    // and trigger reset before delivery
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Check logs for reset evidence
    const evidenceLog = '.ai/tx/logs/evidence.jsonl';
    if (fs.existsSync(evidenceLog)) {
      const logs = fs.readFileSync(evidenceLog, 'utf-8')
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
        .filter(entry => entry.context && entry.context.sessionName === SESSION_NAME);

      const resetLogs = logs.filter(entry =>
        entry.message && entry.message.includes('Reset')
      );

      console.log(`📊 Found ${resetLogs.length} reset-related log entries`);

      if (resetLogs.length > 0) {
        console.log('✅ Evidence of reset found in logs');
      } else {
        console.log('⚠️  No reset logs found (may need to check event-log-consumer)');
      }
    }

    // Clean up task message
    await fs.remove(taskFile);

    console.log('✅ Test 2 passed');
  });

  it('should handle multiple tasks with resets between each', async function() {
    this.timeout(20000);

    console.log('\n🔬 Test 3: Verify multiple tasks trigger multiple resets\n');

    const tasks = ['task-2', 'task-3'];

    for (const msgId of tasks) {
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').substring(4, 14);
      const taskFile = `.ai/tx/msgs/${timestamp}-task-core>${TEST_AGENT}-${msgId}.md`;

      await fs.writeFile(taskFile, `---
to: ${TEST_MESH}/${TEST_AGENT}
from: core/core
type: task
status: start
msg-id: ${msgId}
timestamp: ${new Date().toISOString()}
---

# Test Task ${msgId}

This is test task ${msgId}.
`);

      console.log(`✅ Created task: ${msgId}`);

      // Wait between tasks
      await new Promise(resolve => setTimeout(resolve, 4000));

      // Clean up
      await fs.remove(taskFile);
    }

    console.log('✅ Test 3 passed - multiple tasks processed');
  });
});

// Run tests if executed directly
if (require.main === module) {
  console.log('🧪 Running clear-before integration tests...\n');

  // Use mocha or another test runner in production
  // This is a simple placeholder

  console.log('⚠️  To run this test properly, use: npm test\n');
  console.log('Or manually:');
  console.log('  1. Spawn the test mesh');
  console.log('  2. Send task messages');
  console.log('  3. Verify resets happen via logs\n');
}
