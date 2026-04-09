/**
 * PlanDeriver - Extract capability requirements from plan artifacts
 *
 * Reads plan.md + tasks.md from a plan directory and uses a one-shot LLM call
 * to derive a structured CapabilityNeeded object. Caches the result as
 * capabilities_needed.yaml in the plan directory for reuse.
 *
 * Responsibilities:
 * - Read plan artifacts from a directory
 * - Build extraction prompt with enum vocabulary
 * - Call LLM for structured extraction (haiku, no tools)
 * - Parse and validate the derived capability
 * - Cache result for subsequent runs
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { log } from '../../shared/logger.ts';
import {
  DOMAIN_VALUES, INPUT_VALUES, OUTPUT_VALUES,
  TOOL_VALUES, INTERACTION_VALUES, TOPOLOGY_VALUES,
  isValidCapability,
  type CapabilityNeeded,
} from './schema.ts';

const COMPONENT = 'plan-deriver';
const CACHE_FILE = 'capabilities_needed.yaml';

/**
 * Check if a path is a plan directory (has plan.md or tasks.md).
 */
export function isPlanDirectory(inputPath: string): boolean {
  if (!fs.existsSync(inputPath)) return false;
  const stat = fs.statSync(inputPath);
  if (!stat.isDirectory()) return false;
  return (
    fs.existsSync(path.join(inputPath, 'plan.md')) ||
    fs.existsSync(path.join(inputPath, 'tasks.md'))
  );
}

/**
 * Check if a cached capabilities_needed.yaml exists in the plan directory.
 */
export function getCachedCapabilities(planDir: string): CapabilityNeeded | null {
  const cachePath = path.join(planDir, CACHE_FILE);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const content = fs.readFileSync(cachePath, 'utf-8');
    const parsed = YAML.parse(content);
    const cap = parsed?.capability || parsed;
    if (!isValidCapability(cap)) return null;

    return {
      domain: cap.domain,
      input: cap.input,
      output: cap.output,
      tools: cap.tools ?? [],
      interaction: cap.interaction,
      topology: cap.topology ?? 'static',
    };
  } catch {
    return null;
  }
}

/**
 * Read plan artifacts and concatenate into a single context string.
 */
function readPlanContent(planDir: string): string {
  const parts: string[] = [];

  for (const file of ['plan.md', 'tasks.md', 'context.md']) {
    const filePath = path.join(planDir, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      parts.push(`## ${file}\n\n${content}`);
    }
  }

  if (parts.length === 0) {
    throw new Error(`No plan files found in ${planDir}`);
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Build the LLM prompt for capability extraction.
 */
function buildExtractionPrompt(planContent: string): string {
  return `Extract the capability requirements from this implementation plan.

Return ONLY valid YAML matching this schema — no explanation, no markdown fences:

capability:
  domain: []       # ${DOMAIN_VALUES.join(', ')}
  input: []        # ${INPUT_VALUES.join(', ')}
  output: []       # ${OUTPUT_VALUES.join(', ')}
  tools: []        # ${TOOL_VALUES.join(', ')} (can be empty [])
  interaction: []  # ${INTERACTION_VALUES.join(', ')}
  topology: ""     # ${TOPOLOGY_VALUES.join(', ')}

Rules:
- Use ONLY values from the lists above
- domain: what kind of work is this? (most plans are dev)
- input: what does the plan operate on?
- output: what does the plan produce?
- tools: special capabilities needed (empty [] if none)
- interaction: does a human need to approve? (none = fully autonomous)
- topology: static for simple chains, review-loop if plan has review cycles

Plan:

${planContent}`;
}

/**
 * Parse LLM response into a CapabilityNeeded object.
 */
function parseResponse(response: string): CapabilityNeeded | null {
  // Strip markdown fences if present
  let cleaned = response.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = YAML.parse(cleaned);
    const cap = parsed?.capability || parsed;

    if (!isValidCapability(cap)) {
      log.warn(COMPONENT, 'LLM response failed validation', { response: cleaned });
      return null;
    }

    return {
      domain: cap.domain,
      input: cap.input,
      output: cap.output,
      tools: cap.tools ?? [],
      interaction: cap.interaction,
      topology: cap.topology ?? 'static',
    };
  } catch (err) {
    log.error(COMPONENT, 'Failed to parse LLM response as YAML', { error: String(err), response: cleaned });
    return null;
  }
}

/**
 * Derive capabilities from a plan directory.
 * Uses cached result if available, otherwise calls LLM.
 */
export async function deriveCapabilitiesFromPlan(planDir: string): Promise<CapabilityNeeded | null> {
  // Check cache first
  const cached = getCachedCapabilities(planDir);
  if (cached) {
    log.info(COMPONENT, 'Using cached capabilities', { planDir });
    return cached;
  }

  // Read plan content
  let planContent: string;
  try {
    planContent = readPlanContent(planDir);
  } catch (err) {
    log.error(COMPONENT, String(err));
    return null;
  }

  // Truncate if too long (keep first 8k chars — enough for capability extraction)
  if (planContent.length > 8000) {
    planContent = planContent.slice(0, 8000) + '\n\n[truncated]';
  }

  const prompt = buildExtractionPrompt(planContent);

  // LLM call — lazy import to avoid loading SDK unless needed
  let response: string;
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    response = '';

    for await (const message of query({
      prompt,
      options: {
        model: 'haiku',
        maxTurns: 1,
        permissionMode: 'dontAsk',
        allowedTools: [],
      },
    })) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            response += block.text;
          }
        }
      }
    }
  } catch (err) {
    log.error(COMPONENT, 'LLM query failed', { error: String(err) });
    return null;
  }

  // Parse and validate
  const caps = parseResponse(response);
  if (!caps) return null;

  // Cache for reuse
  const cachePath = path.join(planDir, CACHE_FILE);
  const cacheContent = YAML.stringify({ capability: caps });
  fs.writeFileSync(cachePath, cacheContent, 'utf-8');
  log.info(COMPONENT, 'Cached derived capabilities', { planDir, cachePath });

  return caps;
}
