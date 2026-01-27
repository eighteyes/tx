/**
 * FSM Exit-Based Routing Tests
 *
 * Tests the new exit-based routing with when clauses.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { ConditionEvaluator } from '../../../src/mesh/fsm-evaluator.ts';
import { MeshFSM, type FSMExitConfig } from '../../../src/mesh/index.ts';

describe('ConditionEvaluator', () => {
  const evaluator = new ConditionEvaluator();

  describe('parsing', () => {
    it('should parse condition with == operator', () => {
      const result = evaluator.parse('status == "PASS"');
      assert.strictEqual(result.variable, 'status');
      assert.strictEqual(result.operator, '==');
      assert.strictEqual(result.value, 'PASS');
    });

    it('should parse condition with != operator', () => {
      const result = evaluator.parse('status != "FAIL"');
      assert.strictEqual(result.variable, 'status');
      assert.strictEqual(result.operator, '!=');
      assert.strictEqual(result.value, 'FAIL');
    });

    it('should parse condition without quotes', () => {
      const result = evaluator.parse('status == PASS');
      assert.strictEqual(result.variable, 'status');
      assert.strictEqual(result.operator, '==');
      assert.strictEqual(result.value, 'PASS');
    });

    it('should parse condition with spaces', () => {
      const result = evaluator.parse('  status   ==   "PASS"  ');
      assert.strictEqual(result.variable, 'status');
      assert.strictEqual(result.operator, '==');
      assert.strictEqual(result.value, 'PASS');
    });

    it('should throw on empty condition', () => {
      assert.throws(() => evaluator.parse(''), /Condition cannot be empty/);
    });

    it('should throw on invalid syntax', () => {
      assert.throws(() => evaluator.parse('status PASS'), /Invalid condition syntax/);
    });

    it('should throw on missing operator', () => {
      assert.throws(() => evaluator.parse('status'), /Invalid condition syntax/);
    });
  });

  describe('evaluation', () => {
    it('should evaluate == to true when values match', () => {
      const context = { status: 'PASS' };
      const result = evaluator.evaluate('status == "PASS"', context);
      assert.strictEqual(result, true);
    });

    it('should evaluate == to false when values do not match', () => {
      const context = { status: 'FAIL' };
      const result = evaluator.evaluate('status == "PASS"', context);
      assert.strictEqual(result, false);
    });

    it('should evaluate != to true when values do not match', () => {
      const context = { status: 'PASS' };
      const result = evaluator.evaluate('status != "FAIL"', context);
      assert.strictEqual(result, true);
    });

    it('should evaluate != to false when values match', () => {
      const context = { status: 'PASS' };
      const result = evaluator.evaluate('status != "PASS"', context);
      assert.strictEqual(result, false);
    });

    it('should handle missing variable as empty string', () => {
      const context = {};
      const result = evaluator.evaluate('status == ""', context);
      assert.strictEqual(result, true);
    });

    it('should be case sensitive', () => {
      const context = { status: 'pass' };
      const result = evaluator.evaluate('status == "PASS"', context);
      assert.strictEqual(result, false);
    });

    it('should convert non-string values to strings', () => {
      const context = { count: 42 };
      const result = evaluator.evaluate('count == "42"', context);
      assert.strictEqual(result, true);
    });

    it('should return false on parse error', () => {
      const context = { status: 'PASS' };
      const result = evaluator.evaluate('invalid syntax', context);
      assert.strictEqual(result, false);
    });
  });

  describe('validation', () => {
    it('should validate correct syntax', () => {
      assert.strictEqual(evaluator.isValid('status == "PASS"'), true);
      assert.strictEqual(evaluator.isValid('status != "FAIL"'), true);
    });

    it('should invalidate incorrect syntax', () => {
      assert.strictEqual(evaluator.isValid('status PASS'), false);
      assert.strictEqual(evaluator.isValid(''), false);
    });
  });

  describe('supported operators', () => {
    it('should return list of supported operators', () => {
      const operators = ConditionEvaluator.getSupportedOperators();
      assert.deepStrictEqual(operators, ['==', '!=']);
    });
  });
});

describe('MeshFSM.evaluateExitRouting', () => {
  // Mock FSM instance (we only need evaluateExitRouting method)
  // We'll create a minimal FSM for testing
  const createMockFSM = () => {
    const db = new Database(':memory:');
    const config = {
      initialState: 'test',
      states: [{ name: 'test', coordinator: 'test' }],
      transitions: [],
    };
    return new MeshFSM('test', config, db, '/tmp');
  };

  describe('when clause evaluation', () => {
    it('should return target when first condition matches', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'status == "PASS"', target: 'next-state' },
          { condition: 'status == "FAIL"', target: 'error-state' },
        ],
      };
      const context = { status: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'next-state');
    });

    it('should return target when second condition matches', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'status == "PASS"', target: 'next-state' },
          { condition: 'status == "FAIL"', target: 'error-state' },
        ],
      };
      const context = { status: 'FAIL' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'error-state');
    });

    it('should use first match when multiple conditions match', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'status != "BLOCKED"', target: 'first-match' },
          { condition: 'status == "PASS"', target: 'second-match' },
        ],
      };
      const context = { status: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'first-match');
    });

    it('should fall through when no condition matches', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'status == "PASS"', target: 'next-state' },
        ],
        default: 'default-state',
      };
      const context = { status: 'REFINE' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'default-state');
    });

    it('should handle empty when list', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [],
        default: 'default-state',
      };
      const context = { status: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'default-state');
    });

    it('should handle undefined when', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        default: 'default-state',
      };
      const context = { status: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'default-state');
    });
  });

  describe('exit routing without transitions (exit-only routing)', () => {
    it('should use when clause when it matches', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'status == "PASS"', target: 'when-target' },
        ],
      };
      const context = { status: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'when-target');
    });

    it('should use default when no when clause matches', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'status == "FAIL"', target: 'when-target' },
        ],
        default: 'default-target',
      };
      const context = { status: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'default-target');
    });

    it('should return null when no when clause matches and no default', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'status == "FAIL"', target: 'when-target' },
        ],
      };
      const context = { status: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, null);
    });

    it('should ignore transitions field (backward compat only)', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'status == "PASS"', target: 'when-target' },
        ],
        transitions: {
          'agent-a': 'static-target',  // Should be ignored
        },
      };
      const context = { status: 'PASS' };

      // Transitions should be ignored - when clause should win
      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'when-target');
    });

    it('should use default even if transitions field exists', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'status == "FAIL"', target: 'when-target' },
        ],
        transitions: {
          'agent-a': 'static-target',  // Should be ignored
        },
        default: 'default-target',
      };
      const context = { status: 'PASS' };

      // Should use default, not transitions
      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'default-target');
    });

    it('should require default to prevent routing failures', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'status == "BLOCKED"', target: 'error-state' },
        ],
        // No default - will return null
      };
      const context = { status: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, null);
    });
  });

  describe('context variable access', () => {
    it('should access multiple context variables', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'layer == "haiku"', target: 'haiku-state' },
          { condition: 'layer == "sonnet"', target: 'sonnet-state' },
        ],
      };
      const context = { layer: 'sonnet', iteration: 3 };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'sonnet-state');
    });

    it('should handle special characters in values', async () => {
      const fsm = createMockFSM();
      const exit: FSMExitConfig = {
        when: [
          { condition: 'message == "hello-world"', target: 'next' },
        ],
      };
      const context = { message: 'hello-world' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'next');
    });
  });

  describe('exit.run routing', () => {
    it('should use literal state name from run field', async () => {
      const db = new Database(':memory:');
      const config = {
        initialState: 'start',
        states: [
          { name: 'start', coordinator: 'test' },
          { name: 'target-state', coordinator: 'test' },
        ],
        transitions: [],
      };
      const fsm = new MeshFSM('test', config, db, '/tmp');
      await fsm.initialize();

      const exit: FSMExitConfig = {
        run: 'target-state',
      };
      const context = {};

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'target-state');
    });

    it('should execute script from run field and use output', async () => {
      const db = new Database(':memory:');
      const config = {
        initialState: 'test',
        states: [
          { name: 'test', coordinator: 'test' },
          { name: 'script-output-state', coordinator: 'test' },
        ],
        transitions: [],
      };
      const fsm = new MeshFSM('test', config, db, '/tmp');
      await fsm.initialize();

      const exit: FSMExitConfig = {
        run: 'echo "script-output-state"',
      };
      const context = {};

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'script-output-state');
    });

    it('should use context variables in run script', async () => {
      const db = new Database(':memory:');
      const config = {
        initialState: 'test',
        states: [
          { name: 'test', coordinator: 'test' },
          { name: 'pass-state', coordinator: 'test' },
          { name: 'fail-state', coordinator: 'test' },
        ],
        transitions: [],
      };
      const fsm = new MeshFSM('test', config, db, '/tmp');
      await fsm.initialize();

      const exit: FSMExitConfig = {
        run: 'if [ "$FSM_CTX_SIGNAL" = "PASS" ]; then echo "pass-state"; else echo "fail-state"; fi',
      };
      const context = { signal: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'pass-state');
    });

    it('should fall through to when clause if run script fails', async () => {
      const db = new Database(':memory:');
      const config = {
        initialState: 'test',
        states: [
          { name: 'test', coordinator: 'test' },
          { name: 'when-target', coordinator: 'test' },
        ],
        transitions: [],
      };
      const fsm = new MeshFSM('test', config, db, '/tmp');
      await fsm.initialize();

      const exit: FSMExitConfig = {
        run: 'exit 1',  // Script that fails
        when: [
          { condition: 'status == "PASS"', target: 'when-target' },
        ],
      };
      const context = { status: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'when-target');
    });

    it('should fall through to default if run script outputs invalid state', async () => {
      const db = new Database(':memory:');
      const config = {
        initialState: 'test',
        states: [
          { name: 'test', coordinator: 'test' },
          { name: 'default-state', coordinator: 'test' },
        ],
        transitions: [],
      };
      const fsm = new MeshFSM('test', config, db, '/tmp');
      await fsm.initialize();

      const exit: FSMExitConfig = {
        run: 'echo "non-existent-state"',  // Invalid state
        default: 'default-state',
      };
      const context = {};

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'default-state');
    });

    it('should prioritize run over when clauses', async () => {
      const db = new Database(':memory:');
      const config = {
        initialState: 'test',
        states: [
          { name: 'test', coordinator: 'test' },
          { name: 'run-target', coordinator: 'test' },
          { name: 'when-target', coordinator: 'test' },
        ],
        transitions: [],
      };
      const fsm = new MeshFSM('test', config, db, '/tmp');
      await fsm.initialize();

      const exit: FSMExitConfig = {
        run: 'run-target',  // Literal state name
        when: [
          { condition: 'status == "PASS"', target: 'when-target' },
        ],
      };
      const context = { status: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'run-target');
    });

    it('should handle multiline run scripts', async () => {
      const db = new Database(':memory:');
      const config = {
        initialState: 'test',
        states: [
          { name: 'test', coordinator: 'test' },
          { name: 'computed-state', coordinator: 'test' },
        ],
        transitions: [],
      };
      const fsm = new MeshFSM('test', config, db, '/tmp');
      await fsm.initialize();

      const exit: FSMExitConfig = {
        run: `
          signal="$FSM_CTX_SIGNAL"
          if [ "$signal" = "PASS" ]; then
            echo "computed-state"
          fi
        `,
      };
      const context = { signal: 'PASS' };

      const result = await fsm.evaluateExitRouting(exit, context);
      assert.strictEqual(result, 'computed-state');
    });
  });
});
