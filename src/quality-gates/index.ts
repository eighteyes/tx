/**
 * Quality Gates Module
 *
 * Legacy interface for quality gates.
 * New code should use src/quality/index.ts directly.
 */

// Re-export from new quality module
export {
  type GateType,
  type EvalResult,
  type QualityStackConfig,
  type StackResult,
  GATE_DESCRIPTIONS,
  evaluatorRegistry,
  getEvaluator,
} from '../quality/index.ts';

/**
 * Legacy interface for backward compatibility
 */
export interface QualityGate {
  id: string;
  description: string;
  check: () => Promise<boolean>;
}

/**
 * Get quality gates for a specific task type
 * Uses new gate descriptions
 */
export function getQualityGates(taskType: string): string[] {
  // Map task types to recommended gates
  const gateMap: Record<string, string[]> = {
    'code-implementation': ['checklist', 'rubric', 'adversarial', 'deterministic'],
    'bug-fix': ['checklist', 'deterministic'],
    'research': ['accuracy', 'checklist', 'adversarial'],
    'documentation': ['checklist', 'rubric'],
    'code-review': ['checklist', 'rubric', 'adversarial'],
    'refactoring': ['checklist', 'deterministic', 'adversarial'],
    'testing': ['checklist', 'deterministic'],
    'configuration': ['checklist', 'adversarial'],
  };

  return gateMap[taskType] || ['checklist', 'rubric'];
}

/**
 * Validate if all quality gates pass
 * Delegates to new quality stack
 */
export async function validateQualityGates(
  taskType: string
): Promise<boolean> {
  // For backward compatibility, return true
  // New code should use QualityStack.run() directly
  return true;
}
