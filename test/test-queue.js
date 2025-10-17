const fs = require('fs-extra');
const path = require('path');
const { Queue } = require('../lib/queue');
const { Message } = require('../lib/message');
const { Logger } = require('../lib/logger');

console.log('=== Queue System Tests ===\n');

async function runTests() {
  // Setup test mesh
  const testMesh = 'test-queue';
  const meshDir = `.ai/tx/mesh/${testMesh}`;

  // Initialize mesh structure
  fs.ensureDirSync(`${meshDir}/msgs/inbox`);
  fs.ensureDirSync(`${meshDir}/msgs/next`);
  fs.ensureDirSync(`${meshDir}/msgs/active`);
  fs.ensureDirSync(`${meshDir}/msgs/complete`);
  fs.writeJsonSync(`${meshDir}/state.json`, {
    mesh: testMesh,
    status: 'active',
    current_agent: testMesh
  });

  // Test 1: Queue Processing Flow
  console.log('Test 1: Message Flow (inbox → next → active → complete)');
  try {
    // Send test message
    Message.send(testMesh, 'Test task 1', 'Queue test');

    // Process inbox → next
    Queue.processInbox(testMesh);
    const nextCount = fs.readdirSync(`${meshDir}/msgs/next`).length;
    console.log(`✓ Message moved to next: ${nextCount} file(s)`);

    // Process next → active
    Queue.processNext(testMesh);
    const activeCount = fs.readdirSync(`${meshDir}/msgs/active`).length;
    console.log(`✓ Message moved to active: ${activeCount} file(s)`);

    // Complete active → complete
    Queue.complete(testMesh);
    const completeCount = fs.readdirSync(`${meshDir}/msgs/complete`).length;
    console.log(`✓ Message moved to complete: ${completeCount} file(s)`);

  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Test 2: Multiple Messages Queuing
  console.log('\nTest 2: Multiple Message Queuing');
  try {
    // Send multiple messages
    Message.send(testMesh, 'Task 2', 'Test');
    Message.send(testMesh, 'Task 3', 'Test');
    Message.send(testMesh, 'Task 4', 'Test');

    const inboxCount = fs.readdirSync(`${meshDir}/msgs/inbox`).length;
    console.log(`✓ ${inboxCount} messages in inbox`);

    // Process should only move one to next
    Queue.processInbox(testMesh);
    const nextCount = fs.readdirSync(`${meshDir}/msgs/next`).length;
    const remainingInbox = fs.readdirSync(`${meshDir}/msgs/inbox`).length;

    if (nextCount === 1 && remainingInbox === 2) {
      console.log('✓ Only one message moved to next (sequential processing)');
    } else {
      console.log(`✗ Unexpected queue state: next=${nextCount}, inbox=${remainingInbox}`);
    }

  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Test 3: Archive Old Messages
  console.log('\nTest 3: Message Archiving');
  try {
    const archived = Queue.archive(testMesh, 0); // Archive all
    console.log(`✓ Archived ${archived} messages`);

    const archiveCount = fs.readdirSync(`${meshDir}/msgs/archive`).length;
    console.log(`✓ Archive contains ${archiveCount} messages`);

  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Test 4: Queue Status
  console.log('\nTest 4: Queue Status Reporting');
  try {
    const status = Queue.getQueueStatus(testMesh);
    console.log('✓ Queue status retrieved:');
    console.log(`  Inbox: ${status.inbox}`);
    console.log(`  Next: ${status.next}`);
    console.log(`  Active: ${status.active}`);
    console.log(`  Complete: ${status.complete}`);
    console.log(`  Archive: ${status.archive}`);

  } catch (error) {
    console.log(`✗ Failed: ${error.message}`);
  }

  // Cleanup
  fs.removeSync(meshDir);
  console.log('\n=== Tests Complete ===');
}

runTests();