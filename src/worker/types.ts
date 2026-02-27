/**
 * Shared Types for Worker Module
 *
 * Centralized type definitions used across the refactored worker components:
 * - MeshManager
 * - WorkerLifecycle
 * - MessageRouter
 * - FSMIntegration
 * - WorkerDispatcher
 */

import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { SemanticModel, WorkerConfig, SessionMetrics, FSMConfig, EnsembleConfig, FSMStateConfig } from '../shared/types.ts';
import type { SdkRunner, AgentRouting, ToolRestriction } from './sdk-runner.ts';
import type { WorkerStateMachine } from '../state-machine/index.ts';
import type { HookContext } from './hooks.ts';
import type { WorkspaceConfig } from '../workspace/index.ts';
import type { Message } from '../queue/index.ts';

// =============================================================================
// Mesh Configuration Types
// =============================================================================

/**
 * Routing destination in mesh config
 * Format: { destination_agent: "reason string" }
 */
export type MeshRoutingDestination = Record<string, string>;

/**
 * Agent routing in mesh config
 * Format: { status_type: { destination_agent: "reason" } }
 */
export type MeshAgentRouting = Record<string, MeshRoutingDestination>;

/**
 * Mesh routing config
 * Format: { agent_name: { status_type: { destination_agent: "reason" } } }
 */
export type MeshRouting = Record<string, MeshAgentRouting>;

/**
 * Iteration config for quality gates
 */
export interface IterationConfig {
  maxIterations?: number;  // Max re-runs on quality failure (default: 3)
  onFail?: 'loop' | 'halt';  // What to do on quality failure (default: loop)
}

/**
 * Rearmatter (transparency metadata) configuration
 */
export interface RearmatterConfig {
  enabled?: boolean;
  fields?: string[];
  thresholds?: {
    confidence?: number;
    grade?: string;
  };
}

/**
 * Agent configuration within a mesh
 */
export interface AgentConfig {
  name: string;
  model: SemanticModel;
  prompt?: string;  // Path to prompt file (required unless command is set)
  command?: string;  // Slash command to prepend (e.g., "/know:build")
  workspace?: WorkspaceConfig;  // Optional per-agent workspace config
  mcpServers?: Record<string, McpServerConfig>;  // MCP server configurations
  orchestrator?: boolean;  // Restrict to Read + Write(msgs only). For coordinator agents that route, not implement.
}

/**
 * Full mesh configuration
 * Loaded from config.yaml files in meshes/ directory
 */
export interface MeshConfig {
  mesh: string;
  description?: string;
  agents: AgentConfig[];
  entry_point?: string;
  completion_agent?: string;  // DEPRECATED: Use completion_agents
  completion_agents?: string[];  // Agents that can complete the mesh (first-wins)
  workspace?: WorkspaceConfig;  // Optional workspace output schema
  worktree?: boolean;  // Shorthand: true = isolated worktree + auto-commit + cleanup
  continuation?: boolean | string[];  // true = all, array = specific agents, omit = none
  lifecycle?: {
    pre?: string[];   // Pre-hooks executed before worker spawn
    post?: string[];  // Post-hooks executed after worker completion
  };
  routing?: MeshRouting;  // Agent routing tables
  toolRestriction?: ToolRestriction;  // Tool access policy for all agents in mesh
  iteration?: IterationConfig;  // Iteration config for quality gates
  fsm?: FSMConfig;  // FSM config for workflow orchestration
  ensemble?: EnsembleConfig;  // Ensemble execution config
  rearmatter?: RearmatterConfig;  // Transparency metadata config
  _basePath?: string;  // Internal: directory containing this config (for relative prompt paths)
}

// =============================================================================
// Dispatcher Configuration Types
// =============================================================================

/**
 * Configuration for WorkerDispatcher and its components
 */
export interface DispatcherConfig {
  workDir: string;
  msgsDir: string;
  meshesDir: string;
  lowMode?: boolean;
  ultraLowMode?: boolean;
}

// =============================================================================
// Worker State Types
// =============================================================================

/**
 * Active worker state - tracked by WorkerLifecycle
 */
export interface ActiveWorker {
  runner: SdkRunner;
  machine: WorkerStateMachine;
  startedAt: number;
  hookContext: HookContext;  // Lifecycle hook context (includes quality state)
  startedPromise?: Promise<void>;  // Resolves when FSM 'start' transition completes
  lastOutputAt?: number;  // Timestamp of last output (for stuck detection)
}

/**
 * Suspended session state (worker killed, awaiting resume)
 */
export interface SuspendedSession {
  sessionId: string;
  reason: 'ask-human';
  suspendedAt: number;
  targetAgent: string;  // Who the ask-human was sent to (e.g., "core/core")
  meshName: string;
  agentConfig: AgentConfig;
}

/**
 * Context passed to worker spawning
 */
export interface SpawnContext {
  taskId: string;
  taskBody: string;
  featureName?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  sessionId?: string;
  meshInstance: string;
}

// =============================================================================
// Message Event Types
// =============================================================================

/**
 * Revision mode for message updates
 * - interrupt: Hot inject via SDK (only if worker active, else normal message)
 * - append: Queue message normally (add to context)
 * - replace: Queue with "discard previous work" preamble
 */
export type RevisionMode = 'interrupt' | 'append' | 'replace';

/**
 * Event emitted by Consumer when a message file is revised (edited)
 */
export interface RevisionMessageEvent {
  filepath: string;
  agentId: string;
  from: string;
  type: string;
  content: string;
  headline?: string;
  /** Revision mode - core decides behavior based on worker state */
  mode?: RevisionMode;
}

/**
 * Event emitted by Consumer when an ask message is detected
 * Phase 3: Enhanced with boundary detection for terminal-by-default
 */
export interface AskMessageEvent {
  id: number;
  filepath: string;
  from: string;  // Agent that sent the message (e.g., "narrative-engine/narrator")
  to: string;    // Recipient agent (e.g., "narrative-engine/system")
  type: string;  // 'message' (preferred) or 'ask'/'ask-human' (DEPRECATED)
  headline?: string;
  msgId?: string;
  // Phase 3: Boundary detection
  crossesHumanBoundary?: boolean;  // true if to === 'core/core'
  crossesCompletionBoundary?: boolean;  // true if from is a boundary_agent messaging core
  isTerminal?: boolean;  // true if sender should suspend awaiting response
}

/**
 * Event emitted by Consumer when an ask-response message is detected
 * Phase 3: Enhanced with boundary detection for terminal-by-default
 */
export interface AskResponseMessageEvent {
  id: number;
  filepath: string;
  from: string;  // Agent that responded (e.g., "narrative-engine/system")
  to: string;    // Agent receiving the response (e.g., "narrative-engine/narrator")
  content: string;
  headline?: string;
  msgId?: string;
  // Phase 3: Boundary detection
  fromHumanBoundary?: boolean;  // true if from === 'core/core' (human response)
  resumesSuspension?: boolean;  // true if this should resume a suspended session
}

/**
 * Event emitted by Consumer for parity reminder
 */
export interface ParityReminderEvent {
  agentId: string;
  pendingAsks: Array<{ msgId: string; to: string }>;
  deletedFile: string;
}

// =============================================================================
// Middleware Types (for extensibility)
// =============================================================================

/**
 * Middleware for processing message frontmatter
 * Enables dynamic interception and augmentation of frontmatter
 */
export interface FrontmatterMiddleware {
  name: string;
  process(
    frontmatter: Record<string, unknown>,
    context: FrontmatterContext
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
}

/**
 * Context provided to frontmatter middleware
 */
export interface FrontmatterContext {
  messageType: string;
  sender: string;
  target: string;
  meshName?: string;
  agentName?: string;
  fsmState?: string;
}

// =============================================================================
// Lifecycle Event Types
// =============================================================================

/**
 * Event data for worker spawn
 */
export interface WorkerSpawnEvent {
  agentId: string;
  model: SemanticModel;
}

/**
 * Event data for worker complete
 */
export interface WorkerCompleteEvent {
  id: string;
  messagesProcessed: number;
  output: string;
  sessionId?: string;
  metrics?: any;
  transitionName?: string;
  qualityResult?: {
    iterations: number;
    passed: boolean;
  };
}

/**
 * Event data for worker error
 */
export interface WorkerErrorEvent {
  id: string;
  error: string;
  transitionName?: string;
}

// =============================================================================
// FSM Integration Types
// =============================================================================

/**
 * Ensemble execution context for FSM states
 */
export interface EnsembleExecutionContext {
  ensembleId: string;
  meshName: string;
  stateConfig: FSMStateConfig;
  task: Message;
  agentsToSpawn: string[];
}

/**
 * Result of FSM message validation
 */
export interface FSMValidationResult {
  valid: boolean;
  newState?: string;
  error?: string;
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type { SdkRunner, AgentRouting, ToolRestriction } from './sdk-runner.ts';
export type { HookContext } from './hooks.ts';
export type { Message } from '../queue/index.ts';
