const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { CapabilityLoader } = require('../../lib/capability-loader');
const { PromptBuilder } = require('../../lib/prompt-builder');
const fs = require('fs-extra');
const path = require('path');

describe('Capability Injection', () => {
  describe('CapabilityLoader', () => {
    it('should load know capability', () => {
      const content = CapabilityLoader.loadCapability('know');

      assert.ok(content.length > 0, 'Know capability should have content');
      assert.ok(content.includes('Know Capability'), 'Should include capability title');
      assert.ok(content.includes('spec-graph'), 'Should mention spec-graph');
      assert.ok(content.includes('code-graph'), 'Should mention code-graph');
    });

    it('should list available capabilities', () => {
      const capabilities = CapabilityLoader.listCapabilities();

      assert.ok(Array.isArray(capabilities), 'Should return an array');
      assert.ok(capabilities.includes('know'), 'Should include know capability');
    });

    it('should validate capability exists', () => {
      assert.strictEqual(CapabilityLoader.validateCapability('know'), true, 'Know should exist');
      assert.strictEqual(CapabilityLoader.validateCapability('nonexistent'), false, 'Nonexistent should not exist');
    });

    it('should throw error for missing capability', () => {
      assert.throws(
        () => CapabilityLoader.loadCapability('nonexistent'),
        /Capability not found/,
        'Should throw for missing capability'
      );
    });
  });

  describe('Prompt Builder Capability Injection', () => {
    const testAgentDir = path.join(__dirname, '../fixtures/test-agent');
    const testAgentConfigPath = path.join(testAgentDir, 'config.json');
    const testAgentPromptPath = path.join(testAgentDir, 'prompt.md');

    before(() => {
      // Create test agent directory structure
      fs.ensureDirSync(testAgentDir);
    });

    after(() => {
      // Clean up test fixtures
      fs.removeSync(testAgentDir);
    });

    it('should inject know capability when specified in config', () => {
      // Create test agent config with know capability
      const config = {
        name: 'test-agent',
        runtime: 'claude',
        capabilities: ['know']
      };
      fs.writeJsonSync(testAgentConfigPath, config);
      fs.writeFileSync(testAgentPromptPath, '# Test Agent\n\nThis is a test agent.');

      // Call _getCapabilities directly (testing private method)
      const capabilities = PromptBuilder._getCapabilities(testAgentDir);

      assert.ok(capabilities.includes('<capabilities>'), 'Should wrap in capabilities tags');
      assert.ok(capabilities.includes('<know>'), 'Should have know capability tag');
      assert.ok(capabilities.includes('Know Capability'), 'Should include know capability content');
      assert.ok(capabilities.includes('spec-graph'), 'Should mention spec-graph');
      assert.ok(capabilities.includes('code-graph'), 'Should mention code-graph');
      assert.ok(capabilities.includes('</know>'), 'Should close know capability tag');
      assert.ok(capabilities.includes('</capabilities>'), 'Should close capabilities tag');
    });

    it('should inject multiple capabilities', () => {
      // Note: This test will only work if other capability files exist
      // For now, we'll test with just know since that's what we created
      const config = {
        name: 'test-agent',
        runtime: 'claude',
        capabilities: ['know']
      };
      fs.writeJsonSync(testAgentConfigPath, config);

      const capabilities = PromptBuilder._getCapabilities(testAgentDir);

      assert.ok(capabilities.includes('<know>'), 'Should include know capability');
      // If we had hitl.md, we could test: assert.ok(capabilities.includes('<hitl>'));
    });

    it('should handle missing capabilities gracefully', () => {
      const config = {
        name: 'test-agent',
        runtime: 'claude',
        capabilities: ['nonexistent']
      };
      fs.writeJsonSync(testAgentConfigPath, config);

      // Should not throw - just log error and continue
      const capabilities = PromptBuilder._getCapabilities(testAgentDir);

      // Should still have wrapper tags even if capability fails to load
      assert.ok(capabilities.includes('<capabilities>'), 'Should have capabilities wrapper');
      assert.ok(capabilities.includes('</capabilities>'), 'Should close capabilities wrapper');
      // Should NOT include the nonexistent capability content
      assert.ok(!capabilities.includes('<nonexistent>'), 'Should not include failed capability');
    });

    it('should work without capabilities array', () => {
      const config = {
        name: 'test-agent',
        runtime: 'claude'
        // No capabilities array
      };
      fs.writeJsonSync(testAgentConfigPath, config);

      const capabilities = PromptBuilder._getCapabilities(testAgentDir);

      // Should return empty string when no capabilities
      assert.strictEqual(capabilities, '', 'Should return empty string when no capabilities');
    });

    it('should work when config file does not exist', () => {
      // Remove config file
      fs.removeSync(testAgentConfigPath);

      const capabilities = PromptBuilder._getCapabilities(testAgentDir);

      // Should return empty string when no config
      assert.strictEqual(capabilities, '', 'Should return empty string when no config');
    });
  });
});
