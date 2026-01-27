/**
 * Routing Section
 * Injects message routing instructions into agent prompts
 *
 * Extracted from dispatcher.ts Phase 2 refactoring.
 */

import type { PromptContext } from '../types.js';

/**
 * Routing configuration for prompt injection
 * Format: { status: { destination: "reason" } }
 */
export interface RoutingConfig {
  [status: string]: {
    [destination: string]: string;  // destination -> reason
  };
}

/**
 * Extended prompt context with routing
 */
export interface RoutingPromptContext extends PromptContext {
  routing?: RoutingConfig;
  msgsDir?: string;
}

/**
 * Build the routing section for an agent prompt
 * Appends routing table and instructions to help agent route responses
 */
export function buildRoutingSection(
  routing: RoutingConfig,
  meshName: string
): string {
  const lines: string[] = [];
  lines.push('## Message Routing\n');
  lines.push('When you complete your work, route your response message based on the outcome:\n');

  for (const [status, destinations] of Object.entries(routing)) {
    lines.push(`\n**Status: \`${status}\`**`);

    for (const [destination, reason] of Object.entries(destinations)) {
      const targetAgent = destination === 'core' ? 'core/core' :
                         destination.includes('/') ? destination :
                         `${meshName}/${destination}`;
      lines.push(`- Send message to: \`${targetAgent}\``);
      lines.push(`  Reason: ${reason}`);
    }
  }

  lines.push('\n\nSet the `to` field in your message frontmatter based on which status applies.');

  return lines.join('\n');
}

/**
 * Inject routing instructions into a system prompt
 * Convenience function for adding routing to an existing prompt
 */
export function injectRoutingInstructions(
  systemPrompt: string,
  routing: RoutingConfig,
  meshName: string
): string {
  if (!routing || Object.keys(routing).length === 0) {
    return systemPrompt;
  }

  const routingSection = buildRoutingSection(routing, meshName);
  return `${systemPrompt}\n\n${routingSection}`;
}
