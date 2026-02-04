/**
 * Routing Section
 * Injects message routing instructions into agent prompts
 *
 * Extracted from dispatcher.ts Phase 2 refactoring.
 */

import type { PromptContext } from '../types.js';

/**
 * Routing configuration for prompt injection
 * Format: { routingCategory: { destination: "reason" } }
 * Categories are internal (ask, task, etc.) — not exposed to agents.
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
  lines.push('Route your response message to one of these destinations:\n');

  // Flatten: dedupe destination → collect all reasons
  const destinations = new Map<string, string[]>();
  for (const categoryDestinations of Object.values(routing)) {
    for (const [destination, reason] of Object.entries(categoryDestinations)) {
      const targetAgent = destination === 'core' ? 'core/core' :
                         destination.includes('/') ? destination :
                         `${meshName}/${destination}`;
      if (!destinations.has(targetAgent)) destinations.set(targetAgent, []);
      destinations.get(targetAgent)!.push(reason);
    }
  }

  for (const [targetAgent, reasons] of destinations) {
    lines.push(`- **\`${targetAgent}\`**: ${reasons.join(' | ')}`);
  }

  lines.push('\nSet the `to` field in your message frontmatter. Send to ONLY these destinations.');
  lines.push('\n**After sending your routing message, STOP. Do not read files, analyze state, write prose, or perform any further work. Send ONE message and exit immediately.**');

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

/**
 * Build dispatcher-mode routing section for an agent prompt.
 * Provides sentinel address, valid outcomes, and available agents for route_to.
 */
export function buildDispatcherRoutingSection(
  sentinel: string,
  validOutcomes: string[] | null,
  availableAgents: string[],
  isTerminal: boolean
): string {
  const lines: string[] = [];
  lines.push('## Message Routing\n');
  lines.push(`Send all messages to: **\`${sentinel}\`**\n`);

  if (isTerminal) {
    lines.push('You are a terminal agent. Set `outcome: complete` when your work is finished.\n');
  } else if (validOutcomes === null) {
    // Linear — any outcome accepted
    lines.push('Set `outcome:` in your frontmatter to describe your result.\n');
  } else if (validOutcomes.length > 0) {
    // Branch — specific outcomes required
    lines.push('Set `outcome:` in your frontmatter to one of these values:\n');
    for (const outcome of validOutcomes) {
      lines.push(`- \`${outcome}\``);
    }
    lines.push('');
  }

  lines.push('Special outcomes:');
  lines.push('- `outcome: escalate` — escalate to human operator');
  lines.push('- `outcome: complete` — signal work is finished\n');

  if (availableAgents.length > 0) {
    lines.push('Override routing with `route_to:` in frontmatter (valid agents):');
    for (const agent of availableAgents) {
      lines.push(`- \`${agent}\``);
    }
    lines.push('');
  }

  lines.push('**After sending your message, STOP. Do not read files, analyze state, write prose, or perform any further work. Send ONE message and exit immediately.**');

  return lines.join('\n');
}

/**
 * Inject dispatcher-mode routing instructions into a system prompt
 */
export function injectDispatcherRoutingInstructions(
  systemPrompt: string,
  sentinel: string,
  validOutcomes: string[] | null,
  availableAgents: string[],
  isTerminal: boolean
): string {
  const section = buildDispatcherRoutingSection(sentinel, validOutcomes, availableAgents, isTerminal);
  return `${systemPrompt}\n\n${section}`;
}
