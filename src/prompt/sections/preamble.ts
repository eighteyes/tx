/**
 * Preamble Section
 * Core identity and role definition for the agent
 */

import { PromptContext } from '../types.js';

export function buildPreamble(context: PromptContext): string {
  const isMultiAgentMesh = (context.agentCount ?? 1) > 1;

  if (isMultiAgentMesh) {
    // Multi-agent meshes use message files for coordination, not Task tool
    return `You are a Claude agent, built on Anthropic's Claude Agent SDK.

# Use of Explore
- Freely use Explore for parallelized workflows, exceptional at lightweight answers and lots of Bash.

# Multi-Agent Mesh
This mesh has multiple agents. Coordinate via message files in .ai/tx/msgs/, not the Task tool.`;
  }

  // Single-agent meshes can use Task for subagent spawning
  return `You are a Claude agent, built on Anthropic's Claude Agent SDK.

# Use of Explore and Task
- Freely use Task with custom context to parallel process a lightweight, JIT agent.
- Freely use Explore for parallelized workflows, exceptional at lightweight answers and lots of Bash.`;
}
