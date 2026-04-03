/**
 * SystemMessageWriter - Queue-first message dispatch for system-authored messages
 *
 * Responsibilities:
 * - Build frontmatter and write message files (audit trail)
 * - Insert directly into SQLite queue (bypasses chokidar latency)
 * - Emit routing events (core-message / worker-message) for immediate dispatch
 * - Register filepaths in systemFileRegistry so chokidar skips them
 *
 * Reference: writeFanOutTask() pattern from consumer.ts
 * Agent-authored messages (Claude SDK Write tool) remain chokidar-driven.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { MessageQueue } from '../queue/index.ts';
import { log } from '../shared/logger.ts';

export interface SystemMessageOptions {
  to: string;
  from: string;
  headline: string;
  body: string;
  msgId?: string;
  extraFrontmatter?: Record<string, string>;
  injectResponse?: boolean;
}

export interface SystemMessageResult {
  msgId: string;
  filepath: string;
  queueId: number;
}

export class SystemMessageWriter {
  private queue: MessageQueue;
  private msgsDir: string;
  private emit: (event: string, data: unknown) => void;
  private systemFileRegistry: Set<string>;

  constructor(
    queue: MessageQueue,
    msgsDir: string,
    emit: (event: string, data: unknown) => void,
    systemFileRegistry: Set<string>
  ) {
    this.queue = queue;
    this.msgsDir = msgsDir;
    this.emit = emit;
    this.systemFileRegistry = systemFileRegistry;
  }

  write(options: SystemMessageOptions): SystemMessageResult {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const msgId = options.msgId || `sys-${timestamp}-${rand}`;
    const safeFrom = options.from.replace(/\//g, '-');
    const safeTo = options.to.replace(/\//g, '-');
    const filename = `${timestamp}-${safeFrom}--${safeTo}-${msgId}.md`;
    const filepath = path.join(this.msgsDir, filename);

    // Build frontmatter
    const frontmatterLines = [
      `to: ${options.to}`,
      `from: ${options.from}`,
      `msg-id: ${msgId}`,
      `headline: ${options.headline}`,
      `timestamp: ${new Date(timestamp).toISOString()}`,
    ];

    if (options.injectResponse) {
      frontmatterLines.push('inject-response: true');
    }

    if (options.extraFrontmatter) {
      for (const [key, value] of Object.entries(options.extraFrontmatter)) {
        frontmatterLines.push(`${key}: ${value}`);
      }
    }

    const content = `---\n${frontmatterLines.join('\n')}\n---\n\n${options.body}\n`;

    // Order matters: register → queue insert → write file → emit
    // 1. Register filepath so chokidar skips it
    this.systemFileRegistry.add(filepath);

    // 2. Insert into queue (direct dispatch, bypasses chokidar)
    const queueId = this.queue.insert({
      from_agent: options.from,
      to_agent: options.to,
      source_file: filepath,
      payload: {
        'msg-id': msgId,
        headline: options.headline,
        body: options.body,
        filepath,
      },
    });

    if (queueId === -1) {
      // UNIQUE constraint — chokidar race or duplicate, safe to skip
      this.systemFileRegistry.delete(filepath);
      log.debug('system-writer', 'Message already queued (dedup)', { msgId, to: options.to });
      return { msgId, filepath, queueId: -1 };
    }

    // 3. Write file (audit trail)
    try {
      fs.writeFileSync(filepath, content);
    } catch (err) {
      log.error('system-writer', 'Failed to write audit file', {
        filepath,
        error: (err as Error).message,
      });
      // Queue insert succeeded — message will still be dispatched
    }

    // 4. Emit routing event
    const isCore = options.to === 'core/core';
    const event = isCore ? 'core-message' : 'worker-message';
    this.emit(event, {
      id: queueId,
      filepath,
      agentId: options.to,
      from: options.from,
      event: 'add',
      injectResponse: options.injectResponse || false,
    });

    log.info('system-writer', 'Message dispatched', {
      id: queueId,
      to: options.to,
      from: options.from,
      msgId,
    });

    return { msgId, filepath, queueId };
  }
}
