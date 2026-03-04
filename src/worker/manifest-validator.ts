/**
 * ManifestValidator - Shared artifact validation for mesh file I/O contracts
 *
 * Responsibilities:
 * - Resolve manifest file paths using workspace locations and session variables
 * - Validate file existence and non-emptiness for agent reads/writes
 * - Provide structured validation results for dispatcher pre-flight and post-checks
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { log } from '../shared/logger.ts';
import type { ManifestEntry } from './mesh-validator.ts';

/**
 * Result of validating manifest artifacts for an agent
 */
export interface ManifestValidationResult {
  checked: string[];
  missing: string[];
  empty: string[];
  skipped: string[];
}

/**
 * Resolved paths context for manifest validation
 */
export interface ManifestPathContext {
  workDir: string;
  wsLocations: Record<string, string>;
  wsBase: string;
  varMap: Record<string, string>;
}

/**
 * Resolve template variables from session.yaml for manifest path substitution
 */
export function resolveManifestVariables(
  workDir: string,
  wsLocations: Record<string, string>,
  variablesConfig?: { source?: string; mapping?: Record<string, string> },
): Record<string, string> {
  const varMap: Record<string, string> = {};

  // Read variable source file
  // Config declares: variables.source (path to YAML file), variables.mapping ({var} → field)
  const sourcePath = variablesConfig?.source;
  const mapping = variablesConfig?.mapping;

  if (sourcePath) {
    // Explicit source file declared in config
    const fullPath = path.join(workDir, sourcePath);
    if (fs.existsSync(fullPath)) {
      try {
        const data = YAML.parse(fs.readFileSync(fullPath, 'utf-8'));
        if (data && typeof data === 'object' && mapping) {
          for (const [templateVar, fieldName] of Object.entries(mapping)) {
            const value = data[fieldName];
            if (value !== undefined) varMap[templateVar] = String(value);
          }
        }
      } catch {
        // Non-fatal
      }
    }
  } else {
    // Fallback: conventional session.yaml at session location
    const sessionLocation = wsLocations['session'];
    if (sessionLocation) {
      const sessionPath = path.join(workDir, sessionLocation, 'session.yaml');
      if (fs.existsSync(sessionPath)) {
        try {
          const session = YAML.parse(fs.readFileSync(sessionPath, 'utf-8'));
          if (session && typeof session === 'object') {
            if (session.game_id) varMap['game-id'] = session.game_id;
            if (session.campaign_id) varMap['campaign-id'] = session.campaign_id;
            if (session.turn !== undefined) varMap['N'] = String(session.turn);
          }
        } catch {
          // Non-fatal
        }
      }
    }
  }

  // Resolve location cross-references
  // Location templates can reference other locations via {name}.
  // Iteratively resolve until stable (handles chained references).
  const resolved: Record<string, string> = {};
  const maxPasses = 5;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const [locName, locTemplate] of Object.entries(wsLocations)) {
      let value = locTemplate;
      for (const [k, v] of Object.entries(varMap)) {
        value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      }
      for (const [k, v] of Object.entries(resolved)) {
        value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      }
      const clean = value.replace(/\/+$/, '');
      if (!clean.includes('{') && resolved[locName] !== clean) {
        resolved[locName] = clean;
        changed = true;
      }
    }
    if (!changed) break;
  }

  Object.assign(varMap, resolved);
  return varMap;
}

/**
 * Build path context from mesh config workspace settings
 */
export function buildPathContext(
  workDir: string,
  meshConfig: { workspace?: { locations?: Record<string, string>; path?: string; variables?: { source?: string; mapping?: Record<string, string> } } },
  cachedVarMap?: Record<string, string>,
): ManifestPathContext {
  const wsLocations = meshConfig.workspace?.locations || {};
  const wsBase = meshConfig.workspace?.path || '';
  const varMap = cachedVarMap || resolveManifestVariables(workDir, wsLocations, meshConfig.workspace?.variables);
  return { workDir, wsLocations, wsBase, varMap };
}

/**
 * Resolve a manifest entry to an absolute file path.
 * Returns null if the path contains unresolved template variables.
 */
export function resolveManifestPath(
  entry: ManifestEntry,
  ctx: ManifestPathContext,
): string | null {
  let locationTemplate = ctx.wsLocations[entry.location || 'workspace'] || ctx.wsBase;

  for (const [key, value] of Object.entries(ctx.varMap)) {
    locationTemplate = locationTemplate.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  if (locationTemplate.includes('{')) return null;

  return path.join(ctx.workDir, locationTemplate, entry.id);
}

/**
 * Validate that manifest artifacts exist for a given agent role (reads or writes).
 *
 * @param agentName - Agent to validate for
 * @param manifest - Full mesh manifest
 * @param role - Check 'reads' (pre-dispatch) or 'writes' (post-completion)
 * @param ctx - Resolved path context
 */
export function validateAgentArtifacts(
  agentName: string,
  manifest: ManifestEntry[],
  role: 'reads' | 'writes',
  ctx: ManifestPathContext,
  opts?: {
    /** For preflight reads: only check workspace files written by these agents */
    completedWriters?: string[];
  },
): ManifestValidationResult {
  const result: ManifestValidationResult = {
    checked: [],
    missing: [],
    empty: [],
    skipped: [],
  };

  const entries = manifest.filter(entry => entry[role].includes(agentName));
  const completedWriters = opts?.completedWriters;

  for (const entry of entries) {
    // For preflight reads: skip workspace files whose writers haven't completed yet.
    // Persistent files (game, campaign, session) are always checked.
    if (role === 'reads' && completedWriters && entry.location === 'workspace') {
      const hasCompletedWriter = entry.writes?.some(w => completedWriters.includes(w)) ?? false;
      if (!hasCompletedWriter) {
        result.skipped.push(entry.id);
        continue;
      }
    }

    const resolvedPath = resolveManifestPath(entry, ctx);

    if (!resolvedPath) {
      result.skipped.push(entry.id);
      continue;
    }

    result.checked.push(entry.id);

    if (!fs.existsSync(resolvedPath)) {
      result.missing.push(entry.id);
    } else {
      try {
        const stat = fs.statSync(resolvedPath);
        if (stat.size === 0) {
          result.empty.push(entry.id);
        }
      } catch {
        result.missing.push(entry.id);
      }
    }
  }

  return result;
}

/**
 * Find which agent(s) are declared as writers for a given manifest file.
 * Used in pre-dispatch error messages to identify the responsible agent.
 */
export function findWriters(
  fileId: string,
  manifest: ManifestEntry[],
): string[] {
  const entry = manifest.find(e => e.id === fileId);
  return entry?.writes || [];
}
