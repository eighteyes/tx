/**
 * CapabilitySchema - Capability declaration types and enum validation
 *
 * Defines the vocabulary for bidirectional capability matching between meshes
 * and plans. Meshes declare what they provide, plans declare what they need,
 * and a router matches them mechanically.
 *
 * Responsibilities:
 * - Define enum value arrays for domain, input, output, tools, interaction, topology
 * - Export derived types from enum arrays
 * - Define CapabilityDeclaration and CapabilityNeeded interfaces
 * - Validate capability declarations against known enum values
 */

// -- Enum value arrays (source of truth) --

export const DOMAIN_VALUES = [
  'dev', 'research', 'bug-finding', 'bug-fixing', 'narrative',
  'reasoning', 'review', 'qa', 'knowledge', 'design', 'media', 'meta',
] as const;

export const INPUT_VALUES = [
  'prompt', 'feature-request', 'codebase', 'question',
  'spec', 'url', 'bug-report', 'files',
] as const;

export const OUTPUT_VALUES = [
  'code-changes', 'artifact', 'creative-content', 'report', 'analysis',
  'decision', 'test-suite', 'plan', 'mesh-config', 'knowledge-update', 'video',
] as const;

export const TOOL_VALUES = [
  'git', 'spec-graph', 'mcp-playwright', 'browser', 'web-search', 'worktree',
] as const;

export const INTERACTION_VALUES = [
  'none', 'gate-entry', 'gate-exit', 'gate-iterative',
] as const;

export const TOPOLOGY_VALUES = [
  'static', 'sequential', 'parallel', 'ensemble',
  'phased', 'review-loop', 'gated-pipeline',
] as const;

// -- Derived types --

export type Domain = typeof DOMAIN_VALUES[number];
export type Input = typeof INPUT_VALUES[number];
export type Output = typeof OUTPUT_VALUES[number];
export type Tool = typeof TOOL_VALUES[number];
export type Interaction = typeof INTERACTION_VALUES[number];
export type Topology = typeof TOPOLOGY_VALUES[number];

// -- Interfaces --

export interface CapabilityDeclaration {
  domain: Domain[];
  input: Input[];
  output: Output[];
  tools: Tool[];
  interaction: Interaction[];
}

export interface CapabilityNeeded extends CapabilityDeclaration {
  topology: Topology;
}

// -- Validation --

const ENUM_SETS: Record<string, ReadonlySet<string>> = {
  domain: new Set(DOMAIN_VALUES),
  input: new Set(INPUT_VALUES),
  output: new Set(OUTPUT_VALUES),
  tools: new Set(TOOL_VALUES),
  interaction: new Set(INTERACTION_VALUES),
};

const REQUIRED_NON_EMPTY = ['domain', 'input', 'output', 'interaction'];

/**
 * Validate a capability declaration object.
 *
 * All 5 array fields must exist and contain only known enum values.
 * domain, input, output, interaction must be non-empty.
 * tools can be empty but values must be valid if present.
 */
export function isValidCapability(cap: unknown): cap is CapabilityDeclaration {
  if (typeof cap !== 'object' || cap === null) return false;
  const obj = cap as Record<string, unknown>;
  for (const [field, allowed] of Object.entries(ENUM_SETS)) {
    const value = obj[field];
    if (!Array.isArray(value)) return false;
    if (REQUIRED_NON_EMPTY.includes(field) && value.length === 0) return false;
    for (const item of value) {
      if (typeof item !== 'string' || !allowed.has(item)) return false;
    }
  }
  return true;
}
