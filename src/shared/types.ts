/**
 * V4 Shared Types
 */

export type MessageStatus = 'pending' | 'delivered';

export interface Message {
  id?: number;
  from_agent: string;
  to_agent: string;
  status?: MessageStatus;
  payload: MessagePayload;
  created_at?: number;
  delivered_at?: number;
}

export interface MessagePayload {
  headline?: string;
  body?: string;
  'msg-id'?: string;
  timestamp?: string;
  grade?: string;
  confidence?: number;
  // Ensemble execution fields
  ensemble_id?: string;                  // Track which ensemble execution this belongs to
  custom_aggregation_prompt?: string;    // Custom aggregation prompt for ensemble
  custom_distribution_prompt?: string;   // Custom task distribution prompt (Phase 2+)
  subtask_id?: string;                   // Subtask ID for distributed tasks (Phase 2+)
  [key: string]: unknown;
}

// Agent types
export type AgentStatus = 'starting' | 'running' | 'idle' | 'stopped' | 'error';

export interface AgentConfig {
  id: string;           // e.g., "dev/dev"
  mesh: string;         // e.g., "dev"
  agent: string;        // e.g., "dev"
  model: SemanticModel; // e.g., "sonnet"
  prompt: string;
  capabilities?: string[];
}

export interface AgentState {
  id: string;
  mesh: string;
  agent: string;
  model: string;
  status: AgentStatus;
  pid?: number;
  started_at?: number;
  last_heartbeat?: number;
}

// Provider types
export type SemanticModel = 'opus' | 'sonnet' | 'haiku';

export interface ProviderConfig {
  name: string;
  executablePath?: string;
}

// Worker types (ephemeral)
export interface WorkerConfig {
  id: string;
  model: SemanticModel;
  prompt: string;
  workDir?: string;
}

export interface WorkerResult {
  success: boolean;
  messagesProcessed: number;
  error?: string;
  conversationId?: string;  // Captured from Claude output for resume (legacy)
  sessionId?: string;       // SDK session ID for resume (preferred)
  output?: string;          // Captured session output
  toolCalls?: import('../worker/postcondition-validator.ts').ToolCallRecord[];  // Tool calls for postcondition validation
}

// Core types (persistent)
export interface CoreConfig {
  sessionName: string;
  workDir: string;
  dbPath: string;
  msgsDir: string;
}

// Token and cost tracking types

/**
 * Token usage metrics from a single SDK query
 */
export interface QueryMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
}

/**
 * Aggregated metrics for a worker session (may include multiple queries)
 */
export interface WorkerMetrics {
  agentId: string;
  model: SemanticModel;
  queries: QueryMetrics[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalDurationMs: number;
  totalToolCalls: number;
  startedAt: number;
  completedAt?: number;
}

/**
 * Aggregated metrics for an entire mesh session
 */
export interface SessionMetrics {
  meshInstance: string;
  meshName: string;
  workers: WorkerMetrics[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalDurationMs: number;
  totalToolCalls: number;
  workerCount: number;
  startedAt: number;
  completedAt?: number;
}

// Dispatcher routing types

/**
 * Routing mode:
 * - agent: agent-owned routing via per-agent routing table (default)
 * - dispatcher: centralized routing via dispatch sentinel
 * - manifest: filesystem-state-driven routing
 * - free: agents self-organize from full roster, no routing table
 */
export type RoutingMode = 'agent' | 'dispatcher' | 'manifest' | 'free' | 'static';

/**
 * Fan-out options: trailing object in a fan-out array
 *
 * Example:
 *   planner: [reviewer-a, reviewer-b, reviewer-c, { discuss: true, complete: synthesizer }]
 *
 * - complete: join agent name (all members auto-route outcome:complete here)
 * - discuss: true enables peer messaging via route_to override
 */
export interface FanOutOptions {
  discuss?: boolean;
  complete?: string;
  fan_in?: 'batch' | 'queue' | 'drain';
  transform?: 'summarize';
}

/**
 * Dispatcher routing config shape
 * String value = linear (auto-route to next agent)
 * Array value = fan-out (agents + optional trailing FanOutOptions)
 * Object value = branch (outcome → target agent map)
 *
 * Agents absent from this map are terminal (route to core/core on complete).
 */
export type DispatcherRoutingConfig = Record<string, string | Array<string | FanOutOptions> | Record<string, string>>;

/**
 * Resolved route from dispatcher routing
 */
export interface ResolvedRoute {
  target: string;          // Fully qualified agent ID (mesh/agent) or 'core/core'
  targets?: string[];      // Present when fan-out (array target resolved)
  source: 'linear' | 'branch' | 'terminal' | 'override' | 'escalate' | 'fan-out';
  outcome?: string;        // Original outcome value (if branch)
  usedDefault?: boolean;   // Whether default fallback was used
}

/**
 * Injection context for dispatcher-mode agents
 * Provided to prompt builder so agents know their valid actions
 */
export interface DispatchInjectionContext {
  sentinel: string;              // e.g., "mesh-name/dispatch"
  validOutcomes: string[] | null; // null = linear (any outcome accepted)
  availableAgents: string[];     // All mesh agents (for route_to override)
  isTerminal: boolean;           // Agent has no routing entry
  peers?: string[];              // Fan-out group peers (for discuss routing)
}

// Ensemble types

/**
 * Aggregation strategy for ensemble results
 */
export type AggregationStrategy =
  | 'concat'       // Concatenate all results
  | 'deduplicate'  // Remove duplicates
  | 'voting'       // Vote on best result
  | 'consensus'    // Find consensus
  | 'custom';      // Custom aggregation via prompt

/**
 * Fault tolerance configuration for ensembles
 */
export interface FaultToleranceConfig {
  min_success_count?: number;  // Minimum agents that must succeed
}

// Note: EnsembleConfig and AggregationResult are defined below in "Ensemble types" section

// FSM (Finite State Machine) types

/**
 * FSM gate configuration
 */
export interface FSMGateConfig {
  type: 'script' | 'agent-complete' | 'all-complete';
  script?: string;  // Path to gate script (for script type)
  agent?: string;   // Agent to check (for agent-complete type)
  maxRetries?: number;  // Override default 3 retries
}

/**
 * FSM exit when clause for conditional routing
 */
export interface ExitWhenClause {
  condition: string;  // "var == value" or "var != value"
  target: string;     // Target state name
}

/**
 * FSM exit configuration for state transitions
 */
export interface FSMExitConfig {
  // Gate validation
  gates?: Record<string, string[]>;

  // Context variable updates
  set?: Record<string, string>;

  // Direct routing (literal state name OR script that echoes state)
  run?: string;

  // Conditional routing (new)
  when?: ExitWhenClause[];
  default?: string;

  // Static transitions (backward compat)
  transitions?: Record<string, string>;
}

/**
 * State type for FSM states
 */
export type FSMStateType = 'normal' | 'ensemble';

/**
 * Inline ensemble configuration for FSM states
 * Used within state definition (different from mesh-level EnsembleConfig)
 */
export interface FSMEnsembleConfig {
  type?: 'parallel';             // Ensemble execution type (currently only 'parallel' supported)
  agents?: string[];             // Different agents to run in parallel
  agent?: string;                // OR same agent N times
  count?: number | string;       // Static number or $variable reference
  aggregation: AggregationStrategy;
  timeout_ms?: number;           // Timeout per agent (defaults to 120000)
  fault_tolerance?: {
    min_success_count?: number;  // Minimum agents that must succeed
    retry_failed?: boolean;      // Retry failed agents
  };
}

/**
 * FSM state configuration
 */
export interface FSMStateConfig {
  name: string;
  coordinator?: string;  // Agent that coordinates this state (optional for ensemble)
  participants?: string[];  // Other agents that participate (backward compat)
  agents?: string[];  // Agents for this state (preferred over participants)
  type?: FSMStateType;  // State type: 'normal' (default) or 'ensemble'
  ensemble?: FSMEnsembleConfig;  // Ensemble configuration (required when type === 'ensemble')
  subtask?: boolean;  // Inject subtask prompt into agent context
  gates?: FSMGateConfig[];  // Gates to check before transition
  entry_gates?: string[];  // Gate scripts to validate BEFORE entering this state
  entry?: { set?: Record<string, string> };  // Entry actions: evaluate and set context variables
  onEnter?: string;  // Script to run on state entry
  onExit?: string;   // Script to run on state exit
  exit?: FSMExitConfig;  // Exit configuration with conditional routing
}

/**
 * FSM transition configuration
 */
export interface FSMTransitionConfig {
  from: string;
  to: string;
  trigger: 'message' | 'complete' | 'manual';
  triggerAgent?: string;  // Agent that triggers this transition
  script?: string;  // Transition script
}

/**
 * Object-style FSM state config (used in YAML configs)
 * State name is the key, not part of the value
 */
export type FSMStateConfigObject = Omit<FSMStateConfig, 'name'> & {
  agents?: string[];  // Alternative to coordinator + participants
};

/**
 * Full FSM configuration for mesh config
 * Supports both array format (internal) and object format (YAML config)
 */
export interface FSMConfig {
  initialState?: string;  // Internal format uses initialState
  initial?: string;       // YAML format uses initial
  states: FSMStateConfig[] | Record<string, FSMStateConfigObject>;  // Both formats supported
  transitions: FSMTransitionConfig[];
  context?: Record<string, unknown>;  // Initial context variables
  context_descriptions?: Record<string, string>;  // Human-readable descriptions for context variables
  scripts?: Record<string, string>;   // Named scripts for gates and transitions
}

// Ensemble types

/**
 * Ensemble configuration: multiple agents run on same task, aggregate results
 *
 * Execution flow:
 * 1. coordinator runs first with original task
 * 2. coordinator outputs SUBTASK markers (SUBTASK 1:, SUBTASK 2:, etc.)
 * 3. subtasks are parsed and enqueued to parallel agents
 * 4. agents process their subtasks in parallel
 * 5. reviewer (optional) synthesizes results
 */
export interface EnsembleConfig {
  coordinator?: string;          // Agent that runs FIRST to decompose task (outputs SUBTASK markers)
  agents: string[];              // Agent names to run in parallel
  reviewer?: string;             // Agent that synthesizes results AFTER parallel execution
  aggregation_strategy: 'concat' | 'deduplicate' | 'voting' | 'consensus' | 'custom';
  aggregation_prompt?: string;   // Path to custom aggregation prompt (for 'custom' strategy)
  timeout_ms?: number;           // Timeout per agent (defaults to 120000)
  allow_partial_failure?: boolean; // Continue if some agents fail (default: false)
  fault_tolerance?: {
    min_success_count?: number;  // Minimum agents that must succeed
    retry_failed?: boolean;      // Retry failed agents
  };
}

/**
 * Aggregation result from ensemble execution
 */
export interface AggregationResult {
  aggregated_content: string;
  metadata: {
    strategy: AggregationStrategy;
    agent_count: number;
    custom_prompt_used?: boolean;
    [key: string]: unknown;
  };
}

// Task distribution types

/**
 * Task distribution configuration: spawner splits task into subtasks, subagents process, reviewer synthesizes
 */
export interface TaskDistributionConfig {
  spawner: string;               // Agent that splits task
  subagents: string[];           // Agents that process subtasks
  reviewer: string;              // Agent that synthesizes results
  distribution_strategy: 'equal' | 'weighted' | 'adaptive' | 'custom';
  distribution_prompt?: string;  // Path to custom distribution prompt
  review_prompt?: string;        // Path to custom review prompt
  subtask_count?: number;        // For 'equal' strategy (defaults to subagents.length)
  timeout_ms?: number;           // Timeout per subtask (defaults to 120000)
  allow_partial_failure?: boolean; // Continue if some subtasks fail (default: false)
}

/**
 * Task distribution result
 */
export interface DistributionResult {
  spawner: string;
  subtask_count: number;
  subtasks: Array<{
    id: string;
    description: string;
    assigned_agent: string;
  }>;
  results: Array<{
    subtask_id: string;
    agent: string;
    result: string;
    success: boolean;
    error?: string;
  }>;
  synthesized_result: string;
  metadata?: Record<string, unknown>;
}
