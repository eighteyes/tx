/**
 * Operational Guide Section
 * Loads AGENTS.md from the mesh directory if present
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { PromptContext } from '../types.js';

/**
 * Build operational guide section from AGENTS.md
 * Returns empty string if file doesn't exist (optional file)
 */
export function buildOperationalGuide(context: PromptContext): string {
  if (!context.meshBasePath) {
    return '';
  }

  const agentsPath = join(context.meshBasePath, 'AGENTS.md');

  if (!existsSync(agentsPath)) {
    // AGENTS.md is optional - return empty if not present
    return '';
  }

  try {
    const content = readFileSync(agentsPath, 'utf-8');
    return `# Operational Guide\n\n${content.trim()}`;
  } catch {
    // Log error but don't fail - operational guide is optional
    return '';
  }
}
