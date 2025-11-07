const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Routing } = require('../../lib/routing');

describe('Routing', () => {
  describe('validateRoute()', () => {
    it('should validate valid route', () => {
      const result = Routing.validateRoute('dev', 'dev', 'complete', 'core');
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    it('should reject invalid status', () => {
      const result = Routing.validateRoute('dev', 'dev', 'invalid-status', 'core');
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('Unknown status'));
    });

    it('should reject invalid target for status', () => {
      const result = Routing.validateRoute('dev', 'dev', 'complete', 'invalid-target');
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('cannot route to'));
    });

    it('should return valid for mesh without routing', () => {
      const result = Routing.validateRoute('core', 'core', 'complete', 'anywhere');
      assert.strictEqual(result.valid, true);
    });

    it('should handle agent names with category prefix', () => {
      const result = Routing.validateRoute('dev', 'development/dev', 'complete', 'core');
      assert.strictEqual(result.valid, true);
    });

    it('should handle target with mesh prefix', () => {
      const result = Routing.validateRoute('dev', 'dev', 'complete', 'core/core');
      assert.strictEqual(result.valid, true);
    });
  });

  describe('getAgentRouting()', () => {
    it('should get routing for agent with routing rules', () => {
      const routing = Routing.getAgentRouting('dev', 'dev');
      assert.ok(routing);
      assert.strictEqual(typeof routing, 'object');
      assert.ok(routing.complete);
    });

    it('should return null for agent without routing', () => {
      const routing = Routing.getAgentRouting('core', 'core');
      assert.strictEqual(routing, null);
    });

    it('should return null for non-existent mesh', () => {
      const routing = Routing.getAgentRouting('non-existent', 'agent');
      assert.strictEqual(routing, null);
    });
  });

  describe('getValidStatuses()', () => {
    it('should return array of valid statuses', () => {
      const statuses = Routing.getValidStatuses('dev', 'dev');
      assert.ok(Array.isArray(statuses));
      assert.ok(statuses.length > 0);
      assert.ok(statuses.includes('complete'));
    });

    it('should return empty array for agent without routing', () => {
      const statuses = Routing.getValidStatuses('core', 'core');
      assert.deepStrictEqual(statuses, []);
    });
  });

  describe('getValidTargets()', () => {
    it('should return array of valid targets for status', () => {
      const targets = Routing.getValidTargets('dev', 'dev', 'complete');
      assert.ok(Array.isArray(targets));
      assert.ok(targets.length > 0);
      assert.ok(targets.includes('core'));
    });

    it('should return empty array for invalid status', () => {
      const targets = Routing.getValidTargets('dev', 'dev', 'invalid-status');
      assert.deepStrictEqual(targets, []);
    });

    it('should return empty array for agent without routing', () => {
      const targets = Routing.getValidTargets('core', 'core', 'complete');
      assert.deepStrictEqual(targets, []);
    });
  });

  describe('formatRoutingInstructions()', () => {
    it('should format routing instructions for agent with routing', () => {
      const instructions = Routing.formatRoutingInstructions('dev', 'dev');
      assert.strictEqual(typeof instructions, 'string');
      assert.ok(instructions.includes('Status & Routing'));
      assert.ok(instructions.includes('complete'));
    });

    it('should return no-routing message for agent without routing', () => {
      const instructions = Routing.formatRoutingInstructions('core', 'core');
      assert.ok(instructions.includes('No routing rules'));
    });

    it('should handle agent names with category prefix', () => {
      const instructions = Routing.formatRoutingInstructions('dev', 'development/dev');
      assert.strictEqual(typeof instructions, 'string');
      assert.ok(instructions.includes('Status & Routing'));
    });

    it('should format single-target routes correctly', () => {
      const instructions = Routing.formatRoutingInstructions('dev', 'dev');
      assert.ok(instructions.includes('Routes to:'));
    });

    it('should handle non-existent mesh gracefully', () => {
      const instructions = Routing.formatRoutingInstructions('non-existent', 'agent');
      assert.strictEqual(typeof instructions, 'string');
    });
  });
});
