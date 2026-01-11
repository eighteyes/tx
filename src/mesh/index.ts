/**
 * Mesh FSM Module
 *
 * Provides finite state machine functionality for mesh workflow orchestration.
 *
 * Components:
 * - MeshFSM: Core FSM class for state tracking and transitions
 * - FSMPersistence: SQLite persistence layer with backup/restore
 * - ScriptExecutor: Bash script runner with timeout and env injection
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
