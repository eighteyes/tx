/**
 * MessageConsumer - V4 file watcher that routes messages to SQLite queue
 */

import { watch, type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import type { MessageQueue } from '../queue/index.ts';
import { log } from '../shared/logger.ts';

interface Frontmatter {
  to: string;
  from: string;
  type: string;
  status?: string;
  'msg-id'?: string;
  headline?: string;
  timestamp?: string;
  [key: string]: string | undefined;
}

interface ParsedMessage {
  frontmatter: Frontmatter;
  body: string;
  rearmatter: Record<string, unknown> | null;
}

export class MessageConsumer {
  private watchDir: string;
  private queue: MessageQueue;
  private watcher: FSWatcher | null = null;
  private running = false;

  constructor(watchDir: string, queue: MessageQueue) {
    this.watchDir = watchDir;
    this.queue = queue;
  }

  async start(): Promise<void> {
    if (this.running) return;

    if (!fs.existsSync(this.watchDir)) {
      fs.mkdirSync(this.watchDir, { recursive: true });
    }

    return new Promise((resolve) => {
      this.watcher = watch(this.watchDir, {
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
      });

      this.watcher.on('add', (filepath: string) => {
        if (filepath.endsWith('.md')) this.processFile(filepath);
      });

      this.watcher.on('ready', () => {
        this.running = true;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.running || !this.watcher) return;

    await this.watcher.close();
    this.watcher = null;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  private processFile(filepath: string): void {
    const filename = path.basename(filepath);
    try {
      // Skip if already processed (prevents duplicates on restart)
      if (this.queue.hasMessageFromFile(filepath)) {
        log.debug('consumer', `Skipped already-processed file: ${filename}`);
        return;
      }

      const content = fs.readFileSync(filepath, 'utf-8');
      const parsed = this.parseMessage(content);
      if (!parsed) {
        log.debug('consumer', `Skipped non-message file: ${filename}`);
        return;
      }

      const id = this.queue.insert({
        from_agent: parsed.frontmatter.from,
        to_agent: parsed.frontmatter.to,
        type: parsed.frontmatter.type,
        payload: {
          'msg-id': parsed.frontmatter['msg-id'],
          headline: parsed.frontmatter.headline,
          status: parsed.frontmatter.status,
          command: parsed.frontmatter.command,
          body: parsed.body,
          rearmatter: parsed.rearmatter,
          filepath
        }
      });

      log.info('consumer', `Queued message`, {
        id,
        from: parsed.frontmatter.from,
        to: parsed.frontmatter.to,
        type: parsed.frontmatter.type,
        headline: parsed.frontmatter.headline,
        file: filename
      });
    } catch (err) {
      log.error('consumer', `Failed to process file: ${filename}`, { error: (err as Error).message });
    }
  }

  private parseMessage(content: string): ParsedMessage | null {
    const parts = content.split(/^---$/m);
    if (parts.length < 3) return null;

    const frontmatter = this.parseFrontmatter(parts[1].trim());
    if (!frontmatter.to || !frontmatter.from || !frontmatter.type) return null;

    const hasRearmatter = parts.length >= 4;
    const body = hasRearmatter ? parts[2].trim() : parts.slice(2).join('---').trim();
    const rearmatter = hasRearmatter ? this.parseRearmatter(parts[3].trim()) : null;

    return { frontmatter, body, rearmatter };
  }

  private parseFrontmatter(yaml: string): Frontmatter {
    const data: Frontmatter = { to: '', from: '', type: '' };

    for (const line of yaml.split('\n')) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        data[key] = value;
      }
    }

    return data;
  }

  private parseRearmatter(yaml: string): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    for (const line of yaml.split('\n')) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (!match) continue;

      const key = match[1].trim();
      const raw = match[2].trim();

      // Parse as number, JSON, or keep as string
      if (/^-?\d+\.?\d*$/.test(raw)) {
        data[key] = parseFloat(raw);
      } else if (raw.startsWith('{') || raw.startsWith('[')) {
        try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
      } else {
        data[key] = raw;
      }
    }

    return data;
  }
}
