/**
 * Assay Schema (v0.1.0)
 *
 * Defines the structure for work assay artifacts produced by summarizer agents.
 * Assays are structured audits that cross-check agent self-reports (rearmatter)
 * against observable evidence (session trace) and original intent.
 *
 * See: docs/superpowers/specs/2026-03-16-work-assay-creation-design.md
 */

/**
 * Provenance metadata - where and how the assay was created
 */
export interface AssayProvenance {
  mesh_id: string;
  session_id: string;
  platform: string;
  model: string;
}

/**
 * Iteration tracking for retry scenarios
 */
export interface AssayIteration {
  attempt: number;
  previous_assay_id?: string;
  delta?: string; // Change from previous attempt
}

/**
 * Summarizer's assessment grade (confidence in ability to assess)
 */
export interface AssayGrade {
  confidence: number; // 0-1
  limiting_factors: string[];
}

/**
 * Strategy assessment - claimed vs observed alignment
 */
export interface AssayStrategy {
  claimed: string;
  observed: string;
  alignment: 'aligned' | 'partial' | 'diverged';
  appropriateness: string;
}

/**
 * Delta - what changed
 */
export interface AssayDelta {
  files_changed: string[];
  mutations: string[];
  state_changes: string[];
}

/**
 * Residue - what remains unfinished
 */
export interface AssayResidue {
  open_questions: string[];
  unresolved_problems: string[];
  deferred_work: string[];
}

/**
 * Discrepancy between testimony and evidence
 */
export interface AssayDiscrepancy {
  field: string;
  testimony: string;
  evidence: string;
  severity: 'minor' | 'moderate' | 'major';
}

/**
 * Gap - what's missing
 */
export interface AssayGap {
  description: string;
  impact: string;
  category: 'coverage' | 'validation' | 'documentation' | 'testing' | 'other';
}

/**
 * Opportunity - opened doors
 */
export interface AssayOpportunity {
  description: string;
  value: string;
  category: string;
}

/**
 * Assumption made during work
 */
export interface AssayAssumption {
  assumption: string;
  blast_radius: string;
  verified: boolean;
}

/**
 * Dependency identified
 */
export interface AssayDependency {
  dependency: string;
  verified: boolean;
  risk_if_false: string;
}

/**
 * Risk created or identified
 */
export interface AssayRisk {
  exposure: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affected_scope: string;
}

/**
 * Artifact produced
 */
export interface AssayArtifact {
  path: string;
  type: string;
  description: string;
}

/**
 * Cost metrics
 */
export interface AssayCost {
  tokens: number;
  tool_calls: number;
  elapsed_seconds: number;
  turns: number;
}

/**
 * Speculation - where summarizer is inferring, not observing
 */
export interface AssaySpeculation {
  field: string;
  inference: string;
  confidence: number;
  basis: string;
}

/**
 * Complete Assay structure
 */
export interface Assay {
  // System metadata
  version: string; // Schema version (e.g., "0.1.0")
  assay_id: string; // Unique identifier
  created_at: string; // ISO timestamp
  provenance: AssayProvenance;
  iteration: AssayIteration;

  // Frozen context
  intent: string; // Original message verbatim

  // Summarizer analysis
  verdict: 'done' | 'partial' | 'failed' | 'diverged';
  grade: AssayGrade;
  strategy: AssayStrategy;
  delta: AssayDelta;
  residue: AssayResidue;
  discrepancies: AssayDiscrepancy[];
  gaps: AssayGap[];
  opportunities: AssayOpportunity[];
  assumptions: AssayAssumption[];
  dependencies: AssayDependency[];
  risks: AssayRisk[];
  artifacts: AssayArtifact[];
  cost: AssayCost;
  speculations: AssaySpeculation[];
  narrative: string; // One-paragraph human-readable story
}

/**
 * Validate assay structure
 * Returns list of missing/invalid required fields (empty array = valid)
 */
export function validateAssay(data: unknown): string[] {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return ['assay must be an object'];
  }

  const a = data as Record<string, unknown>;

  // Check required string fields
  const stringFields = ['version', 'assay_id', 'created_at', 'intent', 'verdict', 'narrative'];
  for (const field of stringFields) {
    if (typeof a[field] !== 'string') {
      errors.push(`${field} must be a string`);
    }
  }

  // Check verdict enum
  const validVerdicts = ['done', 'partial', 'failed', 'diverged'];
  if (!validVerdicts.includes(a.verdict as string)) {
    errors.push(`verdict must be one of: ${validVerdicts.join(', ')}`);
  }

  // Check required objects
  const objectFields = ['provenance', 'iteration', 'grade', 'strategy', 'delta', 'residue', 'cost'];
  for (const field of objectFields) {
    if (!a[field] || typeof a[field] !== 'object') {
      errors.push(`${field} must be an object`);
    }
  }

  // Check required arrays
  const arrayFields = [
    'discrepancies',
    'gaps',
    'opportunities',
    'assumptions',
    'dependencies',
    'risks',
    'artifacts',
    'speculations',
  ];
  for (const field of arrayFields) {
    if (!Array.isArray(a[field])) {
      errors.push(`${field} must be an array`);
    }
  }

  return errors;
}

/**
 * Create empty assay template with system fields populated
 */
export function createAssayTemplate(
  meshId: string,
  sessionId: string,
  intent: string,
  platform: string = 'claude-sdk',
  model: string = 'claude-sonnet-4'
): Assay {
  const now = new Date().toISOString();
  const assayId = `${meshId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  return {
    version: '0.1.0',
    assay_id: assayId,
    created_at: now,
    provenance: {
      mesh_id: meshId,
      session_id: sessionId,
      platform,
      model,
    },
    iteration: {
      attempt: 1,
    },
    intent,
    verdict: 'partial',
    grade: {
      confidence: 0,
      limiting_factors: [],
    },
    strategy: {
      claimed: '',
      observed: '',
      alignment: 'partial',
      appropriateness: '',
    },
    delta: {
      files_changed: [],
      mutations: [],
      state_changes: [],
    },
    residue: {
      open_questions: [],
      unresolved_problems: [],
      deferred_work: [],
    },
    discrepancies: [],
    gaps: [],
    opportunities: [],
    assumptions: [],
    dependencies: [],
    risks: [],
    artifacts: [],
    cost: {
      tokens: 0,
      tool_calls: 0,
      elapsed_seconds: 0,
      turns: 0,
    },
    speculations: [],
    narrative: '',
  };
}
