/**
 * Prompt Building Module
 * Public API for building agent prompts
 */

export { PromptBuilder } from './builder.js';
export type { PromptContext, PromptSection, BuildOptions } from './types.js';

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
