/**
 * OAOM (One Agent, One Message) Stop Signal Section
 *
 * Injects a prompt section that instructs non-orchestrator agents to STOP
 * after writing their output message. Orchestrator agents are exempt since
 * they coordinate multiple messages by design.
 *
 * Valid routing targets are listed to help the agent route correctly.
 * Targets come from existing routing config — nothing is hardcoded.
 */

export interface OaomContext {
  agentName: string;
  isOrchestrator: boolean;
  /** Flattened list of valid routing targets for this agent */
  routingTargets: string[];
}

/**
 * Build the OAOM stop signal section for an agent prompt.
 * Returns empty string for orchestrator agents.
 */
export function buildOaomSection(context: OaomContext): string {
  if (context.isOrchestrator) return '';

  const lines: string[] = [];
  lines.push('# Message Completion Protocol\n');
  lines.push('After writing your output message to the msgs directory, STOP. Do not make additional tool calls. Your task is complete once your message file is written. Any remaining work belongs to the next agent.\n');

  if (context.routingTargets.length > 0) {
    lines.push('Valid routing targets for your messages:\n');
    for (const target of context.routingTargets) {
      lines.push(`- \`${target}\``);
    }
    lines.push('\nDo not send messages to agents not listed above.');
  }

  return lines.join('\n');
}
