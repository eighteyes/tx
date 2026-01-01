/**
 * Evaluator Registry
 *
 * Registry pattern for quality gate evaluators.
 * Allows registering and retrieving evaluators by gate type.
 */

import type { GateType, Evaluator, EvalResult, PreflightOutput, RearmatterData } from './types.ts';
import { log } from '../shared/logger.ts';

/**
 * Registry for evaluator implementations
 */
class EvaluatorRegistry {
  private evaluators = new Map<GateType, Evaluator>();

  /**
   * Register an evaluator for a gate type
   */
  register(gate: GateType, evaluator: Evaluator): void {
    if (evaluator.gate !== gate) {
      throw new Error(`Evaluator gate mismatch: expected ${gate}, got ${evaluator.gate}`);
    }
    this.evaluators.set(gate, evaluator);
    log.debug('quality-registry', `Registered evaluator: ${gate}`);
  }

  /**
   * Get an evaluator by gate type
   */
  get(gate: GateType): Evaluator | undefined {
    return this.evaluators.get(gate);
  }

  /**
   * Check if an evaluator is registered for a gate
   */
  has(gate: GateType): boolean {
    return this.evaluators.has(gate);
  }

  /**
   * Get all registered gate types
   */
  getRegisteredGates(): GateType[] {
    return Array.from(this.evaluators.keys());
  }

  /**
   * Clear all registered evaluators (mainly for testing)
   */
  clear(): void {
    this.evaluators.clear();
  }
}

/**
 * Global evaluator registry instance
 */
export const evaluatorRegistry = new EvaluatorRegistry();

/**
 * Base abstract evaluator class
 * Provides common functionality for all evaluators
 */
export abstract class BaseEvaluator implements Evaluator {
  abstract gate: GateType;

  /**
   * Evaluate a solution
   */
  abstract evaluate(
    solution: string,
    rearmatter: RearmatterData,
    criteria: PreflightOutput,
    priorEvals?: EvalResult[]
  ): Promise<EvalResult>;

  /**
   * Create a passing result
   */
  protected pass(details?: Record<string, unknown>, feedback?: string): EvalResult {
    return {
      gate: this.gate,
      passed: true,
      confidence: 1.0,
      details,
      feedback,
    };
  }

  /**
   * Create a failing result
   */
  protected fail(feedback: string, details?: Record<string, unknown>, confidence?: number): EvalResult {
    return {
      gate: this.gate,
      passed: false,
      feedback,
      confidence: confidence ?? 0.0,
      details,
    };
  }
}

/**
 * Register an evaluator in the global registry
 */
export function registerEvaluator(gate: GateType, evaluator: Evaluator): void {
  evaluatorRegistry.register(gate, evaluator);
}

/**
 * Get an evaluator from the global registry
 */
export function getEvaluator(gate: GateType): Evaluator | undefined {
  return evaluatorRegistry.get(gate);
}
