/**
 * Rearmatter Schema
 *
 * Defines the structure for agent self-report blocks that appear after the third
 * `---` delimiter in message files. Rearmatter is a lean 7-field self-assessment
 * that agents write after signaling work completion.
 *
 * See: docs/superpowers/specs/2026-03-16-work-assay-creation-design.md
 */

/**
 * Agent's self-assessed grade with confidence score and limiting factors
 */
export interface RearmatterGrade {
  /** Agent's confidence in its own work (0-1 scale) */
  confidence: number;
  /** List of factors that limited the agent's confidence or work quality */
  limiting_factors: string[];
}

/**
 * Complete rearmatter structure - agent's self-report
 */
export interface Rearmatter {
  /** Agent's restatement of the original intent/task */
  understanding: string;
  /** How the agent decided what to do (method, not results) */
  strategy: string;
  /** What the agent actually did (actions taken) */
  actions: string;
  /** Honest self-assessment: done, partial, stuck, confused, diverged */
  result: string;
  /** Agent's self-assessed confidence and limiting factors */
  grade: RearmatterGrade;
  /** Files and state changes made */
  changes: string[];
  /** Things the agent noticed as shaky or uncertain */
  uncertainties: string[];
  /** What to do if work continued */
  next_steps: string[];
}

/**
 * Validate rearmatter structure
 * Returns list of missing/invalid fields (empty array = valid)
 */
export function validateRearmatter(data: unknown): string[] {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return ['rearmatter must be an object'];
  }

  const r = data as Record<string, unknown>;

  // Check required string fields
  const stringFields = ['understanding', 'strategy', 'actions', 'result'];
  for (const field of stringFields) {
    if (typeof r[field] !== 'string') {
      errors.push(`${field} must be a string`);
    }
  }

  // Check grade object
  if (!r.grade || typeof r.grade !== 'object') {
    errors.push('grade must be an object');
  } else {
    const grade = r.grade as Record<string, unknown>;
    if (typeof grade.confidence !== 'number') {
      errors.push('grade.confidence must be a number');
    } else if (grade.confidence < 0 || grade.confidence > 1) {
      errors.push('grade.confidence must be between 0 and 1');
    }
    if (!Array.isArray(grade.limiting_factors)) {
      errors.push('grade.limiting_factors must be an array');
    }
  }

  // Check array fields
  const arrayFields = ['changes', 'uncertainties', 'next_steps'];
  for (const field of arrayFields) {
    if (!Array.isArray(r[field])) {
      errors.push(`${field} must be an array`);
    }
  }

  return errors;
}

/**
 * Extract confidence score from rearmatter
 * Returns undefined if rearmatter invalid or confidence missing
 */
export function extractConfidence(rearmatter: Record<string, unknown> | null): number | undefined {
  if (!rearmatter) return undefined;

  const grade = rearmatter.grade as Record<string, unknown> | undefined;
  if (!grade) return undefined;

  const confidence = grade.confidence;
  if (typeof confidence !== 'number') return undefined;
  if (confidence < 0 || confidence > 1) return undefined;

  return confidence;
}

/**
 * Check if rearmatter data contains all expected fields
 * Returns object with field presence status
 */
export function checkRearmatterCompleteness(data: unknown): {
  complete: boolean;
  present: string[];
  missing: string[];
} {
  const expectedFields = [
    'understanding',
    'strategy',
    'actions',
    'result',
    'grade',
    'changes',
    'uncertainties',
    'next_steps',
  ];

  if (!data || typeof data !== 'object') {
    return {
      complete: false,
      present: [],
      missing: expectedFields,
    };
  }

  const r = data as Record<string, unknown>;
  const present: string[] = [];
  const missing: string[] = [];

  for (const field of expectedFields) {
    if (r[field] !== undefined) {
      present.push(field);
    } else {
      missing.push(field);
    }
  }

  return {
    complete: missing.length === 0,
    present,
    missing,
  };
}
