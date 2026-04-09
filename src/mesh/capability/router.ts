/**
 * CapabilityRouter - Mechanical set-coverage scoring for mesh selection
 *
 * Scores meshes against plan requirements using subset checks across
 * five capability fields. No LLM involved — pure set math.
 *
 * Responsibilities:
 * - Score a mesh declaration against a needed capability via subset coverage
 * - Hard-disqualify meshes missing any needed value
 * - Select best mesh from a catalog with excess-count tiebreaking
 */

import type { CapabilityDeclaration, CapabilityNeeded } from './schema.ts';

export interface CatalogEntry {
  name: string;
  capability: CapabilityDeclaration;
}

export interface MatchResult {
  name: string;
  score: number;
  excessCount: number;
}

const MATCH_FIELDS = ['domain', 'input', 'output', 'tools', 'interaction'] as const;

/**
 * Score a mesh's declared capabilities against a needed specification.
 *
 * For each of the 5 array fields, checks needed[field] subset-of provided[field].
 * Returns 0 if ANY needed value is missing (hard disqualify).
 * Returns 1.0 if all fields pass (all qualifying matches are equivalent).
 */
export function scoreMesh(provided: CapabilityDeclaration, needed: CapabilityNeeded): number {
  for (const field of MATCH_FIELDS) {
    const providedSet = new Set(provided[field] as readonly string[]);
    const neededValues = needed[field] as readonly string[];
    for (const value of neededValues) {
      if (!providedSet.has(value)) return 0;
    }
  }
  return 1.0;
}

/**
 * Count values present in provided but absent from needed across all fields.
 */
function countExcess(provided: CapabilityDeclaration, needed: CapabilityNeeded): number {
  let excess = 0;
  for (const field of MATCH_FIELDS) {
    const neededSet = new Set(needed[field] as readonly string[]);
    const providedValues = provided[field] as readonly string[];
    for (const value of providedValues) {
      if (!neededSet.has(value)) excess++;
    }
  }
  return excess;
}

/**
 * Find the best matching mesh from a catalog for a given need.
 *
 * Disqualifies score=0 entries. Tiebreaks by fewest excess capabilities.
 * Returns null if nothing qualifies.
 */
export function findBestMesh(catalog: CatalogEntry[], needed: CapabilityNeeded): CatalogEntry | null {
  let bestEntry: CatalogEntry | null = null;
  let bestExcess = Infinity;

  for (const entry of catalog) {
    const score = scoreMesh(entry.capability, needed);
    if (score === 0) continue;

    const excess = countExcess(entry.capability, needed);
    if (excess < bestExcess) {
      bestExcess = excess;
      bestEntry = entry;
    }
  }

  return bestEntry;
}
