/**
 * IdentityGate - SDK PreToolUse hook enforcing message sender identity
 *
 * Responsibilities:
 * - Intercept Write tool calls to .ai/tx/msgs/ directory
 * - Parse YAML frontmatter from message content
 * - Validate `from:` field matches expected agent identity
 * - Block/warn when agent forgets its identity (common with weaker models)
 */

import path from 'node:path';
import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import type { GuardrailMode } from './guardrail-config.ts';

export interface IdentityGateConfig {
  agentId: string;  // Expected identity (mesh/agent format, e.g., "dev/worker")
  workDir: string;
  killRunner: (reason: string) => void;
  killThreshold: number | null;  // null = no kill (data gathering mode)
  mode: GuardrailMode;  // { strict, warning } — controls enforcement behavior
}

export class IdentityGate {
  private config: IdentityGateConfig;
  private strikes = 0;
  private msgsDir: string;

  constructor(config: IdentityGateConfig) {
    this.config = config;
    this.msgsDir = path.join(config.workDir, '.ai', 'tx', 'msgs');
  }

  /**
   * Create PreToolUse hook matcher for Write tool
   */
  createHook(): HookCallbackMatcher {
    return {
      matcher: 'Write',
      hooks: [async (input, _toolUseId, _options) => {
        const hookInput = input as { tool_name: string; tool_input: Record<string, unknown>; cwd: string };
        const filePath = hookInput.tool_input.file_path as string | undefined;
        const content = hookInput.tool_input.content as string | undefined;

        // Only validate messages to the msgs directory
        if (!filePath || !content) {
          return { decision: 'approve' } as HookJSONOutput;
        }

        const resolved = path.resolve(this.config.workDir, filePath);
        if (!resolved.startsWith(this.msgsDir + path.sep) && resolved !== this.msgsDir) {
          return { decision: 'approve' } as HookJSONOutput;
        }

        // Parse frontmatter and validate `from:` field
        const fromField = this.extractFromField(content);
        if (!fromField) {
          // No from field - let other validation handle this
          return { decision: 'approve' } as HookJSONOutput;
        }

        // Normalize for comparison (handle potential variations)
        const expectedFrom = this.config.agentId;
        const actualFrom = fromField.trim();

        if (this.matchesIdentity(actualFrom, expectedFrom)) {
          return { decision: 'approve' } as HookJSONOutput;
        }

        // Identity mismatch
        this.strikes++;
        return this.handleViolation(actualFrom, expectedFrom, filePath);
      }],
      timeout: 5,
    };
  }

  /**
   * Extract `from:` field from YAML frontmatter
   */
  private extractFromField(content: string): string | null {
    // Check for frontmatter delimiters
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) {
      return null;
    }

    const frontmatter = frontmatterMatch[1];

    // Extract `from:` field (handles various YAML formats)
    const fromMatch = frontmatter.match(/^from:\s*(.+)$/m);
    if (!fromMatch) {
      return null;
    }

    // Remove quotes if present
    return fromMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  /**
   * Check if actual `from:` matches expected identity
   * Handles: exact match, case variations, partial matches
   */
  private matchesIdentity(actual: string, expected: string): boolean {
    // Exact match
    if (actual === expected) {
      return true;
    }

    // Case-insensitive match
    if (actual.toLowerCase() === expected.toLowerCase()) {
      return true;
    }

    // Handle partial matches (agent might omit mesh prefix)
    // e.g., "worker" instead of "dev/worker"
    const [expectedMesh, expectedAgent] = expected.split('/');
    if (expectedAgent && actual === expectedAgent) {
      // Partial match - could be acceptable but log for awareness
      log.debug('identity-gate', 'Partial identity match (missing mesh prefix)', {
        actual,
        expected,
        agentId: this.config.agentId,
      });
      return true;
    }

    return false;
  }

  private handleViolation(
    actualFrom: string,
    expectedFrom: string,
    filePath: string,
  ): HookJSONOutput {
    const { strict, warning } = this.config.mode;
    const logData = {
      agentId: this.config.agentId,
      actualFrom,
      expectedFrom,
      filePath,
      strikes: this.strikes,
      mode: { strict, warning },
    };

    // Non-strict: allow the action through
    if (!strict) {
      if (!warning) {
        // Disabled: allow silently
        log.debug('identity-gate', 'Identity mismatch (disabled mode, allowing)', logData);
        return { decision: 'approve' } as HookJSONOutput;
      }
      // Warning: approve with gentle feedback
      log.info('identity-gate', 'Identity mismatch (warning mode, allowed)', logData);
      log.activity('guardrail:identity-gate:warning', this.config.agentId,
        `Identity mismatch: wrote from="${actualFrom}" but expected "${expectedFrom}"`);
      return {
        decision: 'approve',
        systemMessage: `Note: Your message has \`from: ${actualFrom}\` but your identity is \`${expectedFrom}\`. ` +
          `Please use your correct identity in future messages. The message was allowed this time.`,
      } as HookJSONOutput;
    }

    // Strict mode: current blocking behavior
    const killAt = this.config.killThreshold;
    if (killAt !== null && this.strikes >= killAt) {
      log.error('identity-gate', 'Kill threshold reached', {
        ...logData,
        killThreshold: killAt,
      });
      log.activity('guardrail:identity-gate', this.config.agentId,
        `Identity gate STRICT KILL: ${this.strikes} violations — wrote "${actualFrom}" expected "${expectedFrom}"`);
      this.config.killRunner(`Identity gate: ${this.strikes} identity violations. Last: wrote "${actualFrom}" expected "${expectedFrom}"`);
      return { decision: 'block', reason: warning ? 'Identity contract terminated.' : undefined };
    }

    // Below kill threshold: block with reason (if warning) or silently
    log.warn('identity-gate', 'Identity mismatch (strict)', logData);
    log.activity('guardrail:identity-gate', this.config.agentId,
      `Identity gate STRICT BLOCKED (${this.strikes}/${killAt ?? '∞'}): from="${actualFrom}" expected="${expectedFrom}"`);

    if (!warning) {
      return { decision: 'block' };
    }

    return {
      decision: 'block',
      reason: `IDENTITY CONTRACT VIOLATION [strike ${this.strikes}${killAt !== null ? `/${killAt}` : ''}]: ` +
        `Message has \`from: ${actualFrom}\` but your identity is \`${expectedFrom}\`.\n\n` +
        `Your agent address is: ${expectedFrom}\n\n` +
        `Fix the \`from:\` field in your message frontmatter and try again.`,
    };
  }

  reset(): void {
    this.strikes = 0;
  }
}
