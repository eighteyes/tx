const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { MessageWriter } = require('../../lib/message-writer');
const fs = require('fs-extra');
const path = require('path');

describe('MessageWriter Rearmatter Integration', () => {
  const testDir = path.join(__dirname, '../fixtures/message-writer-test');
  const msgsDir = path.join(testDir, '.ai/tx/msgs');

  before(async () => {
    // Create test directories
    await fs.ensureDir(msgsDir);

    // Change to test directory for tests
    process.chdir(testDir);
  });

  after(async () => {
    // Clean up test fixtures
    await fs.remove(testDir);

    // Change back to original directory
    process.chdir(path.join(__dirname, '../..'));
  });

  describe('write() with rearmatter', () => {
    it('should write message with valid rearmatter', async () => {
      const content = `# Task Complete

Implementation done.

---
rearmatter:
  confidence: 0.85
  grade: B
---`;

      const msgPath = await MessageWriter.write(
        'test-mesh/test-agent',
        'core/core',
        'task-complete',
        'test123',
        content
      );

      // Verify file was created
      assert.ok(fs.existsSync(msgPath), 'Message file should exist');

      // Read and verify content
      const fileContent = await fs.readFile(msgPath, 'utf-8');
      assert.ok(fileContent.includes('rearmatter:'), 'Should include rearmatter block');
      assert.ok(fileContent.includes('confidence: 0.85'), 'Should include confidence');
      assert.ok(fileContent.includes('grade: B'), 'Should include grade');

      // Clean up
      await fs.remove(msgPath);
    });

    it('should write message without rearmatter', async () => {
      const content = '# Task Complete\n\nImplementation done.';

      const msgPath = await MessageWriter.write(
        'test-mesh/test-agent',
        'core/core',
        'task-complete',
        'test456',
        content
      );

      // Verify file was created
      assert.ok(fs.existsSync(msgPath));

      // Read and verify content
      const fileContent = await fs.readFile(msgPath, 'utf-8');
      assert.ok(!fileContent.includes('rearmatter:'), 'Should not include rearmatter');

      // Clean up
      await fs.remove(msgPath);
    });

    it('should handle message with invalid rearmatter gracefully', async () => {
      const content = `# Task Complete

Implementation done.

---
rearmatter:
  confidence: 2.5
  grade: X
---`;

      // Should not throw - just log warnings
      const msgPath = await MessageWriter.write(
        'test-mesh/test-agent',
        'core/core',
        'task-complete',
        'test789',
        content
      );

      // Verify file was created despite invalid rearmatter
      assert.ok(fs.existsSync(msgPath));

      // Content should still be preserved
      const fileContent = await fs.readFile(msgPath, 'utf-8');
      assert.ok(fileContent.includes('confidence: 2.5'), 'Should preserve invalid content');

      // Clean up
      await fs.remove(msgPath);
    });

    it('should handle message with section breakdowns', async () => {
      const content = `# Task Complete

Implementation done.

---
rearmatter:
  confidence: 0.58
  confidence_sections:
    "Technical Analysis": 0.92
    "Timeline Estimates": 0.43
  grade: D
  grade_sections:
    "Technical Analysis": A
    "Timeline Estimates": F
---`;

      const msgPath = await MessageWriter.write(
        'test-mesh/test-agent',
        'core/core',
        'task-complete',
        'testabc',
        content
      );

      assert.ok(fs.existsSync(msgPath));

      const fileContent = await fs.readFile(msgPath, 'utf-8');
      assert.ok(fileContent.includes('confidence_sections'), 'Should include sections');
      assert.ok(fileContent.includes('Technical Analysis'), 'Should include section names');

      // Clean up
      await fs.remove(msgPath);
    });

    it('should handle message with line-numbered items', async () => {
      const content = `# Task Complete

Implementation done.

---
rearmatter:
  confidence: 0.85
  grade: B
  speculation:
    15: "uncertain about API stability"
  gaps:
    34: "missing production load data"
  assumptions:
    8: "assuming infrastructure can handle 10x traffic"
---`;

      const msgPath = await MessageWriter.write(
        'test-mesh/test-agent',
        'core/core',
        'task-complete',
        'testdef',
        content
      );

      assert.ok(fs.existsSync(msgPath));

      const fileContent = await fs.readFile(msgPath, 'utf-8');
      assert.ok(fileContent.includes('speculation:'), 'Should include speculation');
      assert.ok(fileContent.includes('gaps:'), 'Should include gaps');
      assert.ok(fileContent.includes('assumptions:'), 'Should include assumptions');
      assert.ok(fileContent.includes('uncertain about API stability'), 'Should include descriptions');

      // Clean up
      await fs.remove(msgPath);
    });
  });

  describe('buildFilename()', () => {
    it('should build correct filename format', () => {
      const timestamp = '2025-11-06T21:30:45.123Z';
      const from = 'test-mesh/test-agent';
      const to = 'core/core';
      const type = 'task-complete';
      const msgId = 'test123';

      const filename = MessageWriter.buildFilename(timestamp, from, to, type, msgId);

      // Should be: MMDDHHMMSS-type-fromAgent>toAgent-msgId.md
      assert.ok(filename.match(/^\d{10}-task-complete-test-agent>core-test123\.md$/),
        `Filename should match pattern, got: ${filename}`);
    });
  });

  describe('formatMessage()', () => {
    it('should format message with frontmatter and content', () => {
      const frontmatter = {
        to: 'core/core',
        from: 'test/test',
        type: 'task-complete',
        'msg-id': 'test123',
        timestamp: '2025-11-06T21:30:45.123Z'
      };
      const content = '# Test\n\nContent here.';

      const message = MessageWriter.formatMessage(frontmatter, content);

      assert.ok(message.startsWith('---'), 'Should start with frontmatter delimiter');
      assert.ok(message.includes('to: core/core'), 'Should include to field');
      assert.ok(message.includes('from: test/test'), 'Should include from field');
      assert.ok(message.includes('# Test'), 'Should include content');
    });

    it('should preserve rearmatter in content', () => {
      const frontmatter = {
        to: 'core/core',
        from: 'test/test',
        type: 'task-complete',
        'msg-id': 'test123',
        timestamp: '2025-11-06T21:30:45.123Z'
      };
      const content = `# Test

Content here.

---
rearmatter:
  confidence: 0.85
  grade: B
---`;

      const message = MessageWriter.formatMessage(frontmatter, content);

      assert.ok(message.includes('rearmatter:'), 'Should preserve rearmatter');
      assert.ok(message.includes('confidence: 0.85'), 'Should preserve confidence');
      assert.ok(message.includes('grade: B'), 'Should preserve grade');
    });
  });
});
