/**
 * Quality Stack Types
 *
 * Composable evaluation pipeline for validating agent outputs.
 * Supports pre-flight criteria generation and configurable quality gates.
 */

/**
 * Available quality gate types
 */
export type GateType =
  | 'summarizer'   // Consensus from ensemble (weights by rearmatter confidence)
  | 'checklist'    // Task-type specific verification
  | 'rubric'       // Dynamic criteria from pre-flight
  | 'adversarial'  // Challenge assumptions, find weaknesses
  | 'accuracy'     // Validate vs sources, check first-party vs second-party
  | 'deterministic'; // Run tests, lint, type checks

/**
 * Graded config in mesh config
 * - false: No quality stack (default)
 * - true: Pre-flight decides stack
 * - string[]: These gates required, pre-flight may add more
 */
export type GradedConfig = boolean | GateType[];

/**
 * Fail action for evaluation stages
 */
export type FailAction = 'loop' | 'flag' | 'halt';

/**
 * Evaluation stage configuration
 */
export interface EvalStage {
  type: 'llm' | 'deterministic';
  gate: GateType;
  agent?: string;              // For LLM gates - which agent runs evaluation
  command?: string;            // For deterministic - shell command to run
  criteria: 'from_preflight' | 'static' | 'none';
  failAction: FailAction;
}

/**
 * Quality stack configuration
 */
export interface QualityStackConfig {
  preflight: boolean;          // Whether to run pre-flight agent
  stages: EvalStage[];         // Ordered list of evaluation stages
  maxIterations: number;       // Max re-runs on failure
  evalChain: boolean;          // Whether evaluators see prior evals
}

/**
 * Result from a single evaluation
 */
export interface EvalResult {
  gate: GateType;
  passed: boolean;
  feedback?: string;           // Feedback for improvement
  confidence?: number;         // 0-1 confidence score
  details?: Record<string, unknown>;
  duration?: number;           // Milliseconds taken
}

/**
 * Rubric item for grading
 */
export interface RubricItem {
  criterion: string;
  weight: number;              // 0-1 weight
  description: string;
}

/**
 * Effort level for task estimation
 */
export type EffortLevel = 'light' | 'medium' | 'heavy';

/**
 * Pre-flight agent output schema
 */
export interface PreflightOutput {
  taskType: string;            // e.g., 'code-review', 'research', 'implementation'
  checklist: string[];         // Task-specific checklist items (outcome-focused)
  rubric: RubricItem[];        // Grading rubric (outcome-focused)
  requiredGates: GateType[];   // Gates that MUST pass
  suggestedGates: GateType[];  // Gates pre-flight recommends
  accuracyRequirements?: {
    requireSources: boolean;
    preferFirstParty: boolean;
    minSourceCount?: number;
  };
  // Effort estimation (for meta-evolution)
  effortLevel: EffortLevel;
  estimatedToolCalls: number;  // Informs agent count
}

/**
 * Result from quality stack run
 */
export interface StackResult {
  passed: boolean;
  results: EvalResult[];
  iterations: number;
  finalSolution: string;
  feedback?: string;           // Aggregated feedback if failed
  totalDuration?: number;      // Total milliseconds
}

/**
 * Evaluator interface - base for all quality gates
 */
export interface Evaluator {
  gate: GateType;
  evaluate(
    solution: string,
    rearmatter: RearmatterData,
    criteria: PreflightOutput,
    priorEvals?: EvalResult[]
  ): Promise<EvalResult>;
}

/**
 * Rearmatter data extracted from agent output
 * Contains self-evaluation and confidence data
 */
export interface RearmatterData {
  confidence?: number;         // 0-1 self-assessed confidence
  grade?: string;              // Self-assessed grade (A-F)
  toolCalls?: number;          // Number of tool calls made
  sources?: SourceReference[]; // Sources referenced
  assumptions?: string[];      // Assumptions made
  limitations?: string[];      // Known limitations
  [key: string]: unknown;      // Allow extension
}

/**
 * Source reference for accuracy validation
 */
export interface SourceReference {
  url?: string;
  type: 'first-party' | 'second-party' | 'unknown';
  title?: string;
  verified?: boolean;
}

/**
 * Calibration log entry for tool call estimation refinement
 */
export interface CalibrationEntry {
  taskId: string;
  taskType: string;
  estimated: number;           // From pre-flight
  actual: number;              // Tracked during execution
  delta: number;               // actual - estimated
  timestamp: string;
}

/**
 * Default quality stack configuration
 */
export const DEFAULT_QUALITY_CONFIG: QualityStackConfig = {
  preflight: true,
  stages: [
    { type: 'llm', gate: 'checklist', criteria: 'from_preflight', failAction: 'loop' },
    { type: 'llm', gate: 'rubric', criteria: 'from_preflight', failAction: 'flag' },
    { type: 'llm', gate: 'adversarial', criteria: 'none', failAction: 'flag' },
  ],
  maxIterations: 3,
  evalChain: false,  // Only adversarial sees prior evals (hardcoded behavior)
};

/**
 * Gate execution order
 * Determines the order gates run when using graded: true
 */
export const GATE_ORDER: GateType[] = [
  'summarizer',
  'accuracy',
  'checklist',
  'rubric',
  'adversarial',
  'deterministic',
];

/**
 * Gate descriptions for logging and debugging
 */
export const GATE_DESCRIPTIONS: Record<GateType, string> = {
  summarizer: 'Consensus from ensemble, weights by confidence',
  accuracy: 'Source validation, first-party vs second-party',
  checklist: 'Task-type specific verification',
  rubric: 'Dynamic criteria scoring',
  adversarial: 'Challenge assumptions, find weaknesses',
  deterministic: 'Run tests, lint, type checks',
};
