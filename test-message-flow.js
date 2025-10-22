#!/usr/bin/env node

/**
 * Test script to trace message flow through the system
 * Tests the complete flow: inbox → next → active → injection
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

// Function to check if a file exists in a directory
function checkFile(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.includes(pattern));
  return files.length > 0 ? files[0] : null;
}

// Function to wait for a condition
async function waitFor(condition, timeout = 10000, interval = 500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return true;
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

// Main test
async function test() {
  console.log('\n🧪 Message Flow Test Starting...\n');

  // 1. Stop any running TX system
  console.log('1️⃣ Stopping TX system...');
  try {
    execSync('tx stop', { stdio: 'pipe' });
  } catch (e) {
    // Ignore errors if not running
  }
  await new Promise(r => setTimeout(r, 2000));

  // 2. Clean up old test meshes
  console.log('2️⃣ Cleaning up old test meshes...');
  execSync('rm -rf .ai/tx/mesh/test-flow-*', { stdio: 'pipe' });

  // 3. Start TX system
  console.log('3️⃣ Starting TX system...');
  execSync('tx start -d', { stdio: 'pipe' });
  await new Promise(r => setTimeout(r, 3000));

  // 4. Spawn test-echo mesh
  console.log('4️⃣ Spawning test-echo mesh...');
  const spawnOutput = execSync('tx spawn test-echo echo', { encoding: 'utf-8' });
  console.log('   Output:', spawnOutput.trim());

  // Extract mesh instance ID from output
  const meshMatch = spawnOutput.match(/Mesh instance ID: (test-echo-[a-f0-9]{6})/);
  if (!meshMatch) {
    console.error('❌ Could not extract mesh instance ID');
    process.exit(1);
  }
  const meshId = meshMatch[1];
  console.log(`   ✅ Mesh spawned: ${meshId}`);

  // Wait for session to be ready
  await new Promise(r => setTimeout(r, 2000));

  // 5. Check directory structure
  console.log('5️⃣ Checking directory structure...');
  const agentDir = `.ai/tx/mesh/${meshId}/agents/echo`;
  const inboxDir = path.join(agentDir, 'msgs', 'inbox');
  const nextDir = path.join(agentDir, 'msgs', 'next');
  const activeDir = path.join(agentDir, 'msgs', 'active');

  console.log(`   Inbox exists: ${fs.existsSync(inboxDir)}`);
  console.log(`   Next exists: ${fs.existsSync(nextDir)}`);
  console.log(`   Active exists: ${fs.existsSync(activeDir)}`);

  // 6. Create a test message directly in inbox
  console.log('6️⃣ Creating test message in inbox...');
  const msgFile = `${Date.now()}-test-task.md`;
  const msgPath = path.join(inboxDir, msgFile);
  const msgContent = `---
from: core/core
to: ${meshId}/echo
type: task
status: start
msg-id: test-001
headline: Test message flow
timestamp: ${new Date().toISOString()}
---

# Test Task

Please echo this message: "Testing message flow!"`;

  fs.ensureDirSync(inboxDir);
  fs.writeFileSync(msgPath, msgContent);
  console.log(`   ✅ Created: ${msgFile}`);

  // 7. Monitor message movement through queues
  console.log('7️⃣ Monitoring message movement...');

  // Check if message moves from inbox → next
  console.log('   Waiting for inbox → next...');
  const movedToNext = await waitFor(() => {
    const inInbox = checkFile(inboxDir, 'test-task');
    const inNext = checkFile(nextDir, 'test-task');
    if (!inInbox && inNext) {
      console.log(`     ✅ Moved to next: ${inNext}`);
      return true;
    }
    return false;
  }, 5000, 200);

  if (!movedToNext) {
    console.log('     ❌ Message stuck in inbox!');
    console.log('     Inbox contents:', fs.readdirSync(inboxDir));
  }

  // Check if message moves from next → active
  console.log('   Waiting for next → active...');
  const movedToActive = await waitFor(() => {
    const inNext = checkFile(nextDir, 'test-task');
    const inActive = checkFile(activeDir, 'test-task');
    if (!inNext && inActive) {
      console.log(`     ✅ Moved to active: ${inActive}`);
      return true;
    }
    return false;
  }, 5000, 200);

  if (!movedToActive) {
    console.log('     ❌ Message stuck in next!');
    console.log('     Next contents:', fs.readdirSync(nextDir));
  }

  // 8. Check tmux session for injection evidence
  console.log('8️⃣ Checking tmux session for injection...');
  await new Promise(r => setTimeout(r, 2000)); // Give time for injection

  const sessionName = `${meshId}-echo`;
  try {
    const tmuxOutput = execSync(`tmux capture-pane -t ${sessionName} -p`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    });

    // Look for evidence of file reading
    if (tmuxOutput.includes('Read tool') && tmuxOutput.includes('test-task')) {
      console.log('   ✅ Message was injected and read by agent!');

      // Show relevant part of output
      const lines = tmuxOutput.split('\n');
      const relevantLines = lines.filter(l =>
        l.includes('Read') ||
        l.includes('test-task') ||
        l.includes('Testing message flow')
      ).slice(0, 5);

      if (relevantLines.length > 0) {
        console.log('\n   Agent activity:');
        relevantLines.forEach(l => console.log('     ', l.trim()));
      }
    } else {
      console.log('   ❌ No evidence of message injection in tmux session');
      console.log('   Last 10 lines of session:');
      const lastLines = tmuxOutput.split('\n').slice(-10);
      lastLines.forEach(l => console.log('     ', l));
    }
  } catch (e) {
    console.log(`   ❌ Could not capture tmux session: ${e.message}`);
  }

  // 9. Check recent logs
  console.log('\n9️⃣ Recent queue/watcher logs:');
  try {
    const logs = execSync(
      `tail -20 .ai/tx/logs/debug.jsonl | jq -r 'select(.component == "queue" or .component == "watcher") | "[\\(.component)] \\(.message)"' | tail -10`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    console.log(logs);
  } catch (e) {
    console.log('   Could not read logs');
  }

  // Cleanup
  console.log('\n🧹 Cleaning up...');
  execSync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`, { stdio: 'pipe' });

  console.log('\n✅ Test complete!\n');
}

// Run the test
test().catch(console.error);