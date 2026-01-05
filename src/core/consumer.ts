/**
 * MessageConsumer - V4 file watcher that routes messages to SQLite queue
 *
 * Responsibilities:
 * - Watch msgs directory for new .md files
 * - Parse message frontmatter and body
 * - Insert messages into SQLite queue
 * - Emit 'core-message' event for core/core messages (enables event-driven injection)
 */

import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { MessageQueue } from '../queue/index.ts';
import { log } from '../shared/logger.ts';

/**
 * Pending ask tracking for parity gate
 * Tracks outbound asks by msg-id to ensure workers wait for responses
 */
interface PendingAsk {
  to: string;        // Target agent
  timestamp: number; // When ask was sent
}

/**
 * Event emitted when task-complete is rejected due to pending asks
 */
export interface ParityReminderEvent {
  agentId: string;
  pendingAsks: Array<{ msgId: string; to: string }>;
  deletedFile: string;
}

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

export class MessageConsumer extends EventEmitter {
  private watchDir: string;
  private queue: MessageQueue;
  private watcher: FSWatcher | null = null;
  private running = false;
  private meshesDir: string;
  private meshEntryPoints: Map<string, string> = new Map();
  // Parity gate: track pending asks per agent by msg-id
  // Map<agentId, Map<msgId, PendingAsk>>
  private pendingAsks: Map<string, Map<string, PendingAsk>> = new Map();

  constructor(watchDir: string, queue: MessageQueue, meshesDir?: string) {
    super();
    this.watchDir = watchDir;
    this.queue = queue;
    // Default to TX_ROOT/meshes if not provided
    this.meshesDir = meshesDir || (process.env.TX_ROOT
      ? path.join(process.env.TX_ROOT, 'meshes')
      : path.join(process.cwd(), 'meshes'));
    this.loadMeshEntryPoints();
  }

  /**
   * Load entry_point mappings from mesh configs
   * Enables routing: to: dev → to: dev/worker
   */
  private loadMeshEntryPoints(): void {
    if (!fs.existsSync(this.meshesDir)) return;

    const scanDir = (dir: string, depth: number = 0) => {
      if (depth > 2) return;
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      // Check for config files in priority order: YAML > JSON
      const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
      const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

      if (yamlConfig) {
        try {
          const content = fs.readFileSync(path.join(dir, yamlConfig.name), 'utf-8');
          const config = YAML.parse(content);
          const entryPoint = config.entry_point || 'worker';
          this.meshEntryPoints.set(config.mesh, entryPoint);
        } catch {
          // Skip invalid configs
        }
      } else if (jsonConfig) {
        try {
          const content = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
          const config = JSON.parse(content);
          const entryPoint = config.entry_point || 'worker';
          this.meshEntryPoints.set(config.mesh, entryPoint);
        } catch {
          // Skip invalid configs
        }
      }

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scanDir(path.join(dir, entry.name), depth + 1);
        }
      }
    };

    scanDir(this.meshesDir);
  }

  /**
   * Subscribe to dispatcher events for parity gate
   * Clears pending asks when a new session starts for an agent
   */
  subscribeToDispatcher(dispatcher: EventEmitter): void {
    dispatcher.on('session-start', ({ agentId }: { agentId: string }) => {
      if (this.pendingAsks.has(agentId)) {
        const pendingCount = this.pendingAsks.get(agentId)!.size;
        if (pendingCount > 0) {
          log.info('consumer', `Clearing ${pendingCount} stale pending asks on session start`, {
            agentId,
            msgIds: Array.from(this.pendingAsks.get(agentId)!.keys()),
          });
        }
        this.pendingAsks.delete(agentId);
      }
    });
  }

  /**
   * Resolve mesh routing: to: dev → to: dev/worker
   * If 'to' contains slash, use as-is
   * If 'to' is just a mesh name, append entry_point
   */
  private resolveToAgent(to: string): string {
    if (to.includes('/')) return to;

    const entryPoint = this.meshEntryPoints.get(to);
    if (entryPoint) {
      return `${to}/${entryPoint}`;
    }

    // Default to 'worker' if mesh not found
    return `${to}/worker`;
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
        if (filepath.endsWith('.md')) this.processFile(filepath, 'new');
      });

      // Watch for changes - handles message revisions (edited files)
      this.watcher.on('change', (filepath: string) => {
        if (filepath.endsWith('.md')) this.processFile(filepath, 'revision');
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

  private processFile(filepath: string, event: 'new' | 'revision' = 'new'): void {
    const filename = path.basename(filepath);
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const parsed = this.parseMessage(content);
      if (!parsed) {
        log.debug('consumer', `Skipped non-message file: ${filename}`);
        return;
      }

      // Resolve mesh routing: to: dev → to: dev/worker
      const toAgent = this.resolveToAgent(parsed.frontmatter.to);

      // For revisions, emit revision-message event for interrupt handling
      // before attempting to insert (which may fail due to duplicate constraint)
      if (event === 'revision') {
        log.info('consumer', `Message revision detected`, {
          from: parsed.frontmatter.from,
          to: toAgent,
          type: parsed.frontmatter.type,
          file: filename
        });

        // Emit revision event for dispatcher to handle interrupt+resume
        if (toAgent !== 'core/core') {
          this.emit('revision-message', {
            filepath,
            agentId: toAgent,
            from: parsed.frontmatter.from,
            type: parsed.frontmatter.type,
            content: parsed.body,
            headline: parsed.frontmatter.headline
          });
        }
        return; // Don't queue revisions - they're handled via interrupt+resume
      }

      const id = this.queue.insert({
        from_agent: parsed.frontmatter.from,
        to_agent: toAgent,
        type: parsed.frontmatter.type,
        source_file: filepath,
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

      // -1 signals duplicate (constraint violation)
      if (id === -1) {
        log.debug('consumer', `Skipped duplicate file: ${filename}`);
        return;
      }

      log.info('consumer', `Queued message`, {
        id,
        from: parsed.frontmatter.from,
        to: toAgent,
        originalTo: parsed.frontmatter.to !== toAgent ? parsed.frontmatter.to : undefined,
        type: parsed.frontmatter.type,
        headline: parsed.frontmatter.headline,
        file: filename,
        event
      });

      // Emit events for event-driven dispatch (no polling needed)
      // Skip headless messages - they're handled by tx run, not the dispatcher
      if (parsed.frontmatter.headless === 'true') {
        log.debug('consumer', `Skipping headless message: ${filename}`);
        return;
      }

      // Detect ask messages - these trigger await state in dispatcher
      // Worker writes ask → consumer detects → dispatcher enters await
      // Also handles ask-human messages which require interrupt + steering
      const messageType = parsed.frontmatter.type;
      if (messageType === 'ask' || messageType === 'ask-human') {
        const msgId = parsed.frontmatter['msg-id'];
        const fromAgent = parsed.frontmatter.from;

        log.info('consumer', `${messageType} message detected`, {
          from: fromAgent,
          to: toAgent,
          msgId,
          file: filename
        });

        // Parity gate: track pending ask by msg-id
        if (msgId) {
          if (!this.pendingAsks.has(fromAgent)) {
            this.pendingAsks.set(fromAgent, new Map());
          }
          this.pendingAsks.get(fromAgent)!.set(msgId, {
            to: toAgent,
            timestamp: Date.now(),
          });
          log.info('consumer', `Parity gate: tracking ask`, {
            fromAgent,
            msgId,
            to: toAgent,
            pendingCount: this.pendingAsks.get(fromAgent)!.size,
          });
        }

        this.emit('ask-message', {
          id,
          filepath,
          from: fromAgent,
          to: toAgent,
          type: messageType,
          headline: parsed.frontmatter.headline,
          msgId
        });
      }

      // Detect ask-response messages - these resume awaiting workers
      if (messageType === 'ask-response') {
        const msgId = parsed.frontmatter['msg-id'];
        const respondingAgent = parsed.frontmatter.from;

        log.info('consumer', `Ask-response message detected`, {
          from: respondingAgent,
          to: toAgent,
          msgId,
          file: filename
        });

        // Parity gate: remove from pending asks by msg-id
        // The response is TO the agent who originally sent the ask
        if (msgId) {
          const agentPendingAsks = this.pendingAsks.get(toAgent);
          if (agentPendingAsks && agentPendingAsks.has(msgId)) {
            agentPendingAsks.delete(msgId);
            log.info('consumer', `Parity gate: resolved ask`, {
              agentId: toAgent,
              msgId,
              from: respondingAgent,
              remainingPending: agentPendingAsks.size,
            });
            // Clean up empty maps
            if (agentPendingAsks.size === 0) {
              this.pendingAsks.delete(toAgent);
            }
          } else {
            // Warning: ask-response for unknown msg-id
            log.warn('consumer', `Parity gate: ask-response for unknown msg-id`, {
              agentId: toAgent,
              msgId,
              from: respondingAgent,
              knownMsgIds: agentPendingAsks ? Array.from(agentPendingAsks.keys()) : [],
            });
          }
        }

        this.emit('ask-response-message', {
          id,
          filepath,
          from: respondingAgent,
          to: toAgent,
          content: parsed.body,
          headline: parsed.frontmatter.headline,
          msgId
        });
      }

      if (toAgent === 'core/core') {
        // Parity gate: check if task-complete has pending asks
        if (messageType === 'task-complete') {
          const fromAgent = parsed.frontmatter.from;
          const agentPendingAsks = this.pendingAsks.get(fromAgent);

          if (agentPendingAsks && agentPendingAsks.size > 0) {
            // Build pending asks list for reminder
            const pendingAsksList = Array.from(agentPendingAsks.entries()).map(([msgId, ask]) => ({
              msgId,
              to: ask.to,
            }));

            log.warn('consumer', `Parity gate: BLOCKING task-complete with pending asks`, {
              fromAgent,
              pendingAsks: pendingAsksList,
              file: filename,
            });

            // DELETE the task-complete file
            try {
              fs.unlinkSync(filepath);
              log.info('consumer', `Parity gate: deleted blocked task-complete file`, {
                filepath: filename,
              });
            } catch (unlinkErr) {
              log.error('consumer', `Parity gate: failed to delete task-complete file`, {
                filepath: filename,
                error: (unlinkErr as Error).message,
              });
            }

            // Emit parity-reminder event for dispatcher to inject feedback
            this.emit('parity-reminder', {
              agentId: fromAgent,
              pendingAsks: pendingAsksList,
              deletedFile: filepath,
            } as ParityReminderEvent);

            // Skip emitting core-message - the task-complete is blocked
            return;
          }
        }

        this.emit('core-message', {
          id,
          filepath,
          from: parsed.frontmatter.from,
          type: parsed.frontmatter.type,
          event
        });
      } else {
        // Parity gate: check if task-complete TO another worker has pending asks
        if (messageType === 'task-complete') {
          const fromAgent = parsed.frontmatter.from;
          const agentPendingAsks = this.pendingAsks.get(fromAgent);

          if (agentPendingAsks && agentPendingAsks.size > 0) {
            // Build pending asks list for reminder
            const pendingAsksList = Array.from(agentPendingAsks.entries()).map(([msgId, ask]) => ({
              msgId,
              to: ask.to,
            }));

            log.warn('consumer', `Parity gate: BLOCKING task-complete with pending asks`, {
              fromAgent,
              pendingAsks: pendingAsksList,
              file: filename,
            });

            // DELETE the task-complete file
            try {
              fs.unlinkSync(filepath);
              log.info('consumer', `Parity gate: deleted blocked task-complete file`, {
                filepath: filename,
              });
            } catch (unlinkErr) {
              log.error('consumer', `Parity gate: failed to delete task-complete file`, {
                filepath: filename,
                error: (unlinkErr as Error).message,
              });
            }

            // Emit parity-reminder event for dispatcher to inject feedback
            this.emit('parity-reminder', {
              agentId: fromAgent,
              pendingAsks: pendingAsksList,
              deletedFile: filepath,
            } as ParityReminderEvent);

            // Skip emitting worker-message - the task-complete is blocked
            return;
          }
        }

        this.emit('worker-message', {
          id,
          agentId: toAgent,
          from: parsed.frontmatter.from,
          type: parsed.frontmatter.type,
          event
        });
      }
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
