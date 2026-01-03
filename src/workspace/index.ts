/**
 * Workspace Module - Task-scoped output workspaces
 */

export { WorkspaceManager, normalizeWorkspaceConfig, type WorkspaceConfig, type WorkspaceInfo } from './manager.ts';
export { PromptInjector, type InjectionContext, type PreambleContext } from './injector.ts';
export { MESSAGING_PROTOCOL } from './messaging-protocol.ts';

// Legacy workspace context (kept for compatibility)
export interface WorkspaceContext {
  files: string[];
  recentChanges: string[];
  relevantCode: string;
}

/**
 * Gather workspace context for an agent
 * STUB: Returns empty context for now
 */
export async function gatherWorkspaceContext(
  mesh: string,
  agent: string
): Promise<string> {
  // TODO: Implement actual workspace scanning
  // - Find relevant files based on agent role
  // - Get recent git changes
  // - Extract code snippets
  return '';
}
