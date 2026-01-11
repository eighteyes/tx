/**
 * V4 Shared Types
 */

// Message types
export type MessageType =
  | 'task'
  | 'task-complete'
  | 'ask'
  | 'ask-response'
  | 'ask-human'
  | 'update'
  | 'lifecycle';

export type MessageStatus = 'pending' | 'delivered';

export interface Message {
  id?: number;
  from_agent: string;
  to_agent: string;
  type: MessageType;
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
  workerCount: number;
  startedAt: number;
  completedAt?: number;
}

// Ralph Loops types

/**
 * Resource limits for a single iteration
 */
export interface RalphIterationLimits {
  time_ms: number;      // Max milliseconds per iteration
  tokens: number;       // Max tokens per iteration
  cost_usd: number;     // Max cost per iteration
}

/**
 * Ralph loop configuration for a specific agent
 */
export interface RalphLoopAgentConfig {
  name: string;                       // Agent name to apply loops to
  max_iterations: number;             // Maximum number of iterations
  iteration_limits: RalphIterationLimits;  // Resource limits per iteration
  success_patterns: string[];         // Patterns indicating success (case-sensitive)
}

/**
 * Ralph loops configuration in mesh config
 */
export interface RalphLoopConfig {
  enabled: boolean;
  agents: RalphLoopAgentConfig[];
}

/**
 * Result from a Ralph loop execution
 */
export interface RalphLoopResult {
  output: string;                     // Final output
  iterations_completed: number;       // Actual iterations run
  total_tokens: number;               // Sum of tokens across iterations
  total_cost_usd: number;             // Sum of costs across iterations
  total_time_ms: number;              // Sum of time across iterations
  success: boolean;                   // Whether success pattern matched
  final_pattern_matched?: string;     // Which pattern matched (if any)
  limit_hit?: 'iterations' | 'time' | 'tokens' | 'cost';  // Which limit stopped execution
}

/**
 * Metadata emitted in message frontmatter after Ralph loop execution
 */
export interface RalphLoopMetadata {
  iterations_completed: number;
  total_tokens: number;
  total_cost_usd: number;
  total_time_ms: number;
  success: boolean;
  final_pattern_matched?: string;
  limit_hit?: 'iterations' | 'time' | 'tokens' | 'cost';
}

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
 * FSM state configuration
 */
export interface FSMStateConfig {
  name: string;
  coordinator: string;  // Agent that coordinates this state
  participants?: string[];  // Other agents that participate
  gates?: FSMGateConfig[];  // Gates to check before transition
  onEnter?: string;  // Script to run on state entry
  onExit?: string;   // Script to run on state exit
}

/**
 * FSM transition configuration
 */
export interface FSMTransitionConfig {
  from: string;
  to: string;
  trigger: 'ask' | 'task-complete' | 'manual';
  triggerAgent?: string;  // Agent that triggers this transition
  script?: string;  // Transition script
}

/**
 * Full FSM configuration for mesh config
 */
export interface FSMConfig {
  initialState: string;
  states: FSMStateConfig[];
  transitions: FSMTransitionConfig[];
  context?: Record<string, unknown>;  // Initial context variables
}
