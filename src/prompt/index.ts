/**
 * Prompt Building Module
 * Public API for building agent prompts
 */

export { PromptBuilder } from './builder.js';
export type { PromptContext, PromptSection, BuildOptions, RoutingConfig } from './types.js';

// Core agent prompt
export { buildCorePrompt, buildMeshList } from './core.js';
export type { CorePromptConfig } from './core.js';

// Routing section (extracted from dispatcher)
export { buildRoutingSection, injectRoutingInstructions, buildDispatcherRoutingSection, injectDispatcherRoutingInstructions } from './sections/routing.js';

// OAOM stop signal section
export { buildOaomSection } from './sections/oaom.js';
export type { OaomContext } from './sections/oaom.js';

// Convenience functions
import { PromptBuilder } from './builder.js';
import type { PromptContext, BuildOptions } from './types.js';

/**
 * Build a complete prompt from context
 */
export function buildPrompt(context: PromptContext, options?: BuildOptions): string {
  const builder = new PromptBuilder(context, options);
  return builder.build();
}

/**
 * Build a prompt for a specific mesh/agent
 */
export function buildMeshPrompt(
  mesh: string,
  agent: string,
  agentPromptPath: string,
  model: string = 'sonnet',
  taskMessage?: string
): string {
  const context: PromptContext = {
    mesh,
    agent,
    model,
    agentPromptPath,
    taskMessage,
  };

  return buildPrompt(context);
}
