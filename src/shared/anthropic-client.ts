/**
 * Shared Anthropic API Client
 *
 * Provides a singleton Anthropic client instance for direct API calls.
 * Use this for simple completions (like summarization) that don't need
 * the full agentic SDK capabilities.
 *
 * For agentic workflows with tools, use @anthropic-ai/claude-agent-sdk instead.
 */

import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

/**
 * Get the shared Anthropic client instance.
 * Creates a new client on first call, reuses it subsequently.
 *
 * Configuration is pulled from environment variables:
 * - ANTHROPIC_API_KEY: Required API key
 */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/**
 * Reset the client (for testing purposes)
 */
export function resetAnthropicClient(): void {
  client = null;
}
