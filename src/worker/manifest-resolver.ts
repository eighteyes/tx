/**
 * ManifestResolver - Filesystem-driven agent orchestration
 *
 * Responsibilities:
 * - Determine which agents are eligible to run based on manifest reads/writes and filesystem state
 * - Detect deadlocks when no agents are eligible but some remain incomplete
 * - Provide diagnostic information for deadlock debugging
 */

import fs from 'node:fs';
import { resolveManifestPath } from './manifest-validator.ts';
import type { ManifestEntry } from './mesh-validator.ts';
import type { ManifestPathContext } from './manifest-validator.ts';

export interface ManifestResolverResult {
  eligible: string[];
  deadlock: boolean;
  diagnostics?: ManifestDeadlockDiagnostic[];
}

export interface ManifestDeadlockDiagnostic {
  agent: string;
  missingReads: string[];
}

/**
 * Resolve which agents are eligible to run based on manifest state.
 *
 * An agent is eligible when:
 * 1. All manifest files it reads exist on disk
 * 2. At least one manifest file it writes is NOT in writtenFiles
 * 3. It is NOT in completedAgents
 *
 * Directory entries (id ends with /): existence = satisfied.
 */
export function resolveManifestEligibility(
  manifest: ManifestEntry[],
  agentNames: string[],
  completedAgents: Set<string>,
  writtenFiles: Set<string>,
  pathContext: ManifestPathContext,
): ManifestResolverResult {
  const eligible: string[] = [];
  const incomplete: string[] = [];
  const diagnostics: ManifestDeadlockDiagnostic[] = [];

  for (const agentName of agentNames) {
    if (completedAgents.has(agentName)) continue;
    incomplete.push(agentName);

    // Check reads: all must be satisfied
    const readEntries = manifest.filter(e => e.reads.includes(agentName));
    const missingReads: string[] = [];

    let readsSatisfied = true;
    for (const entry of readEntries) {
      const resolved = resolveManifestPath(entry, pathContext);

      if (!resolved) {
        // Unresolved template variable — treat as unsatisfied
        readsSatisfied = false;
        missingReads.push(entry.id);
        continue;
      }

      if (!fs.existsSync(resolved)) {
        readsSatisfied = false;
        missingReads.push(entry.id);
      }
    }

    if (!readsSatisfied) {
      diagnostics.push({ agent: agentName, missingReads });
      continue;
    }

    // Check writes: at least one must be incomplete (not in writtenFiles)
    const writeEntries = manifest.filter(e => e.writes.includes(agentName));
    const isDirectory = (entry: ManifestEntry) => entry.id.endsWith('/');

    const hasIncompleteWrite = writeEntries.some(entry => {
      if (isDirectory(entry)) return false; // Directories skip writes-incomplete check
      const resolved = resolveManifestPath(entry, pathContext);
      if (!resolved) return true; // Unresolved = incomplete
      return !writtenFiles.has(resolved);
    });

    if (hasIncompleteWrite || writeEntries.length === 0) {
      // Eligible if: has incomplete writes OR has no writes (pure reader — validator
      // should have caught this, but handle gracefully)
      eligible.push(agentName);
    } else {
      // All writes complete but agent not in completedAgents — stale state.
      // Include in diagnostics for deadlock reporting.
      diagnostics.push({ agent: agentName, missingReads: [] });
    }
  }

  const deadlock = eligible.length === 0 && incomplete.length > 0;

  return {
    eligible,
    deadlock,
    diagnostics: deadlock ? diagnostics : undefined,
  };
}

/**
 * Format deadlock diagnostics into a human-readable error message.
 */
export function formatDeadlockMessage(result: ManifestResolverResult): string {
  if (!result.deadlock || !result.diagnostics) return '';

  const stuckCount = result.diagnostics.length;
  const lines = [`Manifest deadlock: ${stuckCount} agent${stuckCount === 1 ? '' : 's'} stuck`];

  for (const diag of result.diagnostics) {
    if (diag.missingReads.length > 0) {
      lines.push(`  ${diag.agent}: missing reads [${diag.missingReads.join(', ')}]`);
    } else {
      lines.push(`  ${diag.agent}: all writes complete but not marked done`);
    }
  }

  return lines.join('\n');
}
