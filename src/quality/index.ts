/**
 * Quality Stack Module
 *
 * Composable evaluation pipeline for validating agent outputs.
 */

// Core types
export type {
  GateType,
  GradedConfig,
  FailAction,
  EvalStage,
  QualityStackConfig,
  EvalResult,
  RubricItem,
  EffortLevel,
  PreflightOutput,
  StackResult,
  Evaluator,
  RearmatterData,
  SourceReference,
  CalibrationEntry,
} from './types.ts';

export {
  DEFAULT_QUALITY_CONFIG,
  GATE_ORDER,
  GATE_DESCRIPTIONS,
} from './types.ts';

// Registry
export {
  evaluatorRegistry,
  BaseEvaluator,
  registerEvaluator,
  getEvaluator,
} from './registry.ts';

// Gates
export {
  ChecklistGate,
  RubricGate,
  AdversarialGate,
  AccuracyGate,
  DeterministicGate,
  SummarizerGate,
  PreflightGate,
  createNpmScriptGate,
  createTypeCheckGate,
  createTestGate,
  createPreflightGate,
  getBestSolution,
} from './gates/index.ts';

export type {
  DeterministicGateConfig,
  EnsembleSolution,
  SummarizerGateConfig,
  PreflightGateConfig,
} from './gates/index.ts';

// Stack orchestrator
export {
  QualityStack,
  createStandardStack,
  createStackFromConfig,
} from './stack.ts';

export type {
  QualityStackEvents,
  QualityStackOptions,
} from './stack.ts';
