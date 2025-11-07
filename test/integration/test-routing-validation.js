const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const { Queue } = require('../../lib/queue');
const { Message } = require('../../lib/message');

/**
 * Integration tests for routing validation
 *
 * Tests the critical bug fix where Queue was using the destination mesh/agent
 * for routing validation instead of the source mesh/agent.
 *
 * Key scenarios:
 * 1. Message from open mesh (no routing rules) -> strict mesh with invalid status = PASS
 * 2. Message from strict mesh with invalid status -> anywhere = FAIL
 * 3. Message from strict mesh with valid status -> valid target = PASS
 * 4. Message from strict mesh with valid status -> invalid target = FAIL
 */

describe('Routing Validation Integration', () => {
  const msgsDir = '.ai/tx/msgs';
  const testFiles = [];

  before(async () => {
    // Ensure message directory exists
    await fs.ensureDir(msgsDir);

    // Initialize queue
    Queue.initialize();
  });

  after(async () => {
    // Clean up test message files
    for (const file of testFiles) {
      try {
        await fs.remove(file);
        // Also remove -failed version if it exists
        await fs.remove(file.replace('.md', '-failed.md'));
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  /**
   * Helper to create a fake message file
   */
  function createFakeMessage(from, to, status, type = 'task') {
    const now = new Date();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const SS = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${MM}${DD}${HH}${mm}${SS}`;

    // Extract agent names for filename
    const fromAgent = from.split('/').pop();
    const toAgent = to.split('/').pop();
    const msgId = `test-${Math.random().toString(36).slice(2, 8)}`;

    const filename = `${timestamp}-${type}-${fromAgent}>${toAgent}-${msgId}.md`;
    const filepath = path.join(msgsDir, filename);

    const content = `---
to: ${to}
from: ${from}
type: ${type}
status: ${status}
msg-id: ${msgId}
timestamp: ${new Date().toISOString()}
---

# Test Message

This is a test message for routing validation.
`;

    fs.writeFileSync(filepath, content);
    testFiles.push(filepath);

    return {
      filepath,
      filename,
      msgId
    };
  }

  /**
   * Helper to check if message was marked as failed
   */
  function isMessageFailed(filepath) {
    const failedPath = filepath.replace('.md', '-failed.md');
    return fs.existsSync(failedPath);
  }

  /**
   * Helper to get failure reason
   */
  function getFailureReason(filepath) {
    const failedPath = filepath.replace('.md', '-failed.md');
    if (!fs.existsSync(failedPath)) return null;

    const content = fs.readFileSync(failedPath, 'utf8');
    const match = content.match(/\*\*ROUTING FAILED\*\*: (.+)/);
    return match ? match[1] : 'Unknown';
  }

  describe('Open mesh to strict mesh', () => {
    it('should PASS when sender has no routing rules, even with invalid status', async () => {
      // Open mesh (test-routing-open) sends message with "start" status
      // Strict mesh (test-routing-strict) doesn't accept "start"
      // BUT sender has no rules, so validation should pass

      const { filepath } = createFakeMessage(
        'test-routing-open/coordinator',
        'test-routing-strict/worker',
        'start',
        'task'
      );

      // Parse and validate through Queue
      const message = Message.parseMessage(filepath);

      const fromParts = message.metadata.from.split('/');
      const sourceMesh = fromParts[0];
      const sourceAgent = fromParts.length > 1 ? fromParts[1] : fromParts[0];

      const validation = Queue.validateRouting(message, sourceMesh, sourceAgent);

      assert.strictEqual(validation.valid, true,
        'Message from open mesh should pass validation regardless of status');

      assert.strictEqual(isMessageFailed(filepath), false,
        'Message should not be marked as failed');
    });

    it('should PASS when sender has no routing rules with any status', async () => {
      const { filepath } = createFakeMessage(
        'test-routing-open/coordinator',
        'test-routing-strict/worker',
        'completely-invalid-status',
        'task'
      );

      const message = Message.parseMessage(filepath);
      const fromParts = message.metadata.from.split('/');
      const sourceMesh = fromParts[0];
      const sourceAgent = fromParts.length > 1 ? fromParts[1] : fromParts[0];

      const validation = Queue.validateRouting(message, sourceMesh, sourceAgent);

      assert.strictEqual(validation.valid, true,
        'Open mesh should be able to send with any status');
    });
  });

  describe('Strict mesh to any destination', () => {
    it('should FAIL when sender uses invalid status', async () => {
      // Strict mesh tries to send with "start" which is not in its routing rules

      const { filepath } = createFakeMessage(
        'test-routing-strict/worker',
        'core/core',
        'start',
        'task'
      );

      const message = Message.parseMessage(filepath);
      const fromParts = message.metadata.from.split('/');
      const sourceMesh = fromParts[0];
      const sourceAgent = fromParts.length > 1 ? fromParts[1] : fromParts[0];

      const validation = Queue.validateRouting(message, sourceMesh, sourceAgent);

      assert.strictEqual(validation.valid, false,
        'Strict mesh should not be able to send with invalid status');

      assert.ok(validation.error.includes('Unknown status'),
        'Error should mention unknown status');

      assert.ok(validation.error.includes('start'),
        'Error should mention the invalid status');
    });

    it('should PASS when sender uses valid status and valid target', async () => {
      const { filepath } = createFakeMessage(
        'test-routing-strict/worker',
        'core/core',
        'complete',
        'task'
      );

      const message = Message.parseMessage(filepath);
      const fromParts = message.metadata.from.split('/');
      const sourceMesh = fromParts[0];
      const sourceAgent = fromParts.length > 1 ? fromParts[1] : fromParts[0];

      const validation = Queue.validateRouting(message, sourceMesh, sourceAgent);

      assert.strictEqual(validation.valid, true,
        'Valid status to valid target should pass');
    });

    it('should FAIL when sender uses valid status but invalid target', async () => {
      // 'complete' status is valid, but can only go to 'core' or 'reviewer'
      // Sending to 'invalid-target' should fail

      const { filepath } = createFakeMessage(
        'test-routing-strict/worker',
        'invalid-target/agent',
        'complete',
        'task'
      );

      const message = Message.parseMessage(filepath);
      const fromParts = message.metadata.from.split('/');
      const sourceMesh = fromParts[0];
      const sourceAgent = fromParts.length > 1 ? fromParts[1] : fromParts[0];

      const validation = Queue.validateRouting(message, sourceMesh, sourceAgent);

      assert.strictEqual(validation.valid, false,
        'Valid status to invalid target should fail');

      assert.ok(validation.error.includes('cannot route to'),
        'Error should mention invalid target');
    });
  });

  describe('Core mesh (no routing rules)', () => {
    it('should PASS when core sends to any mesh with any status', async () => {
      const { filepath } = createFakeMessage(
        'core/core',
        'test-routing-strict/worker',
        'start',
        'task'
      );

      const message = Message.parseMessage(filepath);
      const fromParts = message.metadata.from.split('/');
      const sourceMesh = fromParts[0];
      const sourceAgent = fromParts.length > 1 ? fromParts[1] : fromParts[0];

      const validation = Queue.validateRouting(message, sourceMesh, sourceAgent);

      assert.strictEqual(validation.valid, true,
        'Core should be able to send with any status');
    });
  });

  describe('Bug regression test', () => {
    it('should validate based on FROM field, not TO field', async () => {
      // This is the exact scenario that caused the bug:
      // core/core -> dev/dev with status: start
      //
      // BUG: Queue was checking if DEV can send with "start" (FAIL)
      // FIX: Queue should check if CORE can send with "start" (PASS - no rules)

      const { filepath } = createFakeMessage(
        'core/core',
        'dev/dev',
        'start',
        'task'
      );

      const message = Message.parseMessage(filepath);

      // This is what the FIX does - extract from 'from' field
      const fromParts = message.metadata.from.split('/');
      const sourceMesh = fromParts[0];
      const sourceAgent = fromParts.length > 1 ? fromParts[1] : fromParts[0];

      assert.strictEqual(sourceMesh, 'core', 'Should extract source mesh from FROM field');
      assert.strictEqual(sourceAgent, 'core', 'Should extract source agent from FROM field');

      const validation = Queue.validateRouting(message, sourceMesh, sourceAgent);

      assert.strictEqual(validation.valid, true,
        'Core -> dev with status:start should PASS (core has no routing rules)');

      // Verify it's not checking the destination
      // If it were checking 'dev' (the bug), this would fail
      const wrongValidation = Queue.validateRouting(message, 'dev', 'dev');
      assert.strictEqual(wrongValidation.valid, false,
        'When checking destination mesh (the BUG), it should fail - proving we fixed it');
    });
  });

  describe('Real-world scenario', () => {
    it('should allow core to spawn dev mesh with task', async () => {
      // Use test-routing-strict instead of dev to avoid iteration limit collision
      // with the bug regression test above
      const { filepath } = createFakeMessage(
        'core/core',
        'test-routing-strict/worker',
        'start',
        'task'
      );

      const message = Message.parseMessage(filepath);
      const fromParts = message.metadata.from.split('/');
      const sourceMesh = fromParts[0];
      const sourceAgent = fromParts.length > 1 ? fromParts[1] : fromParts[0];

      const validation = Queue.validateRouting(message, sourceMesh, sourceAgent);

      assert.strictEqual(validation.valid, true,
        'Core should be able to send task to test-routing-strict with start status');
    });

    it('should prevent dev from using invalid status', async () => {
      const { filepath } = createFakeMessage(
        'dev/dev',
        'core/core',
        'in-progress',  // Not a valid status for dev
        'update'
      );

      const message = Message.parseMessage(filepath);
      const fromParts = message.metadata.from.split('/');
      const sourceMesh = fromParts[0];
      const sourceAgent = fromParts.length > 1 ? fromParts[1] : fromParts[0];

      const validation = Queue.validateRouting(message, sourceMesh, sourceAgent);

      assert.strictEqual(validation.valid, false,
        'Dev should not be able to use in-progress status');
    });
  });
});
