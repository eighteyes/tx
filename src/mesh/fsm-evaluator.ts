/**
 * ConditionEvaluator - Parses and evaluates conditional expressions for FSM routing
 *
 * Supports Phase 1 operators:
 * - == : String equality
 * - != : String inequality
 *
 * Syntax: "variable == value" or "variable != value"
 * Values can be quoted or unquoted
 */

import { log } from '../shared/logger.ts';

/**
 * Parsed condition components
 */
export interface ParsedCondition {
  variable: string;
  operator: '==' | '!=';
  value: string;
}

/**
 * ConditionEvaluator class for parsing and evaluating conditions
 */
export class ConditionEvaluator {
  // Regex pattern for condition parsing
  // Matches: variable operator value
  // Where operator is == or !=
  // Value can be quoted ("value") or unquoted (value) or empty ("")
  private static readonly CONDITION_PATTERN = /^(\w+)\s*(==|!=)\s*"?([^"]*)"?$/;

  /**
   * Parse a condition string into its components
   * @param condition - Condition string like "var == value" or "var != \"value\""
   * @returns Parsed condition with variable, operator, and value
   * @throws Error if condition syntax is invalid
   */
  parse(condition: string): ParsedCondition {
    const trimmed = condition.trim();

    // Check for empty condition
    if (!trimmed) {
      throw new Error('Condition cannot be empty');
    }

    const match = trimmed.match(ConditionEvaluator.CONDITION_PATTERN);

    if (!match) {
      throw new Error(
        `Invalid condition syntax: "${condition}". ` +
        'Expected format: "variable == value" or "variable != value"'
      );
    }

    const [, variable, operator, value] = match;

    // Validate operator (should already be validated by regex, but be explicit)
    if (operator !== '==' && operator !== '!=') {
      throw new Error(`Invalid operator: "${operator}". Only == and != are supported.`);
    }

    // Note: value is already clean - the regex pattern [^"]* excludes quotes
    return {
      variable: variable.trim(),
      operator: operator as '==' | '!=',
      value: value,
    };
  }

  /**
   * Evaluate a condition against a context
   * @param condition - Condition string to evaluate
   * @param context - Context variables (all values treated as strings)
   * @returns True if condition evaluates to true
   */
  evaluate(condition: string, context: Record<string, unknown>): boolean {
    try {
      const parsed = this.parse(condition);

      // Get variable value from context
      // Convert to string for comparison (all FSM context values are strings)
      const contextValue = context[parsed.variable];
      const contextValueStr = contextValue !== undefined && contextValue !== null
        ? String(contextValue)
        : '';

      // Perform comparison based on operator
      let result: boolean;
      switch (parsed.operator) {
        case '==':
          result = contextValueStr === parsed.value;
          break;
        case '!=':
          result = contextValueStr !== parsed.value;
          break;
        default:
          // Should never reach here due to parse validation
          throw new Error(`Unknown operator: ${parsed.operator}`);
      }

      log.debug('fsm-evaluator', 'Evaluated condition', {
        condition,
        variable: parsed.variable,
        operator: parsed.operator,
        expectedValue: parsed.value,
        actualValue: contextValueStr,
        result,
      });

      return result;
    } catch (error) {
      log.error('fsm-evaluator', 'Failed to evaluate condition', {
        condition,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return false on error (fail-safe)
      return false;
    }
  }

  /**
   * Validate condition syntax without evaluating
   * @param condition - Condition string to validate
   * @returns True if syntax is valid
   */
  isValid(condition: string): boolean {
    try {
      this.parse(condition);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get list of supported operators
   */
  static getSupportedOperators(): string[] {
    return ['==', '!='];
  }
}
