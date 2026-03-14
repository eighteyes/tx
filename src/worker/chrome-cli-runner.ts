/**
 * ChromeCliRunner - CLI-based runner for browser-capable agents
 *
 * Spawns `claude --chrome --print` as a child process instead of using the Agent SDK.
 * WHY: The Agent SDK does not support `--chrome` — only the CLI does.
 * Hard-baked to the Chrome use case: no HITL permissions, no session resume, no checkpoint/fork.
 *
 * Implements the Runner interface so the dispatcher treats it interchangeably with SdkRunner.
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import type { MessageQueue } from '../queue/index.ts';
import type { Message } from '../queue/index.ts';
import type { SemanticModel, WorkerResult } from '../shared/types.ts';
import type { Runner } from './runner.ts';
import { isGuardrailKill } from './runner.ts';
import { log } from '../shared/logger.ts';

export interface ChromeCliRunnerConfig {
  id: string;
  model: SemanticModel;
  systemPrompt: string;
  workDir: string;
  msgsDir: string;
  maxTurns?: number;
  env?: Record<string, string>;
}

export class ChromeCliRunner extends EventEmitter implements Runner {
  private config: ChromeCliRunnerConfig;
  private queue: MessageQueue;
  private process: ChildProcess | null = null;
  private running = false;
  private _killReason: string | null = null;
  private sessionId: string | null = null;
  private output: string = '';
  private stderr: string = '';

  constructor(config: ChromeCliRunnerConfig, queue: MessageQueue) {
    super();
    this.setMaxListeners(25);
    this.config = config;
    this.queue = queue;
  }

  private buildArgs(taskPrompt: string): string[] {
    const args: string[] = [
      '--chrome',
      '--print',
      '--model', this.config.model,
      '--output-format', 'text',
    ];

    if (this.config.maxTurns) {
      args.push('--max-turns', String(this.config.maxTurns));
    }

    args.push('--system-prompt', this.config.systemPrompt);
    args.push(taskPrompt);

    return args;
  }

  private dequeueTask(): Message | null {
    const agentId = this.config.id;
    const pending = this.queue.getPendingTasks(agentId);
    if (pending.length === 0) return null;
    return pending[0];
  }

  async run(): Promise<WorkerResult> {
    const workerId = this.config.id;

    const task = this.dequeueTask();
    const taskPrompt = task
      ? (String(task.payload?.body ?? task.payload?.headline ?? 'No task body'))
      : 'No pending tasks';

    log.info('chrome-cli-runner', 'Spawning claude --chrome', {
      workerId,
      model: this.config.model,
      promptLength: this.config.systemPrompt.length,
      taskLength: taskPrompt.length,
    });

    this.running = true;
    this.sessionId = `chrome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<WorkerResult>((resolve) => {
      let settled = false;
      const args = this.buildArgs(taskPrompt);

      this.process = spawn('claude', args, {
        cwd: this.config.workDir,
        env: {
          ...process.env,
          ...this.config.env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.emit('start', { id: workerId });
      this.emit('init', { id: workerId, tools: [], sessionId: this.sessionId });

      this.process.stdout!.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        this.output += text;
        this.emit('output', { id: workerId, data: text });
      });

      this.process.stderr!.on('data', (chunk: Buffer) => {
        this.stderr += chunk.toString();
      });

      this.process.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;

        this.running = false;
        this.process = null;

        const success = code === 0 && !this._killReason;

        if (success) {
          if (task?.id !== undefined) this.queue.markProcessed(task.id);

          log.info('chrome-cli-runner', 'CLI process completed', {
            workerId,
            outputLength: this.output.length,
          });
          this.emit('complete', {
            id: workerId,
            messagesProcessed: task ? 1 : 0,
            output: this.output,
            sessionId: this.sessionId,
            metrics: { totalInputTokens: 0, totalOutputTokens: 0, totalCacheRead: 0, totalCacheCreation: 0, totalCost: 0, queries: 0 },
          });
          resolve({
            success: true,
            messagesProcessed: task ? 1 : 0,
            output: this.output,
            sessionId: this.sessionId || undefined,
          });
        } else {
          const errorMsg = this._killReason
            ? `Killed: ${this._killReason}`
            : `CLI exited with code ${code}: ${this.stderr.slice(0, 500)}`;

          log.error('chrome-cli-runner', 'CLI process failed', {
            workerId,
            code,
            killReason: this._killReason,
            stderr: this.stderr.slice(0, 500),
          });
          this.emit('error', {
            id: workerId,
            error: errorMsg,
          });
          resolve({
            success: false,
            messagesProcessed: task ? 1 : 0,
            error: errorMsg,
          });
        }
      });

      this.process.on('error', (err: Error) => {
        if (settled) return;
        settled = true;

        this.running = false;
        this.process = null;

        const errorMsg = `Failed to spawn claude CLI: ${err.message}`;
        log.error('chrome-cli-runner', errorMsg, { workerId });

        this.emit('error', { id: workerId, error: errorMsg });
        resolve({
          success: false,
          messagesProcessed: 0,
          error: errorMsg,
        });
      });
    });
  }

  kill(reason?: string): void {
    this._killReason = reason || 'unspecified';
    log.warn('chrome-cli-runner', 'Killing CLI process', {
      workerId: this.config.id,
      reason: this._killReason,
      pid: this.process?.pid,
    });

    if (this.process) {
      this.process.kill('SIGTERM');
      const proc = this.process;
      setTimeout(() => {
        if (proc.exitCode === null) {
          log.warn('chrome-cli-runner', 'SIGTERM ignored, escalating to SIGKILL', {
            workerId: this.config.id,
            pid: proc.pid,
          });
          proc.kill('SIGKILL');
        }
      }, 5000).unref();
    }
    this.running = false;
  }

  getKillReason(): string | null { return this._killReason; }

  wasGuardrailKill(): boolean {
    return isGuardrailKill(this._killReason);
  }

  hasActiveQuery(): boolean {
    return this.running;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isRunning(): boolean {
    return this.running;
  }

  async interrupt(): Promise<void> {
    this.kill('interrupt');
  }

  async resume(_sessionId: string, _feedback: string): Promise<WorkerResult> {
    log.warn('chrome-cli-runner', 'Resume not supported for chrome agents', {
      workerId: this.config.id,
    });
    return { success: false, messagesProcessed: 0, error: 'Resume not supported for chrome agents' };
  }

  resolvePermission(_toolUseID: string, _allow: boolean, _message?: string): boolean {
    return false;
  }
}
