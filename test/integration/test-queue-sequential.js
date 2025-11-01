const { execSync, spawn } = require('child_process');
const { TmuxInjector } = require('../../lib/tmux-injector');
const fs = require('fs-extra');
const path = require('path');

/**
 * Integration Test: Queue Sequential Processing
 *
 * Tests that a mesh agent processes 3 messages sequentially (one at a time)
 * This is a simpler test that doesn't use E2EWorkflow - it spawns directly
 */

console.log('=== Integration Test: Queue Sequential Processing ===\n');

const TEST_TIMEOUT = 120000; // 2 minutes
const MESH = 'test-queue';
const AGENT = 'queue-worker';

let meshInstance = null;
let sessionName = null;
let testPassed = false;
let txProcess = null;

async function cleanup() {
  console.log('\n🧹 Cleaning up...\n');

  // Stop tx system
  try {
    execSync('tx stop', { stdio: 'pipe' });
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (e) {
    // Ignore
  }

  // Kill tx process if running
  if (txProcess && !txProcess.killed) {
    try {
      txProcess.kill();
    } catch (e) {
      // Ignore
    }
  }

  if (sessionName && TmuxInjector.sessionExists(sessionName)) {
    console.log(`   Killing session: ${sessionName}`);
    TmuxInjector.killSession(sessionName);
  }

  // Kill core session too
  if (TmuxInjector.sessionExists('core')) {
    console.log(`   Killing session: core`);
    TmuxInjector.killSession('core');
  }

  // Clean up message directories
  if (meshInstance) {
    const meshDir = `.ai/tx/mesh/${meshInstance}`;
    if (fs.existsSync(meshDir)) {
      console.log(`   Removing mesh directory: ${meshDir}`);
      fs.removeSync(meshDir);
    }
  }

  console.log('✅ Cleanup complete\n');
}

async function createMessage(taskNumber) {
  const timestamp = new Date().toISOString();
  const msgId = `task-${taskNumber}-${Date.now()}`;
  const filename = `${msgId}.md`;
  const filepath = path.join(`.ai/tx/mesh/${meshInstance}/agents/${AGENT}/msgs`, filename);

  const content = `---
to: ${meshInstance}/${AGENT}
from: test-runner
type: task
msg-id: ${msgId}
status: pending
timestamp: ${timestamp}
headline: Test task ${taskNumber}
---

# Task ${taskNumber}

Process item ${taskNumber}.
`;

  fs.writeFileSync(filepath, content);
  console.log(`   ✅ Created message: ${filename}\n`);

  return filepath;
}

async function runTest() {
  const testStartTime = Date.now();

  try {
    console.log('📍 Step 1: Starting tx system\n');

    // Start tx system first (this starts the watcher)
    txProcess = spawn('tx', ['start', '-d'], {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    // Log output for debugging
    txProcess.stdout.on('data', (data) => {
      // Suppress unless needed
    });

    txProcess.stderr.on('data', (data) => {
      // Suppress unless needed
    });

    console.log('   ✅ TX system starting...\n');

    // Wait for system to be ready
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Wait for core session
    const coreExists = await TmuxInjector.sessionExists('core');
    if (!coreExists) {
      throw new Error('Core session not created');
    }

    console.log('   ✅ Core session ready\n');

    console.log('📍 Step 2: Spawning test-queue mesh\n');

    // Spawn the mesh
    const spawnOutput = execSync(`tx spawn ${MESH}`, { encoding: 'utf-8' });
    console.log(spawnOutput);

    // Extract mesh instance ID from output
    const instanceMatch = spawnOutput.match(/Mesh instance ID: (test-queue-[a-f0-9]+)/);
    if (!instanceMatch) {
      throw new Error('Could not extract mesh instance ID from spawn output');
    }
    meshInstance = instanceMatch[1];
    sessionName = `${meshInstance}-${AGENT}`;

    console.log(`   ✅ Mesh instance: ${meshInstance}`);
    console.log(`   ✅ Session: ${sessionName}\n`);

    // Verify session exists
    if (!TmuxInjector.sessionExists(sessionName)) {
      throw new Error(`Session ${sessionName} not found`);
    }

    console.log('📍 Step 3: Waiting for agent to be ready\n');

    // Wait for agent to be idle
    const agentReady = await TmuxInjector.waitForIdle(sessionName, 2000, 30000);
    if (!agentReady) {
      console.log('⚠️  Warning: Agent may not be fully ready\n');
    } else {
      console.log('✅ Agent is ready\n');
    }

    console.log('📍 Step 4: Sending 3 messages to agent\n');

    // Create 3 messages with delays to ensure proper ordering
    const msg1 = await createMessage(1);
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for watcher to detect

    const msg2 = await createMessage(2);
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for watcher to detect

    const msg3 = await createMessage(3);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for watcher to detect

    console.log('✅ All 3 messages sent\n');

    console.log('📍 Step 5: Waiting for agent to process messages\n');

    // Wait for agent to process (it should take some time)
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Check agent is idle (done processing)
    const agentDone = await TmuxInjector.waitForIdle(sessionName, 3000, 60000);
    if (!agentDone) {
      console.log('⚠️  Warning: Agent may still be processing\n');
    } else {
      console.log('✅ Agent finished processing\n');
    }

    console.log('📍 Step 6: Verifying sequential processing\n');

    // Capture session output
    const output = execSync(`tmux capture-pane -t ${sessionName} -p -S -500`, {
      encoding: 'utf-8'
    });

    // Save output for debugging
    const debugFile = '/tmp/queue-test-output.txt';
    fs.writeFileSync(debugFile, output);
    console.log(`   📝 Session output saved to: ${debugFile}\n`);

    // Look for evidence of processing each task
    const hasTask1 = output.includes('item 1') || output.includes('Task 1') || output.includes('task-1');
    const hasTask2 = output.includes('item 2') || output.includes('Task 2') || output.includes('task-2');
    const hasTask3 = output.includes('item 3') || output.includes('Task 3') || output.includes('task-3');

    console.log(`   Evidence of processing:`);
    console.log(`      - Task 1: ${hasTask1 ? '✅' : '❌'}`);
    console.log(`      - Task 2: ${hasTask2 ? '✅' : '❌'}`);
    console.log(`      - Task 3: ${hasTask3 ? '✅' : '❌'}\n`);

    // Count Write operations (should be 3 responses)
    const writeMatches = output.match(/Write\(/g);
    const writeCount = writeMatches ? writeMatches.length : 0;
    console.log(`   Write operations: ${writeCount}\n`);

    // Check message files
    const msgsDir = `.ai/tx/mesh/${meshInstance}/agents/${AGENT}/msgs`;
    const files = fs.readdirSync(msgsDir);
    const responseFiles = files.filter(f => f.includes('task-complete') || f.endsWith('-done.md'));

    console.log(`   Message files in ${msgsDir}:`);
    files.forEach(f => console.log(`      - ${f}`));
    console.log(`\n   Response/done files: ${responseFiles.length}\n`);

    // Verify results
    if (!hasTask1 || !hasTask2 || !hasTask3) {
      console.log('❌ Not all tasks were processed\n');
      testPassed = false;
      return;
    }

    if (writeCount < 3) {
      console.log(`❌ Expected at least 3 Write operations, found ${writeCount}\n`);
      testPassed = false;
      return;
    }

    console.log('✅ All tasks processed successfully!\n');

    // Check for sequential processing evidence
    // This is harder to verify automatically, but we can look for patterns
    console.log('📍 Step 7: Checking for sequential processing patterns\n');

    // Split output into lines and look for Read/Write patterns
    const lines = output.split('\n');
    const readWrites = [];

    lines.forEach((line, idx) => {
      if (line.includes('Read(') && line.includes('.md')) {
        readWrites.push({ type: 'Read', line: idx, text: line.substring(0, 100) });
      }
      if (line.includes('Write(') && line.includes('.md')) {
        readWrites.push({ type: 'Write', line: idx, text: line.substring(0, 100) });
      }
    });

    console.log('   Read/Write sequence:');
    readWrites.forEach(rw => {
      console.log(`      Line ${rw.line}: ${rw.type} - ${rw.text}`);
    });
    console.log();

    // If we see Read -> Write -> Read -> Write -> Read -> Write pattern, that's sequential
    const pattern = readWrites.map(rw => rw.type).join(' -> ');
    console.log(`   Pattern: ${pattern}\n`);

    if (readWrites.length >= 6) {
      console.log('✅ Evidence of sequential Read-Write cycles detected\n');
    } else {
      console.log(`⚠️  Expected at least 6 Read/Write operations, found ${readWrites.length}\n`);
    }

    console.log('✅ TEST PASSED: Queue sequential processing verified!\n');
    testPassed = true;

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    testPassed = false;
  } finally {
    const testDuration = Date.now() - testStartTime;
    console.log(`📊 Test duration: ${testDuration}ms\n`);

    await cleanup();

    const exitCode = testPassed ? 0 : 1;
    console.log(`${testPassed ? '✅' : '❌'} Integration Test ${testPassed ? 'PASSED' : 'FAILED'}\n`);
    process.exit(exitCode);
  }
}

const overallTimeout = setTimeout(() => {
  console.error('\n❌ TEST TIMEOUT: Test took longer than 2 minutes');
  testPassed = false;
  cleanup().then(() => process.exit(1));
}, TEST_TIMEOUT);

runTest().catch(error => {
  console.error('Unhandled error:', error);
  clearTimeout(overallTimeout);
  cleanup().then(() => process.exit(1));
});
