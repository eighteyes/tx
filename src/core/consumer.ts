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
import { DispatchRouter } from '../worker/dispatch-router.ts';
import type { DispatcherRoutingConfig } from '../shared/types.ts';
import { SystemMessageWriter } from './system-message-writer.ts';
import { GuardrailConfig } from '../worker/guardrail-config.ts';

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
  parallel?: string;  // 'true' to spawn parallel instance
  'mesh-id'?: string;  // Unique identifier for parallel instance
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
  routing_mode?: 'agent' | 'dispatcher';
  routing?: Record<string, Record<string, Record<string, string>>> | DispatcherRoutingConfig;
  agents?: Array<{ name: string; [key: string]: unknown }>;
  completion_agent?: string;  // DEPRECATED: Use completion_agents
  completion_agents?: string[];  // Agents at mesh boundary (can message core/core)
  boundary_agents?: string[];  // DEPRECATED: Use completion_agents (backward compatibility)
  fsm?: Record<string, unknown>;  // FSM config block (presence means FSM-controlled mesh)
  stop_on_first_complete?: boolean;  // Stop mesh on first completion signal (default: true)
  check_queue_on_complete?: boolean;  // Defer shutdown if queue has pending messages (default: true)
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
  // Cross-mesh routing error tracker: track retry count for non-existent mesh errors
  private crossMeshRoutingErrors: Map<string, number> = new Map();
  // Cache mesh configs for routing validation
  private meshConfigCache: Map<string, CachedMeshConfig> = new Map();
  private readonly MESH_CONFIG_CACHE_TTL = 60000; // 60 seconds
  // Dispatch routers for dispatcher-mode meshes (created on first use, invalidated with config cache)
  private dispatchRouters: Map<string, DispatchRouter> = new Map();
  // Registry of system-authored file paths — chokidar skips these (already queue-dispatched)
  readonly systemFileRegistry: Set<string> = new Set();
  // Queue-first writer for system-authored messages
  systemWriter!: SystemMessageWriter;
  // Guardrail config for max_instances enforcement
  private guardrailConfig: GuardrailConfig;

  constructor(watchDir: string, queue: MessageQueue, meshesDir?: string) {
    super();
    this.setMaxListeners(25);
    this.watchDir = watchDir;
    this.queue = queue;
    // Default to TX_ROOT/meshes if not provided
    this.meshesDir = meshesDir || (process.env.TX_ROOT
      ? path.join(process.env.TX_ROOT, 'meshes')
      : path.join(process.cwd(), 'meshes'));
    this.systemWriter = new SystemMessageWriter(
      queue,
      watchDir,
      (event, data) => this.emit(event, data),
      this.systemFileRegistry
    );
    // Derive workDir from watchDir (.ai/tx/msgs -> project root)
    // watchDir is typically <workDir>/.ai/tx/msgs
    const workDir = watchDir.endsWith(path.join('.ai', 'tx', 'msgs'))
      ? path.resolve(watchDir, '../../..')
      : path.dirname(watchDir);
    this.guardrailConfig = new GuardrailConfig(workDir);
    this.loadMeshEntryPoints();
  }

  /**
   * Register a parallel instance mesh by cloning the base mesh's agents
   * into meshAgents under the instance name (e.g., "test-echo-alpha").
   * This allows cross-mesh validation to recognize the rewritten route.
   */
  private registerParallelInstance(baseMesh: string, meshId: string): string {
    const instanceName = `${baseMesh}-${meshId}`;

    if (!this.meshAgents.has(instanceName)) {
      const baseAgents = this.meshAgents.get(baseMesh);
      if (baseAgents) {
        this.meshAgents.set(instanceName, new Set(baseAgents));
      }
      // Clone entry point from base mesh
      const baseEntry = this.meshEntryPoints.get(baseMesh);
      if (baseEntry) {
        this.meshEntryPoints.set(instanceName, baseEntry);
      }
      log.info('consumer', 'Registered parallel instance mesh', {
        baseMesh,
        meshId,
        instanceName,
        agents: baseAgents ? Array.from(baseAgents) : [],
      });
    }

    return instanceName;
  }

  /**
   * Try to load a mesh on-demand when a message arrives for an unknown mesh.
   * This enables hot-registration: new meshes added after TX starts are detected
   * when first messaged.
   *
   * Returns true if mesh was successfully loaded, false otherwise.
   */
  private tryLoadMeshOnDemand(meshName: string): boolean {
    // Check for config file in standard locations
    const meshDir = path.join(this.meshesDir, meshName);
    const yamlPath = path.join(meshDir, 'config.yaml');
    const ymlPath = path.join(meshDir, 'config.yml');
    const jsonPath = path.join(meshDir, 'config.json');

    let configPath: string | null = null;
    if (fs.existsSync(yamlPath)) configPath = yamlPath;
    else if (fs.existsSync(ymlPath)) configPath = ymlPath;
    else if (fs.existsSync(jsonPath)) configPath = jsonPath;

    // Also check TX_ROOT/meshes if different from project meshes
    if (!configPath && process.env.TX_ROOT) {
      const globalMeshDir = path.join(process.env.TX_ROOT, 'meshes', meshName);
      const globalYamlPath = path.join(globalMeshDir, 'config.yaml');
      const globalYmlPath = path.join(globalMeshDir, 'config.yml');
      const globalJsonPath = path.join(globalMeshDir, 'config.json');

      if (fs.existsSync(globalYamlPath)) configPath = globalYamlPath;
      else if (fs.existsSync(globalYmlPath)) configPath = globalYmlPath;
      else if (fs.existsSync(globalJsonPath)) configPath = globalJsonPath;
    }

    if (!configPath) {
      return false;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = configPath.endsWith('.json')
        ? JSON.parse(content)
        : YAML.parse(content);

      // Validate mesh name matches
      if (config.mesh !== meshName) {
        log.warn('consumer', 'Mesh config name mismatch during hot-load', {
          expected: meshName,
          actual: config.mesh,
          configPath,
        });
        return false;
      }

      // Register entry point
      const entryPoint = (config.entry_point as string) || 'worker';
      this.meshEntryPoints.set(meshName, entryPoint);

      // Register agent names for partial name resolution
      const agents = config.agents as Array<{ name: string }> | undefined;
      if (agents && Array.isArray(agents)) {
        const agentNames = new Set(agents.map((a) => a.name));
        this.meshAgents.set(meshName, agentNames);
      }

      // Extract slash commands from intents.commands
      const intents = config.intents as { commands?: Record<string, string> } | undefined;
      if (intents?.commands) {
        for (const slashCmd of Object.values(intents.commands)) {
          this.commandToMesh.set(slashCmd, meshName);
        }
      }

      log.info('consumer', 'Hot-loaded mesh config', {
        meshName,
        entryPoint,
        agentCount: agents?.length || 0,
        configPath,
      });

      return true;
    } catch (err) {
      log.error('consumer', 'Failed to hot-load mesh config', {
        meshName,
        configPath,
        error: (err as Error).message,
      });
      return false;
    }
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
    this.systemWriter.write({
      to: 'core/core',
      from: 'system/consumer',
      type: 'error',
      headline: 'Command routing error',
      body,
      extraFrontmatter: { 'ref-msg-id': refMsgId },
    });
  }

  /**
   * Write a fan-out task file and directly dispatch it.
   *
   * Previously relied on chokidar to detect the written file and trigger
   * processFile() → worker-message. This fails in Docker (overlayfs) where
   * inotify events don't fire reliably for files created within a chokidar
   * event handler. Fix: write the file (audit trail), then directly insert
   * into the queue and emit worker-message for immediate dispatch.
   * Queue UNIQUE constraint on source_file safely deduplicates if chokidar
   * also picks up the file.
   */
  private writeFanOutTask(targetAgentId: string, fromAgent: string, body: string): void {
    this.systemWriter.write({
      to: targetAgentId,
      from: 'system/fan-out',
      type: 'task',
      headline: `Fan-out task from ${fromAgent}`,
      body,
      extraFrontmatter: { 'original-from': fromAgent },
    });
  }

  /**
   * Resolve mesh routing with support for partial names:
   * - to: mesh/agent → use as-is (fully qualified)
   * - to: agent (from narrative-engine/coordinator) → narrative-engine/agent (if agent exists in mesh)
   * - to: mesh → mesh/entry_point (treat as mesh name)
   */
  /**
   * Normalize a 'from' field to fully qualified mesh/agent format.
   * Agents often omit their mesh prefix when writing messages.
   */
  private resolveFromAgent(from: string, to: string): string {
    if (from.includes('/')) return from;

    // Infer mesh from the 'to' field
    const toParts = to.split('/');
    const targetMesh = toParts.length > 1 ? toParts[0] : null;

    if (targetMesh) {
      const meshAgents = this.meshAgents.get(targetMesh);
      if (meshAgents && meshAgents.has(from)) {
        log.debug('consumer', 'Resolved partial from agent name', {
          from,
          to,
          resolved: `${targetMesh}/${from}`
        });
        return `${targetMesh}/${from}`;
      }
    }

    // Both from and to are bare — prefer the mesh that contains BOTH agents
    // This prevents cross-mesh leaks when agents with identical names exist in multiple meshes
    const bareTo = to.includes('/') ? null : to;
    if (bareTo) {
      for (const [meshName, agents] of this.meshAgents) {
        if (agents.has(from) && agents.has(bareTo)) {
          log.warn('consumer', 'Resolved bare from+to to same mesh (bare names should be qualified)', {
            from,
            to: bareTo,
            resolved: `${meshName}/${from}`,
          });
          return `${meshName}/${from}`;
        }
      }
    }

    // Last resort: check all meshes for this agent name (arbitrary order — may pick wrong mesh)
    for (const [meshName, agents] of this.meshAgents) {
      if (agents.has(from)) {
        log.warn('consumer', 'Resolved bare from via mesh scan (ambiguous)', {
          from,
          resolved: `${meshName}/${from}`,
          note: 'Agent should use fully-qualified from: field',
        });
        return `${meshName}/${from}`;
      }
    }

    return from;
  }

  private resolveToAgent(to: string, from: string): string {
    // Already fully qualified
    if (to.includes('/')) return to;

    // Extract sender's mesh from "mesh/agent" format
    const fromParts = from.split('/');
    const senderMesh = fromParts.length > 1 ? fromParts[0] : null;

    // Check if 'to' is an agent in sender's mesh (partial name resolution)
    // This is like DNS search domains — bare names resolve within sender's mesh first
    if (senderMesh) {
      const meshAgents = this.meshAgents.get(senderMesh);
      if (meshAgents && meshAgents.has(to)) {
        log.info('consumer', `Resolved bare agent name within sender's mesh`, {
          from,
          to,
          senderMesh,
          resolved: `${senderMesh}/${to}`
        });
        return `${senderMesh}/${to}`;
      }
    }

    // Both 'to' and 'from' are bare names — find a mesh containing both
    if (!senderMesh) {
      const fromAgent = fromParts[0]; // bare agent name
      for (const [meshName, agents] of this.meshAgents) {
        if (agents.has(to) && agents.has(fromAgent)) {
          log.info('consumer', `Resolved both bare names to same mesh`, {
            from: fromAgent,
            to,
            resolved: `${meshName}/${to}`
          });
          return `${meshName}/${to}`;
        }
      }
      // 'from' is bare but 'to' not found alongside it — try 'to' as sole agent match (cross-mesh fallback)
      for (const [meshName, agents] of this.meshAgents) {
        if (agents.has(to)) {
          log.warn('consumer', `Bare agent name resolved via cross-mesh fallback (agent not in sender's mesh)`, {
            from,
            to,
            resolved: `${meshName}/${to}`,
            note: 'This may indicate a routing mistake'
          });
          return `${meshName}/${to}`;
        }
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
          // Skip system-authored files — already queue-dispatched
          if (this.systemFileRegistry.has(filepath)) {
            this.systemFileRegistry.delete(filepath);
            log.debug('consumer', 'Skipping system-authored file', { file: path.basename(filepath) });
            return;
          }
          this.processFile(filepath, 'new').catch((err) => {
            log.error('consumer', `Failed to process new file: ${path.basename(filepath)}`, {
              error: (err as Error).message,
            });
          });
        }
      });

      // Watch for changes - revision only when frontmatter declares it
      this.watcher.on('change', (filepath: string) => {
        if (filepath.endsWith('.md')) {
          this.processFile(filepath, 'change').catch((err) => {
            log.error('consumer', `Failed to process changed file: ${path.basename(filepath)}`, {
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

  private async processFile(filepath: string, event: 'new' | 'change' = 'new'): Promise<void> {
    const filename = path.basename(filepath);
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const parsed = this.parseMessage(content);
      if (!parsed) {
        log.debug('consumer', `Skipped non-message file: ${filename}`);
        return;
      }

      // Resolve mesh routing with support for partial names
      // CRITICAL: Resolve 'from' first so resolveToAgent can use sender's mesh context
      // This enables bare agent names to resolve within sender's mesh (e.g., oracle → narrator stays in narrative-engine-v2)
      const fromAgent = this.resolveFromAgent(parsed.frontmatter.from, parsed.frontmatter.to);
      let toAgent = this.resolveToAgent(parsed.frontmatter.to, fromAgent);

      // =================================================================
      // DISPATCHER ROUTING — resolve mesh/dispatch sentinel to real target
      // =================================================================
      let dispatcherResolved = false;
      const [sentinelMesh, sentinelAgent] = toAgent.split('/');
      if (sentinelAgent === 'dispatch') {
        const resolved = await this.resolveDispatcherRouting(
          sentinelMesh, fromAgent, parsed.frontmatter, filepath
        );
        if (resolved === null) {
          // Resolution failed — nudge/escalation already handled
          return;
        }
        toAgent = resolved;
        dispatcherResolved = true;

        // Re-infer message type with resolved target (dispatcher changes to → core/core)
        // Without this, status: complete to mesh/dispatch infers as 'message' instead of 'task-complete'
        if (!parsed.frontmatter._explicitType) {
          const reinferred = this.inferMessageType(parsed.frontmatter, toAgent, fromAgent);
          if (reinferred !== parsed.frontmatter.type) {
            log.info('consumer', 'Re-inferred message type after dispatcher resolution', {
              from: fromAgent, to: toAgent,
              originalType: parsed.frontmatter.type,
              resolvedType: reinferred,
            });
            parsed.frontmatter.type = reinferred;
          }
        }
      }

      // =================================================================
      // PARALLEL INSTANCE ROUTING — spawn or route to named instance
      // =================================================================
      const isParallelSpawn = parsed.frontmatter.parallel === 'true';
      const meshId = parsed.frontmatter['mesh-id'];
      let resolvedBaseMesh: string | undefined;

      if (isParallelSpawn && !meshId) {
        // parallel: true without mesh-id is an error
        log.error('consumer', 'parallel: true requires mesh-id field', {
          to: toAgent,
          from: fromAgent,
          file: filename,
        });

        this.systemWriter.write({
          to: 'core/core',
          from: 'consumer/consumer',
          type: 'error',
          headline: 'Missing mesh-id for parallel spawn',
          body: `Message has \`parallel: true\` but no \`mesh-id\` field. The \`mesh-id\` field is required when spawning parallel instances.`,
        });

        fs.unlinkSync(filepath);
        return;
      }

      if (isParallelSpawn && meshId) {
        const [baseMesh, agentName] = toAgent.split('/');
        resolvedBaseMesh = baseMesh;

        // Check if instance already exists
        const existing = this.queue.getInstance(baseMesh, meshId);

        if (existing) {
          // Rewrite 'to' field to route to the existing instance
          const instanceName = this.registerParallelInstance(baseMesh, meshId);
          const instanceAgent = `${instanceName}/${agentName}`;

          log.info('consumer', 'Routing to existing parallel instance', {
            baseMesh,
            meshId,
            instanceName,
            originalTo: toAgent,
            rewrittenTo: instanceAgent,
            from: fromAgent,
            file: filename,
          });

          // Rewrite the frontmatter.to field
          parsed.frontmatter.to = instanceAgent;
          toAgent = instanceAgent;
        } else {
          // Check max_instances guardrail before spawning
          const maxInstances = this.guardrailConfig.getMaxInstances(baseMesh);
          if (maxInstances !== null) {
            const running = this.queue.countRunningInstances(baseMesh);
            if (running >= maxInstances) {
              // Max instances exceeded - write error to core/core
              const errorMsg = `Max instances exceeded for mesh "${baseMesh}": ${running}/${maxInstances}. Cannot spawn instance with mesh-id "${meshId}".`;
              log.error('consumer', 'Max instances guardrail violation', {
                baseMesh,
                meshId,
                running,
                maxInstances,
                from: fromAgent,
              });

              this.systemWriter.write({
                to: 'core/core',
                from: 'consumer/consumer',
                type: 'error',
                headline: `Max instances exceeded for ${baseMesh}`,
                body: errorMsg,
              });

              // Delete the triggering file and return early
              fs.unlinkSync(filepath);
              return;
            }
          }

          // Register instance mesh and rewrite route on first message too
          const instanceName = this.registerParallelInstance(baseMesh, meshId);
          const instanceAgent = `${instanceName}/${agentName}`;

          log.info('consumer', 'Spawning new parallel instance', {
            baseMesh,
            meshId,
            instanceName,
            originalTo: toAgent,
            rewrittenTo: instanceAgent,
            from: fromAgent,
            file: filename,
          });

          // Mark instance in registry before spawning
          this.queue.insertInstance(baseMesh, meshId);

          // Rewrite the route to the instance name
          parsed.frontmatter.to = instanceAgent;
          toAgent = instanceAgent;

          this.emit('spawn-instance', {
            baseMesh,
            meshId,
            targetAgent: instanceAgent,
            fromAgent,
            messageId: parsed.frontmatter['msg-id'],
          });
        }
      } else if (meshId && !isParallelSpawn) {
        // mesh-id provided without parallel: true — route to existing instance
        const [baseMesh, agentName] = toAgent.split('/');
        resolvedBaseMesh = baseMesh;
        const existing = this.queue.getInstance(baseMesh, meshId);

        if (existing && existing.status === 'running') {
          // Rewrite 'to' field to route to the instance
          const instanceName = this.registerParallelInstance(baseMesh, meshId);
          const instanceAgent = `${instanceName}/${agentName}`;

          log.info('consumer', 'Routing to existing parallel instance by mesh-id', {
            baseMesh,
            meshId,
            instanceName,
            originalTo: toAgent,
            rewrittenTo: instanceAgent,
            from: fromAgent,
            file: filename,
          });

          // Rewrite the frontmatter.to field
          parsed.frontmatter.to = instanceAgent;
          toAgent = instanceAgent;
        } else if (existing && existing.status === 'completed') {
          log.warn('consumer', 'Attempted to route to completed parallel instance', {
            baseMesh,
            meshId,
            from: fromAgent,
            file: filename,
          });
          this.writeErrorToCore(
            `Cannot route to completed parallel instance \`${baseMesh}/${meshId}\`.`,
            parsed.frontmatter['msg-id'] || filename
          );
          return;
        } else {
          log.warn('consumer', 'Attempted to route to nonexistent parallel instance', {
            baseMesh,
            meshId,
            from: fromAgent,
            file: filename,
          });
          this.writeErrorToCore(
            `Parallel instance \`${baseMesh}/${meshId}\` does not exist. Use \`parallel: true\` to spawn.`,
            parsed.frontmatter['msg-id'] || filename
          );
          return;
        }
      }

      const targetMesh = toAgent.split('/')[0];
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

      // Cross-mesh validation: reject messages to nonexistent meshes
      // First attempt on-demand loading for new meshes added after TX started
      if (targetMesh !== 'core' &&
          !toAgent.startsWith('system/') &&
          !this.meshAgents.has(targetMesh)) {
        // Try hot-loading the mesh before dropping the message
        const loaded = this.tryLoadMeshOnDemand(targetMesh);
        if (!loaded) {
          // Handle cross-mesh routing error with retry mechanism
          const handled = await this.handleCrossMeshRoutingError(
            fromAgent,
            toAgent,
            targetMesh,
            parsed.frontmatter['msg-id'] || filename,
            filepath
          );
          if (!handled) {
            // Retry mechanism exhausted or error writing feedback - drop message
            return;
          }
          // Message dropped after retry handling
          return;
        }
        // Mesh was hot-loaded successfully — re-resolve the toAgent in case entry_point differs
        toAgent = this.resolveToAgent(parsed.frontmatter.to, parsed.frontmatter.from);
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

      // Type is always set by parseMessage() (either from file or inferred)
      const messageType = parsed.frontmatter.type;

      if (fromAgent && toAgent && messageType) {
        const [fromMesh] = fromAgent.split('/');
        const [toMesh] = toAgent.split('/');

        // Only validate intra-mesh routing (not cross-mesh or system messages)
        // Skip task-complete as it's handled specially
        // Skip system messages (from: system/*)
        // Skip dispatcher-resolved messages (already validated by DispatchRouter)
        if (fromMesh === toMesh &&
            messageType !== 'task-complete' &&
            !fromAgent.startsWith('system/') &&
            !fromAgent.startsWith('core/') &&
            !dispatcherResolved) {
          // Check if this is a dispatcher-mode mesh with agent bypassing sentinel
          const isDispatcherViolation = await this.checkDispatcherModeViolation(fromAgent, toAgent, filepath);
          if (isDispatcherViolation) return;

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

      // Explicit revision: only when frontmatter declares revision field
      const isRevision = !!parsed.frontmatter.revision;

      if (isRevision) {
        log.info('consumer', `Message revision detected (explicit)`, {
          from: parsed.frontmatter.from,
          to: toAgent,
          type: parsed.frontmatter.type,
          mode: parsed.frontmatter.revision,
          file: filename
        });

        if (toAgent !== 'core/core') {
          const mode = parsed.frontmatter.revision as 'interrupt' | 'append' | 'replace';
          this.emit('revision-message', {
            filepath,
            agentId: toAgent,
            from: parsed.frontmatter.from,
            type: parsed.frontmatter.type,
            content: parsed.body,
            headline: parsed.frontmatter.headline,
            mode
          });
        }
        return;
      }

      // Change events without revision frontmatter: treat as new message
      // Queue insert handles dedup via UNIQUE constraint on source_file

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
          'inject-response': parsed.frontmatter['inject-response'],  // Auto-inject response into core session
          'mesh-id': parsed.frontmatter['mesh-id'],  // Parallel instance identifier
          'base-mesh': resolvedBaseMesh,  // Base mesh name for parallel instances (dispatcher uses for config lookup)
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

      // Detect messages that trigger await state in dispatcher
      if (messageType === 'ask' || messageType === 'ask-human' || (messageType === 'message' && toAgent === 'core/core')) {
        if (messageType === 'ask' || messageType === 'ask-human') {
          log.warn('deprecated-message-type', `Legacy type="${messageType}" used; boundary inference handles this`, { type: messageType, file: filename, detail: 'Use human: true frontmatter instead of ask-human type' });
        }
        const msgId = parsed.frontmatter['msg-id'];

        log.info('consumer', `${messageType} message detected`, {
          from: fromAgent,
          to: toAgent,
          msgId,
          file: filename
        });

        // Human response detection: core/core → agent with pending ask = ask-response
        // When an agent messages core/core (human boundary), the mesh halts.
        // The human's reply comes back as a regular message from core/core.
        // Detect this and emit ask-response-message to resume the suspended session.
        if (fromAgent === 'core/core' && toAgent !== 'core/core') {
          const pendingAsks = this.queue.getPendingAsks(toAgent);
          const hasPendingHumanAsk = pendingAsks.some(a => a.to_agent === 'core/core');

          if (hasPendingHumanAsk) {
            log.info('consumer', `Human response detected for suspended agent`, {
              from: fromAgent,
              to: toAgent,
              msgId,
              pendingAskCount: pendingAsks.filter(a => a.to_agent === 'core/core').length,
              file: filename,
            });

            this.emit('ask-response-message', {
              id,
              filepath,
              from: fromAgent,
              to: toAgent,
              content: parsed.body,
              headline: parsed.frontmatter.headline,
              msgId,
              fromHumanBoundary: true,
              resumesSuspension: true,
            });
            return;  // Handled as ask-response — do NOT fall through
          }
        }

        // Parity gate: ONLY track asks to core/core (human boundary)
        // Agent-to-agent asks don't require parity tracking in terminal-by-default
        if (msgId && toAgent === 'core/core') {
          this.queue.trackPendingAsk(fromAgent, toAgent, msgId);
          const counts = this.queue.getPendingAskCounts(fromAgent);
          log.info('consumer', `Parity gate: tracking ask to human boundary`, {
            fromAgent,
            msgId,
            to: toAgent,
            pendingCount: counts.get(toAgent) || 1,
          });
        }

        // Boundary detection — any message to core/core crosses human boundary
        const crossesHumanBoundary = toAgent === 'core/core';
        const isTerminal = true;  // All asks are terminal by default (sender suspends)

        this.emit('ask-message', {
          id,
          filepath,
          from: fromAgent,
          to: toAgent,
          type: messageType,
          headline: parsed.frontmatter.headline,
          msgId,
          crossesHumanBoundary,
          isTerminal
        });
      }

      // Detect response messages - these resume awaiting workers
      if (messageType === 'ask-response') {
        log.warn('consumer', `DEPRECATED ASK: type 'ask-response' is deprecated, use 'message' + routing`, {
          from: parsed.frontmatter.from,
          to: toAgent,
        });
        const msgId = parsed.frontmatter['msg-id'];
        const respondingAgent = parsed.frontmatter.from;

        const correlationId = msgId;

        log.info('consumer', `Ask-response message detected`, {
          from: respondingAgent,
          to: toAgent,
          msgId,
          correlationId,
          file: filename
        });

        // Parity gate: ONLY validate responses from core/core (human boundary)
        // Agent-to-agent responses don't need parity tracking in terminal-by-default
        if (respondingAgent === 'core/core') {
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
        }

        // Boundary detection for terminal-by-default
        const fromHumanBoundary = respondingAgent === 'core/core';
        const resumesSuspension = fromHumanBoundary;  // Human responses resume suspensions

        this.emit('ask-response-message', {
          id,
          filepath,
          from: respondingAgent,
          to: toAgent,
          content: parsed.body,
          headline: parsed.frontmatter.headline,
          msgId,
          fromHumanBoundary,
          resumesSuspension
        });
        return;  // ask-response handled - do NOT fall through to worker-message
      }

      if (toAgent === 'core/core') {
        // Parity gate: check if task-complete has pending asks
        if (messageType === 'task-complete') {
          log.warn('deprecated-message-type', `Legacy type="task-complete" used; use status: complete instead`, { type: messageType, file: filename, detail: 'Parity gate core path' });
          const fromAgent = this.resolveFromAgent(parsed.frontmatter.from, toAgent);
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

          // Parity gate passed - mark parallel instance complete if mesh-id present
          if (parsed.frontmatter['mesh-id']) {
            const [meshName] = fromAgent.split('/');
            const instanceMeshId = parsed.frontmatter['mesh-id'];
            this.queue.completeInstance(meshName, instanceMeshId);
            log.info('consumer', 'Marked parallel instance complete', {
              baseMesh: meshName,
              meshId: instanceMeshId,
              fromAgent,
            });
          }

          // Check if this is a completion agent
          const [meshName, agentName] = fromAgent.split('/');
          const meshConfig = await this.loadMeshConfig(meshName);
          const completionAgents = this.normalizeCompletionAgents(meshConfig);
          const isCompletionAgent = completionAgents.includes(agentName);

          if (isCompletionAgent) {
            const stopOnFirst = meshConfig?.stop_on_first_complete !== false;  // default true
            const checkQueue = meshConfig?.check_queue_on_complete !== false;  // default true

            if (!stopOnFirst) {
              // Persistent mesh — completion signal is informational
              // Clear only THIS agent's asks, not the whole mesh
              this.queue.clearPendingAsks(fromAgent);
              log.info('consumer', 'Completion agent (stop_on_first_complete=false) — mesh continues', {
                meshName, fromAgent,
              });
              // Fall through to emit core-message normally
            } else if (checkQueue) {
              const pendingCount = this.queue.countPendingForMesh(meshName);
              if (pendingCount > 0) {
                // Queue still has work — defer shutdown
                log.info('consumer', 'Completion agent deferred — pending messages in queue', {
                  meshName, fromAgent, pendingCount,
                });
                this.queue.clearPendingAsks(fromAgent);
                // Fall through to emit core-message normally
              } else {
                // Queue empty — proceed with shutdown
                const clearedAsks = this.queue.clearPendingAsksForMesh(meshName);
                if (clearedAsks > 0) {
                  log.info('consumer', `Completion agent: cleared ${clearedAsks} mesh pending asks`, {
                    meshName, fromAgent,
                  });
                }
                if (this.meshStateManager) {
                  this.meshStateManager.clearMeshState(meshName);
                }
                this.queue.completeMeshRun(meshName, fromAgent);
                log.info('consumer', 'Marked mesh run complete', { mesh: meshName, completionAgent: fromAgent });
                this.emit('mesh-complete', {
                  meshName,
                  completionAgent: fromAgent,
                } as MeshCompleteEvent);
              }
            } else {
              // Immediate shutdown — original behavior
              const clearedAsks = this.queue.clearPendingAsksForMesh(meshName);
              if (clearedAsks > 0) {
                log.info('consumer', `Completion agent: cleared ${clearedAsks} mesh pending asks`, {
                  meshName, fromAgent,
                });
              }
              if (this.meshStateManager) {
                this.meshStateManager.clearMeshState(meshName);
              }
              this.queue.completeMeshRun(meshName, fromAgent);
              log.info('consumer', 'Marked mesh run complete', { mesh: meshName, completionAgent: fromAgent });
              this.emit('mesh-complete', {
                meshName,
                completionAgent: fromAgent,
              } as MeshCompleteEvent);
            }
          } else {
            // Non-completion agent: only clear this agent's asks
            const clearedAsks = this.queue.clearPendingAsks(fromAgent);
            if (clearedAsks > 0) {
              log.info('consumer', `Agent complete: cleared ${clearedAsks} pending asks`, {
                fromAgent,
              });
            }

            // FSM-controlled meshes: suppress core-message for intermediate agents.
            // The FSM handles dispatching next-state agents via fsm:dispatch.
            // Only the completion agent's message should reach core.
            if (meshConfig?.fsm) {
              log.info('consumer', 'FSM intermediate agent complete — suppressing core-message', {
                fromAgent,
                meshName,
              });
              return;
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
          log.warn('deprecated-message-type', `Legacy type="task-complete" used; use status: complete instead`, { type: messageType, file: filename, detail: 'Parity gate worker path' });
          const fromAgent = this.resolveFromAgent(parsed.frontmatter.from, toAgent);
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

        // Track mesh run start (if not already running)
        const [dispatchMesh] = toAgent.split('/');
        if (dispatchMesh && dispatchMesh !== 'core') {
          const existingRun = this.queue.getRunningMeshRun(dispatchMesh);
          if (!existingRun) {
            this.queue.startMeshRun(dispatchMesh);
            log.info('consumer', 'Started mesh run', { mesh: dispatchMesh });
          }
        }

        this.emit('worker-message', {
          id,
          agentId: toAgent,
          from: parsed.frontmatter.from,
          type: parsed.frontmatter.type,
          event,
          injectResponse: parsed.frontmatter['inject-response'] === 'true',
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

    // External messages: cross-project (txlit) or external systems
    // Synthesize missing fields so they pass through the pipeline
    if (frontmatter.external === 'true') {
      if (!frontmatter.to) frontmatter.to = 'core/core';
      if (!frontmatter.from) frontmatter.from = `external/${frontmatter.source || 'unknown'}`;
    }

    // Type field is optional — inferred from routing context
    if (!frontmatter.to || !frontmatter.from) return null;
    if (frontmatter.type) {
      frontmatter._explicitType = 'true';
    } else {
      frontmatter.type = this.inferMessageType(frontmatter, frontmatter.to, frontmatter.from);
    }

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

  /**
   * Infer message type when not explicitly provided (Terminal-by-default)
   * This enables simpler message authoring by inferring type from routing context
   *
   * DEPRECATED ASK: ask/ask-human/ask-response types are deprecated.
   * Future: only task, task-complete, message. Routing determines semantics.
   */
  private inferMessageType(fm: Frontmatter, to: string, from: string): string {
    // To core/core with status=complete or outcome=complete = task-complete (mesh completion signal)
    // Dispatcher agents use outcome: complete (resolved by DispatchRouter to core/core)
    // Agent-mode agents use status: complete
    if (to === 'core/core' && !from.startsWith('core/') && (fm.status === 'complete' || fm.outcome === 'complete')) {
      return 'task-complete';
    }
    // Everything else is a message. Human boundary is inferred from destination (core/core).
    return 'message';
  }

  // ==========================================================================
  // ROUTING SELF-HEAL METHODS
  // ==========================================================================

  /**
   * Normalize completion_agent / completion_agents / boundary_agents into an array
   * Supports backward compatibility with boundary_agents (deprecated)
   * Priority: completion_agents > boundary_agents > completion_agent
   */
  private normalizeCompletionAgents(config: MeshConfig | null): string[] {
    if (!config) return [];
    // Prefer completion_agents (current naming)
    if (config.completion_agents?.length) return config.completion_agents;
    // Backward compat: boundary_agents (deprecated)
    if (config.boundary_agents?.length) return config.boundary_agents;
    // Legacy: singular completion_agent
    if (config.completion_agent) return [config.completion_agent];
    return [];
  }

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
      // Invalidate dispatch router when config reloads
      this.dispatchRouters.delete(meshName);

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
  /**
   * Resolve dispatcher routing for mesh/dispatch sentinel messages.
   * Returns resolved target agent ID, or null if resolution fails (nudge emitted).
   */
  private async resolveDispatcherRouting(
    meshName: string,
    fromAgent: string,
    frontmatter: Frontmatter,
    filepath: string
  ): Promise<string | null> {
    const meshConfig = await this.loadMeshConfig(meshName);
    if (!meshConfig || meshConfig.routing_mode !== 'dispatcher') {
      log.warn('consumer', 'Message to mesh/dispatch but mesh is not in dispatcher mode', {
        meshName, from: fromAgent, file: path.basename(filepath),
      });
      // Treat as soft error — route through anyway if possible
      return null;
    }

    // Get or create DispatchRouter
    let router = this.dispatchRouters.get(meshName);
    if (!router) {
      const agentNames = (meshConfig.agents || []).map(a => a.name);
      router = new DispatchRouter(
        meshName,
        meshConfig.routing as DispatcherRoutingConfig,
        agentNames
      );
      this.dispatchRouters.set(meshName, router);
    }

    const [, senderAgent] = fromAgent.split('/');
    const outcome = frontmatter.outcome;
    const routeTo = frontmatter.route_to;

    const resolved = router.resolve(senderAgent, outcome, routeTo);

    if (resolved) {
      log.info('consumer', 'Dispatcher routing resolved', {
        from: fromAgent,
        outcome,
        routeTo,
        target: resolved.target,
        targets: resolved.targets,
        source: resolved.source,
        usedDefault: resolved.usedDefault,
      });

      // Fan-out: write extra task files for targets[1..N-1]
      if (resolved.targets && resolved.targets.length > 1) {
        // Read original message body for fan-out copies
        const originalContent = fs.readFileSync(filepath, 'utf-8');
        const originalParsed = this.parseMessage(originalContent);
        const body = originalParsed?.body || '';

        for (let i = 1; i < resolved.targets.length; i++) {
          this.writeFanOutTask(resolved.targets[i], fromAgent, body);
        }

        // Detect join agent and fan-in mode from router
        const parallelGroup = router.getParallelGroup(senderAgent);
        const joinAgent = parallelGroup?.joinAgent || null;

        // Emit fan-out event for dispatcher to register the group
        this.emit('fan-out', {
          meshName,
          agents: resolved.targets.map(t => t.split('/')[1]),
          sourceAgent: senderAgent,
          joinAgent,
          fanIn: parallelGroup?.fanIn || 'batch',
          transform: parallelGroup?.transform,
        });

        log.info('consumer', 'Fan-out dispatched', {
          from: fromAgent,
          targets: resolved.targets,
          joinAgent,
        });
      }

      // Check if this agent is completing into a fan-out join agent
      // Source 'branch' covers both explicit and implicit fan-out member routing
      if (outcome === 'complete' && resolved.target !== 'core/core') {
        this.emit('fan-out-complete', {
          meshName,
          agentName: senderAgent,
          joinAgent: resolved.target.split('/')[1],
        });
      }

      return resolved.target;
    }

    // Resolution failed — nudge the agent
    const validOutcomes = router.getValidOutcomes(senderAgent);
    const violation = this.routingViolationTracker.get(fromAgent) || {
      count: 0,
      lastViolation: { attemptedTarget: '', messageType: '', timestamp: 0 },
    };
    violation.count++;
    violation.lastViolation = {
      attemptedTarget: `${meshName}/dispatch`,
      messageType: frontmatter.type || 'message',
      timestamp: Date.now(),
    };
    this.routingViolationTracker.set(fromAgent, violation);

    if (violation.count <= 1) {
      // Nudge: tell agent what outcomes are valid
      const outcomeList = validOutcomes && validOutcomes.length > 0
        ? validOutcomes.map(o => `\`${o}\``).join(', ')
        : '(any value — linear routing)';

      const feedback = routeTo
        ? `Invalid \`route_to: ${routeTo}\`. Valid agents: ${router.getInjectionContext(senderAgent).availableAgents.join(', ')}`
        : outcome === 'discuss'
        ? `\`outcome: discuss\` requires \`route_to:\` specifying which peer to message. Peers: ${(router.getInjectionContext(senderAgent).peers || []).join(', ')}`
        : `Invalid or missing \`outcome: ${outcome || '(none)'}\`. Valid outcomes: ${outcomeList}`;

      this.emit('system-feedback', {
        agentId: fromAgent,
        feedback,
        reason: 'dispatcher-routing-violation',
      });
      log.warn('consumer', 'Dispatcher routing nudge', { from: fromAgent, feedback });
    } else {
      // Escalate to core
      this.writeErrorToCore(
        `Agent \`${fromAgent}\` failed dispatcher routing ${violation.count}x. ` +
        `Last outcome: \`${outcome || '(none)'}\`, route_to: \`${routeTo || '(none)'}\`.`,
        frontmatter['msg-id'] || path.basename(filepath)
      );
      log.warn('consumer', 'Dispatcher routing escalated to core', { from: fromAgent, count: violation.count });
    }

    return null;
  }

  /**
   * Check if an agent in a dispatcher-mode mesh is writing to a wrong target
   * (not mesh/dispatch). Called from routing validation when applicable.
   */
  async checkDispatcherModeViolation(
    fromAgent: string,
    toAgent: string,
    filepath: string
  ): Promise<boolean> {
    const [meshName] = fromAgent.split('/');
    const meshConfig = await this.loadMeshConfig(meshName);
    if (!meshConfig || meshConfig.routing_mode !== 'dispatcher') return false;

    // Agent in dispatcher-mode mesh wrote directly to another agent instead of mesh/dispatch
    const [, targetAgent] = toAgent.split('/');
    if (targetAgent === 'dispatch') return false; // Already handled

    const violation = this.routingViolationTracker.get(fromAgent) || {
      count: 0,
      lastViolation: { attemptedTarget: '', messageType: '', timestamp: 0 },
    };
    violation.count++;
    violation.lastViolation = {
      attemptedTarget: toAgent,
      messageType: 'message',
      timestamp: Date.now(),
    };
    this.routingViolationTracker.set(fromAgent, violation);

    if (violation.count <= 1) {
      this.emit('system-feedback', {
        agentId: fromAgent,
        feedback: `Write to \`${meshName}/dispatch\` instead of \`${toAgent}\`. Set \`outcome:\` in frontmatter.`,
        reason: 'dispatcher-wrong-target',
      });
      log.warn('consumer', 'Dispatcher mode: agent wrote to wrong target', {
        from: fromAgent, to: toAgent, hint: `${meshName}/dispatch`,
      });
    } else {
      this.writeErrorToCore(
        `Agent \`${fromAgent}\` bypassed dispatcher routing ${violation.count}x (sent to \`${toAgent}\`).`,
        path.basename(filepath)
      );
    }
    return true;
  }

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
    // This method is only called for agent-mode meshes (dispatcher-mode is handled separately)
    const agentModeRouting = meshConfig.routing as Record<string, Record<string, Record<string, string>>>;
    const agentRouting = agentModeRouting[agentName];
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
        log.warn('consumer', 'Routing violation (soft): target exists, sending anyway', {
          from: fromAgent,
          to: toAgent,
          type: messageType,
          expectedRoutes: Object.keys(agentRouting),
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
        log.warn('consumer', 'Routing violation (soft): target exists, sending anyway', {
          from: fromAgent,
          to: toAgent,
          type: messageType,
          expectedRoutes: Object.keys(typeRouting || {}),
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
    const agentModeRouting = meshConfig.routing as Record<string, Record<string, Record<string, string>>> | undefined;
    const routing = agentModeRouting?.[agentName]?.[messageType];
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
    const agentModeRouting = meshConfig.routing as Record<string, Record<string, Record<string, string>>> | undefined;
    const agentRouting = agentModeRouting?.[agentName];
    if (!agentRouting) return {};

    const result: Record<string, Array<{ target: string; description: string }>> = {};
    for (const [msgType, targets] of Object.entries(agentRouting)) {
      result[msgType] = Object.entries(targets as Record<string, string>).map(([target, description]) => ({
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

    const feedbackContent = `# Routing Violation — Retry Required

Your message to \`${attemptedTarget}\` was blocked. That agent does not exist.

**Valid targets:**
${targetsFormatted}

Re-read your workspace files to determine where you are in your sequence, then send to the correct target from the list above.`;

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

    // Escalation to core
    this.systemWriter.write({
      to: 'core/core',
      from: 'system/routing-validator',
      type: 'message',
      headline: 'Routing violation needs human intervention',
      body: `# Agent Repeatedly Violating Routing Rules

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

The agent's session is blocked until this is resolved.`,
    });

    // Feedback to the agent so they know they're blocked
    // Route through system-feedback event so dispatcher can attach session-id
    // for conversation context resume
    this.emit('system-feedback', {
      agentId: fromAgent,
      feedback: `# Routing Violation - Escalated

Your message to \`${attemptedTarget}\` with type \`${messageType}\` has been blocked.

**This is your second routing violation.** The issue has been escalated to a human operator.

## What Happened

Your routing attempt does not match any configured routing rules for your agent.

## Valid targets for ${agentName} → ${messageType}:

${targetsFormatted}

**Your session is paused until a human resolves this issue.**`,
      reason: 'routing-escalation',
    });
  }

  /**
   * Handle cross-mesh routing errors with retry mechanism.
   * Tracks retry count and injects correction messages to the agent.
   * Escalates to core after max retries exhausted.
   * Returns true if handled (message should be dropped), false if error occurred.
   */
  private async handleCrossMeshRoutingError(
    fromAgent: string,
    toAgent: string,
    targetMesh: string,
    msgId: string,
    filepath: string
  ): Promise<boolean> {
    const [senderMesh, senderAgent] = fromAgent.split('/');
    const errorKey = `${fromAgent}→${toAgent}`;

    // Get retry count
    const retryCount = (this.crossMeshRoutingErrors.get(errorKey) || 0) + 1;
    this.crossMeshRoutingErrors.set(errorKey, retryCount);

    // Get max retries from guardrail config
    const maxRetries = this.guardrailConfig.getRoutingMaxRetries(senderMesh, senderAgent);
    const routingMode = this.guardrailConfig.getMode('routing_error', senderMesh, senderAgent);

    log.warn('consumer', 'Cross-mesh routing error', {
      from: fromAgent,
      to: toAgent,
      targetMesh,
      retryCount,
      maxRetries,
      file: path.basename(filepath),
      knownMeshes: Array.from(this.meshAgents.keys()).sort(),
      mode: routingMode,
    });

    // Check if we should escalate
    if (retryCount >= maxRetries) {
      log.warn('consumer', 'Cross-mesh routing error: max retries exhausted, escalating', {
        from: fromAgent,
        to: toAgent,
        retryCount,
        maxRetries,
      });

      // Escalate to core/core
      this.systemWriter.write({
        to: 'core/core',
        from: 'system/routing-validator',
        type: 'message',
        headline: 'Cross-mesh routing error - human intervention required',
        body: `# Agent Repeatedly Sending to Non-Existent Mesh

Agent \`${fromAgent}\` has tried to send to non-existent mesh \`${targetMesh}\` **${retryCount} times**.

## Latest Attempt

- **Attempted target:** \`${toAgent}\`
- **Target mesh:** ${targetMesh} (does not exist)
- **Message ID:** ${msgId}

## Known Meshes

${Array.from(this.meshAgents.keys()).sort().map(m => `- ${m}`).join('\n')}

## Possible Issues

1. **Agent is hallucinating mesh names** - The agent is making up mesh names that don't exist
2. **Typo in mesh name** - The agent is close to a valid mesh name but has a typo
3. **Missing mesh config** - The mesh should exist but isn't registered

## Recommended Actions

1. **Guide the agent** - Review the agent's task and provide correct routing
2. **Check mesh configs** - Ensure all meshes are properly registered
3. **Restart the mesh** - If the agent is stuck, restart to clear state

The agent's message has been dropped.`,
        extraFrontmatter: {
          'retry-count': String(retryCount),
          'escalated': 'true',
          'ref-msg-id': msgId,
        },
      });

      // Clear retry counter after escalation
      this.crossMeshRoutingErrors.delete(errorKey);

      // Delete the message file
      try {
        fs.unlinkSync(filepath);
        log.info('consumer', 'Deleted message file after escalation', { file: path.basename(filepath) });
      } catch (unlinkErr) {
        log.warn('consumer', 'Failed to delete message file', {
          file: path.basename(filepath),
          error: (unlinkErr as Error).message,
        });
      }

      return true;
    }

    // Inject correction message with routing table
    const knownMeshes = Array.from(this.meshAgents.keys()).sort();
    const senderMeshConfig = await this.loadMeshConfig(senderMesh);

    // Build valid target list - include agents from sender's mesh and known meshes
    let validTargets = '';

    // 1. Agents in sender's mesh (for intra-mesh routing)
    if (senderMeshConfig && senderMeshConfig.agents) {
      const senderMeshAgents = senderMeshConfig.agents
        .map((a: { name: string }) => `${senderMesh}/${a.name}`)
        .join(', ');
      validTargets += `\n**Agents in your mesh (${senderMesh}):**\n${senderMeshAgents}\n`;
    }

    // 2. Known meshes (for cross-mesh routing)
    validTargets += `\n**Known meshes (use mesh/agent or just mesh for entry point):**\n`;
    for (const meshName of knownMeshes) {
      const entryPoint = this.meshEntryPoints.get(meshName);
      validTargets += `- **${meshName}** (entry: ${entryPoint || 'worker'})\n`;
    }

    // 3. Special targets
    validTargets += `\n**Special targets:**\n- **core/core** - Send to human\n`;

    const correctionMessage = `# Routing Error — Retry ${retryCount}/${maxRetries}

Your message to \`${toAgent}\` could not be delivered because **mesh "${targetMesh}" does not exist**.

## Valid Routing Targets
${validTargets}

## What to Do

1. **Review your workspace** to understand your current task
2. **Check the routing targets above** to find the correct destination
3. **Resend your message** with a valid target from the list

If you're unsure which target to use, message \`core/core\` to ask for clarification.`;

    // Emit system-feedback event for direct injection into agent session
    this.emit('system-feedback', {
      agentId: fromAgent,
      feedback: correctionMessage,
      reason: 'cross-mesh-routing-error',
    });

    log.info('consumer', 'Emitted cross-mesh routing correction for direct injection', {
      fromAgent,
      toAgent,
      targetMesh,
      retryCount,
      maxRetries,
    });

    // Delete the original message file
    try {
      fs.unlinkSync(filepath);
      log.info('consumer', 'Deleted message file after routing correction', { file: path.basename(filepath) });
    } catch (unlinkErr) {
      log.warn('consumer', 'Failed to delete message file', {
        file: path.basename(filepath),
        error: (unlinkErr as Error).message,
      });
    }

    return true;
  }
}
