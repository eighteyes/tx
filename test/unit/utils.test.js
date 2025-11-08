const { describe, it } = require('node:test');
const assert = require('node:assert');
const { sum } = require('../../lib/utils');

describe('utils', () => {
  describe('sum', () => {
    it('should return the sum of two positive numbers', () => {
      assert.strictEqual(sum(2, 3), 5);
      assert.strictEqual(sum(10, 20), 30);
    });

    it('should handle zero', () => {
      assert.strictEqual(sum(0, 0), 0);
      assert.strictEqual(sum(5, 0), 5);
      assert.strictEqual(sum(0, 5), 5);
    });

    it('should handle negative numbers', () => {
      assert.strictEqual(sum(-5, 3), -2);
      assert.strictEqual(sum(-5, -3), -8);
      assert.strictEqual(sum(5, -3), 2);
    });

    it('should handle decimal numbers', () => {
      assert.strictEqual(sum(1.5, 2.5), 4);
      assert.strictEqual(sum(0.1, 0.2), 0.30000000000000004); // JavaScript floating point quirk
    });

    it('should throw TypeError for non-number arguments', () => {
      assert.throws(() => sum('5', 3), TypeError);
      assert.throws(() => sum(5, '3'), TypeError);
      assert.throws(() => sum('5', '3'), TypeError);
      assert.throws(() => sum(null, 3), TypeError);
      assert.throws(() => sum(5, undefined), TypeError);
    });
  });
});
