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
