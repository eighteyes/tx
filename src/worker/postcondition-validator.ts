/**
 * PostconditionValidator - Validates that required tool calls occurred during agent execution
 *
 * Prevents agents from hallucinating results instead of using their tools.
 * Example: gravity agent must run campaign.sh via Bash to read state, not fabricate collisions.yaml
 *
 * Features:
 * - Pattern matching: substring search in Bash commands or Write paths
 * - Exit code validation: Bash calls must exit 0 (configurable)
 * - Call counting: enforce minimum number of tool calls
 * - Guardrail modes: strict (kill), warning (feedback), silent (log only)
 */

import { EventEmitter } from 'node:events';
import { log } from '../shared/logger.ts';
import type { GuardrailMode } from './guardrail-config.ts';

/**
 * Tool call record captured during SDK session
 */
export interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  exitCode?: number;  // For Bash only
}

/**
 * Postcondition configuration for a single tool call requirement
 */
export interface ToolCallPostcondition {
  tool: string;          // Tool name (e.g., 'Bash', 'Write')
  pattern?: string;      // Substring to match in command/path (optional)
  exit_code?: number;    // Required exit code for Bash (default: 0)
  min_calls?: number;    // Minimum number of matching calls (default: 1)
}

/**
 * Postcondition config schema for agent
 */
export interface PostconditionConfig {
  tool_calls?: ToolCallPostcondition[];
}

/**
 * Validation result
 */
export interface PostconditionValidationResult {
  passed: boolean;
  failures: string[];  // Human-readable failure messages
}

export interface PostconditionValidatorConfig {
  agentId: string;
  mode: GuardrailMode;
  sessionId?: string;
}

/**
 * PostconditionValidator - Validates tool call postconditions after agent execution
 */
export class PostconditionValidator extends EventEmitter {
  private config: PostconditionValidatorConfig;

  constructor(config: PostconditionValidatorConfig) {
    super();
    this.config = config;
  }

  /**
   * Validate postconditions against captured tool calls
   * Returns validation result with pass/fail and specific failure reasons
   */
  validate(
    postconditions: PostconditionConfig | undefined,
    toolCalls: ToolCallRecord[]
  ): PostconditionValidationResult {
    // No postconditions = automatic pass
    if (!postconditions?.tool_calls || postconditions.tool_calls.length === 0) {
      return { passed: true, failures: [] };
    }

    const failures: string[] = [];

    // Validate each postcondition
    for (const condition of postconditions.tool_calls) {
      const failure = this.validateSingleCondition(condition, toolCalls);
      if (failure) {
        failures.push(failure);
      }
    }

    const passed = failures.length === 0;

    // Log result
    if (passed) {
      log.info('postcondition-validator', 'Postcondition validation passed', {
        agentId: this.config.agentId,
        sessionId: this.config.sessionId,
        conditions: postconditions.tool_calls.length,
        toolCalls: toolCalls.length,
      });
      log.activity('guardrail:postcondition', this.config.agentId, 'Postcondition PASS');
      this.emit('postcondition:passed', {
        agentId: this.config.agentId,
        sessionId: this.config.sessionId,
        conditions: postconditions.tool_calls.length,
      });
    } else {
      const failuresSummary = failures.join('; ');
      log.warn('postcondition-validator', 'Postcondition validation failed', {
        agentId: this.config.agentId,
        sessionId: this.config.sessionId,
        failures,
        conditions: postconditions.tool_calls.length,
        toolCalls: toolCalls.length,
      });
      log.activity('guardrail:postcondition', this.config.agentId,
        `Postcondition FAIL: ${failuresSummary}`);
      this.emit('postcondition:failed', {
        agentId: this.config.agentId,
        sessionId: this.config.sessionId,
        failures,
      });
    }

    return { passed, failures };
  }

  /**
   * Validate a single postcondition against tool calls
   * Returns failure message if validation fails, null if passes
   */
  private validateSingleCondition(
    condition: ToolCallPostcondition,
    toolCalls: ToolCallRecord[]
  ): string | null {
    const { tool, pattern, exit_code, min_calls } = condition;

    // Default values
    const requiredExitCode = exit_code !== undefined ? exit_code : 0;
    const requiredMinCalls = min_calls !== undefined ? min_calls : 1;

    // Filter tool calls matching this condition
    const matchingCalls = toolCalls.filter(call => {
      // Tool name must match
      if (call.tool !== tool) return false;

      // Pattern matching (substring)
      if (pattern) {
        const matched = this.matchesPattern(call, pattern);
        if (!matched) return false;
      }

      // Exit code validation (Bash only)
      if (tool === 'Bash') {
        // If exit_code is specified or defaulted to 0, validate it
        if (call.exitCode !== requiredExitCode) return false;
      }

      return true;
    });

    // Check min_calls threshold
    if (matchingCalls.length < requiredMinCalls) {
      return this.formatFailureMessage(
        condition,
        matchingCalls.length,
        requiredMinCalls,
        requiredExitCode
      );
    }

    return null;
  }

  /**
   * Check if tool call matches pattern (substring search)
   */
  private matchesPattern(call: ToolCallRecord, pattern: string): boolean {
    switch (call.tool) {
      case 'Bash': {
        const command = call.input.command as string | undefined;
        return command ? command.includes(pattern) : false;
      }
      case 'Write': {
        const filePath = call.input.file_path as string | undefined;
        return filePath ? filePath.includes(pattern) : false;
      }
      case 'Read': {
        const filePath = call.input.file_path as string | undefined;
        return filePath ? filePath.includes(pattern) : false;
      }
      case 'Edit': {
        const filePath = call.input.file_path as string | undefined;
        return filePath ? filePath.includes(pattern) : false;
      }
      default:
        // For other tools, check if pattern appears in any string input value
        return Object.values(call.input).some(value =>
          typeof value === 'string' && value.includes(pattern)
        );
    }
  }

  /**
   * Format a human-readable failure message
   */
  private formatFailureMessage(
    condition: ToolCallPostcondition,
    actualCalls: number,
    requiredCalls: number,
    requiredExitCode: number
  ): string {
    const parts: string[] = [];

    // Tool + pattern
    if (condition.pattern) {
      parts.push(`${condition.tool}("${condition.pattern}")`);
    } else {
      parts.push(condition.tool);
    }

    // Call count
    parts.push(`not called (expected ${requiredCalls}+ calls, got ${actualCalls})`);

    // Exit code detail (Bash only)
    if (condition.tool === 'Bash' && condition.exit_code !== undefined) {
      parts.push(`with exit code ${requiredExitCode}`);
    }

    return parts.join(' ');
  }

  /**
   * Build system message for warning mode (inject feedback)
   */
  buildWarningMessage(failures: string[]): string {
    return `⚠️ **Postcondition Validation Failed**

The following required tool calls did not occur:

${failures.map(f => `- ${f}`).join('\n')}

**What this means:**
You may have hallucinated results instead of using the specified tools. Please review your approach and ensure you are calling the required tools with the correct inputs.

**Expected behavior:**
Each postcondition must be satisfied for the task to be considered complete. Retry with the correct tool calls.`;
  }
}
