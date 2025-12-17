/**
 * Agent Prompt Section
 * Loads and formats the agent-specific prompt from the mesh config
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PromptContext } from '../types.js';

export function buildAgentPrompt(context: PromptContext): string {
  try {
    const promptPath = resolve(context.agentPromptPath);
    const content = readFileSync(promptPath, 'utf-8');
    return content.trim();
  } catch (err) {
    throw new Error(`Failed to load agent prompt from ${context.agentPromptPath}: ${err}`);
  }
}
