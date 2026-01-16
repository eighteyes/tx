/**
 * SimpleExpressionEvaluator Unit Tests
 *
 * Tests simple math and string expression evaluation for FSM exit.set operations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SimpleExpressionEvaluator } from '../../../src/mesh/fsm-expression.ts';

describe('SimpleExpressionEvaluator', () => {
  const evaluator = new SimpleExpressionEvaluator();

  describe('arithmetic operations', () => {
    it('should evaluate $var + number', () => {
      const context = { iteration: 5 };
      const result = evaluator.evaluate('$iteration + 1', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 6);
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should evaluate $var - number', () => {
      const context = { count: 10 };
      const result = evaluator.evaluate('$count - 3', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 7);
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should evaluate $var * number', () => {
      const context = { factor: 4 };
      const result = evaluator.evaluate('$factor * 2', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 8);
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should evaluate $var / number', () => {
      const context = { total: 20 };
      const result = evaluator.evaluate('$total / 4', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 5);
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should evaluate number + $var', () => {
      const context = { offset: 3 };
      const result = evaluator.evaluate('10 + $offset', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 13);
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should evaluate $var1 + $var2', () => {
      const context = { a: 5, b: 7 };
      const result = evaluator.evaluate('$a + $b', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 12);
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should evaluate $var1 - $var2', () => {
      const context = { max: 100, current: 30 };
      const result = evaluator.evaluate('$max - $current', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 70);
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should handle decimal numbers', () => {
      const context = { value: 3.5 };
      const result = evaluator.evaluate('$value + 1.5', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 5);
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should handle string number values in context', () => {
      const context = { iteration: '5' };  // String, not number
      const result = evaluator.evaluate('$iteration + 1', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 6);
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should fail on division by zero', () => {
      const context = { value: 10 };
      const result = evaluator.evaluate('$value / 0', context);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Division by zero'));
    });

    it('should fail on missing variable', () => {
      const context = { other: 5 };
      const result = evaluator.evaluate('$missing + 1', context);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('missing'));
    });

    it('should fail on non-numeric variable value', () => {
      const context = { value: 'not-a-number' };
      const result = evaluator.evaluate('$value + 1', context);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not a number'));
    });
  });

  describe('string interpolation', () => {
    it('should interpolate single variable', () => {
      const context = { name: 'test' };
      const result = evaluator.evaluate('$name', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 'test');
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should interpolate prefix-$var', () => {
      const context = { iteration: 3 };
      const result = evaluator.evaluate('attempt-$iteration', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 'attempt-3');
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should interpolate $var-suffix', () => {
      const context = { base: 'feature' };
      const result = evaluator.evaluate('$base-branch', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 'feature-branch');
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should interpolate multiple variables', () => {
      const context = { mesh: 'dev', agent: 'worker' };
      const result = evaluator.evaluate('$mesh/$agent', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 'dev/worker');
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should interpolate with numbers in context', () => {
      const context = { count: 42 };
      const result = evaluator.evaluate('count=$count', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 'count=42');
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should fail on missing variable in string', () => {
      const context = { existing: 'value' };
      const result = evaluator.evaluate('prefix-$missing-suffix', context);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Missing'));
    });
  });

  describe('shell fallback detection', () => {
    it('should detect pipe operator needs shell', () => {
      const context = { data: 'test' };
      const result = evaluator.evaluate('echo $data | grep test', context);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isSimpleExpression, false);
    });

    it('should detect command substitution needs shell', () => {
      const context = { file: 'test.txt' };
      const result = evaluator.evaluate('$(cat $file)', context);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isSimpleExpression, false);
    });

    it('should detect yq command needs shell', () => {
      const context = { json: '{}' };
      const result = evaluator.evaluate('echo $json | yq .field', context);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isSimpleExpression, false);
    });

    it('should detect echo command needs shell', () => {
      const context = { value: 'test' };
      const result = evaluator.evaluate('echo $value', context);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isSimpleExpression, false);
    });

    it('should detect redirection needs shell', () => {
      const context = { file: 'out.txt' };
      const result = evaluator.evaluate('data > $file', context);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isSimpleExpression, false);
    });

    it('should detect logical operators need shell', () => {
      const context = { cmd: 'test' };
      const result = evaluator.evaluate('$cmd && echo success', context);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.isSimpleExpression, false);
    });
  });

  describe('plain strings', () => {
    it('should pass through plain string without variables', () => {
      const context = {};
      const result = evaluator.evaluate('static-value', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 'static-value');
      assert.strictEqual(result.isSimpleExpression, true);
    });

    it('should pass through numeric string', () => {
      const context = {};
      const result = evaluator.evaluate('42', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, '42');
      assert.strictEqual(result.isSimpleExpression, true);
    });
  });

  describe('canEvaluateLocally', () => {
    it('should return true for simple arithmetic', () => {
      assert.strictEqual(evaluator.canEvaluateLocally('$var + 1'), true);
      assert.strictEqual(evaluator.canEvaluateLocally('$a - $b'), true);
    });

    it('should return true for string interpolation', () => {
      assert.strictEqual(evaluator.canEvaluateLocally('prefix-$var'), true);
    });

    it('should return true for plain strings', () => {
      assert.strictEqual(evaluator.canEvaluateLocally('static'), true);
    });

    it('should return false for shell commands', () => {
      assert.strictEqual(evaluator.canEvaluateLocally('echo $var'), false);
      assert.strictEqual(evaluator.canEvaluateLocally('$var | grep x'), false);
    });
  });

  describe('substituteVariables', () => {
    it('should substitute all variables', () => {
      const context = { a: '1', b: '2' };
      const result = evaluator.substituteVariables('$a and $b', context);

      assert.strictEqual(result, '1 and 2');
    });

    it('should keep unresolved variables', () => {
      const context = { a: '1' };
      const result = evaluator.substituteVariables('$a and $b', context);

      assert.strictEqual(result, '1 and $b');
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace around expression', () => {
      const context = { x: 5 };
      const result = evaluator.evaluate('  $x + 1  ', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 6);
    });

    it('should handle zero values', () => {
      const context = { counter: 0 };
      const result = evaluator.evaluate('$counter + 1', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 1);
    });

    it('should handle negative results', () => {
      const context = { small: 5 };
      const result = evaluator.evaluate('$small - 10', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, -5);
    });

    it('should handle underscore in variable names', () => {
      const context = { my_var: 10 };
      const result = evaluator.evaluate('$my_var + 1', context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 11);
    });

    it('should handle null context value', () => {
      const context = { nullVar: null };
      const result = evaluator.evaluate('$nullVar + 1', context);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('should handle undefined context value', () => {
      const context = { defined: 1 } as Record<string, unknown>;
      const result = evaluator.evaluate('$undefined + 1', context);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });
  });
});
