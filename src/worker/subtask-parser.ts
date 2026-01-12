/**
 * Subtask Parser
 *
 * Parses spawner agent output to extract subtask definitions.
 *
 * Expected spawner output format:
 * ```
 * SUBTASK 1: Title of subtask
 * Description and details of the subtask...
 *
 * SUBTASK 2: Title of second subtask
 * Description of second subtask...
 * ```
 *
 * Or alternative format with markdown headers:
 * ```
 * ## SUBTASK 1: Title
 * Content...
 *
 * ## SUBTASK 2: Title
 * Content...
 * ```
 */

import { log } from '../shared/logger.ts';

export interface ParsedSubtask {
  id: string;           // e.g., "subtask-1"
  title: string;        // Optional title from "SUBTASK N: Title"
  description: string;  // Full content for this subtask
  sequence: number;     // Original sequence number from spawner output
}

export interface SubtaskParseResult {
  success: boolean;
  subtasks: ParsedSubtask[];
  error?: string;
  warnings?: string[];
}

/**
 * Parse spawner output to extract subtask definitions
 */
export function parseSpawnerOutput(output: string): SubtaskParseResult {
  const warnings: string[] = [];

  // Try structured format first: "SUBTASK N:" or "## SUBTASK N:"
  const subtaskRegex = /(?:^|\n)(?:#{1,3}\s*)?SUBTASK\s+(\d+)\s*:?\s*([^\n]*)/gi;
  const matches = Array.from(output.matchAll(subtaskRegex));

  if (matches.length === 0) {
    return {
      success: false,
      subtasks: [],
      error: 'No subtasks found in spawner output. Expected format: "SUBTASK 1: Description" or "## SUBTASK 1: Description"',
    };
  }

  const subtasks: ParsedSubtask[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const nextMatch = matches[i + 1];

    const sequence = parseInt(match[1], 10);
    const title = match[2]?.trim() || '';

    // Extract content between this match and the next (or end of output)
    const startIndex = match.index! + match[0].length;
    const endIndex = nextMatch ? nextMatch.index! : output.length;
    const content = output.substring(startIndex, endIndex).trim();

    if (!content) {
      warnings.push(`Subtask ${sequence} has no description content`);
    }

    subtasks.push({
      id: `subtask-${sequence}`,
      title,
      description: content,
      sequence,
    });
  }

  // Validate sequence numbers are consecutive
  const sequences = subtasks.map(st => st.sequence).sort((a, b) => a - b);
  for (let i = 0; i < sequences.length; i++) {
    if (sequences[i] !== i + 1) {
      warnings.push(`Subtask sequence numbers are not consecutive: found ${sequences.join(', ')}`);
      break;
    }
  }

  log.info('subtask-parser', `Parsed ${subtasks.length} subtasks from spawner output`, {
    count: subtasks.length,
    sequences: sequences.join(', '),
    warnings: warnings.length,
  });

  return {
    success: true,
    subtasks,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Format subtask results for reviewer
 * Concatenates all subtask outputs in a structured format
 */
export function formatSubtaskResults(
  results: Array<{
    subtask_id: string;
    agent: string;
    output: string;
    success: boolean;
    error?: string;
  }>
): string {
  const lines: string[] = [];

  lines.push('# Subtask Results\n');
  lines.push(`Total subtasks: ${results.length}`);
  lines.push(`Successful: ${results.filter(r => r.success).length}`);
  lines.push(`Failed: ${results.filter(r => !r.success).length}`);
  lines.push('\n---\n');

  for (const result of results) {
    const sequenceNum = result.subtask_id.replace('subtask-', '');
    lines.push(`## SUBTASK ${sequenceNum} RESULT`);
    lines.push(`**Agent**: ${result.agent}`);
    lines.push(`**Status**: ${result.success ? '✓ Success' : '✗ Failed'}`);

    if (result.error) {
      lines.push(`**Error**: ${result.error}`);
    }

    lines.push('\n### Output\n');
    lines.push(result.output || '(no output)');
    lines.push('\n---\n');
  }

  return lines.join('\n');
}
