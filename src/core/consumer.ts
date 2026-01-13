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
 * Interface for FSM validation capability
 * Dispatcher implements this for FSM validation
 */
interface FSMValidator {
  validateMessageWithFSM(
    senderAgentId: string,
    targetAgentId: string,
    messageType: string,
    messageFrontmatter: Record<string, unknown>,
    rearmatter?: Record<string, unknown>
  ): Promise<boolean>;
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
  // Command routing: maps slash commands to their handling mesh
  // e.g., "/know:add" → "brain", "/know:plan" → "brain"
  private commandToMesh: Map<string, string> = new Map();
  // Parity gate: pending asks are now persisted in SQLite via this.queue
  // FSM validator (dispatcher) for pre-routing validation
  private fsmValidator: FSMValidator | null = null;

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

      const loadConfig = (config: Record<string, unknown>) => {
        const meshName = config.mesh as string;
        const entryPoint = (config.entry_point as string) || 'worker';
        this.meshEntryPoints.set(meshName, entryPoint);

        // Extract slash commands from intents.commands
        const intents = config.intents as { commands?: Record<string, string> } | undefined;
        if (intents?.commands) {
          for (const slashCmd of Object.values(intents.commands)) {
            // Map the slash command to this mesh
            // e.g., "/know:add" → "brain"
            this.commandToMesh.set(slashCmd, meshName);
          }
        }
      };

      if (yamlConfig) {
        try {
          const content = fs.readFileSync(path.join(dir, yamlConfig.name), 'utf-8');
          const config = YAML.parse(content);
          loadConfig(config);
        } catch {
          // Skip invalid configs
        }
      } else if (jsonConfig) {
        try {
          const content = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
          const config = JSON.parse(content);
          loadConfig(config);
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
   * Subscribe to dispatcher events for parity gate and FSM validation
   * - Clears pending asks when a new session starts for an agent
   * - Sets up FSM validator for pre-routing message validation
   */
  subscribeToDispatcher(dispatcher: EventEmitter & Partial<FSMValidator>): void {
    // Store dispatcher as FSM validator if it has the validation method
    if (typeof dispatcher.validateMessageWithFSM === 'function') {
      this.fsmValidator = dispatcher as FSMValidator;
      log.debug('consumer', 'FSM validator registered');
    }

    dispatcher.on('session-start', ({ agentId }: { agentId: string }) => {
      const pending = this.queue.getPendingAsks(agentId);
      if (pending.length > 0) {
        log.info('consumer', `Clearing ${pending.length} stale pending asks on session start`, {
          agentId,
          msgIds: pending.map(p => p.msg_id),
        });
        this.queue.clearPendingAsks(agentId);
      }
    });
  }

  /**
   * Write error message to core for command routing issues
   */
  private writeErrorToCore(body: string, refMsgId: string): void {
    const timestamp = Date.now();
    const msgId = `error-${timestamp}`;
    const filename = `${timestamp}-error-system--core-core-${msgId}.md`;
    const filepath = path.join(this.watchDir, filename);

    const message = `---
to: core/core
from: system/consumer
type: error
msg-id: ${msgId}
ref-msg-id: ${refMsgId}
headline: Command routing error
timestamp: ${new Date().toISOString()}
---

${body}
`;

    fs.writeFileSync(filepath, message);
    log.info('consumer', 'Wrote command routing error to core', { msgId, refMsgId });
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
        if (filepath.endsWith('.md')) {
          this.processFile(filepath, 'new').catch((err) => {
            log.error('consumer', `Failed to process new file: ${path.basename(filepath)}`, {
              error: (err as Error).message,
            });
          });
        }
      });

      // Watch for changes - handles message revisions (edited files)
      this.watcher.on('change', (filepath: string) => {
        if (filepath.endsWith('.md')) {
          this.processFile(filepath, 'revision').catch((err) => {
            log.error('consumer', `Failed to process revised file: ${path.basename(filepath)}`, {
              error: (err as Error).message,
            });
          });
        }
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

  private async processFile(filepath: string, event: 'new' | 'revision' = 'new'): Promise<void> {
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
      const targetMesh = toAgent.split('/')[0];

      // Command validation: check if target mesh handles this command
      const command = parsed.frontmatter.command;
      if (command && this.commandToMesh.size > 0) {
        // Extract base command (e.g., "/know:add foo" → "/know:add")
        const baseCommand = command.split(' ')[0];
        const correctMesh = this.commandToMesh.get(baseCommand);

        if (correctMesh && correctMesh !== targetMesh) {
          log.warn('consumer', `Command routing error: ${baseCommand} should go to ${correctMesh}, not ${targetMesh}`, {
            command,
            targetMesh,
            correctMesh,
            file: filename
          });

          // Write error message back to core
          this.writeErrorToCore(
            `Command \`${baseCommand}\` should be routed to \`${correctMesh}\`, not \`${targetMesh}\`.\n\n` +
            `Correct routing:\n\`\`\`yaml\nto: ${correctMesh}/${this.meshEntryPoints.get(correctMesh) || 'worker'}\ncommand: ${command}\n\`\`\``,
            parsed.frontmatter['msg-id'] || filename
          );
          return;
        }
      }

      // =================================================================
      // FSM VALIDATION - happens BEFORE type-specific routing
      // This is the central validation point for ALL message types.
      // =================================================================
      if (this.fsmValidator) {
        const fromAgent = parsed.frontmatter.from;
        const messageType = parsed.frontmatter.type;

        // Build frontmatter record for FSM context
        const frontmatterRecord: Record<string, unknown> = {
          from: fromAgent,
          to: toAgent,
          type: messageType,
          'msg-id': parsed.frontmatter['msg-id'],
          headline: parsed.frontmatter.headline,
          status: parsed.frontmatter.status,
          command: parsed.frontmatter.command,
        };

        const isValid = await this.fsmValidator.validateMessageWithFSM(
          fromAgent,
          toAgent,
          messageType,
          frontmatterRecord,
          parsed.rearmatter ?? undefined
        );

        if (!isValid) {
          log.warn('consumer', 'Message rejected by FSM validation', {
            filepath: filename,
            from: fromAgent,
            to: toAgent,
            type: messageType,
          });
          // Don't route the message - FSM validation failed
          return;
        }
      }

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
          feature: parsed.frontmatter.feature,  // For worktree-enabled meshes
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

        // Parity gate: track pending ask in SQLite (survives restarts)
        if (msgId) {
          this.queue.trackPendingAsk(fromAgent, toAgent, msgId);
          const counts = this.queue.getPendingAskCounts(fromAgent);
          log.info('consumer', `Parity gate: tracking ask`, {
            fromAgent,
            msgId,
            to: toAgent,
            pendingCount: counts.get(toAgent) || 1,
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

        // Parity gate: progressive matching - msg-id first, then agent fallback
        // The response is TO the agent who originally sent the ask
        const result = this.queue.resolvePendingAsk(respondingAgent, toAgent, msgId);

        if (result.resolved) {
          if (result.matchType === 'msg-id') {
            log.info('consumer', `Parity gate: resolved ask by msg-id`, {
              agentId: toAgent,
              msgId,
              from: respondingAgent,
              originalMsgId: result.ask?.msg_id,
            });
          } else {
            // Agent fallback - msg-id didn't match but found pending ask to this agent
            log.warn('consumer', `Parity gate: resolved ask by agent (msg-id mismatch)`, {
              agentId: toAgent,
              responseMsgId: msgId,
              originalMsgId: result.ask?.msg_id,
              from: respondingAgent,
            });
          }
        } else {
          // No match found - truly unknown response
          const pending = this.queue.getPendingAsks(toAgent);
          const counts = this.queue.getPendingAskCounts(toAgent);
          log.warn('consumer', `Parity gate: ask-response for unknown ask`, {
            agentId: toAgent,
            msgId,
            from: respondingAgent,
            knownMsgIds: pending.map(p => p.msg_id),
            knownTargets: Array.from(counts.keys()),
          });
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
          const pending = this.queue.getPendingAsks(fromAgent);

          if (pending.length > 0) {
            const pendingAsksList = pending.map(p => ({
              msgId: p.msg_id,
              to: p.to_agent,
            }));

            log.warn('consumer', `Parity gate: BLOCKING task-complete with pending asks`, {
              fromAgent,
              pendingAsks: pendingAsksList,
              totalPendingCount: pending.length,
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
          const pending = this.queue.getPendingAsks(fromAgent);

          if (pending.length > 0) {
            const pendingAsksList = pending.map(p => ({
              msgId: p.msg_id,
              to: p.to_agent,
            }));

            log.warn('consumer', `Parity gate: BLOCKING task-complete with pending asks`, {
              fromAgent,
              pendingAsks: pendingAsksList,
              totalPendingCount: pending.length,
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
