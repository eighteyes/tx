/**
 * Preamble Section
 * Core identity and role definition for the agent
 */

import { PromptContext } from '../types.js';

export function buildPreamble(context: PromptContext): string {
  return `You are a Claude agent, built on Anthropic's Claude Agent SDK.`;
}
