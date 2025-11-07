const { describe, it } = require('node:test');
const assert = require('node:assert');
const { AgentPath } = require('../../lib/utils/agent-path');

describe('AgentPath', () => {
  describe('extractName()', () => {
    it('should extract name from simple path', () => {
      assert.strictEqual(AgentPath.extractName('core'), 'core');
    });

    it('should extract name from categorized path', () => {
      assert.strictEqual(AgentPath.extractName('editorial/reviewer'), 'reviewer');
    });

    it('should handle empty string', () => {
      assert.strictEqual(AgentPath.extractName(''), '');
    });

    it('should handle null/undefined', () => {
      assert.strictEqual(AgentPath.extractName(null), '');
      assert.strictEqual(AgentPath.extractName(undefined), '');
    });

    it('should extract from deeply nested paths', () => {
      assert.strictEqual(AgentPath.extractName('category/subcategory/agent'), 'agent');
    });
  });

  describe('extractCategory()', () => {
    it('should return null for simple path', () => {
      assert.strictEqual(AgentPath.extractCategory('core'), null);
    });

    it('should extract category from categorized path', () => {
      assert.strictEqual(AgentPath.extractCategory('editorial/reviewer'), 'editorial');
    });

    it('should handle empty string', () => {
      assert.strictEqual(AgentPath.extractCategory(''), null);
    });

    it('should handle null/undefined', () => {
      assert.strictEqual(AgentPath.extractCategory(null), null);
      assert.strictEqual(AgentPath.extractCategory(undefined), null);
    });

    it('should extract first category from deeply nested paths', () => {
      assert.strictEqual(AgentPath.extractCategory('category/subcategory/agent'), 'category');
    });
  });

  describe('format()', () => {
    it('should format simple path when no category', () => {
      assert.strictEqual(AgentPath.format(null, 'core'), 'core');
    });

    it('should format categorized path', () => {
      assert.strictEqual(AgentPath.format('editorial', 'reviewer'), 'editorial/reviewer');
    });

    it('should handle empty category as null', () => {
      assert.strictEqual(AgentPath.format('', 'agent'), 'agent');
    });
  });

  describe('parse()', () => {
    it('should parse simple path', () => {
      const result = AgentPath.parse('core');
      assert.deepStrictEqual(result, {
        name: 'core',
        category: null,
        fullPath: 'core'
      });
    });

    it('should parse categorized path', () => {
      const result = AgentPath.parse('editorial/reviewer');
      assert.deepStrictEqual(result, {
        name: 'reviewer',
        category: 'editorial',
        fullPath: 'editorial/reviewer'
      });
    });
  });

  describe('hasCategory()', () => {
    it('should return false for simple path', () => {
      assert.strictEqual(AgentPath.hasCategory('core'), false);
    });

    it('should return true for categorized path', () => {
      assert.strictEqual(AgentPath.hasCategory('editorial/reviewer'), true);
    });

    it('should handle empty string', () => {
      assert.strictEqual(AgentPath.hasCategory(''), false);
    });

    it('should handle null/undefined', () => {
      assert.strictEqual(AgentPath.hasCategory(null), false);
      assert.strictEqual(AgentPath.hasCategory(undefined), false);
    });
  });
});
