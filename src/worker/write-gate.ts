/**
 * WriteGate - SDK PreToolUse hook enforcing manifest write contracts
 *
 * Responsibilities:
 * - Intercept Write/Edit/NotebookEdit tool calls before execution
 * - Intercept Bash redirects (>, >>, tee) before execution
 * - Validate target path against declared allowed paths
 * - Implement violation gradient: 1-2 error with paths, 3+ kill
 * - Log all violations for forensics
 */

import path from 'node:path';
import fs from 'node:fs';
import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import type { GuardrailMode } from './guardrail-config.ts';

export interface WriteGateConfig {
  agentId: string;
  allowedPaths: string[];
  workDir: string;
  killRunner: (reason: string) => void;
  killThreshold: number | null;  // null = no kill (data gathering mode)
  mode: GuardrailMode;  // { strict, warning } — controls enforcement behavior
}

export class WriteGate {
  private config: WriteGateConfig;
  private fileToolStrikes = 0;
  private bashStrikes = 0;
  private allowedAbsolute: Set<string>;
  private msgsDir: string;
  private logsDir: string;

  constructor(config: WriteGateConfig) {
    this.config = config;
    this.msgsDir = path.join(config.workDir, '.ai', 'tx', 'msgs');
    this.logsDir = path.join(config.workDir, '.ai', 'tx', 'logs');

    // Resolve all allowed paths to absolute
    this.allowedAbsolute = new Set(
      config.allowedPaths
        .filter(p => !p.includes('{'))
        .map(p => this.resolvePath(p).replace(/\/+$/, ''))
    );
  }

  /**
   * Create PreToolUse hook matcher for Write/Edit/NotebookEdit
   */
  createFileToolHook(): HookCallbackMatcher {
    return {
      matcher: 'Write|Edit|NotebookEdit',
      hooks: [async (input, _toolUseId, _options) => {
        const hookInput = input as { tool_name: string; tool_input: Record<string, unknown>; cwd: string };
        const rawPath = this.extractFilePath(hookInput.tool_name, hookInput.tool_input);
        if (!rawPath) return { decision: 'approve' } as HookJSONOutput;

        const resolved = this.resolvePath(rawPath);
        if (this.isExempt(resolved) || this.isAllowed(resolved)) {
          return { decision: 'approve' } as HookJSONOutput;
        }

        this.fileToolStrikes++;
        return this.handleViolation('file-tool', this.fileToolStrikes, rawPath, resolved);
      }],
      timeout: 5,
    };
  }

  /**
   * Create PreToolUse hook matcher for Bash (redirect detection)
   */
  createBashHook(): HookCallbackMatcher {
    return {
      matcher: 'Bash',
      hooks: [async (input, _toolUseId, _options) => {
        const hookInput = input as { tool_input: Record<string, unknown> };
        const command = (hookInput.tool_input as { command?: string })?.command;
        if (!command) return { decision: 'approve' } as HookJSONOutput;

        const redirectPaths = this.extractBashRedirects(command);
        if (redirectPaths.length === 0) {
          return { decision: 'approve' } as HookJSONOutput;
        }

        for (const rawPath of redirectPaths) {
          const resolved = this.resolvePath(rawPath);
          if (!this.isExempt(resolved) && !this.isAllowed(resolved)) {
            this.bashStrikes++;
            return this.handleViolation('bash-redirect', this.bashStrikes, rawPath, resolved);
          }
        }

        return { decision: 'approve' } as HookJSONOutput;
      }],
      timeout: 5,
    };
  }

  private extractFilePath(toolName: string, toolInput: Record<string, unknown>): string | null {
    switch (toolName) {
      case 'Write':
      case 'Edit':
        return (toolInput.file_path as string) || null;
      case 'NotebookEdit':
        return (toolInput.notebook_path as string) || null;
      default:
        return null;
    }
  }

  private extractBashRedirects(command: string): string[] {
    const paths: string[] = [];
    // Match: > file, >> file, | tee file, | tee -a file
    const redirectRegex = /(?:>>?\s*|tee(?:\s+-a)?\s+)([^\s|;&"']+|"[^"]+"|'[^']+')/g;
    let match;
    while ((match = redirectRegex.exec(command)) !== null) {
      const filePath = match[1].replace(/^['"]|['"]$/g, '');
      if (filePath && !filePath.startsWith('-')) {
        paths.push(filePath);
      }
    }
    return paths;
  }

  private resolvePath(rawPath: string): string {
    const resolved = path.resolve(this.config.workDir, rawPath);
    const normalized = path.normalize(resolved);
    try {
      return fs.realpathSync(normalized);
    } catch {
      // File doesn't exist yet (Write creating new file)
      const dir = path.dirname(normalized);
      try {
        return path.join(fs.realpathSync(dir), path.basename(normalized));
      } catch {
        return normalized;
      }
    }
  }

  private isExempt(resolvedPath: string): boolean {
    if (resolvedPath === '/dev/null') return true;
    return resolvedPath.startsWith(this.msgsDir + path.sep) ||
           resolvedPath.startsWith(this.logsDir + path.sep) ||
           resolvedPath === this.msgsDir ||
           resolvedPath === this.logsDir;
  }

  private isAllowed(resolvedPath: string): boolean {
    if (this.allowedAbsolute.has(resolvedPath)) return true;
    for (const allowed of this.allowedAbsolute) {
      if (resolvedPath.startsWith(allowed + path.sep)) return true;
    }
    return false;
  }

  private handleViolation(
    type: 'file-tool' | 'bash-redirect',
    strikes: number,
    rawPath: string,
    resolvedPath: string,
  ): HookJSONOutput {
    const { strict, warning } = this.config.mode;
    const logData = {
      agentId: this.config.agentId,
      type,
      strikes,
      targetPath: rawPath,
      resolvedPath,
      allowedCount: this.allowedAbsolute.size,
      mode: { strict, warning },
    };

    // Non-strict: allow the action through
    if (!strict) {
      if (!warning) {
        // Disabled: allow silently
        log.debug('write-gate', 'Write violation (disabled mode, allowing)', logData);
        return { decision: 'approve' } as HookJSONOutput;
      }
      // Warning: approve with gentle feedback
      log.info('write-gate', 'Write outside manifest (warning mode, allowed)', logData);
      log.activity('guardrail:write-gate:warning', this.config.agentId, `Write gate warning: ${rawPath} (not in manifest, allowed)`);
      const pathList = this.allowedAbsolute.size > 0
        ? Array.from(this.allowedAbsolute).map(p => `  - ${p}`).join('\n')
        : '  (none declared)';
      return {
        decision: 'approve',
        systemMessage: `Note: "${rawPath}" is not in the declared manifest. ` +
          `This write was allowed. Declared write targets:\n${pathList}`,
      } as HookJSONOutput;
    }

    // Strict mode: current blocking behavior
    const killAt = this.config.killThreshold;
    if (killAt !== null && strikes >= killAt) {
      log.error('write-gate', 'Kill threshold reached', {
        ...logData,
        killThreshold: killAt,
        allowedPaths: Array.from(this.allowedAbsolute),
      });
      log.activity('guardrail:write-gate', this.config.agentId, `Write gate STRICT KILL: ${strikes} ${type} violations — last: ${rawPath}`);
      this.config.killRunner(`Write gate: ${strikes} ${type} violations. Last: ${rawPath}`);
      return { decision: 'block', reason: warning ? 'Write contract terminated.' : undefined };
    }

    // Below kill threshold: block with reason (if warning) or silently
    log.warn('write-gate', 'Write contract violation (strict)', logData);
    log.activity('guardrail:write-gate', this.config.agentId, `Write gate STRICT BLOCKED (${strikes}/${killAt ?? '∞'}): ${rawPath}`);

    if (!warning) {
      return { decision: 'block' };
    }

    const pathList = this.allowedAbsolute.size > 0
      ? Array.from(this.allowedAbsolute).map(p => `  - ${p}`).join('\n')
      : '  (none declared)';

    return {
      decision: 'block',
      reason: `WRITE CONTRACT VIOLATION [strike ${strikes}${killAt !== null ? `/${killAt}` : ''}]: ` +
        `Attempted to write "${rawPath}" which is not in the manifest.\n\n` +
        `Allowed write targets:\n${pathList}\n\n` +
        `Write only to declared files.\n\n` +
        `If you believe this path should be allowed, write a message to core/core explaining which path you need and why.`,
    };
  }

  reset(): void {
    this.fileToolStrikes = 0;
    this.bashStrikes = 0;
  }
}
