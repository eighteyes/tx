/**
 * Rearmatter Section
 * Quality gates, constraints, and final instructions
 */

import { PromptContext } from '../types.js';

export function buildRearmatter(context: PromptContext): string {
  let section = '## Quality Gates\n\n';

  if (context.qualityGates && context.qualityGates.length > 0) {
    section += 'Before completing this task, verify:\n\n';
    context.qualityGates.forEach(gate => {
      section += `- ${gate}\n`;
    });
  } else {
    section += 'No specific quality gates defined for this task.\n';
  }

  return section;
}
