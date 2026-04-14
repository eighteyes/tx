/**
 * ContextResolver - Per-agent manifest context query resolution
 *
 * Responsibilities:
 * - Resolve full/sections/script context queries for manifest entries
 * - Handle directory entries (iterate .yaml files, flat concat with headers)
 * - Apply token substitution in script values ({id}, {path}, {game_path}, etc.)
 * - Format injection tags: # [pre-loaded: {path} — {mode}]
 * - Apply fallback behavior (full | omit) on resolution failure
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { log } from '../shared/logger.ts';
import type { ManifestContextValue } from './mesh-validator.ts';

export type { ManifestContextValue };

/**
 * Result returned by a successful context resolution.
 * Content is tagged with the source path and query mode and ready for injection.
 */
export interface ContextResolveResult {
  /** Tagged content: starts with "# [pre-loaded: ...]" line, followed by extracted content */
  content: string;
  /** Byte size of the content (for aggregate size guard in dispatcher) */
  sizeBytes: number;
}

/**
 * Resolution options passed by the dispatcher
 */
export interface ContextResolveOptions {
  /** Absolute project root used to compute relative paths for tags */
  workDir: string;
  /**
   * Resolved variable map (location names → resolved relative paths, plus
   * runtime vars like game-id, campaign-id, N, feature).
   * Keys match location names from workspace.locations (e.g. 'game', 'campaign', 'workspace').
   */
  varMap: Record<string, string>;
  /** Script execution timeout in ms (default: 30_000) */
  scriptTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Resolve a context query for a manifest entry + agent.
 *
 * @param entryId        - Manifest entry id (e.g. "author.yaml" or "entities/characters/")
 * @param contextValue   - The context value for this agent (from entry.context[agentName])
 * @param resolvedPath   - Absolute path to the file or directory
 * @param opts           - Resolution options
 * @returns Resolved content with tag, or null if the entry should be skipped
 */
export function resolveContextEntry(
  entryId: string,
  contextValue: ManifestContextValue,
  resolvedPath: string,
  opts: ContextResolveOptions,
): ContextResolveResult | null {
  if (entryId.endsWith('/')) {
    return resolveDirectoryContext(entryId, contextValue, resolvedPath, opts);
  }
  return resolveSingleFile(entryId, contextValue, resolvedPath, undefined, opts);
}

// ---------------------------------------------------------------------------
// Single-file resolution
// ---------------------------------------------------------------------------

function resolveSingleFile(
  entryId: string,
  contextValue: ManifestContextValue,
  filePath: string,
  fileId: string | undefined,
  opts: ContextResolveOptions,
): ContextResolveResult | null {
  if (!fs.existsSync(filePath)) {
    log.warn('context-resolver', `File not found for context query`, { entryId, filePath });
    return null;
  }

  const relPath = path.relative(opts.workDir, filePath);

  if (contextValue === 'full') {
    return resolveFullFile(relPath, filePath);
  }

  if ('sections' in contextValue) {
    return resolveSections(entryId, contextValue, filePath, relPath, opts);
  }

  if ('script' in contextValue) {
    return resolveScript(
      entryId,
      contextValue,
      filePath,
      relPath,
      fileId ?? path.basename(filePath, path.extname(filePath)),
      opts,
    );
  }

  log.warn('context-resolver', `Unrecognised context value shape`, { entryId });
  return null;
}

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve context for a directory entry.
 * Lists all .yaml / .yml files, applies per-file query, concatenates results.
 */
function resolveDirectoryContext(
  entryId: string,
  contextValue: ManifestContextValue,
  dirPath: string,
  opts: ContextResolveOptions,
): ContextResolveResult | null {
  if (!fs.existsSync(dirPath)) {
    log.warn('context-resolver', `Directory not found for context query`, { entryId, dirPath });
    return null;
  }

  let filenames: string[];
  try {
    filenames = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort(); // deterministic order
  } catch (err) {
    log.error('context-resolver', `Failed to read directory`, { entryId, dirPath, error: String(err) });
    return null;
  }

  if (filenames.length === 0) {
    const tag = `# [pre-loaded: ${entryId} — empty directory]`;
    return { content: `${tag}\n`, sizeBytes: Buffer.byteLength(tag + '\n', 'utf-8') };
  }

  const parts: string[] = [];

  for (const filename of filenames) {
    const filePath = path.join(dirPath, filename);
    const fileId = path.basename(filename, path.extname(filename));
    const result = resolveSingleFile(entryId, contextValue, filePath, fileId, opts);
    if (result) {
      parts.push(result.content);
    }
  }

  const combinedContent = parts.join('\n');
  return {
    content: combinedContent,
    sizeBytes: Buffer.byteLength(combinedContent, 'utf-8'),
  };
}

// ---------------------------------------------------------------------------
// Primitive resolvers
// ---------------------------------------------------------------------------

/** Read entire file, tag it */
function resolveFullFile(relPath: string, filePath: string): ContextResolveResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  const tag = `# [pre-loaded: ${relPath} — full]`;
  const tagged = `${tag}\n${content}`;
  return { content: tagged, sizeBytes: Buffer.byteLength(tagged, 'utf-8') };
}

/**
 * Extract sections via yq pick.
 * Delegates to yq for dot-notation nested path support per QA answer #11.
 */
function resolveSections(
  entryId: string,
  query: { sections: string[]; fallback?: 'full' | 'omit' },
  filePath: string,
  relPath: string,
  opts: ContextResolveOptions,
): ContextResolveResult | null {
  const pathExprs = query.sections.map(s => `"${s}"`).join(', ');
  const yqExpr = `pick([${pathExprs}])`;
  const modeLabel = `sections: ${query.sections.join(', ')}`;
  const tag = `# [pre-loaded: ${relPath} — ${modeLabel}]`;

  const result = spawnSync('yq', [yqExpr, filePath], {
    encoding: 'utf-8',
    timeout: DEFAULT_TIMEOUT_MS,
  });

  if (result.error || (result.status !== 0 && result.status !== null)) {
    const errDetail = result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
    log.warn('context-resolver', `yq sections query failed`, {
      entryId, filePath, sections: query.sections, error: errDetail,
    });
    return applyFallback(query.fallback, entryId, filePath, relPath, opts);
  }

  const extracted = (result.stdout || '').trimEnd();
  const tagged = `${tag}\n${extracted}`;
  return { content: tagged, sizeBytes: Buffer.byteLength(tagged, 'utf-8') };
}

/**
 * Execute an arbitrary shell script, inject stdout.
 * Substitutes {id}, {path}, {game_path}, {campaign_path}, {workspace} tokens.
 */
function resolveScript(
  entryId: string,
  query: { script: string; fallback?: 'full' | 'omit' },
  filePath: string,
  relPath: string,
  fileId: string,
  opts: ContextResolveOptions,
): ContextResolveResult | null {
  const tag = `# [pre-loaded: ${relPath} — script]`;

  const tokens = buildScriptTokens(filePath, fileId, opts);
  const resolvedScript = substituteTokens(query.script, tokens);

  const result = spawnSync('sh', ['-c', resolvedScript], {
    encoding: 'utf-8',
    timeout: opts.scriptTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    cwd: opts.workDir,
    env: {
      ...process.env,
      // Expose key paths as env vars alongside token substitution (QA answer #3)
      TX_FILE_PATH: filePath,
      TX_FILE_ID: fileId,
      TX_WORK_DIR: opts.workDir,
    },
  });

  if (result.error || (result.status !== 0 && result.status !== null)) {
    const errDetail = result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
    log.warn('context-resolver', `Script failed`, {
      entryId, filePath, script: query.script, resolvedScript, error: errDetail,
    });
    return applyFallback(query.fallback, entryId, filePath, relPath, opts);
  }

  const stdout = (result.stdout || '').trimEnd();
  const tagged = `${tag}\n${stdout}`;
  return { content: tagged, sizeBytes: Buffer.byteLength(tagged, 'utf-8') };
}

// ---------------------------------------------------------------------------
// Fallback handling
// ---------------------------------------------------------------------------

function applyFallback(
  fallback: 'full' | 'omit' | undefined,
  entryId: string,
  filePath: string,
  relPath: string,
  opts: ContextResolveOptions,
): ContextResolveResult | null {
  if (fallback === 'full') {
    log.info('context-resolver', `Falling back to full read`, { entryId, filePath });
    const content = fs.readFileSync(filePath, 'utf-8');
    const tag = `# [pre-loaded: ${relPath} — full (fallback)]`;
    const tagged = `${tag}\n${content}`;
    return { content: tagged, sizeBytes: Buffer.byteLength(tagged, 'utf-8') };
  }

  if (fallback === 'omit') {
    log.info('context-resolver', `Omitting entry per fallback: omit`, { entryId });
  } else {
    log.warn('context-resolver', `No fallback configured; omitting entry`, { entryId });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Token substitution
// ---------------------------------------------------------------------------

/**
 * Build the token map for script substitution.
 * Token names match the spec: {id}, {path}, {game_path}, {campaign_path}, {workspace}
 */
function buildScriptTokens(
  filePath: string,
  fileId: string,
  opts: ContextResolveOptions,
): Record<string, string> {
  const { workDir, varMap } = opts;

  const tokens: Record<string, string> = {
    id: fileId,
    path: filePath,
  };

  // Location-based tokens: resolved from varMap (relative) → absolute
  if (varMap['game']) tokens['game_path'] = path.resolve(workDir, varMap['game']);
  if (varMap['campaign']) tokens['campaign_path'] = path.resolve(workDir, varMap['campaign']);
  if (varMap['workspace']) tokens['workspace'] = path.resolve(workDir, varMap['workspace']);

  return tokens;
}

/**
 * Replace all {key} placeholders in a template string.
 * Exported for testing.
 */
export function substituteTokens(template: string, tokens: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(tokens)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}
