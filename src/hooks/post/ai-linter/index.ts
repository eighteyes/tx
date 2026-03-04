/**
 * AI Linter Post-Hook
 *
 * Pluggable framework that catches common AI code generation mistakes.
 * Groups changed files by extension, dispatches to registered language linters,
 * aggregates violations, and throws QualityIterationError if errors found.
 *
 * New language linters are added by implementing LanguageLinter and pushing
 * to the linters array below.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../../../shared/logger.ts';
import type { HookDefinition, HookContext, HookUtils } from '../../types.ts';
import { QualityIterationError } from '../../errors.ts';
import type { LanguageLinter, LintViolation } from './types.ts';
import { jsLinter } from './js-linter.ts';

const COMPONENT = 'hooks:ai-linter';

/** Max file size to lint (256KB) */
const MAX_FILE_SIZE = 256 * 1024;

// --- Linter Registry ---
// Add new language linters here:
const linters: LanguageLinter[] = [jsLinter];
// Future: import { pythonLinter } from './python-linter.ts'; linters.push(pythonLinter);

/**
 * Build extension -> linter lookup map.
 * If allowedLanguages is provided, only include linters whose name is in the list.
 * e.g. allowedLanguages=['js'] -> only jsLinter's extensions are mapped.
 * Omit or pass undefined -> all registered linters.
 */
function buildExtensionMap(allowedLanguages?: string[]): Map<string, LanguageLinter> {
  const map = new Map<string, LanguageLinter>();
  const allowed = allowedLanguages
    ? new Set(allowedLanguages.map((l) => l.toLowerCase()))
    : null;

  for (const linter of linters) {
    if (allowed && !allowed.has(linter.name.toLowerCase())) {
      continue;
    }
    for (const ext of linter.extensions) {
      map.set(ext, linter);
    }
  }
  return map;
}

/**
 * Get changed files via git diff. Falls back to git status if HEAD fails.
 */
async function getChangedFiles(workDir: string): Promise<string[]> {
  const { execSync } = await import('node:child_process');

  let output = '';
  try {
    output = execSync('git diff --name-only HEAD', {
      cwd: workDir,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch {
    // Fallback: git status --porcelain (excludes untracked)
    try {
      const statusOutput = execSync('git status --porcelain -uno', {
        cwd: workDir,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
      });
      // Parse porcelain output: "XY filename" -> extract filename
      output = statusOutput
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.slice(3).trim())
        .join('\n');
    } catch (error) {
      log.warn(COMPONENT, 'Failed to get changed files', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  return output
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

/**
 * Filter out files that are too large or don't exist
 */
function filterFiles(files: string[], workDir: string): string[] {
  return files.filter((file) => {
    const absPath = path.isAbsolute(file) ? file : path.join(workDir, file);
    try {
      const stats = fs.statSync(absPath);
      if (stats.size > MAX_FILE_SIZE) {
        log.debug(COMPONENT, `Skipping large file: ${file} (${stats.size} bytes)`);
        return false;
      }
      return true;
    } catch {
      return false; // File doesn't exist or not readable
    }
  });
}

/**
 * Format violations into human-readable feedback for the worker
 */
function formatFeedback(violations: LintViolation[]): string {
  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  // Group by file
  const byFile = new Map<string, LintViolation[]>();
  for (const v of violations) {
    const list = byFile.get(v.file) || [];
    list.push(v);
    byFile.set(v.file, list);
  }

  const lines: string[] = [];
  lines.push('## AI Linter: Code Quality Issues Found');
  lines.push('');
  lines.push(`**${errors.length} error(s), ${warnings.length} warning(s)**`);
  lines.push('');

  for (const [file, fileViolations] of byFile) {
    lines.push(`### ${file}`);
    // Sort by line number
    fileViolations.sort((a, b) => a.line - b.line);
    for (const v of fileViolations) {
      const loc = v.column ? `line ${v.line}, col ${v.column}` : `line ${v.line}`;
      const severity = v.severity === 'error' ? '**ERROR**' : 'WARNING';
      let entry = `- ${severity} (${loc}): [${v.rule}] ${v.message}`;
      if (v.fix) {
        entry += ` -- Fix: ${v.fix}`;
      }
      lines.push(entry);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('Fix all ERROR items. Warnings are informational.');

  return lines.join('\n');
}

// --- Hook Handler ---

const handler = async (context: HookContext, utils: HookUtils): Promise<void> => {
  const agentId = context.agentId || `${context.meshName}/${context.agentName}`;
  const workDir = context.worktreePath || utils.workDir;

  log.activity('quality:ai-linter', agentId, 'Scanning for AI code generation issues...');

  // 1. Get changed files
  const changedFiles = await getChangedFiles(workDir);
  if (changedFiles.length === 0) {
    log.info(COMPONENT, 'No changed files to lint');
    log.activity('quality:ai-linter', agentId, 'SKIPPED: No changed files');
    return;
  }

  // 2. Filter out oversized files
  const files = filterFiles(changedFiles, workDir);
  if (files.length === 0) {
    log.info(COMPONENT, 'No lintable files after filtering');
    log.activity('quality:ai-linter', agentId, 'SKIPPED: No lintable files');
    return;
  }

  // 3. Group files by extension and match to linters
  // Supports filtering via mesh config: quality:ai-linter:languages=js+python
  const allowedLanguages = context.aiLinterLanguages as string[] | undefined;
  if (allowedLanguages) {
    log.debug(COMPONENT, `Language filter active: ${allowedLanguages.join(', ')}`);
  }
  const extMap = buildExtensionMap(allowedLanguages);
  const linterFiles = new Map<LanguageLinter, string[]>();

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const linter = extMap.get(ext);
    if (linter) {
      const list = linterFiles.get(linter) || [];
      list.push(file);
      linterFiles.set(linter, list);
    }
  }

  if (linterFiles.size === 0) {
    log.info(COMPONENT, 'No files match any registered linter', {
      fileCount: files.length,
      registeredExtensions: [...extMap.keys()],
    });
    log.activity('quality:ai-linter', agentId, 'SKIPPED: No matching linters');
    return;
  }

  // 4. Run each linter on its matched files
  const allViolations: LintViolation[] = [];
  const contextRecord: Record<string, unknown> = {
    deterministicCommands: context.deterministicCommands,
    qualityIteration: context.qualityIteration,
  };

  for (const [linter, matchedFiles] of linterFiles) {
    log.debug(COMPONENT, `Running ${linter.name} linter on ${matchedFiles.length} file(s)`);
    try {
      const violations = await linter.lint(matchedFiles, workDir, contextRecord);
      allViolations.push(...violations);
    } catch (error) {
      log.error(COMPONENT, `Linter ${linter.name} threw an error`, {
        error: (error as Error).message,
      });
    }
  }

  // 5. Tally results
  const errors = allViolations.filter((v) => v.severity === 'error');
  const warnings = allViolations.filter((v) => v.severity === 'warning');
  const passed = errors.length === 0;

  const summary = passed
    ? `PASS: ${files.length} files scanned, ${warnings.length} warning(s)`
    : `FAIL: ${errors.length} error(s), ${warnings.length} warning(s) in ${files.length} files`;

  log.info(COMPONENT, summary, {
    agentId,
    filesScanned: files.length,
    errors: errors.length,
    warnings: warnings.length,
  });
  log.activity('quality:ai-linter', agentId, summary);

  // 6. Write audit message
  utils.writeResultMessage(context, 'ai-linter', passed, summary, {
    filesScanned: files.length,
    errors: errors.length,
    warnings: warnings.length,
    violations: allViolations.slice(0, 50), // Cap for audit readability
  });

  // 7. If errors exist, format feedback and throw for retry
  if (!passed) {
    const feedback = formatFeedback(allViolations);
    throw new QualityIterationError(feedback);
  }
};

export const qualityAiLinterHook: HookDefinition = {
  name: 'quality:ai-linter',
  phase: 'post',
  priority: 65, // After semantic gates (50-60), before deterministic (70)
  description: 'Catches common AI code generation mistakes via pluggable language linters',
  handler,
};
