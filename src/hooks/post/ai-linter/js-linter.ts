/**
 * JS/TS Language Linter
 *
 * Catches common AI code generation mistakes in JavaScript/TypeScript files:
 * - Smart/curly quotes from training data
 * - Non-breaking spaces
 * - Zero-width characters
 * - Em/en dashes in code (not comments)
 * - Ellipsis characters
 * - Placeholder TODOs / throw-not-implemented
 * - Hallucinated imports (packages not in package.json)
 * - Optional tsc --noEmit compile check
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from '../../../shared/logger.ts';
import type { LanguageLinter, LintViolation } from './types.ts';

const COMPONENT = 'ai-linter:js';

// --- Individual check functions ---

function checkSmartQuotes(lines: string[], file: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const pattern = /[\u2018\u2019\u201C\u201D]/g;

  for (let i = 0; i < lines.length; i++) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(lines[i])) !== null) {
      const char = match[0];
      const replacement = (char === '\u2018' || char === '\u2019') ? "'" : '"';
      violations.push({
        file,
        line: i + 1,
        column: match.index + 1,
        rule: 'smart-quotes',
        message: `Found curly/smart quote \u2018${char}\u2019`,
        severity: 'error',
        fix: `Replace with ASCII ${replacement}`,
      });
    }
  }
  return violations;
}

function checkEmEnDashes(lines: string[], file: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const pattern = /[\u2013\u2014]/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment-only lines
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(line)) !== null) {
      const char = match[0];
      const replacement = char === '\u2013' ? '-' : '--';
      violations.push({
        file,
        line: i + 1,
        column: match.index + 1,
        rule: 'em-en-dashes',
        message: `Found ${char === '\u2013' ? 'en' : 'em'} dash in code`,
        severity: 'error',
        fix: `Replace with ${replacement}`,
      });
    }
  }
  return violations;
}

function checkEllipsis(lines: string[], file: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const pattern = /\u2026/g;

  for (let i = 0; i < lines.length; i++) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(lines[i])) !== null) {
      violations.push({
        file,
        line: i + 1,
        column: match.index + 1,
        rule: 'ellipsis-char',
        message: 'Found ellipsis character (\u2026)',
        severity: 'warning',
        fix: 'Replace with three dots (...)',
      });
    }
  }
  return violations;
}

function checkNonBreakingSpace(lines: string[], file: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const pattern = /\u00A0/g;

  for (let i = 0; i < lines.length; i++) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(lines[i])) !== null) {
      violations.push({
        file,
        line: i + 1,
        column: match.index + 1,
        rule: 'non-breaking-space',
        message: 'Found non-breaking space (\\u00A0)',
        severity: 'error',
        fix: 'Replace with regular space',
      });
    }
  }
  return violations;
}

function checkZeroWidthChars(lines: string[], file: string, fileContent: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const pattern = /[\u200B\u200C\u200D\uFEFF]/g;

  for (let i = 0; i < lines.length; i++) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(lines[i])) !== null) {
      // FEFF (BOM) is OK at byte position 0 of the file
      if (match[0] === '\uFEFF' && i === 0 && match.index === 0) {
        continue;
      }
      const charName = {
        '\u200B': 'zero-width space',
        '\u200C': 'zero-width non-joiner',
        '\u200D': 'zero-width joiner',
        '\uFEFF': 'BOM/zero-width no-break space',
      }[match[0]] || 'zero-width character';

      violations.push({
        file,
        line: i + 1,
        column: match.index + 1,
        rule: 'zero-width-chars',
        message: `Found ${charName}`,
        severity: 'error',
        fix: 'Remove character',
      });
    }
  }
  return violations;
}

function checkPlaceholderCode(lines: string[], file: string): LintViolation[] {
  const violations: LintViolation[] = [];
  const patterns = [
    { regex: /TODO:\s*implement/i, msg: 'TODO: implement placeholder' },
    { regex: /throw new Error\(['"]Not implemented['"]\)/i, msg: "throw new Error('Not implemented') placeholder" },
    { regex: /throw new Error\(['"]TODO['"]\)/i, msg: "throw new Error('TODO') placeholder" },
    { regex: /\/\/\s*FIXME:\s*implement/i, msg: 'FIXME: implement placeholder' },
    { regex: /pass\s*#\s*TODO/i, msg: 'pass # TODO placeholder' },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { regex, msg } of patterns) {
      if (regex.test(lines[i])) {
        violations.push({
          file,
          line: i + 1,
          rule: 'placeholder-code',
          message: `Found ${msg}`,
          severity: 'warning',
          fix: 'Implement the actual logic or remove the placeholder',
        });
      }
    }
  }
  return violations;
}

/**
 * Walk up from workDir to find the nearest package.json,
 * return a Set of all dependency names (deps + devDeps + peerDeps + optionalDeps).
 */
function loadPackageDeps(workDir: string): Set<string> {
  const deps = new Set<string>();
  let dir = workDir;

  // Walk up to find package.json (max 10 levels)
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
          if (pkg[field] && typeof pkg[field] === 'object') {
            for (const name of Object.keys(pkg[field])) {
              deps.add(name);
            }
          }
        }
        return deps;
      }
    } catch {
      // Continue searching up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }

  return deps;
}

/**
 * Extract package name from an import specifier.
 * Handles scoped packages: '@scope/pkg' -> '@scope/pkg'
 * Regular packages: 'lodash/fp' -> 'lodash'
 */
function extractPackageName(specifier: string): string | null {
  // Skip relative imports and Node builtins
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null;
  }
  // Scoped package: @scope/name or @scope/name/subpath
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return null;
  }
  // Regular package: name or name/subpath
  return specifier.split('/')[0];
}

function checkHallucinatedImports(lines: string[], file: string, packageDeps: Set<string>): LintViolation[] {
  const violations: LintViolation[] = [];
  if (packageDeps.size === 0) return violations; // No package.json found, skip

  // Match: import ... from 'pkg' / import ... from "pkg"
  const esImportPattern = /(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/;
  // Match: require('pkg') / require("pkg")
  const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    for (const pattern of [esImportPattern, requirePattern]) {
      const match = line.match(pattern);
      if (match) {
        const specifier = match[1];
        const pkgName = extractPackageName(specifier);
        if (pkgName && !packageDeps.has(pkgName)) {
          // Check for Node.js built-in modules (without node: prefix)
          const nodeBuiltins = new Set([
            'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
            'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
            'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
            'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
            'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8',
            'vm', 'wasi', 'worker_threads', 'zlib',
          ]);
          if (nodeBuiltins.has(pkgName)) continue;

          violations.push({
            file,
            line: i + 1,
            rule: 'hallucinated-import',
            message: `Package '${pkgName}' not found in package.json`,
            severity: 'warning',
            fix: `Install with \`npm install ${pkgName}\` or replace with correct package`,
          });
        }
      }
    }
  }
  return violations;
}

/**
 * Run tsc --noEmit and parse errors.
 * Skipped if context.deterministicCommands already includes tsc.
 */
async function checkTsc(
  tsFiles: string[],
  workDir: string,
  context: Record<string, unknown>,
): Promise<LintViolation[]> {
  if (tsFiles.length === 0) return [];

  // Skip if deterministic gate already runs tsc
  const deterministicCommands = context.deterministicCommands as string[] | undefined;
  if (deterministicCommands?.some((cmd: string) => cmd.includes('tsc'))) {
    log.debug(COMPONENT, 'Skipping tsc check — already in deterministicCommands');
    return [];
  }

  const violations: LintViolation[] = [];

  try {
    const { execSync } = await import('node:child_process');
    // Check if tsconfig exists
    const tsconfigPath = path.join(workDir, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
      log.debug(COMPONENT, 'No tsconfig.json found, skipping tsc check');
      return [];
    }

    try {
      execSync('npx tsc --noEmit 2>&1', {
        cwd: workDir,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000, // 2 minute timeout
      });
      // If no error thrown, tsc passed
    } catch (error: unknown) {
      const tscError = error as { stdout?: string; stderr?: string; status?: number };
      const output = tscError.stdout || tscError.stderr || '';
      // Parse tsc error output: file(line,col): error TSxxxx: message
      const errorPattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
      let match;
      while ((match = errorPattern.exec(output)) !== null) {
        const [, filePath, lineStr, colStr, code, message] = match;
        // Normalize file path to be relative
        const relPath = path.isAbsolute(filePath)
          ? path.relative(workDir, filePath)
          : filePath;

        violations.push({
          file: relPath,
          line: parseInt(lineStr, 10),
          column: parseInt(colStr, 10),
          rule: `tsc-${code}`,
          message,
          severity: 'error',
        });
      }

      // Cap violations to avoid massive feedback
      if (violations.length > 20) {
        const total = violations.length;
        violations.length = 20;
        violations.push({
          file: '(summary)',
          line: 0,
          rule: 'tsc-overflow',
          message: `...and ${total - 20} more TypeScript errors (showing first 20)`,
          severity: 'error',
        });
      }
    }
  } catch (error) {
    log.warn(COMPONENT, 'Failed to run tsc', { error: (error as Error).message });
  }

  return violations;
}

// --- Main linter implementation ---

export const jsLinter: LanguageLinter = {
  name: 'js',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],

  async lint(files: string[], workDir: string, context: Record<string, unknown>): Promise<LintViolation[]> {
    const violations: LintViolation[] = [];
    const packageDeps = loadPackageDeps(workDir);
    const tsFiles: string[] = [];

    for (const file of files) {
      const ext = path.extname(file);
      if (ext === '.ts' || ext === '.tsx') {
        tsFiles.push(file);
      }

      const absPath = path.isAbsolute(file) ? file : path.join(workDir, file);

      let content: string;
      try {
        content = fs.readFileSync(absPath, 'utf-8');
      } catch {
        log.debug(COMPONENT, `Cannot read file: ${file}`);
        continue;
      }

      const lines = content.split('\n');

      // Run all per-line checks
      violations.push(...checkSmartQuotes(lines, file));
      violations.push(...checkEmEnDashes(lines, file));
      violations.push(...checkEllipsis(lines, file));
      violations.push(...checkNonBreakingSpace(lines, file));
      violations.push(...checkZeroWidthChars(lines, file, content));
      violations.push(...checkPlaceholderCode(lines, file));
      violations.push(...checkHallucinatedImports(lines, file, packageDeps));
    }

    // Run tsc if we have TypeScript files
    const tscViolations = await checkTsc(tsFiles, workDir, context);
    violations.push(...tscViolations);

    return violations;
  },
};
