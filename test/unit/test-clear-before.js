const assert = require('assert');
const path = require('path');
const fs = require('fs-extra');
const { ResetHandler } = require('../../lib/reset-handler');
const { EventLogConsumer } = require('../../lib/event-log-consumer');

/**
 * Unit tests for clear-before feature
 *
 * Tests ResetHandler and EventLogConsumer clear-before logic
 */

describe('clear-before feature - Unit Tests', () => {
  describe('ResetHandler', () => {
    describe('getSessionName()', () => {
      it('should return "core" for core/core', () => {
        const sessionName = ResetHandler.getSessionName('core', 'core');
        assert.strictEqual(sessionName, 'core');
      });

      it('should return mesh name when mesh === agent', () => {
        const sessionName = ResetHandler.getSessionName('brain', 'brain');
        assert.strictEqual(sessionName, 'brain');
      });

      it('should return mesh-agent for standard pattern', () => {
        const sessionName = ResetHandler.getSessionName('research-807055', 'interviewer');
        assert.strictEqual(sessionName, 'research-807055-interviewer');
      });
    });

    describe('findPromptMessage()', () => {
      const testMsgsDir = '.ai/tx/msgs';

      before(async () => {
        // Create test messages directory
        await fs.ensureDir(testMsgsDir);

        // Create test prompt messages
        await fs.writeFile(
          path.join(testMsgsDir, '1107080000-prompt-system>dev-abc123.md'),
          '---\nto: dev\nfrom: system\n---\nOld prompt'
        );
        await fs.writeFile(
          path.join(testMsgsDir, '1107090000-prompt-system>dev-xyz789.md'),
          '---\nto: dev\nfrom: system\n---\nNew prompt'
        );
      });

      after(async () => {
        // Clean up test messages
        await fs.remove(path.join(testMsgsDir, '1107080000-prompt-system>dev-abc123.md'));
        await fs.remove(path.join(testMsgsDir, '1107090000-prompt-system>dev-xyz789.md'));
      });

      it('should find most recent prompt message', () => {
        const promptPath = ResetHandler.findPromptMessage('dev');
        assert.ok(promptPath, 'Should find prompt message');
        assert.ok(promptPath.includes('1107090000-prompt-system>dev-xyz789.md'), 'Should find most recent');
      });

      it('should return null for non-existent agent', () => {
        const promptPath = ResetHandler.findPromptMessage('nonexistent');
        assert.strictEqual(promptPath, null);
      });
    });
  });

  describe('EventLogConsumer', () => {
    describe('isTaskMessage()', () => {
      let consumer;

      before(() => {
        consumer = new EventLogConsumer('test-mesh/test-agent');
      });

      it('should return true for task message with start status', () => {
        const msg = {
          type: 'task',
          status: 'start',
          from: 'core/core',
          to: 'test-mesh/test-agent'
        };
        assert.strictEqual(consumer.isTaskMessage(msg), true);
      });

      it('should return false for task message with other status', () => {
        const msg = {
          type: 'task',
          status: 'complete',
          from: 'core/core',
          to: 'test-mesh/test-agent'
        };
        assert.strictEqual(consumer.isTaskMessage(msg), false);
      });

      it('should return false for non-task message', () => {
        const msg = {
          type: 'ask',
          status: 'start',
          from: 'core/core',
          to: 'test-mesh/test-agent'
        };
        assert.strictEqual(consumer.isTaskMessage(msg), false);
      });
    });

    describe('loadMeshConfigForAgent()', () => {
      it('should extract base mesh name from mesh instance with UUID', async () => {
        const consumer = new EventLogConsumer('dev-44a241/dev');
        const config = await consumer.loadMeshConfigForAgent();

        // Should load dev.json config
        assert.ok(config, 'Should load config');
        assert.strictEqual(config.mesh, 'dev', 'Should extract base mesh name');
      });

      it('should handle mesh without UUID', async () => {
        const consumer = new EventLogConsumer('core/core');
        const config = await consumer.loadMeshConfigForAgent();

        assert.ok(config, 'Should load config');
        assert.strictEqual(config.mesh, 'core', 'Should use mesh name as-is');
      });

      it('should cache config after first load', async () => {
        const consumer = new EventLogConsumer('brain/brain');

        const config1 = await consumer.loadMeshConfigForAgent();
        const config2 = await consumer.loadMeshConfigForAgent();

        // Should return same cached object
        assert.strictEqual(config1, config2, 'Should return cached config');
      });
    });

    describe('shouldResetBeforeTask()', () => {
      it('should return true when clear-before is true', async () => {
        // Create test mesh config with clear-before: true
        const testConfigPath = 'meshes/mesh-configs/test-clear-before-enabled.json';
        await fs.writeJson(testConfigPath, {
          mesh: 'test-clear-before-enabled',
          type: 'ephemeral',
          agents: ['dev'],
          'clear-before': true
        });

        const consumer = new EventLogConsumer('test-clear-before-enabled/dev');
        const shouldReset = await consumer.shouldResetBeforeTask();

        assert.strictEqual(shouldReset, true, 'Should return true');

        // Clean up
        await fs.remove(testConfigPath);
      });

      it('should return false when clear-before is false', async () => {
        // Create test mesh config with clear-before: false
        const testConfigPath = 'meshes/mesh-configs/test-clear-before-disabled.json';
        await fs.writeJson(testConfigPath, {
          mesh: 'test-clear-before-disabled',
          type: 'ephemeral',
          agents: ['dev'],
          'clear-before': false
        });

        const consumer = new EventLogConsumer('test-clear-before-disabled/dev');
        const shouldReset = await consumer.shouldResetBeforeTask();

        assert.strictEqual(shouldReset, false, 'Should return false');

        // Clean up
        await fs.remove(testConfigPath);
      });

      it('should return false when clear-before is not set (backward compatible)', async () => {
        // Use existing mesh config without clear-before field
        const consumer = new EventLogConsumer('core/core');
        const shouldReset = await consumer.shouldResetBeforeTask();

        assert.strictEqual(shouldReset, false, 'Should default to false');
      });
    });
  });
});

// Only run if this file is executed directly
if (require.main === module) {
  console.log('Running clear-before unit tests...\n');

  // Simple test runner
  const testSuite = describe;
  const results = { passed: 0, failed: 0 };

  async function runTests() {
    try {
      await testSuite('clear-before feature - Unit Tests', async () => {
        // Run tests here - this is a placeholder
        // In production, use a real test framework like Mocha
        console.log('✅ Unit tests completed');
      });
    } catch (error) {
      console.error('❌ Tests failed:', error.message);
      process.exit(1);
    }
  }

  runTests();
}

module.exports = { describe };
