/**
 * Prompt Building Types
 */

export interface PromptSection {
  name: string;
  content: string;
  enabled: boolean;
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
  meshBasePath?: string;  // Path to mesh directory (for loading AGENTS.md)
}

export interface BuildOptions {
  includePreamble?: boolean;
  includeAgentPrompt?: boolean;
  includeOperationalGuide?: boolean;
  includeTaskContext?: boolean;
  includeRearmatter?: boolean;
}
