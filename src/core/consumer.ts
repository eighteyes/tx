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
 * Interface for mesh state management
 * Dispatcher implements this to clear in-memory state on mesh completion
 */
interface MeshStateManager {
  clearMeshState(meshName: string): void;
}

/**
 * Event emitted when task-complete is rejected due to pending asks
 */
export interface ParityReminderEvent {
  agentId: string;
  pendingAsks: Array<{ msgId: string; to: string }>;
  deletedFile: string;
}

/**
 * Event emitted when completion_agent sends task-complete to core/core
 * Signals that the mesh run is complete and analytics summary should be logged
 */
export interface MeshCompleteEvent {
  meshName: string;
  completionAgent: string;  // Full agentId (mesh/agent)
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

/**
 * Routing violation tracker for self-heal mechanism
 */
interface RoutingViolation {
  count: number;
  lastViolation: {
    attemptedTarget: string;
    messageType: string;
    timestamp: number;
  };
}

/**
 * Cached mesh config for routing validation
 */
interface CachedMeshConfig {
  config: MeshConfig;
  loadedAt: number;
}

/**
 * Mesh config structure (minimal for routing)
 */
interface MeshConfig {
  mesh: string;
  routing?: Record<string, Record<string, Record<string, string>>>;
  completion_agent?: string;
}

export class MessageConsumer extends EventEmitter {
  private watchDir: string;
  private queue: MessageQueue;
  private watcher: FSWatcher | null = null;
  private running = false;
  private meshesDir: string;
  private meshEntryPoints: Map<string, string> = new Map();
  // Map of mesh name to set of agent names for partial name resolution
  private meshAgents: Map<string, Set<string>> = new Map();
  // Command routing: maps slash commands to their handling mesh
  // e.g., "/know:add" → "brain", "/know:plan" → "brain"
  private commandToMesh: Map<string, string> = new Map();
  // Parity gate: pending asks are now persisted in SQLite via this.queue
  // FSM validator (dispatcher) for pre-routing validation
  private fsmValidator: FSMValidator | null = null;
  // Mesh state manager (dispatcher) for clearing state on completion
  private meshStateManager: MeshStateManager | null = null;
  // Routing self-heal: track violations per agent
  private routingViolationTracker: Map<string, RoutingViolation> = new Map();
  // Cache mesh configs for routing validation
  private meshConfigCache: Map<string, CachedMeshConfig> = new Map();
  private readonly MESH_CONFIG_CACHE_TTL = 60000; // 60 seconds

  constructor(watchDir: string, queue: MessageQueue, meshesDir?: string) {
    super();
    this.setMaxListeners(25);
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

        // Load agent names for partial name resolution
        const agents = config.agents as Array<{ name: string }> | undefined;
        if (agents && Array.isArray(agents)) {
          const agentNames = new Set(agents.map((a) => a.name));
          this.meshAgents.set(meshName, agentNames);
        }

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
   * Subscribe to dispatcher events for parity gate, FSM validation, and recovery
   * - Clears pending asks when a new session starts for an agent
   * - Sets up FSM validator for pre-routing message validation
   * - Sets up recovery handler for system/* interception
   * - Sets up mesh state manager for clearing in-memory state on completion
   */
  subscribeToDispatcher(dispatcher: EventEmitter & Partial<FSMValidator> & Partial<MeshStateManager>): void {
    // Store dispatcher as FSM validator if it has the validation method
    if (typeof dispatcher.validateMessageWithFSM === 'function') {
      this.fsmValidator = dispatcher as FSMValidator;
      log.debug('consumer', 'FSM validator registered');
    }

    // Store dispatcher as mesh state manager for clearing state on completion
    if (typeof dispatcher.clearMeshState === 'function') {
      this.meshStateManager = dispatcher as MeshStateManager;
      log.debug('consumer', 'Mesh state manager registered');
    }

    // Clear pending asks on session start - orphaned asks from previous session would block completion
    dispatcher.on('session-start', ({ agentId }: { agentId: string }) => {
      const cleared = this.queue.clearPendingAsks(agentId);
      if (cleared > 0) {
        log.debug('consumer', `Session start: cleared ${cleared} stale pending asks`, {
          agentId,
        });
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
   * Resolve mesh routing with support for partial names:
   * - to: mesh/agent → use as-is (fully qualified)
   * - to: agent (from narrative-engine/coordinator) → narrative-engine/agent (if agent exists in mesh)
   * - to: mesh → mesh/entry_point (treat as mesh name)
   */
  private resolveToAgent(to: string, from: string): string {
    // Already fully qualified
    if (to.includes('/')) return to;

    // Extract sender's mesh from "mesh/agent" format
    const fromParts = from.split('/');
    const senderMesh = fromParts.length > 1 ? fromParts[0] : null;

    // Check if 'to' is an agent in sender's mesh (partial name resolution)
    if (senderMesh) {
      const meshAgents = this.meshAgents.get(senderMesh);
      if (meshAgents && meshAgents.has(to)) {
        log.debug('consumer', `Resolved partial agent name`, {
          from,
          to,
          resolved: `${senderMesh}/${to}`
        });
        return `${senderMesh}/${to}`;
      }
    }

    // Treat 'to' as mesh name and append entry point
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

      // Resolve mesh routing with support for partial names
      const toAgent = this.resolveToAgent(parsed.frontmatter.to, parsed.frontmatter.from);
      const targetMesh = toAgent.split('/')[0];

      // =================================================================
      // DROP MESSAGES TO system/*
      // Agents routing to system/* is a mistake - drop silently
      // =================================================================
      const fromAgent = parsed.frontmatter.from;
      if (toAgent.startsWith('system/') && !fromAgent?.startsWith('system/')) {
        log.warn('consumer', 'Dropped message to system/* (routing mistake)', {
          from: fromAgent,
          to: toAgent,
          file: filename,
        });

        try {
          fs.unlinkSync(filepath);
        } catch (unlinkErr) {
          log.warn('consumer', `Failed to delete dropped message`, {
            file: filename,
            error: (unlinkErr as Error).message,
          });
        }
        return;
      }

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
      // ROUTING VALIDATION - happens BEFORE FSM check
      // Validates that routing rules exist for intra-mesh messages.
      // Self-heals on first violation, escalates on second.
      // =================================================================
      const messageType = parsed.frontmatter.type;

      if (fromAgent && toAgent && messageType) {
        const [fromMesh] = fromAgent.split('/');
        const [toMesh] = toAgent.split('/');

        // Only validate intra-mesh routing (not cross-mesh or system messages)
        // Skip task-complete as it's handled specially
        // Skip system messages (from: system/*)
        if (fromMesh === toMesh &&
            messageType !== 'task-complete' &&
            !fromAgent.startsWith('system/') &&
            !fromAgent.startsWith('core/')) {
          const routingValid = await this.validateRouting(fromAgent, toAgent, messageType, filepath);
          if (!routingValid) {
            // Already wrote feedback/escalation, skip further processing
            return;
          }
        }
      }

      // =================================================================
      // FSM VALIDATION - happens BEFORE type-specific routing
      // This is the central validation point for ALL message types.
      // =================================================================
      if (this.fsmValidator) {

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
          'session-id': parsed.frontmatter['session-id'],  // Resume existing session
          model: parsed.frontmatter.model,  // Override agent model
          priority: parsed.frontmatter.priority,  // Message priority
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
      if (messageType === 'ask' || messageType === 'ask-human') {
        const msgId = parsed.frontmatter['msg-id'];

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
        const inReplyTo = parsed.frontmatter['in-reply-to'];
        const respondingAgent = parsed.frontmatter.from;

        // Use in-reply-to as primary correlation, fall back to msg-id
        const correlationId = inReplyTo || msgId;

        log.info('consumer', `Ask-response message detected`, {
          from: respondingAgent,
          to: toAgent,
          msgId,
          inReplyTo,
          correlationId,
          file: filename
        });

        // Parity gate: validate response matches a pending ask (don't delete yet)
        // Deletion happens in dispatcher after successful delivery
        const result = this.queue.findPendingAsk(respondingAgent, toAgent, correlationId);

        if (result.found) {
          if (result.matchType === 'msg-id') {
            log.info('consumer', `Parity gate: found pending ask by msg-id`, {
              agentId: toAgent,
              msgId,
              from: respondingAgent,
              originalMsgId: result.ask?.msg_id,
            });
          } else {
            // Agent fallback - msg-id didn't match but found pending ask to this agent
            log.warn('consumer', `Parity gate: found pending ask by agent (msg-id mismatch)`, {
              agentId: toAgent,
              responseMsgId: msgId,
              originalMsgId: result.ask?.msg_id,
              from: respondingAgent,
            });
          }
        } else {
          // No match found - could be a race or truly unknown
          const pending = this.queue.getPendingAsks(toAgent);
          const counts = this.queue.getPendingAskCounts(toAgent);
          log.debug('consumer', `Parity gate: no pending ask found for response`, {
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
        return;  // ask-response handled - do NOT fall through to worker-message
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

          // Parity gate passed - check if this is the completion_agent
          const [meshName, agentName] = fromAgent.split('/');
          const meshConfig = await this.loadMeshConfig(meshName);
          const isCompletionAgent = meshConfig?.completion_agent === agentName;

          if (isCompletionAgent) {
            // Completion agent: clear ALL asks for the mesh
            const clearedAsks = this.queue.clearPendingAsksForMesh(meshName);
            if (clearedAsks > 0) {
              log.info('consumer', `Completion agent: cleared ${clearedAsks} mesh pending asks`, {
                meshName, fromAgent,
              });
            }
            // Also clear mesh state
            if (this.meshStateManager) {
              this.meshStateManager.clearMeshState(meshName);
            }

            // Emit mesh-complete event for analytics summary logging
            this.emit('mesh-complete', {
              meshName,
              completionAgent: fromAgent,
            } as MeshCompleteEvent);
          } else {
            // Non-completion agent: only clear this agent's asks
            const clearedAsks = this.queue.clearPendingAsks(fromAgent);
            if (clearedAsks > 0) {
              log.info('consumer', `Agent complete: cleared ${clearedAsks} pending asks`, {
                fromAgent,
              });
            }
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

  // ==========================================================================
  // ROUTING SELF-HEAL METHODS
  // ==========================================================================

  /**
   * Load mesh config from file system (cached)
   */
  private async loadMeshConfig(meshName: string): Promise<MeshConfig | null> {
    // Check cache
    const cached = this.meshConfigCache.get(meshName);
    if (cached && Date.now() - cached.loadedAt < this.MESH_CONFIG_CACHE_TTL) {
      return cached.config;
    }

    // Find and load config
    const meshDir = path.join(this.meshesDir, meshName);
    const yamlPath = path.join(meshDir, 'config.yaml');
    const ymlPath = path.join(meshDir, 'config.yml');
    const jsonPath = path.join(meshDir, 'config.json');

    let configPath: string | null = null;
    if (fs.existsSync(yamlPath)) configPath = yamlPath;
    else if (fs.existsSync(ymlPath)) configPath = ymlPath;
    else if (fs.existsSync(jsonPath)) configPath = jsonPath;

    if (!configPath) {
      log.debug('consumer', `No config found for mesh: ${meshName}`);
      return null;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = configPath.endsWith('.json')
        ? JSON.parse(content)
        : YAML.parse(content);

      // Cache the config
      this.meshConfigCache.set(meshName, {
        config,
        loadedAt: Date.now(),
      });

      return config;
    } catch (err) {
      log.error('consumer', `Failed to load mesh config: ${meshName}`, {
        error: (err as Error).message,
      });
      return null;
    }
  }

  /**
   * Validate routing rule exists for agent → target message
   * Returns true if valid, false if invalid (feedback/escalation already written)
   */
  private async validateRouting(
    fromAgent: string,
    toAgent: string,
    messageType: string,
    filepath: string
  ): Promise<boolean> {
    const [meshName, agentName] = fromAgent.split('/');
    const [, targetAgentName] = toAgent.split('/');

    // Load mesh config
    const meshConfig = await this.loadMeshConfig(meshName);
    if (!meshConfig || !meshConfig.routing) {
      // No routing config = allow (mesh doesn't define routing rules)
      return true;
    }

    // Check if routing rule exists for this agent → type → target
    const agentRouting = meshConfig.routing[agentName];
    if (!agentRouting) {
      // Agent not in routing table - might be an entry point receiving from core
      return true;
    }

    const typeRouting = agentRouting[messageType];
    if (!typeRouting) {
      // No rules for this message type = might be allowed
      // Only validate if the agent HAS routing rules defined
      const hasAnyRules = Object.keys(agentRouting).length > 0;
      if (!hasAnyRules) return true;

      // Check if target agent exists (soft violation)
      const [targetMesh] = toAgent.split('/');
      const meshAgentSet = this.meshAgents.get(targetMesh);
      const targetExists = meshAgentSet?.has(targetAgentName) ?? false;

      if (targetExists) {
        // Soft violation: no rules for this message type, but target exists
        // Clear violation tracker - this is a config gap, not agent error
        this.routingViolationTracker.delete(fromAgent);
        log.warn('consumer', 'Routing violation (soft): no rules for message type, but target exists', {
          from: fromAgent,
          to: toAgent,
          type: messageType,
          definedTypes: Object.keys(agentRouting),
        });
        return true; // Allow through
      }

      // Hard violation: target doesn't exist at all
      await this.trackRoutingViolation(fromAgent, toAgent, messageType, meshConfig, filepath);
      return false;
    }

    // Check if target is in the allowed destinations
    const routingRule = typeRouting[targetAgentName];
    if (!routingRule) {
      // Check if target agent exists in mesh (soft violation check)
      const [targetMesh] = toAgent.split('/');
      const meshAgentSet = this.meshAgents.get(targetMesh);
      const targetExists = meshAgentSet?.has(targetAgentName) ?? false;

      if (targetExists) {
        // Soft violation: agent exists but not in routing table
        // Clear violation tracker - this is a config gap, not agent error
        this.routingViolationTracker.delete(fromAgent);
        log.warn('consumer', 'Routing violation (soft): target exists, allowing message', {
          from: fromAgent,
          to: toAgent,
          type: messageType,
          expectedTargets: Object.keys(typeRouting || {}),
        });
        return true; // Allow through
      }

      // Hard violation: target doesn't exist at all
      await this.trackRoutingViolation(fromAgent, toAgent, messageType, meshConfig, filepath);
      return false;
    }

    // Valid routing - clear any previous violations
    this.routingViolationTracker.delete(fromAgent);
    return true;
  }

  /**
   * Track routing violation and write feedback or escalation
   */
  private async trackRoutingViolation(
    fromAgent: string,
    toAgent: string,
    messageType: string,
    meshConfig: MeshConfig,
    filepath: string
  ): Promise<void> {
    const violation = this.routingViolationTracker.get(fromAgent) || {
      count: 0,
      lastViolation: { attemptedTarget: '', messageType: '', timestamp: 0 },
    };

    violation.count++;
    violation.lastViolation = {
      attemptedTarget: toAgent,
      messageType,
      timestamp: Date.now(),
    };
    this.routingViolationTracker.set(fromAgent, violation);

    const [, agentName] = fromAgent.split('/');
    const validTargets = this.getValidRoutingTargets(meshConfig, agentName, messageType);

    log.warn('consumer', `Routing violation ${violation.count}x`, {
      fromAgent,
      toAgent,
      messageType,
      validTargets: validTargets.map(t => t.target),
      file: path.basename(filepath),
    });

    if (violation.count === 1) {
      // First violation: Write feedback to agent
      await this.writeRoutingFeedback(fromAgent, toAgent, messageType, validTargets, meshConfig);
    } else {
      // Second violation: Escalate to user
      await this.writeRoutingEscalation(fromAgent, toAgent, messageType, validTargets, meshConfig);
    }
  }

  /**
   * Get valid routing targets for an agent's message type
   */
  private getValidRoutingTargets(
    meshConfig: MeshConfig,
    agentName: string,
    messageType: string
  ): Array<{ target: string; description: string }> {
    const routing = meshConfig.routing?.[agentName]?.[messageType];
    if (!routing) return [];

    return Object.entries(routing).map(([target, description]) => ({
      target,
      description: String(description),
    }));
  }

  /**
   * Get all routing rules for an agent (for feedback context)
   */
  private getAllAgentRouting(
    meshConfig: MeshConfig,
    agentName: string
  ): Record<string, Array<{ target: string; description: string }>> {
    const agentRouting = meshConfig.routing?.[agentName];
    if (!agentRouting) return {};

    const result: Record<string, Array<{ target: string; description: string }>> = {};
    for (const [msgType, targets] of Object.entries(agentRouting)) {
      result[msgType] = Object.entries(targets).map(([target, description]) => ({
        target,
        description: String(description),
      }));
    }
    return result;
  }

  /**
   * Write routing feedback message to agent (first violation)
   */
  private async writeRoutingFeedback(
    fromAgent: string,
    attemptedTarget: string,
    messageType: string,
    validTargets: Array<{ target: string; description: string }>,
    meshConfig: MeshConfig
  ): Promise<void> {
    const [meshName, agentName] = fromAgent.split('/');

    // Get all routing rules for context
    const allRouting = this.getAllAgentRouting(meshConfig, agentName);

    // Format valid targets for the attempted message type
    const targetsFormatted = validTargets.length > 0
      ? validTargets.map(t => `- **${t.target}**: "${t.description}"`).join('\n')
      : '_No valid targets defined for this message type_';

    // Format all routing rules for context
    let allRoutingFormatted = '';
    for (const [msgType, targets] of Object.entries(allRouting)) {
      allRoutingFormatted += `\n**${msgType}:**\n`;
      for (const t of targets) {
        allRoutingFormatted += `- ${t.target}: "${t.description}"\n`;
      }
    }

    const feedbackContent = `# Routing Violation

\`${attemptedTarget}\` is not a valid target for \`${messageType}\` messages.

**Valid targets for ${messageType}:**
${targetsFormatted}

**All routes for ${agentName}:**
${allRoutingFormatted || '_None defined_'}`;

    // Emit event for dispatcher to inject directly into agent session
    this.emit('system-feedback', {
      agentId: fromAgent,
      feedback: feedbackContent,
      reason: 'routing-violation',
    });

    log.info('consumer', 'Emitted routing feedback for direct injection', {
      fromAgent,
      attemptedTarget,
      messageType,
    });
  }

  /**
   * Write routing escalation message to core (second violation)
   */
  private async writeRoutingEscalation(
    fromAgent: string,
    attemptedTarget: string,
    messageType: string,
    validTargets: Array<{ target: string; description: string }>,
    meshConfig: MeshConfig
  ): Promise<void> {
    const [meshName, agentName] = fromAgent.split('/');

    const targetsFormatted = validTargets.length > 0
      ? validTargets.map(t => `- **${t.target}**: "${t.description}"`).join('\n')
      : '_No valid targets defined for this message type_';

    const timestamp = Date.now();
    const msgId = `routing-escalation-${timestamp}`;
    const filename = `${timestamp}-ask-human-system--core-core-${msgId}.md`;
    const filepath = path.join(this.watchDir, filename);

    const escalationContent = `---
to: core/core
from: system/routing-validator
type: ask-human
msg-id: ${msgId}
headline: Routing violation needs human intervention
timestamp: ${new Date().toISOString()}
---

# Agent Repeatedly Violating Routing Rules

Agent \`${fromAgent}\` has violated routing rules **2 times** and needs human intervention.

## Latest Violation

- **Attempted target:** \`${attemptedTarget}\`
- **Message type:** \`${messageType}\`
- **Mesh:** ${meshName}

## Valid Targets for ${agentName} → ${messageType}:

${targetsFormatted}

## Recommended Actions

1. **Correct the agent's routing** - Guide the agent to use valid targets
2. **Update mesh config** - If the routing rule should exist, add it to \`meshes/${meshName}/config.yaml\`
3. **Reset the mesh** - Restart the mesh if agent is stuck

The agent's session is blocked until this is resolved.
`;

    fs.writeFileSync(filepath, escalationContent);
    log.info('consumer', 'Escalated routing violation to core', {
      fromAgent,
      attemptedTarget,
      messageType,
      msgId,
    });

    // Also write feedback to the agent so they know they're blocked
    const agentFeedbackMsgId = `routing-blocked-${timestamp}`;
    const agentFilename = `${timestamp}-routing-feedback-system--${meshName}-${agentName}-${agentFeedbackMsgId}.md`;
    const agentFilepath = path.join(this.watchDir, agentFilename);

    const agentFeedbackContent = `---
to: ${fromAgent}
from: system/routing-validator
type: routing-feedback
violation-count: 2
escalated: true
timestamp: ${new Date().toISOString()}
---

# Routing Violation - Escalated

Your message to \`${attemptedTarget}\` with type \`${messageType}\` has been blocked.

**This is your second routing violation.** The issue has been escalated to a human operator.

## What Happened

Your routing attempt does not match any configured routing rules for your agent.

## Valid targets for ${agentName} → ${messageType}:

${targetsFormatted}

**Your session is paused until a human resolves this issue.**
`;

    fs.writeFileSync(agentFilepath, agentFeedbackContent);
    log.info('consumer', 'Wrote escalation notice to agent', {
      fromAgent,
      msgId: agentFeedbackMsgId,
    });
  }
}
