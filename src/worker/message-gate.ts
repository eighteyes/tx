/**
 * MessageGate - SDK PreToolUse hook enforcing max_messages at write time
 *
 * Responsibilities:
 * - Intercept Write tool calls targeting the msgs directory
 * - Count message writes per agent session
 * - Block writes that exceed the max_messages limit
 * - Kill the runner on limit breach in strict mode
 *
 * Solves the race condition where chokidar-based enforcement fires
 * after the SDK has already written dozens of files to disk.
 * This hook fires BEFORE the Write tool executes.
 */

import path from 'node:path';
import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import type { GuardrailMode } from './guardrail-config.ts';

export interface MessageGateConfig {
  agentId: string;
  msgsDir: string;
  maxMessages: number;
  mode: GuardrailMode;
  killRunner: (reason: string) => void;
}

export class MessageGate {
  private config: MessageGateConfig;
  private messageCount = 0;

  constructor(config: MessageGateConfig) {
    this.config = config;
  }

  /**
   * Create PreToolUse hook that intercepts Write calls to the msgs directory.
   * Counts message file writes and enforces max_messages before the file hits disk.
   */
  createHook(): HookCallbackMatcher {
    return {
      matcher: 'Write',
      hooks: [async (input, _toolUseId, _options) => {
        const hookInput = input as { tool_input: Record<string, unknown> };
        const filePath = (hookInput.tool_input?.file_path as string) || '';

        // Only gate writes to the msgs directory
        if (!this.isMessageWrite(filePath)) {
          return { decision: 'approve' } as HookJSONOutput;
        }

        this.messageCount++;
        const { strict, warning } = this.config.mode;
        const limit = this.config.maxMessages;

        if (this.messageCount <= limit) {
          return { decision: 'approve' } as HookJSONOutput;
        }

        // Over limit
        const logData = {
          agentId: this.config.agentId,
          messageCount: this.messageCount,
          maxMessages: limit,
          blockedPath: filePath,
          mode: { strict, warning },
        };

        if (!strict) {
          if (warning) {
            log.warn('message-gate', 'max_messages exceeded (warning mode, allowed)', logData);
            log.activity('guardrail:message-gate:warning', this.config.agentId,
              `Message gate warning: ${this.messageCount}/${limit} (allowed)`);
            return {
              decision: 'approve',
              systemMessage: `Warning: You have sent ${this.messageCount} messages (limit: ${limit}). ` +
                `Consider completing your work soon.`,
            } as HookJSONOutput;
          }
          // Disabled: silent approve
          return { decision: 'approve' } as HookJSONOutput;
        }

        // Strict mode: block the write and kill the runner
        log.warn('message-gate', 'max_messages exceeded — blocking write and killing worker', logData);
        log.activity('guardrail:message-gate', this.config.agentId,
          `Message gate STRICT KILL: ${this.messageCount}/${limit}`);

        this.config.killRunner(`max_messages limit reached (${this.messageCount}/${limit})`);

        if (!warning) {
          return { decision: 'block' } as HookJSONOutput;
        }

        return {
          decision: 'block',
          reason: `MESSAGE LIMIT REACHED: You have sent ${limit} messages (the maximum allowed). ` +
            `This write has been blocked and your session is being terminated.`,
        } as HookJSONOutput;
      }],
      timeout: 5,
    };
  }

  private isMessageWrite(filePath: string): boolean {
    if (!filePath) return false;
    const resolved = path.resolve(filePath);
    const msgsDir = path.resolve(this.config.msgsDir);
    return resolved.startsWith(msgsDir + path.sep) || resolved === msgsDir;
  }

  getMessageCount(): number {
    return this.messageCount;
  }

  reset(): void {
    this.messageCount = 0;
  }
}
