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
}

export interface BuildOptions {
  includePreamble?: boolean;
  includeAgentPrompt?: boolean;
  includeTaskContext?: boolean;
  includeRearmatter?: boolean;
}
