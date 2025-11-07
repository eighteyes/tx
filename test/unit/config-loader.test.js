const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ConfigLoader } = require('../../lib/config-loader');

describe('ConfigLoader', () => {
  beforeEach(() => {
    // Clear cache before each test
    ConfigLoader.clearCache();
  });

  describe('loadMeshConfig()', () => {
    it('should load valid mesh config', () => {
      const config = ConfigLoader.loadMeshConfig('core');
      assert.ok(config);
      assert.strictEqual(config.mesh, 'core');
      assert.ok(Array.isArray(config.agents));
    });

    it('should throw error for non-existent mesh', () => {
      assert.throws(
        () => ConfigLoader.loadMeshConfig('non-existent-mesh'),
        /Mesh config not found/
      );
    });

    it('should cache config on second load', () => {
      const config1 = ConfigLoader.loadMeshConfig('core');
      const config2 = ConfigLoader.loadMeshConfig('core');

      // Should be the exact same object (cached)
      assert.strictEqual(config1, config2);
    });

    it('should reload config when skipCache is true', () => {
      const config1 = ConfigLoader.loadMeshConfig('core');
      const config2 = ConfigLoader.loadMeshConfig('core', { skipCache: true });

      // Should be different objects (not cached)
      assert.notStrictEqual(config1, config2);

      // But should have same content
      assert.deepStrictEqual(config1, config2);
    });
  });

  describe('isPersistent()', () => {
    it('should return false for non-persistent mesh', () => {
      assert.strictEqual(ConfigLoader.isPersistent('core'), false);
    });

    it('should return false for non-existent mesh', () => {
      assert.strictEqual(ConfigLoader.isPersistent('non-existent'), false);
    });
  });

  describe('getMeshAgents()', () => {
    it('should return agents array', () => {
      const agents = ConfigLoader.getMeshAgents('core');
      assert.ok(Array.isArray(agents));
      assert.ok(agents.length > 0);
      assert.ok(agents.includes('core'));
    });

    it('should throw for non-existent mesh', () => {
      assert.throws(
        () => ConfigLoader.getMeshAgents('non-existent'),
        /Mesh config not found/
      );
    });
  });

  describe('getMeshAgentNames()', () => {
    it('should extract agent names from paths', () => {
      const names = ConfigLoader.getMeshAgentNames('core');
      assert.ok(Array.isArray(names));
      assert.ok(names.includes('core'));
    });

    it('should extract names from categorized paths', () => {
      // Using prompt-editor which has editorial/reviewer
      const names = ConfigLoader.getMeshAgentNames('prompt-editor');
      assert.ok(names.includes('reviewer'));
    });
  });

  describe('findAgentPath()', () => {
    it('should find simple agent path', () => {
      const path = ConfigLoader.findAgentPath('core', 'core');
      assert.strictEqual(path, 'core');
    });

    it('should find categorized agent path', () => {
      const path = ConfigLoader.findAgentPath('prompt-editor', 'reviewer');
      assert.strictEqual(path, 'editorial/reviewer');
    });

    it('should return null if agent not found', () => {
      const path = ConfigLoader.findAgentPath('core', 'non-existent');
      assert.strictEqual(path, null);
    });
  });

  describe('getMeshDescription()', () => {
    it('should return description if present', () => {
      const desc = ConfigLoader.getMeshDescription('core');
      assert.strictEqual(typeof desc, 'string');
    });

    it('should return empty string for non-existent mesh', () => {
      const desc = ConfigLoader.getMeshDescription('non-existent');
      assert.strictEqual(desc, '');
    });
  });

  describe('getMeshRouting()', () => {
    it('should return routing object if present', () => {
      const routing = ConfigLoader.getMeshRouting('dev');
      assert.strictEqual(typeof routing, 'object');
    });

    it('should return empty object for mesh without routing', () => {
      const routing = ConfigLoader.getMeshRouting('core');
      assert.strictEqual(typeof routing, 'object');
    });

    it('should return empty object for non-existent mesh', () => {
      const routing = ConfigLoader.getMeshRouting('non-existent');
      assert.deepStrictEqual(routing, {});
    });
  });

  describe('cache management', () => {
    it('should clear all caches', () => {
      // Load some configs to populate cache
      ConfigLoader.loadMeshConfig('core');
      assert.strictEqual(ConfigLoader.meshCache.size, 1);

      ConfigLoader.clearCache();
      assert.strictEqual(ConfigLoader.meshCache.size, 0);
    });

    it('should clear specific mesh cache', () => {
      ConfigLoader.loadMeshConfig('core');
      ConfigLoader.loadMeshConfig('dev');

      assert.strictEqual(ConfigLoader.meshCache.size, 2);

      ConfigLoader.clearMeshCache('core');
      assert.strictEqual(ConfigLoader.meshCache.size, 1);
      assert.ok(!ConfigLoader.meshCache.has('core'));
      assert.ok(ConfigLoader.meshCache.has('dev'));
    });
  });
});
