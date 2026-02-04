/**
 * ReadGate - SDK PreToolUse hook enforcing manifest read contracts
 *
 * Responsibilities:
 * - Intercept Read/Glob/Grep tool calls before execution
 * - Validate target path against declared allowed paths
 * - Block violations and count strikes (kill threshold configurable, default: no kill)
 * - Log all violations with -=LOOK - HERE=- marker
 */

import path from 'node:path';
import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import type { GuardrailMode } from './guardrail-config.ts';

export interface ReadGateConfig {
  agentId: string;
  allowedPaths: string[];
  workDir: string;
  killThreshold: number | null;
  killRunner: (reason: string) => void;
  mode: GuardrailMode;  // { strict, warning } — controls enforcement behavior
}

export class ReadGate {
  private config: ReadGateConfig;
  private strikes = 0;
  private allowedAbsolute: Set<string>;

  constructor(config: ReadGateConfig) {
    this.config = config;
    this.allowedAbsolute = new Set(
      config.allowedPaths.map(p => path.resolve(config.workDir, p).replace(/\/+$/, ''))
    );
  }

  /**
   * Create PreToolUse hook matcher for Read/Glob/Grep
   */
  createHook(): HookCallbackMatcher {
    return {
      matcher: 'Read|Glob|Grep',
      hooks: [async (input, _toolUseId, _options) => {
        const hookInput = input as { tool_name: string; tool_input: Record<string, unknown>; cwd: string };
        const rawPath = this.extractReadPath(hookInput.tool_name, hookInput.tool_input);

        // No path = tool default (cwd) — allow
        if (!rawPath) return { decision: 'approve' } as HookJSONOutput;

        const resolved = path.resolve(this.config.workDir, rawPath);
        if (this.isAllowed(resolved)) {
          return { decision: 'approve' } as HookJSONOutput;
        }

        this.strikes++;
        return this.handleViolation(rawPath, resolved);
      }],
      timeout: 5,
    };
  }

  private extractReadPath(toolName: string, toolInput: Record<string, unknown>): string | null {
    switch (toolName) {
      case 'Read':
        return (toolInput.file_path as string) || (toolInput.path as string) || null;
      case 'Glob':
      case 'Grep':
        return (toolInput.path as string) || null;
      default:
        return null;
    }
  }

  private isAllowed(resolvedPath: string): boolean {
    if (resolvedPath === '/dev/null') return true;
    if (this.allowedAbsolute.has(resolvedPath)) return true;
    for (const allowed of this.allowedAbsolute) {
      // Target is inside allowed directory
      if (resolvedPath.startsWith(allowed + path.sep)) return true;
      // Allowed path is inside target (Glob/Grep searching parent of allowed dir)
      if (allowed.startsWith(resolvedPath + path.sep)) return true;
    }
    return false;
  }

  private handleViolation(rawPath: string, resolvedPath: string): HookJSONOutput {
    const { strict, warning } = this.config.mode;
    const logData = {
      agentId: this.config.agentId,
      strikes: this.strikes,
      targetPath: rawPath,
      resolvedPath,
      allowedCount: this.allowedAbsolute.size,
      mode: { strict, warning },
    };

    // Non-strict: allow the action through
    if (!strict) {
      if (!warning) {
        log.debug('read-gate', 'Read violation (disabled mode, allowing)', logData);
        return { decision: 'approve' } as HookJSONOutput;
      }
      log.info('read-gate', 'Read outside manifest (warning mode, allowed)', logData);
      log.activity('guardrail:read-gate:warning', this.config.agentId, `Read gate warning: ${rawPath} (not in manifest, allowed)`);
      const pathList = this.allowedAbsolute.size > 0
        ? Array.from(this.allowedAbsolute).map(p => `  - ${p}`).join('\n')
        : '  (none declared)';
      return {
        decision: 'approve',
        systemMessage: `Note: "${rawPath}" is not in the declared manifest. ` +
          `This read was allowed. Declared read targets:\n${pathList}`,
      } as HookJSONOutput;
    }

    // Strict mode: current blocking behavior
    if (this.config.killThreshold !== null && this.strikes >= this.config.killThreshold) {
      log.error('read-gate', `-=LOOK - HERE=- Kill threshold reached`, {
        ...logData,
        allowedPaths: Array.from(this.allowedAbsolute),
      });
      log.activity('guardrail:read-gate', this.config.agentId, `Read gate STRICT KILL: ${this.strikes} violations — last: ${rawPath}`);
      this.config.killRunner(`Read gate: ${this.strikes} violations. Last: ${rawPath}`);
      return { decision: 'block', reason: warning ? 'Read contract terminated.' : undefined };
    }

    log.warn('read-gate', `-=LOOK - HERE=- Read contract violation (strict)`, logData);
    log.activity('guardrail:read-gate', this.config.agentId, `Read gate STRICT BLOCKED (${this.strikes}/${this.config.killThreshold ?? '∞'}): ${rawPath}`);

    if (!warning) {
      return { decision: 'block' };
    }

    const pathList = this.allowedAbsolute.size > 0
      ? Array.from(this.allowedAbsolute).map(p => `  - ${p}`).join('\n')
      : '  (none declared)';

    return {
      decision: 'block',
      reason: `READ CONTRACT VIOLATION [strike ${this.strikes}${this.config.killThreshold !== null ? `/${this.config.killThreshold}` : ''}]: ` +
        `Attempted to read "${rawPath}" which is not in the manifest.\n\n` +
        `Allowed read targets:\n${pathList}\n\n` +
        `Read only declared files.\n\n` +
        `If you believe this path should be allowed, write a message to core/core explaining which path you need and why.`,
    };
  }

  reset(): void {
    this.strikes = 0;
  }
}
