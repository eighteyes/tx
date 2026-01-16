// Copied from src/shared/types.ts
export type SemanticModel = 'opus' | 'sonnet' | 'haiku';

export interface WorkspaceConfig {
  path: string;
  create_on_init?: boolean;
  cleanup_on_complete?: boolean;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentConfig {
  name: string;
  model: SemanticModel;
  prompt: string;
  workspace?: WorkspaceConfig;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface FSMStateConfig {
  name: string;
  entry_gates?: string[];
  exit_gates?: string[];
  onEnter?: string;
  onExit?: string;
  coordinator?: string;
}

export interface FSMConfig {
  initial_state: string;
  states: FSMStateConfig[];
  context?: Record<string, unknown>;
  context_descriptions?: Record<string, string>;
}

export interface MeshRouting {
  [agentName: string]: {
    [messageType: string]: {
      [targetAgent: string]: string; // reason
    };
  };
}

export interface MeshConfig {
  mesh: string;
  description?: string;
  agents: AgentConfig[];
  entry_point?: string;
  completion_agent?: string;
  continuation?: boolean | string[];
  workspace?: WorkspaceConfig;
  routing?: MeshRouting;
  fsm?: FSMConfig;
  iteration?: {
    maxIterations?: number;
    onFail?: 'loop' | 'halt';
  };
  lifecycle?: {
    pre?: string[];
    post?: string[];
  };
}

export interface MeshMetadata {
  name: string;
  path: string;
  description: string;
  agents: number;
  configType: 'yaml' | 'json';
}

export interface ValidationError {
  field?: string;
  message: string;
  severity: 'error' | 'warning';
}
