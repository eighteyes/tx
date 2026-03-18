/**
 * Dynaprompt Types
 *
 * Type definitions for agent checkpoints, progress signals, fragments, and exploration.
 */

/**
 * Checkpoint record schema for agent_checkpoints table
 */
export interface CheckpointRecord {
  id: string;
  mesh_instance: string;
  agent_id: string;
  conversation_id: string;
  parent_checkpoint_id: string | null;
  label: string | null;
  snapshot_path: string | null;
  summary: string | null;
  created_at: number;
}

/**
 * Checkpoint tree node for hierarchical display
 */
export interface CheckpointNode {
  checkpoint: CheckpointRecord;
  children: CheckpointNode[];
}

/**
 * Progress signal schema for agent_progress table
 */
export interface ProgressSignal {
  id: string;
  mesh_instance: string;
  agent_id: string;
  step: number;
  total: number;
  label: string | null;
  created_at: number;
}

/**
 * Fragment source priority enum
 */
export type FragmentSource = 'agent-config' | 'agent-dir' | 'mesh-config' | 'mesh-dir' | 'runtime';

/**
 * Fragment entry in registry
 */
export interface Fragment {
  name: string;
  description: string | null;
  content: string;
  source: FragmentSource;
}

/**
 * Exploration record schema for JSONL dataset
 */
export interface ExplorationRecord {
  exploration_id: string;
  mesh_instance: string;
  agent_id: string;
  checkpoint_id: string;
  round: number;
  branches: ExplorationBranch[];
  synthesis: string;
  confidence: number;
  outcome: ExplorationOutcome | null;
  created_at: string;
}

/**
 * Branch outcome in exploration
 */
export interface ExplorationBranch {
  fragment_name: string;
  conversation_id: string;
  outcome: 'success' | 'failed' | 'timeout';
  tokens_used: number;
}

/**
 * Exploration final outcome
 */
export type ExplorationOutcome = 'converged' | 'max_rounds_exceeded' | 'judge_failed' | 'incomplete';

/**
 * Exploration result returned from orchestrator
 */
export interface ExplorationResult {
  final_text: string;
  confidence: number;
  rounds: number;
  exploration_id: string;
}

/**
 * Dynaprompt configuration at mesh/agent level
 */
export interface DynapromptConfig {
  max_forks?: number;
  max_rounds?: number;
  confidence_threshold?: number;
  enable_workspace_snapshots?: boolean;
  fragments?: Record<string, string>;
}

/**
 * Guardrail configuration for max_forks
 */
export interface MaxForksGuardrail {
  strict?: boolean;
  warning?: boolean;
  limit: number;
}
