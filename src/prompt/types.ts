/**
 * Prompt Building Types
 */

export interface PromptSection {
  name: string;
  content: string;
  enabled: boolean;
}

/**
 * Routing configuration for prompt injection
 * Format: { status: { destination: "reason" } }
 */
export interface RoutingConfig {
  [status: string]: {
    [destination: string]: string;  // destination -> reason
  };
}

export interface PromptContext {
  mesh: string;
  agent: string;
  model: string;
  agentPromptPath: string;
  taskMessage?: string;
  workspaceContext?: string;
  qualityGates?: string[];
  agentCount?: number;  // Number of agents in this mesh (>1 = no Task tool)
  routing?: RoutingConfig;  // Message routing configuration
  msgsDir?: string;  // Messages directory for response instructions
}

export interface BuildOptions {
  includePreamble?: boolean;
  includeAgentPrompt?: boolean;
  includeTaskContext?: boolean;
  includeRearmatter?: boolean;
  includeRouting?: boolean;  // Include routing instructions (default: true if routing provided)
}
