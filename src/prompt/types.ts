/**
 * Prompt Building Types
 */

import type { DispatchInjectionContext } from '../shared/types.ts';

export interface PromptSection {
  name: string;
  content: string;
  enabled: boolean;
}

/**
 * Routing configuration for prompt injection (agent-mode)
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
  routing?: RoutingConfig;  // Agent-mode routing configuration
  dispatcherRouting?: DispatchInjectionContext;  // Dispatcher-mode routing context
  msgsDir?: string;  // Messages directory for response instructions
}

export interface BuildOptions {
  includePreamble?: boolean;
  includeAgentPrompt?: boolean;
  includeTaskContext?: boolean;
  includeRearmatter?: boolean;
  includeRouting?: boolean;  // Include routing instructions (default: true if routing provided)
}
