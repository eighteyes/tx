/**
 * Code Context Utilities
 *
 * Shared helpers for hooks that need to gather project context for
 * gap analysis (discovery-code pre-hook, validation-code post-hook).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { HookContext } from '../types.ts';

// ─── Status Messaging ──────────────────────────────────────────────────────

/**
 * Send a non-blocking status update to core/core.
 * Uses systemWriter if available, falls back to writing a message file.
 */
export function writeStatusToCore(
  context: HookContext,
  headline: string,
  body: string,
  msgsDir?: string,
): void {
  const from = `${context.meshName || 'hooks'}/${context.agentName || 'hook'}`;

  if (context.systemWriter) {
    context.systemWriter.write({
      to: 'core/core',
      from,
      headline,
      body,
    });
  } else {
    const dir = msgsDir || path.join(context.workDir || '.', '.ai', 'tx', 'msgs');
    const timestamp = Math.floor(Date.now() / 1000);
    const msgId = `status-${Date.now()}`;
    const fromFile = from.replace('/', '-');
    const filename = `${timestamp}-update-${fromFile}--core-core-${msgId}.md`;
    const content = `---\nto: core/core\nfrom: ${from}\ntype: update\nmsg-id: ${msgId}\nheadline: ${headline}\ntimestamp: ${new Date().toISOString()}\n---\n\n${body}\n`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    } catch { /* best effort */ }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function tryExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

export function fileExists(p: string): boolean {
  try { fs.accessSync(p); return true; } catch { return false; }
}

export function readFileSafe(p: string, maxBytes = 8000): string {
  try {
    const content = fs.readFileSync(p, 'utf-8');
    return content.length > maxBytes ? content.slice(0, maxBytes) + '\n...(truncated)' : content;
  } catch {
    return '';
  }
}

// ─── Project Context Gathering ─────────────────────────────────────────────

/**
 * Gather project context: spec-graph intent, tech stack, file structure.
 * Used by both discovery-code (pre) and validation-code (post) hooks.
 */
export function gatherProjectContext(workDir: string): string {
  const sections: string[] = [];

  // 1. Spec-graph features (project intent)
  const specGraphPath = path.join(workDir, '.ai', 'know', 'spec-graph.json');
  if (fileExists(specGraphPath)) {
    const features = tryExec(`know -g ${specGraphPath} list --type feature`, workDir);
    const objectives = tryExec(`know -g ${specGraphPath} list --type objective`, workDir);
    const project = tryExec(`know -g ${specGraphPath} meta get project`, workDir);

    sections.push(`## Spec Graph — Project Intent\n${project || '(no project meta)'}`);
    if (objectives) sections.push(`### Objectives\n${objectives}`);
    if (features) sections.push(`### Features\n${features}`);
  } else {
    sections.push('## Spec Graph\n(not found — will infer intent from codebase)');
  }

  // 2. Package / manifest files (tech stack detection)
  const packageJson = readFileSafe(path.join(workDir, 'package.json'), 2000);
  if (packageJson) sections.push(`## package.json\n\`\`\`json\n${packageJson}\n\`\`\``);

  const pyproject = readFileSafe(path.join(workDir, 'pyproject.toml'), 1000);
  if (pyproject) sections.push(`## pyproject.toml\n\`\`\`toml\n${pyproject}\n\`\`\``);

  const cargoToml = readFileSafe(path.join(workDir, 'Cargo.toml'), 1000);
  if (cargoToml) sections.push(`## Cargo.toml\n\`\`\`toml\n${cargoToml}\n\`\`\``);

  // 3. Top-level directory structure
  const topDirs = tryExec('find . -maxdepth 2 -type f -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.rs" -o -name "*.go" | grep -v node_modules | grep -v ".git" | head -80', workDir);
  if (topDirs) sections.push(`## Source Files (sample)\n\`\`\`\n${topDirs}\n\`\`\``);

  // 4. Existing API routes (common patterns)
  const routes = tryExec('grep -r "router\\|app\\.get\\|app\\.post\\|@app\\.route\\|#\\[get\\|#\\[post" --include="*.ts" --include="*.py" --include="*.rs" --include="*.go" -l 2>/dev/null | head -20', workDir);
  if (routes) sections.push(`## Files with API routes\n${routes}`);

  // 5. Frontend entry points
  const frontendFiles = tryExec('find . -maxdepth 3 \\( -name "App.tsx" -o -name "App.jsx" -o -name "index.html" -o -name "pages" -type d \\) | grep -v node_modules | head -10', workDir);
  if (frontendFiles) sections.push(`## Frontend entry points\n${frontendFiles}`);

  // 6. Test files
  const testFiles = tryExec('find . -maxdepth 3 \\( -name "*.test.*" -o -name "*.spec.*" -o -name "e2e" -type d \\) | grep -v node_modules | head -20', workDir);
  if (testFiles) sections.push(`## Test files\n${testFiles}`);

  // 7. Existing README/CLAUDE/project docs
  const readme = readFileSafe(path.join(workDir, 'README.md'), 2000);
  if (readme) sections.push(`## README.md\n${readme}`);

  return sections.join('\n\n');
}
