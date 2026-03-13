/**
 * Runner - Shared interface for agent execution backends
 *
 * Both SdkRunner (Agent SDK) and ChromeCliRunner (claude CLI) implement this.
 * The dispatcher, lifecycle manager, and guardrail infrastructure type against
 * this interface so new runner types don't require union-type whack-a-mole.
 */

import { EventEmitter } from 'node:events';
import type { WorkerResult } from '../shared/types.ts';
import type { FileChangeSummary } from '../session/types.ts';

/**
 * Events emitted by all runners (dispatcher subscribes to these):
 * - 'start'           { id: string }
 * - 'init'            { id: string, tools?: string[], sessionId: string }
 * - 'init-anchor'     { id: string, firstUserMessageUuid: string }
 * - 'output'          { id: string, data: string }
 * - 'complete'        { id: string, messagesProcessed: number, output: string, sessionId: string, metrics: object }
 * - 'error'           { id: string, error: string }
 * - 'permission-ask'  { id: string, toolName: string, toolUseID: string }
 * - 'usage-policy-error' { id: string, error: object }
 * - 'interrupted'     { id: string, sessionId: string }
 * - 'max-turns-warning' { id: string, turnCount: number, maxTurns: number }
 */
export interface Runner extends EventEmitter {
  run(): Promise<WorkerResult>;
  kill(reason?: string): void;
  getKillReason(): string | null;
  wasGuardrailKill(): boolean;
  getSessionId(): string | null;
  isRunning(): boolean;
  interrupt(): Promise<void>;
  resume(sessionId: string, feedback: string): Promise<WorkerResult>;
  resolvePermission(toolUseID: string, allow: boolean, message?: string): boolean;
  getFilesChanged?(): FileChangeSummary;
}
