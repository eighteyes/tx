/**
 * Mesh Module
 *
 * Provides mesh functionality including FSM workflow orchestration and ensemble aggregation.
 *
 * Components:
 * - MeshFSM: Core FSM class for state tracking and transitions
 * - FSMPersistence: SQLite persistence layer with backup/restore
 * - ScriptExecutor: Bash script runner with timeout and env injection
 * - AggregationEngine: Result aggregation for ensemble execution
 */

export {
  MeshFSM,
  type FSMConfig,
  type FSMStateConfig,
  type FSMGateConfig,
  type FSMTransitionConfig,
  type FSMTransitionEvent,
  type FSMGateEvent,
  type FSMScriptEvent,
} from './fsm.ts';

export type {
  FSMExitConfig,
  ExitWhenClause,
} from '../shared/types.ts';

export {
  FSMPersistence,
  type FSMStateData,
  type FSMStateBackup,
} from './fsm-persistence.ts';

export {
  ScriptExecutor,
  type ScriptContext,
  type ScriptResult,
  type ScriptExecutorConfig,
} from './fsm-scripts.ts';

export {
  ConditionEvaluator,
  type ParsedCondition,
} from './fsm-evaluator.ts';

export {
  SimpleExpressionEvaluator,
  expressionEvaluator,
  type ExpressionResult,
} from './fsm-expression.ts';

export {
  AggregationEngine,
  type AgentResult,
  type AggregationOptions,
} from './aggregation.ts';
