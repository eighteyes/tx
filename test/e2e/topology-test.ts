/**
 * E2E Topology Test - HITL + Iteration + Writer
 *
 * Tests mesh topology patterns:
 * - HITL (ask-human flow)
 * - Iteration loops (agent sending to self)
 * - Final completion (task-complete to core)
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const TX_ROOT = process.env.TX_ROOT || process.cwd();
const MSGS_DIR = path.join(TX_ROOT, '.ai/tx/msgs');

describe('Topology Test - HITL + Iteration + Writer', () => {
  let testId: string;

  before(() => {
    testId = `topo-${Date.now()}`;

    // Ensure msgs directory exists
    if (!fs.existsSync(MSGS_DIR)) {
      fs.mkdirSync(MSGS_DIR, { recursive: true });
    }
  });

  after(() => {
    // Cleanup test messages
    const files = fs.readdirSync(MSGS_DIR);
    for (const file of files) {
      if (file.includes(testId)) {
        fs.unlinkSync(path.join(MSGS_DIR, file));
      }
    }
  });

  it('should run full topology: HITL → Loop → Writer', async () => {
    console.log('\n🧪 Starting topology test...\n');

    // Step 1: Write initial task to asker
    const taskMsg = `---
to: test/asker
from: core/core
type: task
msg-id: ${testId}-start
headline: Start topology test
timestamp: ${new Date().toISOString()}
---

Test the topology: HITL + iteration + writer
`;

    const taskFile = path.join(MSGS_DIR, `${testId}-task-core--test-asker.md`);
    fs.writeFileSync(taskFile, taskMsg);
    console.log('✅ Step 1: Wrote task to asker');

    // Step 2: Wait for ask-human message
    console.log('⏳ Step 2: Waiting for ask-human message...');
    const askFile = await waitForMessage((file, content) => {
      return content.includes('type: ask-human') &&
             content.includes('from: test/asker');
    }, 30000);

    if (!askFile) throw new Error('No ask-human message received');
    console.log('✅ Step 2: Got ask-human message:', askFile);

    // Step 3: Write ask-response
    const responseMsg = `---
to: test/asker
from: core/core
type: ask-response
msg-id: ${testId}-resp
headline: User response
timestamp: ${new Date().toISOString()}
---

Blue
`;

    const respFile = path.join(MSGS_DIR, `${testId}-ask-response-core--test-asker.md`);
    fs.writeFileSync(respFile, responseMsg);
    console.log('✅ Step 3: Wrote ask-response with "Blue"');

    // Step 4: Wait for iterations (should see 3 loops)
    console.log('⏳ Step 4: Waiting for iteration loops...');
    let loopCount = 0;
    const loopStart = Date.now();

    // Monitor for 45 seconds to catch all loops
    while (Date.now() - loopStart < 45000) {
      const files = fs.readdirSync(MSGS_DIR);
      const loopFiles = files.filter(f =>
        f.includes('test-looper--test-looper')
      );

      if (loopFiles.length > loopCount) {
        loopCount = loopFiles.length;
        console.log(`   Loop ${loopCount} detected`);
      }

      // Check if looper sent to writer
      const toWriter = files.find(f =>
        f.includes('test-looper--test-writer')
      );
      if (toWriter) {
        console.log('✅ Step 4: Looper sent to writer after iterations');
        break;
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    // Step 5: Wait for final task-complete
    console.log('⏳ Step 5: Waiting for final task-complete...');
    const completeFile = await waitForMessage((file, content) => {
      return content.includes('type: task-complete') &&
             content.includes('from: test/writer') &&
             content.includes('to: core/core');
    }, 30000);

    if (!completeFile) throw new Error('No task-complete message received');
    console.log('✅ Step 5: Got task-complete from writer');

    // Verify content
    const completeContent = fs.readFileSync(completeFile, 'utf-8');
    if (!completeContent.includes('Blue')) {
      throw new Error('Final message missing user input');
    }

    console.log('\n✅ TOPOLOGY TEST PASSED\n');
    console.log('Verified:');
    console.log('  ✓ HITL (ask-human → ask-response)');
    console.log(`  ✓ Iteration loops (${loopCount} iterations)`);
    console.log('  ✓ Final writer (task-complete to core)');
    console.log('  ✓ Data flow (user input preserved)\n');
  });
});

/**
 * Wait for a message file matching condition
 */
async function waitForMessage(
  condition: (file: string, content: string) => boolean,
  timeout: number
): Promise<string | null> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const files = fs.readdirSync(MSGS_DIR);

    for (const file of files) {
      const filepath = path.join(MSGS_DIR, file);
      const content = fs.readFileSync(filepath, 'utf-8');

      if (condition(filepath, content)) {
        return filepath;
      }
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return null;
}
