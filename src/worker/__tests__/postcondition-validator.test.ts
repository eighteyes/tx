/**
 * PostconditionValidator tests
 *
 * Tests postcondition validation for tool call requirements.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PostconditionValidator, type ToolCallRecord, type PostconditionConfig } from '../postcondition-validator.ts';
import type { GuardrailMode } from '../guardrail-config.ts';

describe('PostconditionValidator', () => {
  let validator: PostconditionValidator;
  const defaultMode: GuardrailMode = { strict: false, warning: true };

  beforeEach(() => {
    validator = new PostconditionValidator({
      agentId: 'test-agent',
      mode: defaultMode,
    });
  });

  describe('Happy path - valid tool calls', () => {
    it('should pass when required Bash call is present with correct exit code', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'campaign.sh', exit_code: 0 },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: './campaign.sh --run' }, exitCode: 0 },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should pass validation');
      assert.strictEqual(result.failures.length, 0, 'Should have no failures');
    });

    it('should pass when required Write call is present', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Write', pattern: 'output.json' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Write', input: { file_path: '/path/to/output.json', content: '{}' } },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should pass validation');
      assert.strictEqual(result.failures.length, 0, 'Should have no failures');
    });

    it('should pass when multiple postconditions are all satisfied', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'campaign.sh', exit_code: 0 },
          { tool: 'Write', pattern: 'output.json', min_calls: 1 },
          { tool: 'Read', pattern: 'config.yaml' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: './campaign.sh' }, exitCode: 0 },
        { tool: 'Write', input: { file_path: 'output.json', content: '{}' } },
        { tool: 'Read', input: { file_path: 'config.yaml' } },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should pass validation');
      assert.strictEqual(result.failures.length, 0, 'Should have no failures');
    });

    it('should pass when min_calls threshold is met', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Write', pattern: 'report', min_calls: 3 },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Write', input: { file_path: 'report-1.md', content: 'a' } },
        { tool: 'Write', input: { file_path: 'report-2.md', content: 'b' } },
        { tool: 'Write', input: { file_path: 'report-3.md', content: 'c' } },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should pass validation');
    });

    it('should pass when no postconditions are defined', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [],
      };

      const toolCalls: ToolCallRecord[] = [];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should pass validation');
      assert.strictEqual(result.failures.length, 0, 'Should have no failures');
    });

    it('should pass when postconditions is undefined', () => {
      const result = validator.validate(undefined, []);
      assert.strictEqual(result.passed, true, 'Should pass validation');
      assert.strictEqual(result.failures.length, 0, 'Should have no failures');
    });
  });

  describe('Missing tool call', () => {
    it('should fail when required Bash call is absent', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'campaign.sh', exit_code: 0 },
        ],
      };

      const toolCalls: ToolCallRecord[] = [];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, false, 'Should fail validation');
      assert.strictEqual(result.failures.length, 1, 'Should have one failure');
      assert.match(result.failures[0], /Bash.*campaign\.sh.*not called/i, 'Should mention missing Bash call');
    });

    it('should fail when required Write call is absent', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Write', pattern: 'output.json' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Write', input: { file_path: 'other.json', content: '{}' } },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, false, 'Should fail validation');
      assert.strictEqual(result.failures.length, 1, 'Should have one failure');
    });

    it('should fail when tool name matches but pattern does not', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'test.sh' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: 'different.sh' }, exitCode: 0 },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, false, 'Should fail validation');
    });
  });

  describe('Wrong exit code', () => {
    it('should fail when Bash exit code does not match expected', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'campaign.sh', exit_code: 0 },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: './campaign.sh' }, exitCode: 1 },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, false, 'Should fail validation');
      assert.strictEqual(result.failures.length, 1, 'Should have one failure');
    });

    it('should pass when Bash exit code matches custom expected value', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'check.sh', exit_code: 2 },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: './check.sh' }, exitCode: 2 },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should pass validation');
    });

    it('should default to exit code 0 when not specified', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'script.sh' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: 'script.sh' }, exitCode: 1 },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, false, 'Should fail when exit code is not 0');
    });
  });

  describe('Below min_calls threshold', () => {
    it('should fail when call count is below min_calls', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Write', pattern: 'report', min_calls: 3 },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Write', input: { file_path: 'report-1.md', content: 'a' } },
        { tool: 'Write', input: { file_path: 'report-2.md', content: 'b' } },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, false, 'Should fail validation');
      assert.match(result.failures[0], /expected 3\+ calls, got 2/i, 'Should mention call count mismatch');
    });

    it('should default min_calls to 1 when not specified', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Read', pattern: 'config.yaml' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, false, 'Should fail when no matching calls');
      assert.match(result.failures[0], /expected 1\+ calls, got 0/i, 'Should use default min_calls of 1');
    });

    it('should pass when call count exceeds min_calls', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Write', pattern: 'log', min_calls: 2 },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Write', input: { file_path: 'log-1.txt', content: 'a' } },
        { tool: 'Write', input: { file_path: 'log-2.txt', content: 'b' } },
        { tool: 'Write', input: { file_path: 'log-3.txt', content: 'c' } },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should pass when call count exceeds min_calls');
    });
  });

  describe('Mode overrides', () => {
    it('should respect strict mode', () => {
      const strictValidator = new PostconditionValidator({
        agentId: 'test-agent',
        mode: { strict: true, warning: false },
      });

      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'required.sh' },
        ],
      };

      const result = strictValidator.validate(postconditions, []);
      assert.strictEqual(result.passed, false, 'Should fail validation');
    });

    it('should respect warning mode', () => {
      const warningValidator = new PostconditionValidator({
        agentId: 'test-agent',
        mode: { strict: false, warning: true },
      });

      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'required.sh' },
        ],
      };

      const result = warningValidator.validate(postconditions, []);
      assert.strictEqual(result.passed, false, 'Should fail validation');
    });

    it('should build warning message with failure details', () => {
      const failures = [
        'Bash("campaign.sh") not called (expected 1+ calls, got 0)',
        'Write("output.json") not called (expected 1+ calls, got 0)',
      ];

      const message = validator.buildWarningMessage(failures);
      assert.match(message, /Postcondition Validation Failed/i, 'Should include header');
      assert.match(message, /campaign\.sh/i, 'Should include first failure');
      assert.match(message, /output\.json/i, 'Should include second failure');
      assert.match(message, /hallucinated/i, 'Should mention hallucination risk');
    });
  });

  describe('Pattern matching', () => {
    it('should match substring in Bash command', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'campaign' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: './scripts/campaign.sh --verbose' }, exitCode: 0 },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should match pattern in command');
    });

    it('should match substring in Write file_path', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Write', pattern: 'output' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Write', input: { file_path: '/tmp/output-final.json', content: '{}' } },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should match pattern in file_path');
    });

    it('should match substring in Read file_path', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Read', pattern: 'config' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Read', input: { file_path: '/etc/config.yaml' } },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should match pattern in file_path');
    });

    it('should match substring in Edit file_path', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Edit', pattern: 'main.ts' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Edit', input: { file_path: 'src/main.ts', old_string: 'a', new_string: 'b' } },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should match pattern in file_path');
    });

    it('should validate multiple patterns independently', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'setup.sh' },
          { tool: 'Bash', pattern: 'cleanup.sh' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: './setup.sh' }, exitCode: 0 },
        { tool: 'Bash', input: { command: './cleanup.sh' }, exitCode: 0 },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should validate multiple patterns');
    });

    it('should fail if only some patterns match', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'setup.sh' },
          { tool: 'Bash', pattern: 'cleanup.sh' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: './setup.sh' }, exitCode: 0 },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, false, 'Should fail when not all patterns match');
      assert.strictEqual(result.failures.length, 1, 'Should have one failure');
    });
  });

  describe('Event emission', () => {
    it('should emit postcondition:passed event on success', (context, done) => {
      validator.once('postcondition:passed', (data) => {
        assert.strictEqual(data.agentId, 'test-agent', 'Should include agent ID');
        assert.strictEqual(data.conditions, 1, 'Should include condition count');
        done();
      });

      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'test.sh', exit_code: 0 },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: 'test.sh' }, exitCode: 0 },
      ];

      validator.validate(postconditions, toolCalls);
    });

    it('should emit postcondition:failed event on failure', (context, done) => {
      validator.once('postcondition:failed', (data) => {
        assert.strictEqual(data.agentId, 'test-agent', 'Should include agent ID');
        assert.ok(data.failures.length > 0, 'Should include failures');
        done();
      });

      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash', pattern: 'missing.sh' },
        ],
      };

      validator.validate(postconditions, []);
    });
  });

  describe('Tool without pattern', () => {
    it('should match tool name only when pattern is omitted', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Bash' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [
        { tool: 'Bash', input: { command: 'any-command.sh' }, exitCode: 0 },
      ];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, true, 'Should match tool without pattern');
    });

    it('should fail when tool is not called even without pattern', () => {
      const postconditions: PostconditionConfig = {
        tool_calls: [
          { tool: 'Write' },
        ],
      };

      const toolCalls: ToolCallRecord[] = [];

      const result = validator.validate(postconditions, toolCalls);
      assert.strictEqual(result.passed, false, 'Should fail when tool not called');
    });
  });
});
