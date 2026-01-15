/**
 * SimpleExpressionEvaluator - Evaluates simple math and string expressions
 *
 * Purpose:
 * - Support basic arithmetic without shell execution
 * - Enable string concatenation with variables
 * - Fall back to shell for complex operations
 *
 * Supported operations:
 * - Arithmetic: +, -, *, /
 * - String concatenation: variable interpolation
 *
 * Examples:
 * - "$iteration + 1" → evaluates to number + 1
 * - "$count - 1" → evaluates to number - 1
 * - "attempt-$iteration" → string concatenation
 * - "$var * 2" → multiplication
 */

import { log } from '../shared/logger.ts';

/**
 * Result of expression evaluation
 */
export interface ExpressionResult {
  success: boolean;
  value: string | number;
  isSimpleExpression: boolean;  // True if evaluated without shell
  error?: string;
}

/**
 * Token types for expression parsing
 */
type TokenType = 'number' | 'variable' | 'operator' | 'string';

interface Token {
  type: TokenType;
  value: string | number;
  raw: string;
}

export class SimpleExpressionEvaluator {
  // Pattern for simple arithmetic: $var + 1, $var - 1, etc.
  // Matches: $variable OPERATOR value or value OPERATOR $variable
  // REQUIRES whitespace around operators to distinguish from path separators
  private static readonly ARITHMETIC_PATTERN =
    /^\s*\$(\w+)\s+([+\-*/])\s+(\d+(?:\.\d+)?)\s*$|^\s*(\d+(?:\.\d+)?)\s+([+\-*/])\s+\$(\w+)\s*$/;

  // Pattern for two-variable arithmetic: $var1 + $var2
  // REQUIRES whitespace around operators to distinguish from path separators like $mesh/$agent
  private static readonly TWO_VAR_ARITHMETIC_PATTERN =
    /^\s*\$(\w+)\s+([+\-*/])\s+\$(\w+)\s*$/;

  // Pattern for variable reference: $varname
  private static readonly VARIABLE_PATTERN = /\$(\w+)/g;

  // Pattern to detect if expression needs shell
  private static readonly NEEDS_SHELL_PATTERNS = [
    /\|/,           // Pipes
    /\$/,           // Command substitution after variable interpolation
    /`/,            // Backtick command substitution
    /[<>]/,         // Redirections
    /;/,            // Command separators
    /&&|\|\|/,      // Logical operators
    /\(/,           // Subshells
  ];

  /**
   * Evaluate a simple expression without shell execution
   *
   * @param expression - Expression to evaluate (e.g., "$iteration + 1")
   * @param context - Variable context for substitution
   * @returns Result with value and whether shell fallback is needed
   */
  evaluate(expression: string, context: Record<string, unknown>): ExpressionResult {
    const trimmed = expression.trim();

    log.debug('fsm-expression', 'Evaluating expression', {
      expression: trimmed,
      contextKeys: Object.keys(context),
    });

    // Check if expression needs shell first
    if (this.needsShell(trimmed)) {
      log.debug('fsm-expression', 'Expression requires shell execution', {
        expression: trimmed,
      });
      return {
        success: false,
        value: '',
        isSimpleExpression: false,
        error: 'Expression requires shell execution',
      };
    }

    // Try simple arithmetic first: $var OP number
    const arithmeticResult = this.tryArithmetic(trimmed, context);
    if (arithmeticResult.success) {
      log.debug('fsm-expression', 'Arithmetic evaluation succeeded', {
        expression: trimmed,
        result: arithmeticResult.value,
      });
      return arithmeticResult;
    }
    // If pattern matched but failed (e.g., division by zero, missing var), return error
    if (arithmeticResult.error) {
      return arithmeticResult;
    }

    // Try two-variable arithmetic: $var1 OP $var2
    const twoVarResult = this.tryTwoVarArithmetic(trimmed, context);
    if (twoVarResult.success) {
      log.debug('fsm-expression', 'Two-variable arithmetic succeeded', {
        expression: trimmed,
        result: twoVarResult.value,
      });
      return twoVarResult;
    }
    // If pattern matched but failed, return error
    if (twoVarResult.error) {
      return twoVarResult;
    }

    // Try string interpolation: "prefix-$var" or just "$var"
    const stringResult = this.tryStringInterpolation(trimmed, context);
    if (stringResult.success) {
      log.debug('fsm-expression', 'String interpolation succeeded', {
        expression: trimmed,
        result: stringResult.value,
      });
      return stringResult;
    }
    // If string interpolation failed with error (missing vars), return error
    if (stringResult.error) {
      return stringResult;
    }

    // Try to evaluate as pure string (no variables)
    return {
      success: true,
      value: trimmed,
      isSimpleExpression: true,
    };
  }

  /**
   * Try to evaluate as simple arithmetic: $var + number
   */
  private tryArithmetic(
    expression: string,
    context: Record<string, unknown>
  ): ExpressionResult {
    const match = expression.match(SimpleExpressionEvaluator.ARITHMETIC_PATTERN);

    if (!match) {
      return { success: false, value: '', isSimpleExpression: false };
    }

    // Pattern matches either: $var OP num OR num OP $var
    // Groups: [_, var1, op1, num1, num2, op2, var2]
    const varName = match[1] || match[6];
    const operator = match[2] || match[5];
    const numStr = match[3] || match[4];
    const varFirst = !!match[1];  // True if $var comes before number

    // Get variable value
    const varValue = context[varName];
    if (varValue === undefined || varValue === null) {
      return {
        success: false,
        value: '',
        isSimpleExpression: false,
        error: `Variable "${varName}" not found in context`,
      };
    }

    // Convert to numbers
    const varNum = Number(varValue);
    const num = Number(numStr);

    if (isNaN(varNum)) {
      return {
        success: false,
        value: '',
        isSimpleExpression: false,
        error: `Variable "${varName}" value "${varValue}" is not a number`,
      };
    }

    // Perform operation
    const result = this.performOperation(
      varFirst ? varNum : num,
      operator,
      varFirst ? num : varNum
    );

    if (result.error) {
      return {
        success: false,
        value: '',
        isSimpleExpression: false,
        error: result.error,
      };
    }

    return {
      success: true,
      value: result.value!,
      isSimpleExpression: true,
    };
  }

  /**
   * Try to evaluate two-variable arithmetic: $var1 + $var2
   */
  private tryTwoVarArithmetic(
    expression: string,
    context: Record<string, unknown>
  ): ExpressionResult {
    const match = expression.match(SimpleExpressionEvaluator.TWO_VAR_ARITHMETIC_PATTERN);

    if (!match) {
      return { success: false, value: '', isSimpleExpression: false };
    }

    const [, var1Name, operator, var2Name] = match;

    // Get variable values
    const var1Value = context[var1Name];
    const var2Value = context[var2Name];

    if (var1Value === undefined || var1Value === null) {
      return {
        success: false,
        value: '',
        isSimpleExpression: false,
        error: `Variable "${var1Name}" not found in context`,
      };
    }

    if (var2Value === undefined || var2Value === null) {
      return {
        success: false,
        value: '',
        isSimpleExpression: false,
        error: `Variable "${var2Name}" not found in context`,
      };
    }

    // Convert to numbers
    const num1 = Number(var1Value);
    const num2 = Number(var2Value);

    if (isNaN(num1)) {
      return {
        success: false,
        value: '',
        isSimpleExpression: false,
        error: `Variable "${var1Name}" value "${var1Value}" is not a number`,
      };
    }

    if (isNaN(num2)) {
      return {
        success: false,
        value: '',
        isSimpleExpression: false,
        error: `Variable "${var2Name}" value "${var2Value}" is not a number`,
      };
    }

    // Perform operation
    const result = this.performOperation(num1, operator, num2);

    if (result.error) {
      return {
        success: false,
        value: '',
        isSimpleExpression: false,
        error: result.error,
      };
    }

    return {
      success: true,
      value: result.value!,
      isSimpleExpression: true,
    };
  }

  /**
   * Perform arithmetic operation
   */
  private performOperation(
    left: number,
    operator: string,
    right: number
  ): { value?: number; error?: string } {
    switch (operator) {
      case '+':
        return { value: left + right };
      case '-':
        return { value: left - right };
      case '*':
        return { value: left * right };
      case '/':
        if (right === 0) {
          return { error: 'Division by zero' };
        }
        return { value: left / right };
      default:
        return { error: `Unknown operator: ${operator}` };
    }
  }

  /**
   * Try string interpolation with variable substitution
   */
  private tryStringInterpolation(
    expression: string,
    context: Record<string, unknown>
  ): ExpressionResult {
    // Check if expression contains any variables
    if (!expression.includes('$')) {
      return { success: false, value: '', isSimpleExpression: false };
    }

    // Check if this looks like it needs shell execution
    if (this.needsShell(expression)) {
      return { success: false, value: '', isSimpleExpression: false };
    }

    // Perform variable substitution
    let result = expression;
    let hasSubstitution = false;
    const missingVars: string[] = [];

    result = expression.replace(
      SimpleExpressionEvaluator.VARIABLE_PATTERN,
      (match, varName) => {
        const value = context[varName];
        if (value === undefined || value === null) {
          missingVars.push(varName);
          return match;  // Keep original $var if not found
        }
        hasSubstitution = true;
        return String(value);
      }
    );

    // If we still have unsubstituted variables, this needs shell
    if (result.includes('$')) {
      return {
        success: false,
        value: '',
        isSimpleExpression: false,
        error: `Missing variables: ${missingVars.join(', ')}`,
      };
    }

    return {
      success: true,
      value: result,
      isSimpleExpression: true,
    };
  }

  /**
   * Check if expression requires shell execution
   */
  private needsShell(expression: string): boolean {
    // First substitute all known variable patterns to check remaining content
    const withoutVars = expression.replace(
      SimpleExpressionEvaluator.VARIABLE_PATTERN,
      ''
    );

    // Check for shell-specific patterns in remaining content
    for (const pattern of SimpleExpressionEvaluator.NEEDS_SHELL_PATTERNS) {
      if (pattern.test(withoutVars)) {
        return true;
      }
    }

    // Check for command-like patterns
    if (withoutVars.includes('echo ') ||
        withoutVars.includes('yq ') ||
        withoutVars.includes('jq ')) {
      return true;
    }

    return false;
  }

  /**
   * Substitute variables in an expression string
   * Used for simple string interpolation without arithmetic
   */
  substituteVariables(
    expression: string,
    context: Record<string, unknown>
  ): string {
    return expression.replace(
      SimpleExpressionEvaluator.VARIABLE_PATTERN,
      (match, varName) => {
        const value = context[varName];
        if (value === undefined || value === null) {
          return match;  // Keep original $var if not found
        }
        return String(value);
      }
    );
  }

  /**
   * Check if an expression can be evaluated without shell
   */
  canEvaluateLocally(expression: string): boolean {
    // Quick check: no shell-specific patterns
    if (this.needsShell(expression)) {
      return false;
    }

    // Check for simple patterns we support
    const trimmed = expression.trim();

    // Simple arithmetic patterns
    if (SimpleExpressionEvaluator.ARITHMETIC_PATTERN.test(trimmed)) {
      return true;
    }

    // Two-variable arithmetic
    if (SimpleExpressionEvaluator.TWO_VAR_ARITHMETIC_PATTERN.test(trimmed)) {
      return true;
    }

    // Simple variable interpolation (no special shell chars)
    if (trimmed.includes('$') && !this.needsShell(trimmed)) {
      return true;
    }

    // Plain string (no variables, no shell)
    if (!trimmed.includes('$')) {
      return true;
    }

    return false;
  }
}

// Export singleton for convenience
export const expressionEvaluator = new SimpleExpressionEvaluator();
