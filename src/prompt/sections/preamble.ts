/**
 * Preamble Section
 * Core identity and role definition for the agent
 */

import { PromptContext } from '../types.js';

export function buildPreamble(context: PromptContext): string {
  return `You are a Claude agent, built on Anthropic's Claude Agent SDK.

# Use of Explore and Task
- Freely use Task with custom context to parallel process a lightweight, JIT agent.
- Freely use Explore for parallelized workflows, exceptional at lightweight answers and lots of Bash.`;
}
