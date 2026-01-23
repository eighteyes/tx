/**
 * File-based logger for v4
 *
 * Logs to .ai/tx/logs/ instead of stdout to avoid polluting the tmux session
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SessionMetrics } from './types.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

class Logger {
  private logDir: string;
  private logFile: string;
  private activityFile: string;
  private minLevel: LogLevel = 'info';

  private readonly levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  constructor() {
    // Default to cwd, can be overridden with init()
    this.logDir = path.join(process.cwd(), '.ai', 'tx', 'logs');
    this.logFile = path.join(this.logDir, 'v4.jsonl');
    this.activityFile = path.join(this.logDir, 'activity.jsonl');
  }

  /**
   * Initialize logger with specific directory
   */
  init(workDir: string, level: LogLevel = 'info'): void {
    this.logDir = path.join(workDir, '.ai', 'tx', 'logs');
    this.logFile = path.join(this.logDir, 'v4.jsonl');
    this.activityFile = path.join(this.logDir, 'activity.jsonl');
    this.minLevel = level;

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.minLevel];
  }

  private write(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    } catch {
      // Silently fail - don't crash if logging fails
    }
  }

  debug(component: string, message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'debug',
      component,
      message,
      data
    });
  }

  info(component: string, message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      component,
      message,
      data
    });
  }

  warn(component: string, message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      component,
      message,
      data
    });
  }

  error(component: string, message: string, data?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      component,
      message,
      data
    });
  }

  /**
   * Log activity for tx spy - agent output, messages, worker events
   */
  activity(event: string, agentId: string, content: string, meta?: Record<string, unknown>): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      const entry = {
        timestamp: new Date().toISOString(),
        event,
        agentId,
        content,
        ...meta
      };
      fs.appendFileSync(this.activityFile, JSON.stringify(entry) + '\n');
    } catch {
      // Silently fail
    }
  }

  /**
   * Get path to activity file for external watchers
   */
  getActivityFile(): string {
    return this.activityFile;
  }

  /**
   * Log mesh session metrics summary
   */
  sessionComplete(session: SessionMetrics): void {
    // Extract agent names from agentIds (mesh/agent -> agent)
    const agentNames = session.workers.map(w => w.agentId.split('/')[1] || w.agentId);

    // Calculate total tool calls across all workers
    const totalToolCalls = session.workers.reduce((sum, w) => sum + (w.totalToolCalls || 0), 0);

    // Format tokens with commas for readability
    const formatNumber = (n: number): string => n.toLocaleString('en-US');
    const totalTokens = session.totalInputTokens + session.totalOutputTokens;

    // Build human-readable summary message
    const summaryLines = [
      `Mesh run complete: ${session.meshName} (task-id: ${session.meshInstance})`,
      `  Agents: ${agentNames.join(', ')}`,
      `  Total agents: ${session.workerCount}`,
      `  Total tokens: ${formatNumber(totalTokens)} (in: ${formatNumber(session.totalInputTokens)}, out: ${formatNumber(session.totalOutputTokens)})`,
      `  Total cost: $${session.totalCostUsd.toFixed(2)}`,
      `  Total tool calls: ${formatNumber(totalToolCalls)}`,
    ];

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      component: 'mesh-analytics',
      message: summaryLines.join('\n'),
      data: {
        meshInstance: session.meshInstance,
        meshName: session.meshName,
        workerCount: session.workerCount,
        agentNames,
        totalInputTokens: session.totalInputTokens,
        totalOutputTokens: session.totalOutputTokens,
        totalTokens,
        totalCostUsd: session.totalCostUsd.toFixed(4),
        totalToolCalls,
        durationMs: session.totalDurationMs,
        workers: session.workers.map(w => ({
          agentId: w.agentId,
          agentName: w.agentId.split('/')[1] || w.agentId,
          model: w.model,
          inputTokens: w.totalInputTokens,
          outputTokens: w.totalOutputTokens,
          costUsd: w.totalCostUsd.toFixed(4),
          toolCalls: w.totalToolCalls || 0,
        })),
      },
    };
    this.write(entry);
  }
}

// Singleton instance
export const log = new Logger();
