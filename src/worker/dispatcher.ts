/**
 * WorkerDispatcher - Watches queue for task messages and spawns workers
 *
 * When a task message arrives for a non-core agent, the dispatcher:
 * 1. Loads the mesh config to find the agent's prompt
 * 2. Spawns an SdkRunner with the task (resumes if session exists)
 * 3. Worker runs, writes response messages, exits
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { MessageQueue, type Message } from '../queue/index.ts';
import { SdkRunner, type SdkRunnerConfig, type AgentRouting, type ToolRestriction } from './sdk-runner.ts';
import type {SemanticModel, WorkerConfig, SessionMetrics, WorkerMetrics, FSMConfig, EnsembleConfig} from '../shared/types.ts';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import { WorkerStateMachine, createLoggingMiddleware } from '../state-machine/index.ts';
import {WorkspaceManager, PromptInjector, type WorkspaceConfig, type FSMInjectionContext} from '../workspace/index.ts';
import {
  LifecycleHooks,
  QualityIterationError,
  QualityHaltError,
  QualityExhaustedError,
  type HookContext,
} from './hooks.ts';
import { StuckAgentDetector, type StuckAgentConfig, type ActiveWorkerInfo } from './stuck-detector.ts';
import { MeshValidator } from './mesh-validator.ts';
import {
  type PreflightOutput,
} from '../quality/index.ts';
import type { ParityReminderEvent } from '../core/consumer.ts';
import { resolveLifecycle } from './lifecycle-utils.ts';
import {MeshFSM, type FSMTransitionEvent, type FSMGateEvent, type FSMScriptEvent} from '../mesh/index.ts';
import { EnsembleCoordinator } from './ensemble-coordinator.ts';
import type { FSMStateConfig, FSMEnsembleConfig } from '../shared/types.ts';
import { SessionStore, SessionSummarizer } from '../session/index.ts';

/**
 * Load environment variables from .mcp.env file
 * Returns empty object if file doesn't exist
 */
function loadMcpEnv(workDir: string): Record<string, string> {
  const mcpEnvPath = path.join(workDir, '.mcp.env');

  if (!fs.existsSync(mcpEnvPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(mcpEnvPath, 'utf-8');
    const env: Record<string, string> = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }

    return env;
  } catch (error) {
    log.warn('dispatcher', 'Failed to load .mcp.env', {
      error: (error as Error).message
    });
    return {};
  }
}

/**
 * Routing destination in mesh config
 * Format: { destination_agent: "reason string" }
 */
type MeshRoutingDestination = Record<string, string>;

/**
 * Agent routing in mesh config
 * Format: { status_type: { destination_agent: "reason" } }
 */
type MeshAgentRouting = Record<string, MeshRoutingDestination>;

/**
 * Mesh routing config
 * Format: { agent_name: { status_type: { destination_agent: "reason" } } }
 */
type MeshRouting = Record<string, MeshAgentRouting>;

/**
 * Iteration config for quality gates
 */
interface IterationConfig {
  maxIterations?: number;  // Max re-runs on quality failure (default: 3)
  onFail?: 'loop' | 'halt';  // What to do on quality failure (default: loop)
}

// continuation field: boolean | string[] | undefined
// - true = all agents persist sessions
// - string[] = only listed agents persist sessions
// - undefined/false = no session persistence

/**
 * Rearmatter (transparency metadata) configuration
 */
interface RearmatterConfig {
  enabled?: boolean;
  fields?: string[];
  thresholds?: {
    confidence?: number;
    grade?: string;
  };
}

interface MeshConfig {
  mesh: string;
  description?: string;
  agents: AgentConfig[];
  entry_point?: string;
  completion_agent?: string;  // Agent that sends task-complete to core
  workspace?: WorkspaceConfig;  // Optional workspace output schema
  worktree?: boolean;  // Shorthand: true = isolated worktree + auto-commit + cleanup
  continuation?: boolean | string[];  // true = all, array = specific agents, omit = none
  lifecycle?: {
    pre?: string[];   // Pre-hooks executed before worker spawn
    post?: string[];  // Post-hooks executed after worker completion
  };
  routing?: MeshRouting;  // Agent routing tables
  toolRestriction?: ToolRestriction;  // Tool access policy for all agents in mesh
  iteration?: IterationConfig;  // Iteration config for quality gates
  fsm?: FSMConfig;  // FSM config for workflow orchestration
  ensemble?: EnsembleConfig;  // Ensemble execution config
  rearmatter?: RearmatterConfig;  // Transparency metadata config
  _basePath?: string;  // Internal: directory containing this config (for relative prompt paths)
}

interface AgentConfig {
  name: string;
  model: SemanticModel;
  prompt: string;  // Path to prompt file
  workspace?: WorkspaceConfig;  // Optional per-agent workspace config
  mcpServers?: Record<string, McpServerConfig>;  // MCP server configurations
}

export interface DispatcherConfig {
  workDir: string;
  msgsDir: string;
  meshesDir: string;
  lowMode?: boolean;
  ultraLowMode?: boolean;
  /** Pre-initialized session store (from start.ts). If provided, dispatcher will record sessions. */
  sessionStore?: SessionStore;
}

/**
 * Comprehensive agent state snapshot for recovery guidance
 * Used by RecoveryHandler to generate guidance messages for confused agents
 */
export interface AgentStateSnapshot {
  agentId: string;
  meshName: string;
  fsm: {
    currentState: string;
    validExits: string[];
    context: Record<string, unknown>;
  } | null;
  worker: {
    status: string;
    isAwaiting: boolean;
    awaitingResponses: string[];
    messagesProcessed: number;
  } | null;
  pendingAsks: Array<{ msgId: string; to: string; createdAt: number }>;
  sessionId: string | null;
}

/**
 * Event emitted by Consumer when a message file is revised (edited)
 */
interface RevisionMessageEvent {
  filepath: string;
  agentId: string;
  from: string;
  type: string;
  content: string;
  headline?: string;
}

/**
 * Event emitted by Consumer when an ask message is detected
 */
interface AskMessageEvent {
  id: number;
  filepath: string;
  from: string;  // Agent that sent the ask (e.g., "narrative-engine/narrator")
  to: string;    // Agent being asked (e.g., "narrative-engine/system")
  type: string;  // 'ask' or 'ask-human'
  headline?: string;
  msgId?: string;
}

/**
 * Event emitted by Consumer when an ask-response message is detected
 */
interface AskResponseMessageEvent {
  id: number;
  filepath: string;
  from: string;  // Agent that responded (e.g., "narrative-engine/system")
  to: string;    // Agent receiving the response (e.g., "narrative-engine/narrator")
  content: string;
  headline?: string;
  msgId?: string;
}

/**
 * Active worker state
 */
interface ActiveWorker {
  workerId: string;  // Unique instance ID (agentId-uuid) for parallel execution
  runner: SdkRunner;
  machine: WorkerStateMachine;
  startedAt: number;
  hookContext: HookContext;  // Lifecycle hook context (includes quality state)
  startedPromise?: Promise<void>;  // Resolves when FSM 'start' transition completes
  lastOutputAt?: number;  // Timestamp of last output (for stuck detection)
}

/**
 * Suspended session state (worker killed, awaiting resume)
 */
interface SuspendedSession {
  sessionId: string;
  reason: 'ask-human' | 'await-response';  // ask-human = explicitly killed, await-response = exited while awaiting
  suspendedAt: number;
  targetAgents: Set<string>;  // All agents we're awaiting responses from (e.g., Set<"core/core">)
  pendingResponseCount: number;  // Number of responses still awaited
  meshName: string;
  agentConfig: AgentConfig;
  hookContext?: HookContext;  // Preserved for await-response resumption
}

export class WorkerDispatcher extends EventEmitter {
  private config: DispatcherConfig;
  private queue: MessageQueue;
  private running = false;
  private activeWorkers: Map<string, ActiveWorker[]> = new Map();
  private meshConfigs: Map<string, MeshConfig> = new Map();
  private meshFSMs: Map<string, MeshFSM> = new Map();  // mesh name -> FSM instance
  private stateFile: string;
  private workspaceManager: WorkspaceManager;
  private promptInjector: PromptInjector;
  private lifecycleHooks: LifecycleHooks;
  private boundMessageHandler: ((event: { agentId: string }) => void) | null = null;
  private boundRevisionHandler: ((event: RevisionMessageEvent) => void) | null = null;
  private boundAskMessageHandler: ((event: AskMessageEvent) => void) | null = null;
  private boundAskResponseHandler: ((event: AskResponseMessageEvent) => void) | null = null;
  private boundParityReminderHandler: ((event: ParityReminderEvent) => void) | null = null;
  private askResponseBuffer: Map<string, Array<{ from: string; content: string; headline?: string }>> = new Map();
  private sessionMetrics: Map<string, SessionMetrics> = new Map();
  private suspendedSessions: Map<string, SuspendedSession> = new Map();
  private stuckDetector: StuckAgentDetector;
  private ensembleCoordinator: EnsembleCoordinator;
  private sessionStore?: SessionStore;
  private sessionSummarizer?: SessionSummarizer;

  constructor(config: DispatcherConfig, queue: MessageQueue, stuckConfig?: Partial<StuckAgentConfig>) {
    super();
    this.config = config;
    this.queue = queue;
    this.stateFile = path.join(config.workDir, '.ai', 'tx', 'data', 'workers.json');
    this.workspaceManager = new WorkspaceManager(config.workDir);
    this.promptInjector = new PromptInjector();
    this.lifecycleHooks = new LifecycleHooks(config.workDir, queue, config.meshesDir);
    this.stuckDetector = new StuckAgentDetector(stuckConfig);
    this.ensembleCoordinator = new EnsembleCoordinator();

    // Session awareness - use store from config if provided
    if (config.sessionStore) {
      this.sessionStore = config.sessionStore;
      this.sessionSummarizer = new SessionSummarizer(this.sessionStore);
      log.debug('dispatcher', 'Session awareness enabled');
    }

    // Wire stuck detector events to dispatcher
    this.stuckDetector.on('agent:nudged', (data) => {
      this.emit('agent:nudged', data);
    });
    this.stuckDetector.on('agent:escalated', (data) => {
      // Clean up active worker on escalation
      this.activeWorkers.delete(data.agentId);
      this.writeWorkerState();
      this.emit('agent:escalated', data);
    });
  }

  private writeWorkerState(): void {
    const state = {
      workers: Array.from(this.activeWorkers.entries()).flatMap(([agentId, workers]) =>
        workers.map((w) => {
          const status = w.machine.getStatus();
          const baseState = {
            id: w.workerId,  // Use unique workerId instead of agentId
            agentId,
            status,
            startedAt: w.startedAt,
            messagesProcessed: w.machine.getMessagesProcessed(),
            duration: w.machine.getDuration()
          };

          // Add awaiting-specific fields if in awaiting state
          if (status === 'awaiting') {
            return {
              ...baseState,
              awaitingResponses: Array.from(w.machine.getAwaitingResponses()),
              awaitDuration: w.machine.getAwaitDuration()
            };
          }

          return baseState;
        })
      ),
      updatedAt: Date.now(),
    };
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Check if an agent should have session continuation enabled
   */
  private shouldContinueAgent(agentName: string, continuation: boolean | string[] | undefined): boolean {
    if (!continuation) return false;
    if (continuation === true) return true;
    if (Array.isArray(continuation)) return continuation.includes(agentName);
    return false;
  }

  // ============================================================================
  // Worker Instance Management (Array-based for Runtime Parallelism)
  // ============================================================================

  /**
   * Add a worker instance to the active workers map
   * Generates a unique workerId for parallel execution tracking
   */
  private addActiveWorker(agentId: string, worker: Omit<ActiveWorker, 'workerId'>): string {
    const workerId = `${agentId}-${crypto.randomUUID().slice(0, 8)}`;
    const workerWithId: ActiveWorker = { ...worker, workerId };

    const workers = this.activeWorkers.get(agentId) || [];
    workers.push(workerWithId);
    this.activeWorkers.set(agentId, workers);

    log.debug('dispatcher', 'Added active worker', {
      workerId,
      agentId,
      totalWorkersForAgent: workers.length,
    });

    return workerId;
  }

  /**
   * Remove a specific worker instance by workerId
   * Returns true if worker was found and removed
   */
  private removeActiveWorker(agentId: string, workerId: string): boolean {
    const workers = this.activeWorkers.get(agentId);
    if (!workers) return false;

    const filtered = workers.filter(w => w.workerId !== workerId);

    if (filtered.length === workers.length) {
      // Worker not found
      return false;
    }

    if (filtered.length === 0) {
      this.activeWorkers.delete(agentId);
    } else {
      this.activeWorkers.set(agentId, filtered);
    }

    log.debug('dispatcher', 'Removed active worker', {
      workerId,
      agentId,
      remainingWorkersForAgent: filtered.length,
    });

    return true;
  }

  /**
   * Get a specific worker by workerId (searches across all agents)
   */
  private getWorkerByWorkerId(workerId: string): { agentId: string; worker: ActiveWorker } | undefined {
    for (const [agentId, workers] of this.activeWorkers) {
      const worker = workers.find(w => w.workerId === workerId);
      if (worker) {
        return { agentId, worker };
      }
    }
    return undefined;
  }

  /**
   * Get the first worker for an agent (for backwards compatibility)
   * Used when a specific workerId is not available
   */
  private getFirstWorkerForAgent(agentId: string): ActiveWorker | undefined {
    const workers = this.activeWorkers.get(agentId);
    return workers?.[0];
  }

  /**
   * Get all workers for an agent
   */
  getActiveWorkersForAgent(agentId: string): ActiveWorker[] {
    return this.activeWorkers.get(agentId) || [];
  }

  /**
   * Check if agent has any active workers
   */
  hasActiveWorkers(agentId: string): boolean {
    const workers = this.activeWorkers.get(agentId);
    return workers !== undefined && workers.length > 0;
  }

  /**
   * Check if a mesh has any pending ask-human (suspended sessions)
   * When ask-human is pending, the entire mesh should be halted - no new workers spawn.
   */
  hasPendingAskHumanForMesh(meshName: string): boolean {
    for (const [agentId, suspended] of this.suspendedSessions) {
      if (suspended.meshName === meshName && suspended.reason === 'ask-human') {
        return true;
      }
    }
    return false;
  }

  /**
   * Get suspended session info for a mesh (for debugging/logging)
   */
  getSuspendedSessionForMesh(meshName: string): { agentId: string; suspended: SuspendedSession } | undefined {
    for (const [agentId, suspended] of this.suspendedSessions) {
      if (suspended.meshName === meshName) {
        return { agentId, suspended };
      }
    }
    return undefined;
  }

  /**
   * Process any queued messages for agents in a mesh after the mesh is un-halted.
   * This is called when a suspended session resumes and completes.
   */
  private processQueuedMeshMessages(meshName: string): void {
    const meshConfig = this.meshConfigs.get(meshName);
    if (!meshConfig) return;

    log.info('dispatcher', `Processing queued messages for un-halted mesh`, { meshName });

    // Check each agent in the mesh for queued messages
    for (const agent of meshConfig.agents) {
      const agentId = `${meshName}/${agent.name}`;
      const pendingMsg = this.queue.peekOne(agentId);

      if (pendingMsg && !this.hasActiveWorkers(agentId)) {
        log.info('dispatcher', `Found queued message for mesh agent, spawning worker`, {
          agentId,
          meshName,
          from: pendingMsg.from_agent,
          type: pendingMsg.type,
        });

        // Use setTimeout to avoid blocking the current handler
        setTimeout(() => {
          if (this.running && !this.hasActiveWorkers(agentId) && !this.hasPendingAskHumanForMesh(meshName)) {
            this.spawnWorker(meshName, agent);
          }
        }, 100);
      }
    }
  }

  /**
   * Restore suspended sessions from the queue (for crash recovery)
   * Called on startup to restore in-memory state from SQLite persistence
   */
  restoreSuspendedSessions(): void {
    const suspended = this.queue.listSuspendedSessions();

    for (const s of suspended) {
      // Find the mesh config and agent config
      const meshConfig = this.meshConfigs.get(s.meshName);
      const [, agentName] = s.agentId.split('/');
      const agentConfig = meshConfig?.agents.find(a => a.name === agentName);

      if (!agentConfig) {
        log.warn('dispatcher', 'Cannot restore suspended session: agent config not found', {
          agentId: s.agentId,
          meshName: s.meshName,
        });
        continue;
      }

      // Restore to in-memory map
      this.suspendedSessions.set(s.agentId, {
        sessionId: s.sessionId,
        reason: s.reason as 'ask-human' | 'await-response',
        suspendedAt: s.suspendedAt,
        targetAgents: new Set(s.targetAgents || []),
        pendingResponseCount: s.pendingCount,
        meshName: s.meshName,
        agentConfig,
        hookContext: s.hookContext ? JSON.parse(s.hookContext) : undefined,
      });

      log.info('dispatcher', 'Restored suspended session', {
        agentId: s.agentId,
        sessionId: s.sessionId.slice(0, 8),
        reason: s.reason,
        suspendedFor: Date.now() - s.suspendedAt,
      });
    }

    if (suspended.length > 0) {
      log.info('dispatcher', `Restored ${suspended.length} suspended session(s) from previous run`);
    }
  }

  /**
   * Start the dispatcher - subscribes to consumer events for worker messages
   */
  async start(consumer?: EventEmitter): Promise<void> {
    if (this.running) return;

    // Load all mesh configs
    this.loadMeshConfigs();

    // Restore suspended sessions from SQLite (crash recovery)
    this.restoreSuspendedSessions();

    this.running = true;
    this.emit('start');

    // Subscribe to consumer events for event-driven dispatch
    if (consumer) {
      this.boundMessageHandler = (event: { agentId: string }) => {
        this.handleWorkerMessage(event.agentId);
      };
      consumer.on('worker-message', this.boundMessageHandler);

      // Subscribe to revision events for interrupt+resume handling
      this.boundRevisionHandler = (event: RevisionMessageEvent) => {
        this.handleRevisionMessage(event);
      };
      consumer.on('revision-message', this.boundRevisionHandler);

      // Subscribe to ask message events for await state handling
      this.boundAskMessageHandler = (event: AskMessageEvent) => {
        this.handleAskMessage(event);
      };
      consumer.on('ask-message', this.boundAskMessageHandler);

      // Subscribe to ask-response events for resuming awaiting workers
      this.boundAskResponseHandler = (event: AskResponseMessageEvent) => {
        this.handleAskResponseMessage(event);
      };
      consumer.on('ask-response-message', this.boundAskResponseHandler);

      // Subscribe to parity-reminder events for injecting feedback when task-complete blocked
      this.boundParityReminderHandler = (event: ParityReminderEvent) => {
        this.handleParityReminder(event);
      };
      consumer.on('parity-reminder', this.boundParityReminderHandler);
    }

    // Start stuck agent detector
    this.stuckDetector.start(() => this.getActiveWorkersForDetector());
  }

  /**
   * Validate message against FSM rules (if mesh has FSM)
   * Called for ALL message types before type-specific routing happens.
   *
   * This is the central FSM validation point. It should be called by the
   * consumer before emitting core-message or worker-message events.
   *
   * @param senderAgentId - Agent that sent the message (e.g., "ralph-loop/ralph-build")
   * @param targetAgentId - Target agent (e.g., "ralph-loop/ralph-build" or "core/core")
   * @param messageType - Message type (task-complete, ask, ask-human, etc.)
   * @param messageFrontmatter - Parsed frontmatter from message
   * @param rearmatter - Parsed rearmatter (optional, contains success_signal etc.)
   * @returns true if message passes validation, false if rejected
   */
  async validateMessageWithFSM(
    senderAgentId: string,
    targetAgentId: string,
    messageType: string,
    messageFrontmatter: Record<string, unknown>,
    rearmatter?: Record<string, unknown>
  ): Promise<boolean> {
    const [meshName] = senderAgentId.split('/');
    if (!meshName) {
      // No mesh = no FSM validation needed
      return true;
    }

    const fsm = this.meshFSMs.get(meshName);
    if (!fsm || !fsm.isInitialized()) {
      // No FSM = no validation needed
      return true;
    }

    try {
      // Validate message and potentially transition FSM
      const transitioned = await fsm.handleMessage(
        senderAgentId,
        targetAgentId,
        messageType,
        messageFrontmatter,
        rearmatter
      );

      if (!transitioned) {
        log.error('mesh-fsm', 'FSM validation rejected message', {
          meshName,
          from: senderAgentId,
          to: targetAgentId,
          type: messageType,
        });

        // Emit mesh halt event
        this.emit('mesh:halt', {
          meshName,
          reason: 'FSM validation failed',
          message: 'Agent routing violates state machine rules',
        });

        return false;
      }

      log.debug('mesh-fsm', 'FSM validation passed', {
        meshName,
        from: senderAgentId,
        to: targetAgentId,
        type: messageType,
        newState: fsm.getCurrentState(),
      });

      return true;
    } catch (error) {
      // Script failures are fatal - halt the mesh
      log.error('mesh-fsm', 'FSM validation failed fatally', {
        meshName,
        error: (error as Error).message,
      });

      this.emit('mesh:halt', {
        meshName,
        reason: 'FSM script failure',
        error: (error as Error).message,
      });

      return false;
    }
  }

  /**
   * Get active workers in format needed by stuck detector
   * Returns all worker instances (flattened from array-based tracking)
   */
  private getActiveWorkersForDetector(): Map<string, ActiveWorkerInfo> {
    const result = new Map<string, ActiveWorkerInfo>();
    for (const [_agentId, workers] of this.activeWorkers) {
      for (const worker of workers) {
        result.set(worker.workerId, {
          runner: worker.runner,
          machine: worker.machine,
          startedAt: worker.startedAt,
          hookContext: worker.hookContext,
          lastOutputAt: worker.lastOutputAt,
        });
      }
    }
    return result;
  }

  /**
   * Handle incoming worker message - spawn worker for each message
   * Allows concurrent workers for the same agentId (runtime parallelism)
   */
  private handleWorkerMessage(agentId: string): void {
    if (!this.running) return;

    // NOTE: Per-agent lock REMOVED for runtime parallelism
    // Multiple workers can now run concurrently for the same agentId
    const currentWorkers = this.activeWorkers.get(agentId) || [];
    log.debug('dispatcher', `Worker message received`, {
      agentId,
      currentWorkerCount: currentWorkers.length
    });

    // Parse mesh/agent from agentId
    const [meshName, agentName] = agentId.split('/');
    if (!meshName || !agentName) {
      log.error('dispatcher', `Invalid agentId format`, { agentId });
      return;
    }

    // MESH HALT: Check if mesh has pending ask-human
    // When ask-human is pending, the entire mesh is halted - no new workers spawn.
    // Messages remain queued and will be processed after human responds.
    if (this.hasPendingAskHumanForMesh(meshName)) {
      const suspendedInfo = this.getSuspendedSessionForMesh(meshName);
      log.info('dispatcher', `Mesh halted due to pending ask-human, message queued`, {
        agentId,
        meshName,
        suspendedAgent: suspendedInfo?.agentId,
        suspendedAt: suspendedInfo?.suspended.suspendedAt,
        reason: 'Waiting for human response before processing new messages',
      });
      this.emit('mesh:halted-message', {
        agentId,
        meshName,
        reason: 'pending-ask-human',
        suspendedAgent: suspendedInfo?.agentId,
      });
      return;
    }

    let meshConfig = this.meshConfigs.get(meshName);
    if (!meshConfig) {
      // Try JIT loading before failing
      log.info('dispatcher', 'Mesh not loaded, attempting JIT load', { meshName, agentId });
      const loaded = this.tryLoadMeshOnDemand(meshName);
      if (!loaded) {
        log.error('dispatcher', 'Mesh not found (JIT load failed)', { meshName, agentId });
        return;
      }
      meshConfig = this.meshConfigs.get(meshName);
      if (!meshConfig) {
        log.error('dispatcher', 'Mesh loaded but config missing', { meshName, agentId });
        return;
      }
    }

    // Check for FSM ensemble state (both legacy type: ensemble and new ensemble.type: parallel)
    const fsm = this.meshFSMs.get(meshName);
    if (fsm && fsm.isInitialized()) {
      const currentState = fsm.getCurrentStateConfig();
      // Detect ensemble state using both patterns:
      // - Legacy: currentState.type === 'ensemble'
      // - New: currentState.ensemble?.type === 'parallel'
      const isLegacyEnsemble = currentState?.type === 'ensemble';
      const isNewEnsemble = currentState?.ensemble?.type === 'parallel';
      if (isLegacyEnsemble || isNewEnsemble) {
        log.info('dispatcher', `Detected ensemble state, delegating to handleEnsembleState`, {
          meshName,
          state: currentState?.name,
          agentId,
          ensembleType: isLegacyEnsemble ? 'legacy' : 'new',
        });
        this.handleEnsembleState(meshName, currentState!, fsm).catch((error) => {
          log.error('dispatcher', `Ensemble state handling failed`, {
            meshName,
            state: currentState?.name,
            error: (error as Error).message,
          });
          this.emit('mesh:halt', {
            meshName,
            reason: 'Ensemble execution failure',
            error: (error as Error).message,
          });
        });
        return;
      }
    }

    const agent = meshConfig.agents.find(a => a.name === agentName);
    if (!agent) {
      log.error('dispatcher', `Agent not found in mesh`, { meshName, agentName, agentId });
      return;
    }

    log.info('dispatcher', `Spawning worker for message`, { agentId });
    this.spawnWorker(meshName, agent);
  }

  /**
   * Handle message revision - interrupt active worker and resume with revised content
   * This enables mid-flight corrections when message files are edited.
   * Note: With parallelism, revisions affect the first worker for the agent
   */
  private async handleRevisionMessage(event: RevisionMessageEvent): Promise<void> {
    const { agentId, content, headline } = event;

    // Get first worker for this agent (revision applies to oldest running worker)
    const activeWorker = this.getFirstWorkerForAgent(agentId);
    if (!activeWorker) {
      log.warn('dispatcher', `Revision received but no active worker found`, {
        agentId,
        headline,
      });
      return;
    }

    const sessionId = activeWorker.runner.getSessionId();
    if (!sessionId) {
      log.warn('dispatcher', `Revision received but worker has no session ID`, {
        agentId,
        headline,
      });
      return;
    }

    log.info('dispatcher', `Handling message revision`, {
      agentId,
      sessionId: sessionId.slice(0, 8),
      headline,
      contentLength: content.length,
    });

    try {
      // Interrupt the current query
      await activeWorker.runner.interrupt();

      this.emit('revision:interrupt', {
        agentId,
        sessionId,
        headline,
      });

      // Resume with the revised content
      // Build a feedback prompt that includes the revision
      const revisionPrompt = this.buildRevisionPrompt(content, headline);

      log.info('dispatcher', `Resuming session with revised content`, {
        agentId,
        sessionId: sessionId.slice(0, 8),
      });

      // Resume the session with the revised content
      // This will trigger the 'complete' event handler when finished
      const result = await activeWorker.runner.resume(sessionId, revisionPrompt);

      if (result.success) {
        log.info('dispatcher', `Revision resume completed successfully`, {
          agentId,
          sessionId: sessionId.slice(0, 8),
        });
        this.emit('revision:complete', {
          agentId,
          sessionId,
          success: true,
        });
      } else {
        log.error('dispatcher', `Revision resume failed`, {
          agentId,
          sessionId: sessionId.slice(0, 8),
          error: result.error,
        });
        this.emit('revision:error', {
          agentId,
          sessionId,
          error: result.error,
        });
      }
    } catch (error) {
      const errorMsg = (error as Error).message;
      log.error('dispatcher', `Failed to handle message revision`, {
        agentId,
        error: errorMsg,
      });
      this.emit('revision:error', {
        agentId,
        error: errorMsg,
      });
    }
  }

  /**
   * Build a prompt for the revised message content
   */
  private buildRevisionPrompt(content: string, headline?: string): string {
    const parts: string[] = [];

    parts.push('## Message Revision\n');
    parts.push('The task message has been revised. Please discard your previous work and process this updated message:\n');

    if (headline) {
      parts.push(`**Updated Headline**: ${headline}\n`);
    }

    parts.push('---\n');
    parts.push(content);
    parts.push('\n---');
    parts.push('\n**Action**: Process the revised message above. Your previous response is no longer needed.');

    return parts.join('\n');
  }

  /**
   * Handle ask message - transition worker to awaiting state
   * When a worker writes an ask message to another agent, we:
   * 1. Find the worker that sent the ask (by from field)
   * 2. Transition it to awaiting state
   * 3. For ask-human: interrupt the worker and inject steering prompt
   * 4. Set up timeout for await
   *
   * NOTE: FSM validation now happens centrally in validateMessageWithFSM()
   * before this handler is called. This handler only manages worker state.
   * Note: With parallelism, asks affect the first worker for the agent
   */
  private async handleAskMessage(event: AskMessageEvent): Promise<void> {
    const { from: senderAgentId, to: targetAgentId, type: messageType } = event;

    // Get first worker for this agent
    const activeWorker = this.getFirstWorkerForAgent(senderAgentId);
    if (!activeWorker) {
      log.debug('dispatcher', `Ask message but no active worker found`, {
        from: senderAgentId,
        to: targetAgentId,
      });
      return;
    }

    const { machine, runner, workerId } = activeWorker;
    const currentStatus = machine.getStatus();

    // Get session ID for resume
    const sessionId = runner.getSessionId();
    if (!sessionId) {
      log.warn('dispatcher', `Ask message but worker has no session ID`, {
        from: senderAgentId,
        to: targetAgentId,
      });
      return;
    }

    try {
      // ask-human is fire-and-forget - don't add to awaitingResponses
      // Human response comes back as new task input, not ask-response
      // Worker can complete without waiting for human response
      if (messageType === 'ask-human') {
        log.info('dispatcher', `ask-human sent (fire-and-forget, no await)`, {
          from: senderAgentId,
          to: targetAgentId,
        });
        this.emit('worker:ask-human', {
          workerId: senderAgentId,
          target: targetAgentId,
        });
      } else if (currentStatus === 'awaiting') {
        // Already awaiting, add this target to the set
        log.info('dispatcher', `Adding await target`, {
          from: senderAgentId,
          to: targetAgentId,
          existingTargets: Array.from(machine.getAwaitingResponses()),
        });
        await machine.addAwaitTarget(targetAgentId);
      } else if (currentStatus === 'running' || currentStatus === 'idle') {
        // Enter awaiting state
        log.debug('dispatcher', `Worker entering await state`, {
          from: senderAgentId,
          to: targetAgentId,
          type: messageType,
          sessionId: sessionId.slice(0, 8),
        });
        await machine.enterAwait(targetAgentId, sessionId);

        // Set up timeout
        const timeout = machine.currentContext.awaitTimeout;
        const timeoutId = setTimeout(() => {
          this.handleAwaitTimeout(senderAgentId);
        }, timeout);
        machine.currentContext.awaitTimeoutId = timeoutId;

        this.emit('worker:await', {
          workerId: senderAgentId,
          targets: [targetAgentId],
          sessionId,
          type: messageType,
        });

        // For ask-human messages: KILL the worker immediately
        // Worker will be resumed when human responds (FSM handles this)
        if (messageType === 'ask-human') {
          log.info('dispatcher', `Killing worker for ask-human (will resume on response)`, {
            from: senderAgentId,
            sessionId: sessionId.slice(0, 8),
          });

          try {
            // Extract mesh and agent info for later resume
            const [meshName, agentName] = senderAgentId.split('/');
            const meshConfig = this.meshConfigs.get(meshName);
            const agentConfig = meshConfig?.agents.find(a => a.name === agentName);

            if (!agentConfig) {
              log.error('dispatcher', `Cannot suspend: agent config not found`, {
                from: senderAgentId,
                meshName,
                agentName,
              });
              return;
            }

            // Get the count of pending ask-humans for this agent from the queue
            // This tells us how many responses we need to wait for before resuming
            const pendingAsks = this.queue.getPendingAsks(senderAgentId);
            const pendingAskHumans = pendingAsks.filter(a => a.to_agent === 'core/core');
            const pendingCount = pendingAskHumans.length;

            const suspendedAt = Date.now();

            // Store session for later resume with pending count (in-memory)
            this.suspendedSessions.set(senderAgentId, {
              sessionId,
              reason: 'ask-human',
              suspendedAt,
              targetAgents: new Set([targetAgentId]),
              pendingResponseCount: pendingCount,
              meshName,
              agentConfig,
            });

            // Persist to SQLite for crash recovery
            this.queue.suspendSession(senderAgentId, {
              sessionId,
              reason: 'ask-human',
              suspendedAt,
              meshName,
              targetAgents: [targetAgentId],
              pendingCount,
            });

            // Kill the worker - no steering, no resume, just stop
            runner.kill('ask-human: suspending for human response');

            this.emit('worker:suspended', {
              agentId: senderAgentId,
              workerId,
              sessionId,
              reason: 'ask-human',
              pendingResponseCount: pendingCount,
              targetAgents: [targetAgentId],
            });

            // Remove from active workers using workerId
            this.removeActiveWorker(senderAgentId, workerId);

            log.info('dispatcher', `Worker killed and suspended`, {
              from: senderAgentId,
              workerId,
              sessionId: sessionId.slice(0, 8),
              pendingResponseCount: pendingCount,
            });
          } catch (killError) {
            log.error('dispatcher', `Failed to kill worker for ask-human`, {
              from: senderAgentId,
              workerId,
              error: (killError as Error).message,
            });
          }
        }
      } else {
        log.warn('dispatcher', `Cannot await from current state`, {
          from: senderAgentId,
          to: targetAgentId,
          currentStatus,
        });
      }

      // Track incoming ask on target agent (if not ask-human and target exists)
      if (messageType !== 'ask-human') {
        const targetWorker = this.getFirstWorkerForAgent(targetAgentId);
        if (targetWorker) {
          const msgId = event.msgId || `${senderAgentId}->${targetAgentId}-${Date.now()}`;
          targetWorker.machine.addIncomingAsk(senderAgentId, msgId);
          log.debug('dispatcher', `Tracked incoming ask on target`, {
            from: senderAgentId,
            to: targetAgentId,
            msgId,
          });
        }
      }

      this.writeWorkerState();
    } catch (error) {
      log.error('dispatcher', `Failed to enter await state`, {
        from: senderAgentId,
        to: targetAgentId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Build a steering prompt for ask-human flow
   * This tells the worker to stop and wait for human response
   */
  private buildAskHumanSteeringPrompt(): string {
    return `## Session Paused - Awaiting Human Response

You sent an ask-human message to request human input.

**IMPORTANT**: Your session is now PAUSED.
- DO NOT write task-complete
- DO NOT proceed with work
- WAIT for the ask-response message

The system will resume your session when the human responds.`;
  }

  /**
   * Resume a suspended session with human response
   * Creates a new runner and resumes the stored session
   */
  private async resumeSuspendedSession(
    agentId: string,
    suspended: SuspendedSession,
    responseContent: string,
    headline?: string
  ): Promise<void> {
    const { sessionId, meshName, agentConfig } = suspended;

    log.info('dispatcher', `Resuming suspended session`, {
      agentId,
      sessionId: sessionId.slice(0, 8),
      meshName,
      suspendedFor: Date.now() - suspended.suspendedAt,
    });

    try {
      // Remove from suspended (in-memory and SQLite)
      this.suspendedSessions.delete(agentId);
      this.queue.resumeSession(agentId);

      // Build the resume prompt with human response
      const resumePrompt = headline
        ? `## Human Response: ${headline}\n\n${responseContent}`
        : `## Human Response\n\n${responseContent}`;

      // Create new runner config (minimal - session has system prompt)
      const runnerConfig: SdkRunnerConfig = {
        id: agentId,
        model: agentConfig.model,
        systemPrompt: '',  // Not needed for resume - session has it
        workDir: this.config.workDir,
        msgsDir: this.config.msgsDir,
        sessionId,  // Resume existing session
      };

      const runner = new SdkRunner(runnerConfig, this.queue);

      // Create a new FSM for the resumed worker
      const meshConfig = this.meshConfigs.get(meshName);
      const isCompletionAgent = agentConfig.name === meshConfig?.completion_agent;
      const workerConfig: WorkerConfig = {
        id: agentId,
        model: agentConfig.model,
        prompt: agentConfig.prompt,
        workDir: this.config.workDir,
      };
      const machine = new WorkerStateMachine(agentId, workerConfig, meshName, agentConfig.name, 300000, isCompletionAgent);

      // Create hook context
      const meshInstance = `${meshName}-${Date.now()}`;
      const hookContext: HookContext = {
        meshInstance,
        meshName,
        agentName: agentConfig.name,
        workDir: this.config.workDir,
        agentId,
        agentConfig,
        taskId: `${agentId}-resume-${Date.now()}`,
        taskBody: resumePrompt,
        msgsDir: this.config.msgsDir,
      };

      // Store in active workers and get the generated workerId
      const workerId = this.addActiveWorker(agentId, {
        runner,
        machine,
        startedAt: Date.now(),
        hookContext,
      });

      // Set up minimal event handlers
      runner.on('complete', async (data) => {
        log.info('dispatcher', `Resumed worker completed`, {
          agentId,
          workerId,
          sessionId: sessionId.slice(0, 8),
        });
        this.removeActiveWorker(agentId, workerId);
        await machine.complete(data);
        this.emit('worker:complete', {
          ...data,
          transitionName: 'complete',
        });
        this.writeWorkerState();

        // Check for pending continuation messages (self-addressed or from other agents)
        const pendingMsg = this.queue.peekOne(agentId);
        if (pendingMsg && this.running) {
          log.info('dispatcher', `Continuation message found after resumed worker completion, spawning next iteration`, {
            agentId,
            from: pendingMsg.from_agent,
            type: pendingMsg.type,
            isSelfLoop: pendingMsg.from_agent === agentId,
          });

          setTimeout(() => {
            if (this.running && !this.hasActiveWorkers(agentId)) {
              this.spawnWorker(meshName, agentConfig);
            }
          }, 100);
        }

        // MESH UN-HALT: Process any messages that were queued while mesh was halted
        // This runs after the resumed worker completes, checking all agents in the mesh
        this.emit('mesh:unhalted', { meshName, reason: 'ask-human-resolved' });
        this.processQueuedMeshMessages(meshName);
      });

      runner.on('error', (error) => {
        log.error('dispatcher', `Resumed worker error`, {
          agentId,
          workerId,
          error: error.message,
        });
        this.removeActiveWorker(agentId, workerId);
        this.emit('worker:error', { id: agentId, error: error.message });
        this.writeWorkerState();

        // Even on error, the mesh is now un-halted - process queued messages
        this.emit('mesh:unhalted', { meshName, reason: 'ask-human-resolved-with-error' });
        this.processQueuedMeshMessages(meshName);
      });

      // Start the FSM (use process.pid as the runner pid)
      await machine.start(process.pid);

      this.emit('worker:resumed', {
        agentId,
        sessionId,
        suspendedFor: Date.now() - suspended.suspendedAt,
      });

      // Resume the session with human response
      const result = await runner.resume(sessionId, resumePrompt);

      if (!result.success) {
        log.error('dispatcher', `Resume failed`, {
          agentId,
          error: result.error,
        });
      }

      this.writeWorkerState();
    } catch (error) {
      log.error('dispatcher', `Failed to resume suspended session`, {
        agentId,
        error: (error as Error).message,
      });
      // Clean up on failure - remove all workers for this agent
      this.suspendedSessions.delete(agentId);
      // For cleanup, we delete the entire array for this agent
      this.activeWorkers.delete(agentId);
    }
  }

  /**
   * Handle ask-response message - resume awaiting worker
   * When an agent responds to an ask:
   * 1. Find the worker that's awaiting this response (by to field)
   * 2. Remove the responder from awaitingResponses
   * 3. If all responses received, resume the session
   */
  private async handleAskResponseMessage(event: AskResponseMessageEvent): Promise<void> {
    const { from: respondingAgentId, to: awaitingAgentId, content } = event;

    // Check for suspended session
    const suspended = this.suspendedSessions.get(awaitingAgentId);
    if (suspended) {
      // Handle ask-human responses (from core/core)
      if (suspended.reason === 'ask-human' && respondingAgentId === 'core/core') {
        // Buffer this response
        if (!this.askResponseBuffer.has(awaitingAgentId)) {
          this.askResponseBuffer.set(awaitingAgentId, []);
        }
        this.askResponseBuffer.get(awaitingAgentId)!.push({
          from: respondingAgentId,
          content,
          headline: event.headline,
        });

        // Check SQLite for current pending ask count (source of truth)
        // The consumer's resolvePendingAsk was already called, so the count reflects the response
        const remainingPendingAsks = this.queue.getPendingAsks(awaitingAgentId)
          .filter(a => a.to_agent === 'core/core');
        const remainingCount = remainingPendingAsks.length;

        log.info('dispatcher', `Human response received for suspended session`, {
          from: respondingAgentId,
          to: awaitingAgentId,
          sessionId: suspended.sessionId.slice(0, 8),
          suspendedFor: Date.now() - suspended.suspendedAt,
          remainingPendingAsks: remainingCount,
          bufferedResponses: this.askResponseBuffer.get(awaitingAgentId)?.length || 0,
        });

        // Only resume when ALL pending ask-humans to core/core have been resolved
        if (remainingCount === 0) {
          // Get all buffered responses
          const bufferedResponses = this.askResponseBuffer.get(awaitingAgentId) || [];

          log.info('dispatcher', `All ask-human responses received, resuming suspended session`, {
            from: respondingAgentId,
            to: awaitingAgentId,
            sessionId: suspended.sessionId.slice(0, 8),
            responseCount: bufferedResponses.length,
          });

          // Build combined content from all responses
          const combinedContent = this.buildBatchedAskResponseContent(bufferedResponses);

          // Clear buffer before resume
          this.askResponseBuffer.delete(awaitingAgentId);

          // Resume the suspended session with all human responses
          await this.resumeSuspendedSession(awaitingAgentId, suspended, combinedContent,
            bufferedResponses.length > 1 ? `${bufferedResponses.length} Human Responses` : event.headline);
        } else {
          log.info('dispatcher', `Buffered response, waiting for ${remainingCount} more`, {
            from: respondingAgentId,
            to: awaitingAgentId,
            remainingPendingAsks: remainingCount,
          });
        }
        return;
      }

      // Handle agent-to-agent ask-responses for sessions suspended due to exiting while awaiting
      if (suspended.reason === 'await-response' && suspended.targetAgents.has(respondingAgentId)) {
        // Buffer this response
        if (!this.askResponseBuffer.has(awaitingAgentId)) {
          this.askResponseBuffer.set(awaitingAgentId, []);
        }
        this.askResponseBuffer.get(awaitingAgentId)!.push({
          from: respondingAgentId,
          content,
          headline: event.headline,
        });

        // Remove responder from target agents
        suspended.targetAgents.delete(respondingAgentId);
        suspended.pendingResponseCount = suspended.targetAgents.size;

        log.info('dispatcher', `Agent response received for suspended session`, {
          from: respondingAgentId,
          to: awaitingAgentId,
          sessionId: suspended.sessionId.slice(0, 8),
          suspendedFor: Date.now() - suspended.suspendedAt,
          remainingTargetAgents: Array.from(suspended.targetAgents),
          bufferedResponses: this.askResponseBuffer.get(awaitingAgentId)?.length || 0,
        });

        // Resume when all awaited agents have responded
        if (suspended.targetAgents.size === 0) {
          const bufferedResponses = this.askResponseBuffer.get(awaitingAgentId) || [];

          log.info('dispatcher', `All agent responses received, resuming suspended session`, {
            from: respondingAgentId,
            to: awaitingAgentId,
            sessionId: suspended.sessionId.slice(0, 8),
            responseCount: bufferedResponses.length,
          });

          // Build combined content from all responses
          const combinedContent = this.buildAskResponsePrompt(bufferedResponses);

          // Clear buffer before resume
          this.askResponseBuffer.delete(awaitingAgentId);

          // Resume the suspended session
          await this.resumeSuspendedSession(awaitingAgentId, suspended, combinedContent,
            bufferedResponses.length > 1 ? `${bufferedResponses.length} Responses Received` : event.headline);
        } else {
          log.info('dispatcher', `Buffered response, waiting for ${suspended.targetAgents.size} more agents`, {
            from: respondingAgentId,
            to: awaitingAgentId,
            remainingTargetAgents: Array.from(suspended.targetAgents),
          });
        }
        return;
      }
    }

    // Get first worker for awaiting agent
    const activeWorker = this.getFirstWorkerForAgent(awaitingAgentId);
    if (!activeWorker) {
      log.debug('dispatcher', `Ask-response but no active worker found`, {
        from: respondingAgentId,
        to: awaitingAgentId,
      });
      return;
    }

    const { machine, runner } = activeWorker;
    const currentStatus = machine.getStatus();

    if (currentStatus !== 'awaiting') {
      log.warn('dispatcher', `Ask-response but worker not in awaiting state`, {
        from: respondingAgentId,
        to: awaitingAgentId,
        currentStatus,
      });
      return;
    }

    // Check if we're actually waiting for this agent
    const awaitingResponses = machine.getAwaitingResponses();
    if (!awaitingResponses.has(respondingAgentId)) {
      log.warn('dispatcher', `Ask-response from unexpected agent`, {
        from: respondingAgentId,
        to: awaitingAgentId,
        awaiting: Array.from(awaitingResponses),
      });
      return;
    }

    try {
      log.info('dispatcher', `Received ask-response`, {
        from: respondingAgentId,
        to: awaitingAgentId,
        remainingBefore: awaitingResponses.size,
      });

      // Buffer this response for aggregation
      if (!this.askResponseBuffer.has(awaitingAgentId)) {
        this.askResponseBuffer.set(awaitingAgentId, []);
      }
      this.askResponseBuffer.get(awaitingAgentId)!.push({
        from: respondingAgentId,
        content,
        headline: event.headline,
      });

      // Remove incoming ask from responding agent
      const respondingWorker = this.getFirstWorkerForAgent(respondingAgentId);
      if (respondingWorker) {
        const msgId = event.msgId || `${awaitingAgentId}->${respondingAgentId}`;
        respondingWorker.machine.removeIncomingAsk(awaitingAgentId, msgId);
        log.debug('dispatcher', `Removed incoming ask from responder`, {
          from: respondingAgentId,
          to: awaitingAgentId,
          msgId,
        });
      }

      // Remove responder from awaiting set
      const allReceived = await machine.receiveResponse(respondingAgentId);

      this.emit('worker:resume', {
        workerId: awaitingAgentId,
        from: respondingAgentId,
        allReceived,
      });

      // If all responses received, resume the session
      if (allReceived) {
        const sessionId = machine.getAwaitSessionId();
        if (!sessionId) {
          log.error('dispatcher', `All responses received but no session ID`, {
            awaitingAgentId,
          });
          return;
        }

        // Check if runner is still actively processing
        // If so, the response is already queued and runner will see it naturally
        if (runner.isRunning()) {
          log.info('dispatcher', `Runner still active, response queued for current run`, {
            awaitingAgentId,
            sessionId: sessionId.slice(0, 8),
          });
          return;
        }

        // Get ALL buffered responses for this agent
        const bufferedResponses = this.askResponseBuffer.get(awaitingAgentId) || [];

        log.info('dispatcher', `All responses received, resuming session`, {
          awaitingAgentId,
          sessionId: sessionId.slice(0, 8),
          responseCount: bufferedResponses.length,
        });

        // Build resume prompt with ALL buffered responses
        const resumePrompt = this.buildAskResponsePrompt(bufferedResponses);

        // Clear buffer before resume
        this.askResponseBuffer.delete(awaitingAgentId);

        // Resume the session
        const result = await runner.resume(sessionId, resumePrompt);

        if (result.success) {
          log.info('dispatcher', `Session resumed successfully`, {
            awaitingAgentId,
            sessionId: sessionId.slice(0, 8),
          });
        } else {
          log.error('dispatcher', `Session resume failed`, {
            awaitingAgentId,
            error: result.error,
          });
        }
      }

      this.writeWorkerState();
    } catch (error) {
      log.error('dispatcher', `Failed to handle ask-response`, {
        from: respondingAgentId,
        to: awaitingAgentId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Build a prompt for resuming with ask-response content
   * Accepts an array of responses to aggregate multiple responses received while awaiting
   */
  private buildAskResponsePrompt(responses: Array<{ from: string; content: string; headline?: string }>): string {
    const parts: string[] = [];

    if (responses.length === 1) {
      // Single response - use simpler format
      const response = responses[0];
      parts.push('## Ask Response Received\n');
      parts.push(`Response received from **${response.from}**:\n`);

      if (response.headline) {
        parts.push(`**Subject**: ${response.headline}\n`);
      }

      parts.push('---\n');
      parts.push(response.content);
      parts.push('\n---');
      parts.push('\n**Action**: Process this response and continue with your task.');
    } else {
      // Multiple responses - aggregate them
      parts.push(`## Ask Responses Received (${responses.length} total)\n`);
      parts.push('All requested responses have arrived:\n');

      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        parts.push(`\n### Response ${i + 1} from **${response.from}**\n`);

        if (response.headline) {
          parts.push(`**Subject**: ${response.headline}\n`);
        }

        parts.push('---\n');
        parts.push(response.content);
        parts.push('\n---\n');
      }

      parts.push('\n**Action**: Process all responses above and continue with your task.');
    }

    return parts.join('\n');
  }

  /**
   * Build batched content from multiple ask-human responses
   * Used when resuming a suspended session that was waiting for multiple human responses
   */
  private buildBatchedAskResponseContent(responses: Array<{ from: string; content: string; headline?: string }>): string {
    if (responses.length === 1) {
      // Single response - just return the content
      return responses[0].content;
    }

    // Multiple responses - build a combined document
    const parts: string[] = [];
    parts.push(`# Human Responses (${responses.length} total)\n`);
    parts.push('All requested human responses have arrived:\n');

    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      parts.push(`\n## Response ${i + 1}${response.headline ? `: ${response.headline}` : ''}\n`);
      parts.push(response.content);
      parts.push('\n');
    }

    parts.push('\n---\n');
    parts.push('**All responses received.** You may now continue with your task.');

    return parts.join('\n');
  }

  /**
   * Handle parity reminder - inject feedback into worker when task-complete is blocked
   * due to pending asks
   */
  private async handleParityReminder(event: ParityReminderEvent): Promise<void> {
    const { agentId, pendingAsks, deletedFile } = event;

    // Get first worker for this agent
    const activeWorker = this.getFirstWorkerForAgent(agentId);
    if (!activeWorker) {
      log.warn('dispatcher', `Pending asks/tasks reminder: no active worker found`, {
        agentId,
        pendingAsks,
        deletedFile,
      });
      return;
    }

    const { runner } = activeWorker;
    const sessionId = runner.getSessionId();

    if (!sessionId) {
      log.warn('dispatcher', `Pending asks/tasks reminder: worker has no session ID`, {
        agentId,
        pendingAsks,
      });
      return;
    }

    log.info('dispatcher', `Handling pending asks/tasks reminder`, {
      agentId,
      sessionId: sessionId.slice(0, 8),
      pendingAsks,
    });

    try {
      // Interrupt the current query
      await runner.interrupt();

      this.emit('parity:interrupt', {
        agentId,
        sessionId,
        pendingAsks,
      });

      // Build reminder prompt
      const reminderPrompt = this.buildParityReminderPrompt(pendingAsks);

      log.info('dispatcher', `Resuming session with pending asks/tasks reminder`, {
        agentId,
        sessionId: sessionId.slice(0, 8),
      });

      // Resume the session with the reminder
      const result = await runner.resume(sessionId, reminderPrompt);

      if (result.success) {
        log.info('dispatcher', `Pending asks/tasks reminder: resume completed`, {
          agentId,
          sessionId: sessionId.slice(0, 8),
        });
        this.emit('parity:resume', {
          agentId,
          sessionId,
          success: true,
        });
      } else {
        log.error('dispatcher', `Pending asks/tasks reminder: resume failed`, {
          agentId,
          sessionId: sessionId.slice(0, 8),
          error: result.error,
        });
        this.emit('parity:error', {
          agentId,
          sessionId,
          error: result.error,
        });
      }
    } catch (error) {
      const errorMsg = (error as Error).message;
      log.error('dispatcher', `Pending asks/tasks reminder: handling failed`, {
        agentId,
        error: errorMsg,
      });
      this.emit('parity:error', {
        agentId,
        error: errorMsg,
      });
    }
  }

  /**
   * Build a reminder prompt for the parity gate violation
   */
  private buildParityReminderPrompt(pendingAsks: Array<{ msgId: string; to: string }>): string {
    const parts: string[] = [];

    parts.push('## Parity Gate: Pending Asks\n');
    parts.push('Your task-complete was rejected. You have unresolved asks:\n');

    for (const ask of pendingAsks) {
      parts.push(`- msg-id: ${ask.msgId} → ${ask.to}`);
    }

    parts.push('\n**Action**: Wait for responses before completing your task.');
    parts.push('Once all responses arrive, you may write a new task-complete message.');

    return parts.join('\n');
  }

  /**
   * Handle await timeout - transition worker to error state
   */
  private async handleAwaitTimeout(agentId: string): Promise<void> {
    // Get first worker for this agent (the one in awaiting state)
    const activeWorker = this.getFirstWorkerForAgent(agentId);
    if (!activeWorker) {
      return;
    }

    const { machine, workerId } = activeWorker;
    if (machine.getStatus() !== 'awaiting') {
      return;  // Already transitioned out of awaiting
    }

    log.warn('dispatcher', `Await timeout expired`, {
      agentId,
      workerId,
      awaitingResponses: Array.from(machine.getAwaitingResponses()),
      awaitDuration: machine.getAwaitDuration(),
    });

    try {
      await machine.awaitTimeoutError();

      this.emit('worker:await-timeout', {
        workerId: agentId,
        awaitingResponses: Array.from(machine.getAwaitingResponses()),
      });

      // Cleanup using workerId
      this.removeActiveWorker(agentId, workerId);
      this.askResponseBuffer.delete(agentId);
      this.writeWorkerState();
    } catch (error) {
      log.error('dispatcher', `Failed to handle await timeout`, {
        agentId,
        workerId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Stop the dispatcher
   */
  async stop(consumer?: EventEmitter): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Unsubscribe from consumer events
    if (consumer && this.boundMessageHandler) {
      consumer.off('worker-message', this.boundMessageHandler);
      this.boundMessageHandler = null;
    }
    if (consumer && this.boundRevisionHandler) {
      consumer.off('revision-message', this.boundRevisionHandler);
      this.boundRevisionHandler = null;
    }
    if (consumer && this.boundAskMessageHandler) {
      consumer.off('ask-message', this.boundAskMessageHandler);
      this.boundAskMessageHandler = null;
    }
    if (consumer && this.boundAskResponseHandler) {
      consumer.off('ask-response-message', this.boundAskResponseHandler);
      this.boundAskResponseHandler = null;
    }
    if (consumer && this.boundParityReminderHandler) {
      consumer.off('parity-reminder', this.boundParityReminderHandler);
      this.boundParityReminderHandler = null;
    }

    // Stop stuck agent detector
    this.stuckDetector.stop();

    // Kill all active workers (iterate through all instances)
    for (const [agentId, workers] of this.activeWorkers) {
      for (const worker of workers) {
        worker.runner.kill(`shutdown: dispatcher stopping, agentId=${agentId}`);
      }
    }
    this.activeWorkers.clear();
    this.askResponseBuffer.clear();
    this.writeWorkerState();

    this.emit('stop');
  }

  /**
   * Spawn a worker for an agent using SDK with FSM
   */
  private async spawnWorker(meshName: string, agent: AgentConfig): Promise<void> {
    const agentId = `${meshName}/${agent.name}`;

    try {
      // Peek at the next message to get task ID for workspace
      const nextMsg = this.queue.peekOne(agentId);
      const taskId = nextMsg?.id != null ? String(nextMsg.id) : `${agentId}-${Date.now()}`;

      // Get mesh config (poll() already reloaded it from disk)
      const meshConfig = this.meshConfigs.get(meshName);

      // Create hook context with task info for quality hooks
      const meshInstance = `${meshName}-${Date.now()}`;
      const taskBody = nextMsg?.payload?.body as string || '';
      const featureName = nextMsg?.payload?.feature as string | undefined;
      const hookContext: HookContext = {
        meshInstance,
        meshName,
        agentName: agent.name,
        workDir: this.config.workDir,
        agentId,
        taskId,
        taskBody,
        featureName,  // Required for worktree-enabled meshes
        msgsDir: this.config.msgsDir,
      };

      // Initialize session metrics if first worker in this mesh instance
      if (meshInstance && !this.sessionMetrics.has(meshInstance)) {
        this.sessionMetrics.set(meshInstance, {
          meshInstance,
          meshName: meshConfig?.mesh || meshName,
          workers: [],
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostUsd: 0,
          totalDurationMs: 0,
          workerCount: 0,
          startedAt: Date.now(),
        });
      }

      // Resolve lifecycle hooks (worktree: true or explicit lifecycle)
      log.info('dispatcher', 'Resolving lifecycle hooks', {
        agentId,
        hasMeshConfig: !!meshConfig,
        meshName: meshConfig?.mesh,
        hasWorktree: meshConfig?.worktree !== undefined,
        hasLifecycle: meshConfig?.lifecycle !== undefined,
      });

      const lifecycle = meshConfig ? resolveLifecycle(meshConfig) : undefined;

      log.info('dispatcher', 'Lifecycle resolved', {
        agentId,
        hasLifecycle: !!lifecycle,
        pre: lifecycle?.pre || [],
        post: lifecycle?.post || [],
      });

      // Execute pre-hooks if configured
      if (lifecycle?.pre && lifecycle.pre.length > 0) {
        log.info('dispatcher', `Executing pre-hooks for ${agentId}`, {
          hooks: lifecycle.pre,
        });

        try {
          await this.lifecycleHooks.executePreHooks(lifecycle.pre, hookContext);
        } catch (error) {
          const errorMsg = (error as Error).message;
          log.error('dispatcher', `Pre-hook execution failed, aborting worker spawn`, {
            agentId,
            error: errorMsg,
          });

          // Cleanup partial state (e.g., worktree created by earlier hook)
          if (hookContext.worktreePath && hookContext.featureName) {
            try {
              log.info('dispatcher', `Cleaning up worktree after pre-hook failure`, {
                featureName: hookContext.featureName,
                path: hookContext.worktreePath,
              });
              this.lifecycleHooks.getWorktreeManager().removeWorktree(hookContext.featureName, true);
            } catch (cleanupError) {
              log.error('dispatcher', `Failed to cleanup worktree after pre-hook failure`, {
                featureName: hookContext.featureName,
                error: (cleanupError as Error).message,
              });
            }
          }

          this.emit('error', { agentId, error: `Pre-hook failed: ${errorMsg}` });
          return;
        }
      }

      // Load the prompt - resolution order:
      // 1. Relative to mesh's basePath (new structure: meshes/dev/prompt.md)
      // 2. Relative to workDir (legacy: meshes/agents/dev/prompt.md)
      // 3. Global TX_ROOT fallback
      let promptPath: string | null = null;

      // Try mesh basePath first (new flat structure)
      if (meshConfig?._basePath) {
        const meshRelativePath = path.join(meshConfig._basePath, agent.prompt);
        if (fs.existsSync(meshRelativePath)) {
          promptPath = meshRelativePath;
        }
      }

      // Fall back to workDir-relative (legacy structure)
      if (!promptPath) {
        const workDirPath = path.join(this.config.workDir, agent.prompt);
        if (fs.existsSync(workDirPath)) {
          promptPath = workDirPath;
        }
      }

      // Fall back to global TX_ROOT
      if (!promptPath && process.env.TX_ROOT) {
        const globalPath = path.join(process.env.TX_ROOT, agent.prompt);
        if (fs.existsSync(globalPath)) {
          promptPath = globalPath;
        }
      }

      if (!promptPath) {
        this.emit('error', { agentId, error: `Prompt not found: ${agent.prompt}` });
        return;
      }
      let systemPrompt = fs.readFileSync(promptPath, 'utf-8');

      // Inject preamble (tool guidance based on mesh agent count)
      const agentCount = meshConfig?.agents?.length ?? 1;
      systemPrompt = this.promptInjector.injectPreamble(systemPrompt, { agentCount });

      // Inject messaging protocol for all agents
      systemPrompt = this.promptInjector.injectMessagingProtocol(systemPrompt);

      // Inject FSM context if mesh has FSM config
      const fsm = this.meshFSMs.get(meshName);
      if (fsm && fsm.isInitialized()) {
        const currentStateConfig = fsm.getCurrentStateConfig();
        if (currentStateConfig) {
          const status = fsm.getStatus();
          const fsmContext: FSMInjectionContext = {
            meshName,
            currentState: status.currentState,
            stateConfig: currentStateConfig,
            // availableTransitions computed from exit config if needed
            context: status.context,
            contextDescriptions: fsm.getContextDescriptions(),
            gateRetries: status.gateRetries,
          };
          systemPrompt = this.promptInjector.injectFSMContext(systemPrompt, fsmContext);
          log.debug('mesh-fsm', 'Injected FSM context into prompt', {
            agentId,
            currentState: status.currentState,
          });

          // NOTE: subtask injection removed - ensemble agents now use explicit routing
          // instead of file-based SUBTASK markers. See: ensemble.type: parallel in config.
        }
      }
      // Check for workspace config (agent-level overrides mesh-level)
      const workspaceConfig = agent.workspace || meshConfig?.workspace;

      // Create workspace and inject context if configured
      if (workspaceConfig) {
        const workspace = this.workspaceManager.createWorkspace(taskId, workspaceConfig);
        systemPrompt = this.promptInjector.injectWorkspace(systemPrompt, {
          workspace,
          taskId,
        });
        log.info('dispatcher', `Created workspace for task`, { agentId, taskId, dir: workspace.dir });
      }

      // Create worker config - frontmatter model override takes priority
      const frontmatterModel = nextMsg?.payload?.model as string | undefined;
      let model = frontmatterModel || agent.model;
      if (frontmatterModel) {
        log.info('dispatcher', `Using explicit model from frontmatter for ${agentId}`, {
          from: agent.model,
          to: frontmatterModel
        });
      }
      if (this.config.ultraLowMode) {
        model = 'haiku' as SemanticModel;
        log.info('dispatcher', `[ULTRA-LOW MODE] Forced model for ${agentId}`, {from: agent.model, to: model});
      } else if (this.config.lowMode && typeof model === 'string' && (model as string).includes('opus')) {
        model = (model as string).replace('opus', 'sonnet') as SemanticModel;
        log.info('dispatcher', `[LOW MODE] Demoted model for ${agentId}`, {from: agent.model, to: model});
      }

      const workerConfig: WorkerConfig = {
        id: agentId,
        model: model as SemanticModel,
        prompt: systemPrompt
      };

      // Check if this is the completion agent (parity gates only apply to completion agent)
      const isCompletionAgent = agent.name === meshConfig?.completion_agent;

      // Create state machine
      const machine = new WorkerStateMachine(agentId, workerConfig, meshName, agent.name, 300000, isCompletionAgent);

      // Register logging middleware
      machine.use(createLoggingMiddleware('worker'));

      // Wire FSM events to dispatcher
      machine.on('transition', (event) => {
        this.emit('worker:transition', {
          ...event,
          entityType: 'worker'
        });
      });

      // Initialize worker state
      await machine.initialize();

      log.info('dispatcher', `Initializing worker`, { agentId });

      // Use worktree path if set by pre-hooks, otherwise use default workDir
      const workDir = hookContext.worktreePath || this.config.workDir;

      // If running in worktree, inject context and sanitize paths
      if (hookContext.worktreePath && hookContext.featureName) {
        // Inject worktree context into prompt
        const worktreeContext = `
## Worktree Context

You are working in an isolated git worktree for feature: **${hookContext.featureName}**

- **Feature**: ${hookContext.featureName}
- **Branch**: ${hookContext.worktreeBranch || 'unknown'}
- **Path**: ${hookContext.worktreePath}

**IMPORTANT**:
- Use relative paths within this worktree
- Your CWD is already set to the worktree path
- Changes will be committed and merged when the feature is complete (/know:done)

`;
        systemPrompt = worktreeContext + systemPrompt;

        // Strip references to main workDir from prompt to avoid confusion
        systemPrompt = systemPrompt.replaceAll(this.config.workDir, '.');

        log.info('dispatcher', `Injected worktree context`, {
          agentId,
          featureName: hookContext.featureName,
          worktreePath: hookContext.worktreePath,
        });
      }

      // Extract routing config for this agent
      const routing = this.extractAgentRouting(meshName, agent.name, meshConfig);

      // Inject routing instructions into system prompt
      if (routing && Object.keys(routing).length > 0) {
        systemPrompt = this.injectRoutingInstructions(systemPrompt, routing, meshName);
        log.info('dispatcher', `Injected routing instructions into system prompt`, {
          agentId,
          routes: Object.keys(routing),
        });
      }

      // Inject rearmatter config if present
      if (meshConfig?.rearmatter) {
        systemPrompt = this.promptInjector.injectRearmatter(systemPrompt, meshConfig.rearmatter);
        log.info('dispatcher', `Injected rearmatter instructions into system prompt`, {
          agentId,
          fields: meshConfig.rearmatter.fields || [],
        });
      }

      // Save constructed prompt to .ai/tx/prompts/{mesh}/{agent}.md
      const fsmState = fsm?.isInitialized() ? fsm.getStatus().currentState : undefined;
      const promptMetadata: Record<string, unknown> = {
        taskId,
        agentName: agent.name,
        timestamp: new Date().toISOString(),
      };
      if (featureName) {
        promptMetadata.featureName = featureName;
      }
      if (fsmState) {
        promptMetadata.fsmState = fsmState;
      }
      if (hookContext.worktreePath) {
        promptMetadata.worktreePath = hookContext.worktreePath;
      }

      try {
        await this.promptInjector.savePrompt(
          meshName,
          agent.name,
          systemPrompt,
          '', // userPrompt (empty for now, could be populated from message if needed)
          promptMetadata
        );
      } catch (error) {
        log.warn('dispatcher', 'Failed to save prompt (non-fatal)', {
          agentId,
          error: String(error),
        });
      }

      // Load MCP environment variables if agent has MCP servers
      let mcpServers = agent.mcpServers;
      if (mcpServers && Object.keys(mcpServers).length > 0) {
        const mcpEnv = loadMcpEnv(this.config.workDir);

        if (Object.keys(mcpEnv).length > 0) {
          log.info('dispatcher', 'Loaded MCP environment variables', {
            agentId,
            vars: Object.keys(mcpEnv),
          });

          // Inject env vars into each MCP server config
          mcpServers = Object.fromEntries(
            Object.entries(mcpServers).map(([serverName, serverConfig]) => {
              const existingEnv = (serverConfig as { env?: Record<string, string> }).env;
              return [
                serverName,
                {
                  ...serverConfig,
                  env: {
                    ...mcpEnv,              // MCP env vars as base
                    ...existingEnv,         // Server-specific env overrides
                  },
                },
              ];
            })
          );
        }
      }

      // Check for session continuation - explicit frontmatter takes priority
      let sessionId: string | undefined;
      const frontmatterSessionId = nextMsg?.payload?.['session-id'] as string | undefined;
      if (frontmatterSessionId) {
        sessionId = frontmatterSessionId;
        log.info('dispatcher', `Using explicit session-id from frontmatter for ${agentId}`, {
          sessionId: sessionId.slice(0, 8) + '...'
        });
      } else if (this.shouldContinueAgent(agent.name, meshConfig?.continuation)) {
        const existingSession = this.queue.getConversationId(agentId);
        if (existingSession) {
          sessionId = existingSession;
          log.info('dispatcher', `Resuming session for ${agentId}`, {
            sessionId: sessionId.slice(0, 8) + '...'
          });
        }
      }

      const runnerConfig: SdkRunnerConfig = {
        id: agentId,
        model: agent.model,
        systemPrompt,
        workDir,
        msgsDir: this.config.msgsDir,
        routing,
        mcpServers,
        toolRestriction: meshConfig?.toolRestriction,  // Pass tool restriction policy
        sessionId,  // Resume session if continuation enabled
      };

      const worker = new SdkRunner(runnerConfig, this.queue);
      this.emit('worker:spawn', { agentId, model: agent.model });

      // Parity gate: emit session-start for consumer to clear stale pending asks
      this.emit('session-start', { agentId });

      // Clear any stale ask-response buffer for this agent
      this.askResponseBuffer.delete(agentId);

      // Track when FSM 'start' transition completes to avoid race condition
      // When queue is empty, 'complete' fires before 'start' async handler finishes
      // MUST be declared BEFORE event handlers that reference it
      let startedResolve: () => void;
      const startedPromise = new Promise<void>((resolve) => {
        startedResolve = resolve;
      });

      // Wire up SDK events to FSM
      worker.on('start', async (data) => {
        // Only call start if not already running (e.g., resumed from await state)
        if (machine.currentState.status !== 'running') {
          await machine.start(data.pid || process.pid);
        }
        startedResolve();  // Signal that FSM is now in 'running' state
        this.emit('worker:start', data);
      });

      // Variable to store workerId once the worker is registered
      // This allows event handlers to properly track this specific instance
      let registeredWorkerId: string | null = null;

      worker.on('output', (data) => {
        // Track last output time for stuck detection
        // Note: We need to find this specific worker by workerId
        if (registeredWorkerId) {
          const result = this.getWorkerByWorkerId(registeredWorkerId);
          if (result) {
            result.worker.lastOutputAt = Date.now();
          }
        }
        this.emit('worker:output', data);
      });

      worker.on('init', (data) => {
        this.emit('worker:init', data);
      });

      // Transition on message processing
      worker.on('message:idle', async (data) => {
        try {
          // Only transition to idle if currently running
          if (machine.currentState.status === 'running') {
            await machine.markIdle(data.message);
            this.emit('worker:idle', data);
          }
        } catch (error) {
          log.error('dispatcher', `Failed to mark worker idle`, {
            agentId,
            error: (error as Error).message,
            currentState: machine.currentState.status
          });
        }
      });

      // Complete transition - HELD COMPLETION pattern
      // We hold the FSM.complete() until AFTER post-hooks pass to avoid race conditions
      // with quality gate iteration loops
      worker.on('complete', async (data) => {
        // Get this specific worker by workerId
        const workerInfo = registeredWorkerId ? this.getWorkerByWorkerId(registeredWorkerId) : null;
        const activeWorker = workerInfo?.worker;
        const workerHookContext = activeWorker?.hookContext || hookContext;
        const currentWorkerId = registeredWorkerId || 'unknown';

        // Wait for FSM 'start' transition to complete before proceeding
        // This fixes race condition when queue is empty (0 messages processed)
        if (activeWorker?.startedPromise) {
          await activeWorker.startedPromise;
        }

        // Set worker output and sessionId in hook context for quality hooks
        workerHookContext.workerOutput = data.output;
        workerHookContext.sessionId = data.sessionId;

        // Save output for debugging (but DON'T complete FSM yet)
        let transcriptPath: string | null = null;
        if (data.output) {
          transcriptPath = this.saveSessionOutput(agentId, data.output);
        }

        // Execute post-hooks BEFORE completing FSM
        // This allows quality gates to trigger session resume without race conditions
        if (lifecycle?.post && lifecycle.post.length > 0) {
          log.info('dispatcher', `Executing post-hooks for ${agentId} (held completion)`, {
            hooks: lifecycle.post,
            sessionId: data.sessionId?.slice(0, 8),
          });

          try {
            await this.lifecycleHooks.executePostHooks(lifecycle.post, workerHookContext);
          } catch (error) {
            // Handle quality iteration errors with SESSION RESUME (not respawn)
            if (error instanceof QualityIterationError) {
              log.info('dispatcher', 'Quality iteration required - resuming session', {
                agentId,
                iteration: workerHookContext.qualityIteration,
                sessionId: data.sessionId?.slice(0, 8),
                feedback: error.feedback?.slice(0, 100),
              });

              this.emit('quality:retry', {
                agentId,
                taskId: workerHookContext.taskId,
                iteration: workerHookContext.qualityIteration,
                feedback: error.feedback,
              });

              // Write feedback to sys-msgs for audit trail (NOT routed to consumer)
              await this.lifecycleHooks.writeSystemFeedbackMessage(
                workerHookContext,
                agentId,
                workerHookContext.taskId || '',
                error.feedback,
                workerHookContext.qualityIteration || 1
              );

              // Resume session with feedback instead of respawning
              // This preserves conversation context and avoids FSM race condition
              if (data.sessionId) {
                log.info('dispatcher', 'Resuming session for quality iteration', {
                  agentId,
                  iteration: workerHookContext.qualityIteration,
                  sessionId: data.sessionId.slice(0, 8),
                });

                // Resume the session with feedback
                // The 'complete' event will fire again when resume finishes
                const resumeResult = await worker.resume(data.sessionId, error.feedback);

                // If resume fails, log error but don't crash
                if (!resumeResult.success) {
                  log.error('dispatcher', 'Session resume failed', {
                    agentId,
                    error: resumeResult.error,
                  });
                  // Fall through to complete the FSM with the original result
                } else {
                  // Resume succeeded, the 'complete' event handler will be called again
                  // with the new output from the resumed session
                  return;
                }
              } else {
                // No sessionId available - fall back to legacy respawn behavior
                log.warn('dispatcher', 'No sessionId available, falling back to respawn', {
                  agentId,
                  workerId: currentWorkerId,
                  iteration: workerHookContext.qualityIteration,
                });

                // Complete FSM first to avoid race condition
                await machine.complete(data);
                this.removeActiveWorker(agentId, currentWorkerId);
                this.askResponseBuffer.delete(agentId);
                this.writeWorkerState();

                // Then respawn after a delay
                setTimeout(() => {
                  if (this.running) {
                    log.info('dispatcher', 'Respawning worker for quality iteration (legacy)', {
                      agentId,
                      iteration: workerHookContext.qualityIteration,
                    });
                    this.spawnWorker(meshName, agent);
                  }
                }, 500);
                return;
              }
            }

            // Handle quality halt errors
            if (error instanceof QualityHaltError) {
              log.warn('dispatcher', 'Quality stack HALT - stopping immediately', {
                agentId,
                workerId: currentWorkerId,
                taskId: workerHookContext.taskId,
                feedback: error.feedback,
              });

              // Complete FSM before emitting events
              await machine.complete(data);
              this.removeActiveWorker(agentId, currentWorkerId);
              this.askResponseBuffer.delete(agentId);
              this.writeWorkerState();

              this.emit('quality:halt', {
                agentId,
                taskId: workerHookContext.taskId,
                feedback: error.feedback,
              });
              this.emit('worker:error', {
                id: agentId,
                error: `Quality HALT: ${error.feedback}`,
                transitionName: 'error',
              });
              return;
            }

            // Handle max iterations exhausted
            if (error instanceof QualityExhaustedError) {
              log.warn('dispatcher', 'Quality stack exhausted max iterations', {
                agentId,
                taskId: workerHookContext.taskId,
                iterations: workerHookContext.qualityIteration,
              });

              this.emit('quality:exhausted', {
                agentId,
                taskId: workerHookContext.taskId,
                iterations: workerHookContext.qualityIteration,
              });
              // Continue with normal completion even if quality exhausted
            }

            // Other post-hook errors are logged but don't affect completion
            if (!(error instanceof QualityExhaustedError)) {
              log.error('dispatcher', 'Post-hook execution failed', {
                agentId,
                error: (error as Error).message,
              });
            }
          }
        }

        // Check if worker is awaiting responses - if so, suspend instead of completing
        // This handles the case where the SDK subprocess exits naturally while the FSM is in 'awaiting' state
        // ALSO check SQLite for pending outgoing asks - handles race where enterAwait() hasn't finished
        const currentStatus = machine.getStatus();
        const pendingOutgoingAsks = this.queue.getPendingAsks(agentId);
        const hasPendingAsks = pendingOutgoingAsks.length > 0;

        if (currentStatus === 'awaiting' || hasPendingAsks) {
          if (hasPendingAsks && currentStatus !== 'awaiting') {
            log.warn('dispatcher', `Worker has pending outgoing asks but FSM not in awaiting - race condition detected`, {
              agentId,
              workerId: currentWorkerId,
              fsmStatus: currentStatus,
              pendingAsks: pendingOutgoingAsks.map(a => a.msg_id),
            });
          }
          const sessionId = data.sessionId;
          if (sessionId) {
            // Get awaiting responses from FSM, but also include SQLite pending asks (handles race)
            const fsmAwaitingResponses = machine.getAwaitingResponses();
            const sqliteTargets = pendingOutgoingAsks.map(a => a.to_agent);
            const allTargets = new Set([...fsmAwaitingResponses, ...sqliteTargets]);
            const pendingCount = Math.max(fsmAwaitingResponses.size, pendingOutgoingAsks.length);

            log.info('dispatcher', `Worker exited while awaiting - suspending session`, {
              agentId,
              workerId: currentWorkerId,
              sessionId: sessionId.slice(0, 8),
              fsmAwaitingResponses: Array.from(fsmAwaitingResponses),
              sqlitePendingAsks: sqliteTargets,
              mergedTargets: Array.from(allTargets),
            });

            // Save to suspendedSessions (same mechanism as ask-human)
            this.suspendedSessions.set(agentId, {
              sessionId,
              reason: 'await-response',
              suspendedAt: Date.now(),
              targetAgents: allTargets,
              pendingResponseCount: pendingCount,
              meshName,
              agentConfig: agent,
              hookContext: workerHookContext,
            });

            // Persist to SQLite for crash recovery (matches ask-human behavior)
            this.queue.suspendSession(agentId, {
              sessionId,
              reason: 'await-response',
              suspendedAt: Date.now(),
              meshName,
              targetAgents: Array.from(allTargets),
              pendingCount,
            });

            // Remove from activeWorkers but DON'T complete FSM - keep it in awaiting state
            this.removeActiveWorker(agentId, currentWorkerId);
            this.writeWorkerState();

            this.emit('worker:suspended', {
              agentId,
              workerId: currentWorkerId,
              sessionId,
              reason: 'await-response',
              pendingResponseCount: pendingCount,
              targetAgents: Array.from(allTargets),
            });

            // Don't complete FSM - wait for ask-response to resume
            return;
          } else {
            log.warn('dispatcher', `Worker exited while awaiting but no sessionId - cannot suspend`, {
              agentId,
              workerId: currentWorkerId,
              awaitingResponses: Array.from(machine.getAwaitingResponses()),
            });
            // Fall through to normal completion with validation error
          }
        }

        // NOW complete the FSM (after post-hooks pass or exhausted)
        // Defense-in-depth: catch ValidationError if worker tries to complete with pending asks
        try {
          await machine.complete(data);
        } catch (completeError) {
          const errorMsg = (completeError as Error).message;

          // Check if this is a protocol violation (completing with pending asks)
          if (errorMsg.includes('PROTOCOL VIOLATION') || errorMsg.includes('outstanding asks')) {
            // Check if it's unanswered INCOMING asks (need to remind/escalate)
            if (errorMsg.includes('unanswered incoming asks')) {
              const incomingAsks = machine.getIncomingAsks();
              const reminderCount = machine.getIncomingAskReminderCount();

              log.warn('dispatcher', `BLOCKED: task-complete with unanswered incoming asks`, {
                agentId,
                incomingAsks: incomingAsks.map(a => `${a.from} (${a.msgId})`),
                reminderCount,
              });

              // Check if we've exceeded max reminders
              if (reminderCount >= 3) {
                // Force error after 3 reminders
                if (activeWorker) {
                  await this.forceErrorForUnansweredAsks(agentId, activeWorker, incomingAsks, currentWorkerId);
                }
                return;
              }

              // Inject reminder and continue
              if (activeWorker) {
                await this.injectIncomingAskReminder(agentId, activeWorker, incomingAsks, reminderCount);
              }
              return;
            }

            // Otherwise, it's OUTGOING asks (awaiting responses) - just block
            log.warn('dispatcher', `BLOCKED: task-complete while awaiting responses`, {
              agentId,
              error: errorMsg,
              currentState: machine.getStatus(),
              awaitingResponses: Array.from(machine.getAwaitingResponses()),
            });

            this.emit('worker:blocked', {
              agentId,
              reason: 'pending-asks',
              error: errorMsg,
            });

            // Don't delete the worker - it's still awaiting responses
            this.writeWorkerState();
            return;
          }

          // Re-throw other errors
          throw completeError;
        }

        // Accumulate worker metrics into session metrics
        if (data.metrics && workerHookContext.meshInstance) {
          const session = this.sessionMetrics.get(workerHookContext.meshInstance);
          if (session) {
            const workerMetrics: WorkerMetrics = {
              ...data.metrics,
              completedAt: Date.now(),
            };
            session.workers.push(workerMetrics);
            session.totalInputTokens += data.metrics.totalInputTokens;
            session.totalOutputTokens += data.metrics.totalOutputTokens;
            session.totalCostUsd += data.metrics.totalCostUsd;
            session.workerCount++;
          }
        }

        this.removeActiveWorker(agentId, currentWorkerId);
        this.askResponseBuffer.delete(agentId);
        this.stuckDetector.clearNudgeTracking(agentId);
        this.writeWorkerState();

        // Check if mesh session is complete
        this.checkSessionComplete(workerHookContext.meshInstance);

        // Save session ID for continuation (if enabled and session captured)
        const agentName = agentId.split('/')[1];
        if (this.shouldContinueAgent(agentName, meshConfig?.continuation) && data.sessionId) {
          this.queue.setConversationId(agentId, data.sessionId);
          log.info('dispatcher', `Session saved for ${agentId}`, {
            sessionId: data.sessionId.slice(0, 8) + '...'
          });
        }

        // Emit quality pass if we had preflight and made it here without errors
        if (workerHookContext.qualityPreflight) {
          this.emit('quality:pass', {
            agentId,
            taskId: workerHookContext.taskId,
            iterations: workerHookContext.qualityIteration || 1,
          });
        }

        // Record session for session awareness (async, non-blocking)
        if (this.sessionStore && this.sessionSummarizer && data.sessionId && transcriptPath) {
          const sessionStartTime = activeWorker?.startedAt || Date.now();
          const sessionEndTime = Date.now();

          // Get files changed from the runner if available
          const filesChanged = activeWorker?.runner?.getFilesChanged?.() || undefined;

          // Record session metadata
          this.sessionStore.recordSession({
            id: data.sessionId,
            agentId,
            meshId: meshName,
            startedAt: sessionStartTime,
            endedAt: sessionEndTime,
            durationSeconds: Math.floor((sessionEndTime - sessionStartTime) / 1000),
            transcriptPath,
            messageCount: data.metrics?.messageCount,
            toolCalls: data.metrics?.toolCalls,
            finalStatus: 'success',
            filesChanged,
            createdAt: Date.now(),
          });

          // Generate headline async (don't block completion)
          this.sessionSummarizer.generateHeadline(transcriptPath)
            .then((headline) => {
              this.sessionStore!.updateHeadline(data.sessionId!, headline);
            })
            .catch((err) => {
              log.warn('dispatcher', 'Failed to generate session headline', {
                sessionId: data.sessionId,
                error: (err as Error).message,
              });
            });

          // Index for FTS search
          if (data.output) {
            this.sessionStore.indexSessionContent(data.sessionId, data.output);
          }

          log.debug('dispatcher', 'Recorded session for awareness', {
            sessionId: data.sessionId.slice(0, 8),
            agentId,
            meshName,
          });
        }

        this.emit('worker:complete', {
          ...data,
          workerId: currentWorkerId,
          transitionName: 'complete',
          qualityResult: workerHookContext.qualityPreflight
            ? { iterations: workerHookContext.qualityIteration || 1, passed: true }
            : undefined,
        });

        // Check for pending continuation messages (self-addressed or from other agents)
        // This handles the case where an agent sends a message to itself to continue iterating
        const pendingMsg = this.queue.peekOne(agentId);
        if (pendingMsg && this.running) {
          log.info('dispatcher', `Continuation message found after completion, spawning next iteration`, {
            agentId,
            from: pendingMsg.from_agent,
            type: pendingMsg.type,
            isSelfLoop: pendingMsg.from_agent === agentId,
          });

          // Schedule next iteration (slight delay to allow state to settle)
          setTimeout(() => {
            if (this.running && !this.hasActiveWorkers(agentId)) {
              this.spawnWorker(meshName, agent);
            }
          }, 100);
        }
      });

      // Error transition with retry logic
      worker.on('error', async (data) => {
        const errorWorkerId = registeredWorkerId || 'unknown';
        await machine.error(data.error);

        // Check if we can retry
        const canRetry = await machine.canTransition('retry', {
          status: 'initializing',
          config: workerConfig,
          startedAt: Date.now()
        } as any);

        if (canRetry) {
          log.info('dispatcher', `Retrying worker`, {
            agentId,
            workerId: errorWorkerId,
            attempt: machine.currentContext.retryCount + 1,
            maxRetries: machine.currentContext.maxRetries
          });

          await machine.retry();
          // Remove current worker before respawning
          this.removeActiveWorker(agentId, errorWorkerId);
          // Recursively spawn again, but check if dispatcher is still running
          setTimeout(() => {
            if (this.running) {
              this.spawnWorker(meshName, agent);
            } else {
              log.debug('dispatcher', `Skipping retry, dispatcher stopped`, { agentId });
            }
          }, 1000);
        } else {
          log.error('dispatcher', `Worker exhausted retries`, { agentId, workerId: errorWorkerId });
          this.removeActiveWorker(agentId, errorWorkerId);
          this.askResponseBuffer.delete(agentId);
          this.writeWorkerState();
        }

        this.emit('worker:error', { ...data, workerId: errorWorkerId, transitionName: 'error' });
      });

      // Add worker to active workers with unique workerId for parallel execution
      const workerId = this.addActiveWorker(agentId, {
        runner: worker,
        machine,
        startedAt: Date.now(),
        hookContext,
        startedPromise,  // Add promise to track 'start' completion
      });
      // Set the registeredWorkerId so event handlers can reference it
      registeredWorkerId = workerId;
      log.debug('dispatcher', `Worker registered`, { agentId, workerId });
      this.writeWorkerState();

      // Run the worker (async, don't await)
      worker.run().catch(async (error) => {
        await machine.error((error as Error).message)
          .catch(e => log.error('dispatcher', 'Error during error transition', { error: (e as Error).message }));

        // Cleanup worktree if created
        if (lifecycle?.post && lifecycle.post.length > 0) {
          try {
            log.info('dispatcher', `Executing post-hooks after worker spawn error for ${agentId}`, {
              hooks: lifecycle.post,
            });
            await this.lifecycleHooks.executePostHooks(lifecycle.post, hookContext);
          } catch (err) {
            log.error('dispatcher', `Post-hook cleanup failed after worker error`, {
              agentId,
              error: (err as Error).message,
            });
          }
        }
      });

    } catch (error) {
      log.error('dispatcher', 'Failed to spawn worker', {
        agentId,
        error: (error as Error).message
      });
      this.emit('error', { agentId, error: (error as Error).message });
    }
  }

  /**
   * Normalize FSM config to support both array and object-style states
   * Transforms object-style states: { state_name: {...} } → array: [{ name: state_name, ...}]
   */
  private normalizeFSMConfig(fsm: any): FSMConfig {
    // If states is already an array, return as-is
    if (Array.isArray(fsm.states)) {
      return fsm as FSMConfig;
    }

    // Transform object-style states to array-style
    const states: any[] = [];
    for (const [stateName, stateConfig] of Object.entries(fsm.states || {})) {
      const normalized: any = { name: stateName, ...(stateConfig as any) };

      // Transform 'agents' array → coordinator + participants
      if (normalized.agents) {
        const agentList = normalized.agents as string[];
        normalized.coordinator = agentList[0];
        if (agentList.length > 1) {
          normalized.participants = agentList.slice(1);
        }
        delete normalized.agents;
      }

      states.push(normalized);
    }

    return {
      initialState: fsm.initial || fsm.initialState,
      states,
      transitions: fsm.transitions || [],
      context: fsm.context,
      context_descriptions: fsm.context_descriptions,
    } as FSMConfig;
  }

  /**
   * Try to load a mesh on-demand when a message arrives for an unloaded mesh
   * Searches project meshes/ and global TX_ROOT/meshes/
   * Returns true if mesh was loaded successfully
   */
  private tryLoadMeshOnDemand(meshName: string): boolean {
    try {
      const searchDirs: Array<{ dir: string; isGlobal: boolean }> = [];

      // Project meshes
      if (fs.existsSync(this.config.meshesDir)) {
        searchDirs.push({ dir: this.config.meshesDir, isGlobal: false });
      }

      // Global TX_ROOT meshes
      const globalMeshDir = process.env.TX_ROOT
        ? path.join(process.env.TX_ROOT, 'meshes')
        : null;
      if (globalMeshDir && fs.existsSync(globalMeshDir) && globalMeshDir !== this.config.meshesDir) {
        searchDirs.push({ dir: globalMeshDir, isGlobal: true });
      }

      // Search for mesh directory and config file
      for (const { dir: searchRoot, isGlobal } of searchDirs) {
        // Try direct: meshes/{meshName}/config.yaml
        const directPath = path.join(searchRoot, meshName);
        if (fs.existsSync(directPath)) {
          const configPath = this.findConfigInDir(directPath);
          if (configPath) {
            log.info('dispatcher', 'Found mesh config (JIT)', { meshName, configPath });
            this.loadMeshConfigFromFile(configPath, directPath, isGlobal);

            // Initialize FSM if needed
            const config = this.meshConfigs.get(meshName);
            if (config?.fsm) {
              this.initializeSingleFSM(meshName, config);
            }

            return true;
          }
        }

        // Try nested: meshes/{category}/{meshName}/config.yaml
        const categories = fs.readdirSync(searchRoot, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith('.'));

        for (const category of categories) {
          const nestedPath = path.join(searchRoot, category.name, meshName);
          if (fs.existsSync(nestedPath)) {
            const configPath = this.findConfigInDir(nestedPath);
            if (configPath) {
              log.info('dispatcher', 'Found mesh config (JIT, nested)', { meshName, configPath, category: category.name });
              this.loadMeshConfigFromFile(configPath, nestedPath, isGlobal);

              // Initialize FSM if needed
              const config = this.meshConfigs.get(meshName);
              if (config?.fsm) {
                this.initializeSingleFSM(meshName, config);
              }

              return true;
            }
          }
        }
      }

      return false;
    } catch (error) {
      log.error('dispatcher', 'JIT mesh load failed', {
        meshName,
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Find config file in directory (prioritize YAML over JSON)
   * Returns absolute path to config file, or null if not found
   */
  private findConfigInDir(dir: string): string | null {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
      const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

      if (yamlConfig) {
        return path.join(dir, yamlConfig.name);
      } else if (jsonConfig) {
        return path.join(dir, jsonConfig.name);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Initialize FSM for a single mesh (called during JIT loading)
   */
  private initializeSingleFSM(meshName: string, config: MeshConfig): void {
    try {
      const fsm = new MeshFSM(
        meshName,
        config.fsm!,
        this.queue.getDatabase(),
        config._basePath || this.config.workDir
      );

      // Wire FSM events (same as initializeFSMs)
      fsm.on('fsm:transition', (event: FSMTransitionEvent) => {
        log.debug('mesh-fsm', 'State transition', {
          meshName: event.meshName,
          from: event.from,
          to: event.to,
          trigger: event.trigger,
          triggerAgent: event.triggerAgent,
        });
        this.emit('fsm:transition', event);
      });

      fsm.on('fsm:gate-check', (event: FSMGateEvent) => {
        log.debug('mesh-fsm', 'Gate check', {
          meshName: event.meshName,
          state: event.state,
          passed: event.passed,
          retryCount: event.retryCount,
        });
        this.emit('fsm:gate-check', event);
      });

      fsm.on('fsm:script-run', (event: FSMScriptEvent) => {
        if (!event.success) {
          log.error('mesh-fsm', 'Script failed', {
            meshName: event.meshName,
            scriptType: event.scriptType,
            scriptPath: event.scriptPath,
            error: event.error,
          });
        }
        this.emit('fsm:script-run', event);
      });

      // Initialize the FSM
      fsm.initialize().catch(error => {
        log.error('mesh-fsm', 'Failed to initialize FSM (JIT)', {
          meshName,
          error: (error as Error).message,
        });
      });

      this.meshFSMs.set(meshName, fsm);
    } catch (error) {
      log.error('mesh-fsm', 'Failed to create FSM (JIT)', {
        meshName,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Load all mesh configs from meshes/ directory structure
   * Supports: meshes/{mesh}/config.yaml and meshes/{category}/{mesh}/config.yaml
   * Falls back to TX_ROOT/meshes/ if project doesn't have meshes
   */
  private loadMeshConfigs(): void {
    try {
      const meshRoots: Array<{ dir: string; isGlobal: boolean }> = [];

      // Project meshes
      if (fs.existsSync(this.config.meshesDir)) {
        meshRoots.push({ dir: this.config.meshesDir, isGlobal: false });
      }

      // Global TX_ROOT meshes (fallback)
      const globalMeshDir = process.env.TX_ROOT
        ? path.join(process.env.TX_ROOT, 'meshes')
        : null;
      if (globalMeshDir && fs.existsSync(globalMeshDir) && globalMeshDir !== this.config.meshesDir) {
        meshRoots.push({ dir: globalMeshDir, isGlobal: true });
      }

      // Legacy: check for meshes/configs/ directory (old structure)
      const legacyConfigDir = path.join(this.config.meshesDir, 'configs');
      if (fs.existsSync(legacyConfigDir)) {
        this.loadMeshConfigsFromLegacyDir(legacyConfigDir, false);
      }

      if (meshRoots.length === 0) {
        log.warn('dispatcher', 'No mesh directories found', {
          projectDir: this.config.meshesDir,
          globalDir: globalMeshDir
        });
        return;
      }

      // Scan meshes/*/ and meshes/*/*/ for config files
      for (const { dir: meshRoot, isGlobal } of meshRoots) {
        this.scanMeshDir(meshRoot, isGlobal, 0);
      }

      // Initialize FSMs for meshes that have fsm config
      this.initializeFSMs();
    } catch (error) {
      log.error('dispatcher', 'Failed to load mesh configs', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      this.emit('error', { error: `Failed to load mesh configs: ${(error as Error).message}` });
    }
  }

  /**
   * Initialize FSM instances for meshes with fsm config
   */
  private initializeFSMs(): void {
    for (const [meshName, config] of this.meshConfigs) {
      if (!config.fsm) continue;

      try {
        const fsm = new MeshFSM(
          meshName,
          config.fsm,
          this.queue.getDatabase(),
          config._basePath || this.config.workDir  // Use mesh directory for script resolution
        );

        // Wire FSM events for observability
        fsm.on('fsm:transition', (event: FSMTransitionEvent) => {
          log.debug('mesh-fsm', 'State transition', {
            meshName: event.meshName,
            from: event.from,
            to: event.to,
            trigger: event.trigger,
            triggerAgent: event.triggerAgent,
          });
          this.emit('fsm:transition', event);
        });

        fsm.on('fsm:gate-check', (event: FSMGateEvent) => {
          log.debug('mesh-fsm', 'Gate check', {
            meshName: event.meshName,
            state: event.state,
            passed: event.passed,
            retryCount: event.retryCount,
          });
          this.emit('fsm:gate-check', event);
        });

        fsm.on('fsm:script-run', (event: FSMScriptEvent) => {
          if (!event.success) {
            log.error('mesh-fsm', 'Script failed', {
              meshName: event.meshName,
              scriptType: event.scriptType,
              scriptPath: event.scriptPath,
              error: event.error,
            });
          }
          this.emit('fsm:script-run', event);
        });

        // Initialize the FSM (loads or creates state)
        fsm.initialize().catch(error => {
          log.error('mesh-fsm', 'Failed to initialize FSM', {
            meshName,
            error: (error as Error).message,
          });
        });

        this.meshFSMs.set(meshName, fsm);
      } catch (error) {
        log.error('mesh-fsm', `Failed to create FSM for mesh: ${meshName}`, {
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Recursively scan mesh directory for config files (max depth 2)
   * Supports: config.yaml, config.yml (preferred) and config.json (legacy)
   */
  private scanMeshDir(dir: string, isGlobal: boolean, depth: number): void {
    if (depth > 2) return;  // meshes/category/mesh/ is max depth
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      // Check for config files in this directory (priority: YAML > JSON)
      const yamlConfig = entries.find(e => e.isFile() && (e.name === 'config.yaml' || e.name === 'config.yml'));
      const jsonConfig = entries.find(e => e.isFile() && e.name === 'config.json');

      if (yamlConfig) {
        this.loadMeshConfigFromFile(path.join(dir, yamlConfig.name), dir, isGlobal);
      } else if (jsonConfig) {
        this.loadMeshConfigFromFile(path.join(dir, 'config.json'), dir, isGlobal);
      }

      // Recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'configs') {
          this.scanMeshDir(path.join(dir, entry.name), isGlobal, depth + 1);
        }
      }
    } catch (error) {
      log.error('dispatcher', `Failed to scan mesh directory: ${dir}`, {
        error: (error as Error).message
      });
    }
  }

  /**
   * Load a single mesh config from a file
   * Uses MeshValidator for comprehensive validation
   * Supports both YAML (.yaml, .yml) and JSON (.json) formats
   */
  private loadMeshConfigFromFile(configPath: string, basePath: string, isGlobal: boolean): void {
    const filename = path.basename(configPath);
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const isYaml = filename.endsWith('.yaml') || filename.endsWith('.yml');
      const rawConfig = isYaml ? YAML.parse(content) : JSON.parse(content);

      // Validate using MeshValidator
      const validation = MeshValidator.validate(rawConfig, filename);

      if (!validation.valid) {
        log.error('dispatcher', `Invalid mesh config: ${rawConfig.mesh || filename}`, {
          mesh: rawConfig.mesh,
          configPath,
          errors: validation.errors
        });
        this.emit('mesh:invalid', {
          file: filename,
          errors: validation.errors,
          warnings: validation.warnings
        });
        return;
      }

      // Validation passed (warnings are silent unless there are errors)
      const config = validation.config as MeshConfig;

      // Don't override project configs with global ones
      if (this.meshConfigs.has(config.mesh) && isGlobal) {
        return;
      }

      // Transform FSM config if needed (object-style states → array-style)
      if (config.fsm) {
        config.fsm = this.normalizeFSMConfig(config.fsm);
      }

      // Store base path for relative prompt resolution
      config._basePath = basePath;

      this.meshConfigs.set(config.mesh, config);
      this.emit('mesh:loaded', { mesh: config.mesh, agents: config.agents.length });
    } catch (error) {
      log.error('dispatcher', `Failed to parse mesh config: ${filename}`, {
        configPath,
        error: (error as Error).message
      });
      this.emit('mesh:invalid', {
        file: filename,
        errors: [(error as Error).message],
        warnings: []
      });
    }
  }

  /**
   * Legacy: Load configs from meshes/configs/ directory (old structure)
   */
  private loadMeshConfigsFromLegacyDir(configDir: string, isGlobal: boolean): void {
    const files = fs.readdirSync(configDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const configPath = path.join(configDir, file);
      // Legacy configs use workDir-relative prompt paths, so basePath is workDir
      this.loadMeshConfigFromFile(configPath, this.config.workDir, isGlobal);
    }
  }

  /**
   * Save session output to .ai/tx/sessions/{agentId}/{timestamp}.md
   * @returns The file path where the transcript was saved, or null on failure
   */
  private saveSessionOutput(agentId: string, output: string): string | null {
    try {
      const sessionsDir = path.join(this.config.workDir, '.ai', 'tx', 'sessions', agentId.replace('/', '-'));
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}.md`;
      const filepath = path.join(sessionsDir, filename);

      const content = `# Session Output: ${agentId}

**Captured**: ${new Date().toISOString()}

---

${output}
`;

      fs.writeFileSync(filepath, content);
      log.info('dispatcher', `Saved session output: ${filepath}`, { agentId, bytes: output.length });
      return filepath;
    } catch (err) {
      log.error('dispatcher', `Failed to save session output`, { agentId, error: (err as Error).message });
      return null;
    }
  }

  /**
   * Inject routing instructions into system prompt
   * Appends routing table to end of system prompt
   */
  private injectRoutingInstructions(
    systemPrompt: string,
    routing: Record<string, Record<string, string>>,
    meshName: string
  ): string {
    const lines: string[] = [];
    lines.push('\n\n## Message Routing\n');
    lines.push('When you complete your work, route your response message based on the outcome:\n');

    for (const [status, destinations] of Object.entries(routing)) {
      lines.push(`\n**Status: \`${status}\`**`);
      
      for (const [destination, reason] of Object.entries(destinations)) {
        const targetAgent = destination === 'core' ? 'core/core' : 
                           destination.includes('/') ? destination : 
                           `${meshName}/${destination}`;
        lines.push(`- Send message to: \`${targetAgent}\``);
        lines.push(`  Reason: ${reason}`);
      }
    }

    lines.push('\n\nSet the `to` field in your message frontmatter based on which status applies.');

    return systemPrompt + lines.join('\n');
  }

  /**
   * Extract routing config for a specific agent from mesh config
   * Returns routing in format: { status: { destination: "reason" } }
   */
  private extractAgentRouting(
    meshName: string,
    agentName: string,
    meshConfig?: MeshConfig
  ): Record<string, Record<string, string>> | undefined {
    if (!meshConfig?.routing) return undefined;

    const agentRouting = meshConfig.routing[agentName];
    if (!agentRouting) return undefined;

    // Return raw routing config (status -> destination -> reason)
    return Object.keys(agentRouting).length > 0 ? agentRouting : undefined;
  }

  /**
   * Get total active worker count across all agents
   */
  getActiveWorkerCount(): number {
    let count = 0;
    for (const workers of this.activeWorkers.values()) {
      count += workers.length;
    }
    return count;
  }

  /**
   * Get list of active agent IDs (not worker IDs)
   * For backwards compatibility - returns unique agentIds that have workers
   */
  getActiveWorkerIds(): string[] {
    return Array.from(this.activeWorkers.keys());
  }

  /**
   * Get list of all active worker instance IDs
   * Returns unique workerIds for all running workers
   */
  getAllActiveWorkerIds(): string[] {
    const ids: string[] = [];
    for (const workers of this.activeWorkers.values()) {
      for (const worker of workers) {
        ids.push(worker.workerId);
      }
    }
    return ids;
  }

  /**
   * Check if dispatcher is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get worker state machine by agent ID (returns first worker's machine)
   */
  getWorkerMachine(agentId: string): WorkerStateMachine | undefined {
    const workers = this.activeWorkers.get(agentId);
    return workers?.[0]?.machine;
  }

  /**
   * Get all active worker state machines
   * Returns machines keyed by workerId for unique identification
   */
  getAllWorkerMachines(): Map<string, WorkerStateMachine> {
    const machines = new Map<string, WorkerStateMachine>();
    for (const workers of this.activeWorkers.values()) {
      for (const worker of workers) {
        machines.set(worker.workerId, worker.machine);
      }
    }
    return machines;
  }

  /**
   * Get the workspace manager
   */
  getWorkspaceManager(): WorkspaceManager {
    return this.workspaceManager;
  }

  /**
   * Get comprehensive state snapshot for recovery guidance
   * Used by RecoveryHandler to generate guidance messages for confused agents
   */
  getAgentStateSnapshot(agentId: string): AgentStateSnapshot | null {
    const [meshName, agentName] = agentId.split('/');
    if (!meshName || !agentName) return null;

    const fsm = this.meshFSMs.get(meshName);
    const workerMachine = this.getWorkerMachine(agentId);
    const pendingAsks = this.queue.getPendingAsks(agentId);
    const sessionId = this.queue.getConversationId(agentId);

    // Get valid exits from current FSM state's exit config
    let validExits: string[] = [];
    if (fsm?.isInitialized()) {
      const stateConfig = fsm.getCurrentStateConfig();
      if (stateConfig?.exit) {
        const exit = stateConfig.exit;
        // Collect all possible exit targets
        const targets = new Set<string>();

        // From 'when' clauses
        if (exit.when) {
          for (const clause of exit.when) {
            if (clause.target) targets.add(clause.target);
          }
        }

        // From 'default'
        if (exit.default) {
          targets.add(exit.default);
        }

        // From 'run' if it's a literal state name
        if (exit.run && fsm.getStateConfig(exit.run.trim())) {
          targets.add(exit.run.trim());
        }

        // From 'transitions' (backward compat)
        if (exit.transitions) {
          for (const target of Object.keys(exit.transitions)) {
            targets.add(target);
          }
        }

        validExits = Array.from(targets);
      }
    }

    return {
      agentId,
      meshName,
      fsm: fsm?.isInitialized() ? {
        currentState: fsm.getCurrentState(),
        validExits,
        context: fsm.getContext(),
      } : null,
      worker: workerMachine ? {
        status: workerMachine.getStatus(),
        isAwaiting: workerMachine.isAwaiting(),
        awaitingResponses: Array.from(workerMachine.getAwaitingResponses()),
        messagesProcessed: workerMachine.getMessagesProcessed(),
      } : null,
      pendingAsks: pendingAsks.map(a => ({
        msgId: a.msg_id,
        to: a.to_agent,
        createdAt: a.created_at || 0,
      })),
      sessionId,
    };
  }

  /**
   * Check if a mesh session is complete (no active workers from that mesh)
   * If complete, log session metrics and cleanup
   */
  private checkSessionComplete(meshInstance: string | undefined): void {
    if (!meshInstance) return;

    const session = this.sessionMetrics.get(meshInstance);
    if (!session) return;

    // Check if any workers from this mesh are still active (flatten arrays)
    const activeInMesh = Array.from(this.activeWorkers.values())
      .flat()
      .some(w => w.hookContext?.meshInstance === meshInstance);

    if (!activeInMesh) {
      session.completedAt = Date.now();
      session.totalDurationMs = session.completedAt - session.startedAt;

      // Log session summary
      log.sessionComplete(session);

      // Emit event for external consumers
      this.emit('session:complete', session);

      // Cleanup
      this.sessionMetrics.delete(meshInstance);
    }
  }

  // ============================================================================
  // Ensemble State Handling
  // ============================================================================
  // NOTE: getNextStateConfig method removed - it was only used for subtask injection
  // which has been deprecated in favor of explicit routing for ensemble agents.

  /**
   * Handle an FSM state of type 'ensemble'
   * Spawns all ensemble agents in parallel, waits for completion, aggregates results,
   * then runs exit routing.
   */
  private async handleEnsembleState(
    meshName: string,
    stateConfig: FSMStateConfig,
    fsm: MeshFSM
  ): Promise<void> {
    const { ensemble } = stateConfig;
    if (!ensemble) {
      log.error('dispatcher', 'Ensemble state missing ensemble config', {
        meshName,
        state: stateConfig.name,
      });
      return;
    }

    // Determine agents to spawn
    const agentsToSpawn = ensemble.agents
      || Array(this.resolveEnsembleCount(ensemble.count, fsm)).fill(ensemble.agent!);

    if (agentsToSpawn.length === 0) {
      log.error('dispatcher', 'No agents to spawn for ensemble state', {
        meshName,
        state: stateConfig.name,
      });
      return;
    }

    // Get task from queue - peek at the first agent's queue or mesh queue
    const firstAgent = agentsToSpawn[0];
    const agentId = `${meshName}/${firstAgent}`;
    const task = this.queue.peekOne(agentId);
    if (!task) {
      log.warn('dispatcher', 'No task for ensemble state', {
        meshName,
        state: stateConfig.name,
        agentId,
      });
      return;
    }

    log.info('dispatcher', 'Starting ensemble execution', {
      meshName,
      state: stateConfig.name,
      agents: agentsToSpawn,
      aggregation: ensemble.aggregation,
    });

    // Start ensemble tracking
    const ensembleConfig: EnsembleConfig = {
      agents: agentsToSpawn,
      aggregation_strategy: ensemble.aggregation,
      timeout_ms: ensemble.timeout_ms,
      fault_tolerance: ensemble.fault_tolerance,
    };

    const ensembleId = this.ensembleCoordinator.startEnsemble(
      meshName,
      ensembleConfig,
      task
    );

    // Consume task from queue
    this.queue.pollOne(agentId);

    this.emit('ensemble:start', {
      ensembleId,
      meshName,
      state: stateConfig.name,
      agents: agentsToSpawn,
    });

    // Spawn all agents in parallel
    const spawnPromises = agentsToSpawn.map((agentName, idx) =>
      this.spawnEnsembleAgentForFSM(
        meshName,
        agentName,
        ensembleId,
        fsm,
        task,
        stateConfig,
        idx
      )
    );

    await Promise.allSettled(spawnPromises);

    // Wait for completion or timeout
    const timeout = ensemble.timeout_ms || 120000;
    const startTime = Date.now();

    // Poll until ensemble is complete or timeout
    while (!this.ensembleCoordinator.isComplete(ensembleId)) {
      if (Date.now() - startTime > timeout) {
        log.warn('dispatcher', 'Ensemble timeout reached', {
          meshName,
          ensembleId,
          timeout,
        });
        break;
      }
      // Brief pause before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Aggregate results
    const result = await this.ensembleCoordinator.getAggregatedResult(ensembleId);
    if (!result) {
      log.error('dispatcher', 'Ensemble aggregation failed', {
        meshName,
        ensembleId,
      });
      this.emit('ensemble:error', {
        ensembleId,
        meshName,
        error: 'Aggregation failed',
      });
      this.ensembleCoordinator.completeEnsemble(ensembleId);
      return;
    }

    log.info('dispatcher', 'Ensemble aggregation complete', {
      meshName,
      ensembleId,
      success: result.metadata.success,
      strategy: result.metadata.strategy,
    });

    // Set result in FSM context
    fsm.updateContext({
      ENSEMBLE_OUTPUT: result.output,
      ENSEMBLE_METADATA: result.metadata,
    });

    this.emit('ensemble:aggregated', {
      ensembleId,
      meshName,
      output: result.output.slice(0, 500),
      metadata: result.metadata,
    });

    // Run exit block with aggregated result
    await this.processFSMExit(meshName, fsm, stateConfig);

    // Cleanup
    this.ensembleCoordinator.completeEnsemble(ensembleId);

    this.emit('ensemble:complete', {
      ensembleId,
      meshName,
      state: stateConfig.name,
    });
  }

  /**
   * Spawn an ensemble agent for FSM execution
   * Similar to spawnWorker but designed for parallel ensemble execution
   */
  private async spawnEnsembleAgentForFSM(
    meshName: string,
    agentName: string,
    ensembleId: string,
    fsm: MeshFSM,
    task: Message,
    stateConfig: FSMStateConfig,
    index: number
  ): Promise<void> {
    const meshConfig = this.meshConfigs.get(meshName);
    const agentConfig = meshConfig?.agents.find(a => a.name === agentName);

    if (!agentConfig) {
      log.error('dispatcher', 'Ensemble agent not found in mesh config', {
        meshName,
        agentName,
        ensembleId,
      });
      this.ensembleCoordinator.recordAgentResult(
        ensembleId,
        agentName,
        '',
        'Agent not found in mesh config'
      );
      return;
    }

    const timeout = stateConfig.ensemble?.timeout_ms || 120000;
    const agentId = `${meshName}/${agentName}`;

    try {
      log.info('dispatcher', 'Spawning ensemble agent', {
        agentId,
        ensembleId,
        index,
      });

      this.ensembleCoordinator.registerAgentStart(ensembleId, agentName);

      // Build prompt path - resolve relative to mesh basePath or workDir
      let promptPath: string | null = null;

      if (meshConfig?._basePath) {
        const meshRelativePath = path.join(meshConfig._basePath, agentConfig.prompt);
        if (fs.existsSync(meshRelativePath)) {
          promptPath = meshRelativePath;
        }
      }

      if (!promptPath) {
        const workDirPath = path.join(this.config.workDir, agentConfig.prompt);
        if (fs.existsSync(workDirPath)) {
          promptPath = workDirPath;
        }
      }

      if (!promptPath) {
        throw new Error(`Prompt not found: ${agentConfig.prompt}`);
      }

      let systemPrompt = fs.readFileSync(promptPath, 'utf-8');

      // Inject preamble
      const agentCount = meshConfig?.agents?.length ?? 1;
      systemPrompt = this.promptInjector.injectPreamble(systemPrompt, { agentCount });

      // Inject messaging protocol
      systemPrompt = this.promptInjector.injectMessagingProtocol(systemPrompt);

      // Inject FSM context if available
      const currentStateConfig = fsm.getCurrentStateConfig();
      if (currentStateConfig) {
        const status = fsm.getStatus();
        // Inject ensemble index into context for differentiated messaging
        const contextWithIndex = {
          ...status.context,
          ENSEMBLE_INDEX: index,
          ENSEMBLE_TOTAL: stateConfig.ensemble?.agents?.length ||
            (stateConfig.ensemble?.count ?
              this.resolveEnsembleCount(stateConfig.ensemble.count, fsm) : 1),
        };
        const fsmContext: FSMInjectionContext = {
          meshName,
          currentState: status.currentState,
          stateConfig: currentStateConfig,
          // availableTransitions computed from exit config if needed
          context: contextWithIndex,
          contextDescriptions: fsm.getContextDescriptions(),
          gateRetries: status.gateRetries,
        };
        systemPrompt = this.promptInjector.injectFSMContext(systemPrompt, fsmContext);
      }

      // Apply model transformations based on mode
      let model = agentConfig.model;
      if (this.config.ultraLowMode) {
        model = 'haiku' as SemanticModel;
      } else if (this.config.lowMode && typeof model === 'string' && (model as string).includes('opus')) {
        model = (model as string).replace('opus', 'sonnet') as SemanticModel;
      }

      // Create runner config
      const runnerConfig: SdkRunnerConfig = {
        id: agentId,
        model: model,
        systemPrompt,
        workDir: this.config.workDir,
        msgsDir: this.config.msgsDir,
        mcpServers: agentConfig.mcpServers,
        toolRestriction: meshConfig?.toolRestriction,
      };

      const runner = new SdkRunner(runnerConfig, this.queue);

      let result = '';
      let error: string | undefined;

      // Set up event handlers
      runner.on('output', (data) => {
        result += data.data || '';
      });

      runner.on('error', (data) => {
        error = data.error;
      });

      runner.on('complete', (data) => {
        if (data.output) {
          result = data.output;
        }
      });

      // Run with timeout
      await Promise.race([
        runner.run(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        ),
      ]);

      this.ensembleCoordinator.recordAgentResult(ensembleId, agentName, result, error);

      log.debug('dispatcher', 'Ensemble agent completed', {
        agentName,
        ensembleId,
        resultLength: result.length,
        hasError: !!error,
      });
    } catch (err) {
      const errorMessage = (err as Error).message;
      this.ensembleCoordinator.recordAgentResult(
        ensembleId,
        agentName,
        '',
        errorMessage
      );
      log.warn('dispatcher', 'Ensemble agent failed', {
        agentName,
        ensembleId,
        error: errorMessage,
      });
    }
  }

  /**
   * Resolve ensemble count from config
   * Can be a literal number or a $variable reference to FSM context
   */
  private resolveEnsembleCount(count: number | string | undefined, fsm: MeshFSM): number {
    if (typeof count === 'number') return count;

    if (typeof count === 'string') {
      // Resolve from FSM context: $subtask_count
      const varName = count.startsWith('$') ? count.slice(1) : count;
      const value = fsm.getContext()[varName];
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed)) return parsed;
      }
      log.warn('dispatcher', 'Could not resolve ensemble count from context', {
        varName,
        value,
        fallback: 3,
      });
      return 3;  // default fallback
    }

    return 3;  // default
  }

  /**
   * Process FSM exit block after ensemble completion
   * Runs gates, set, when/run/default routing, and transitions to next state
   */
  private async processFSMExit(
    meshName: string,
    fsm: MeshFSM,
    stateConfig: FSMStateConfig
  ): Promise<void> {
    const exit = stateConfig.exit;
    if (!exit) {
      log.warn('dispatcher', 'No exit config for state, cannot route', {
        meshName,
        state: stateConfig.name,
      });
      return;
    }

    log.info('mesh-fsm', 'Processing FSM exit', {
      meshName,
      state: stateConfig.name,
      hasGates: !!exit.gates,
      hasWhen: !!exit.when,
      hasRun: !!exit.run,
      hasDefault: !!exit.default,
    });

    // Process exit.set first if present (extract values before routing)
    if (exit.set) {
      log.debug('mesh-fsm', 'Setting exit context variables', {
        meshName,
        state: stateConfig.name,
        vars: Object.keys(exit.set),
      });
      fsm.updateContext(exit.set as Record<string, unknown>);
    }

    // Evaluate routing using FSM's evaluateExitRouting
    const context = fsm.getContext();
    const nextState = await fsm.evaluateExitRouting(exit, context);

    if (!nextState) {
      log.error('mesh-fsm', 'FSM exit routing failed - no valid next state', {
        meshName,
        currentState: stateConfig.name,
      });
      this.emit('mesh:halt', {
        meshName,
        reason: 'Exit routing failed',
        state: stateConfig.name,
      });
      return;
    }

    log.info('mesh-fsm', 'FSM exit routing determined next state', {
      meshName,
      currentState: stateConfig.name,
      nextState,
    });

    // Transition to next state
    const transitioned = await fsm.transitionTo(
      nextState,
      'ensemble-complete',
      'dispatcher'
    );

    if (transitioned) {
      log.info('mesh-fsm', 'FSM transitioned after ensemble', {
        meshName,
        from: stateConfig.name,
        to: nextState,
      });

      this.emit('fsm:transition', {
        meshName,
        from: stateConfig.name,
        to: nextState,
        trigger: 'ensemble-complete',
        triggerAgent: 'dispatcher',
        timestamp: Date.now(),
      });

      // Trigger next state's agent with aggregated content
      await this.triggerNextStateAgent(meshName, fsm, nextState, context);
    } else {
      log.error('mesh-fsm', 'FSM transition failed', {
        meshName,
        from: stateConfig.name,
        to: nextState,
      });
    }
  }

  /**
   * Trigger the next state's agent by writing a message with aggregated content
   * This bridges ensemble completion to the synthesizer/next agent
   */
  private async triggerNextStateAgent(
    meshName: string,
    fsm: MeshFSM,
    nextState: string,
    context: Record<string, unknown>
  ): Promise<void> {
    // Get the next state's configuration
    const nextStateConfig = fsm.getStateConfig(nextState);
    if (!nextStateConfig) {
      log.warn('dispatcher', 'No state config for next state, skipping agent trigger', {
        meshName,
        nextState,
      });
      return;
    }

    // Determine the target agent - use first agent in the state
    const targetAgents = nextStateConfig.agents || [];
    if (targetAgents.length === 0) {
      log.debug('dispatcher', 'Next state has no agents, skipping trigger', {
        meshName,
        nextState,
      });
      return;
    }

    const targetAgent = targetAgents[0];
    const targetAgentId = `${meshName}/${targetAgent}`;

    // Get ENSEMBLE_OUTPUT from context
    const ensembleOutput = context.ENSEMBLE_OUTPUT as string || '';
    const ensembleMetadata = context.ENSEMBLE_METADATA as Record<string, unknown> || {};

    // Generate message ID
    const msgId = `ensemble-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = Date.now();
    const toSafe = targetAgentId.replace(/\//g, '-');
    const filename = `${timestamp}-task-dispatcher--${toSafe}-${msgId}.md`;
    const filepath = path.join(this.config.msgsDir, filename);

    // Build message content with aggregated output
    const messageContent = `---
to: ${targetAgentId}
from: dispatcher/ensemble
type: task
msg-id: ${msgId}
headline: Ensemble aggregation complete
timestamp: ${new Date().toISOString()}
---

# Aggregated Ensemble Results

The following content has been collected and aggregated from parallel ensemble agents.

${ensembleOutput}

---
**Aggregation Metadata:**
- Strategy: ${ensembleMetadata.strategy || 'unknown'}
- Agent Count: ${ensembleMetadata.agent_count || 'unknown'}
- Success: ${ensembleMetadata.success ?? 'unknown'}
`;

    try {
      fs.writeFileSync(filepath, messageContent);
      log.info('dispatcher', 'Wrote message to trigger next state agent', {
        meshName,
        nextState,
        targetAgent,
        msgId,
        filepath,
        outputLength: ensembleOutput.length,
      });
    } catch (err) {
      log.error('dispatcher', 'Failed to write trigger message', {
        meshName,
        nextState,
        targetAgent,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Inject reminder about unanswered incoming asks
   * Escalating prompts based on reminder count
   */
  private async injectIncomingAskReminder(
    agentId: string,
    worker: ActiveWorker,
    incomingAsks: Array<{ from: string; msgId: string }>,
    currentReminderCount: number
  ): Promise<void> {
    const { machine, runner } = worker;
    const sessionId = runner.getSessionId();

    if (!sessionId) {
      log.error('dispatcher', 'Cannot inject reminder without session ID', { agentId });
      return;
    }

    // Increment reminder count
    const newReminderCount = machine.incrementIncomingAskReminder();

    const askList = incomingAsks.map(a => `- **${a.from}** (msg-id: ${a.msgId})`).join('\n');

    const reminderPrompts = [
      // Reminder 1: Gentle
      `## System Notice: Unanswered Ask Messages

You have received ask messages that require responses:

${askList}

**You cannot complete this task until you respond to these asks.**

Please send ask-response messages to each agent listed above before attempting to complete.

If you don't have the information to respond, you can:
1. Send an ask-response explaining what information you need
2. Send an ask-human to escalate
3. Continue working to gather the needed information

What would you like to do?`,

      // Reminder 2: Firm
      `## IMPORTANT: Completion Blocked - Unanswered Asks

**ATTENTION**: You attempted to complete but have ${incomingAsks.length} unanswered ask message(s):

${askList}

**This is your second reminder.**

You MUST send ask-response messages to all agents above before you can complete.

**Required Action**: Send ask-response to each agent immediately.`,

      // Reminder 3: Final warning
      `## FINAL WARNING: Session Termination Imminent

**CRITICAL**: You have ${incomingAsks.length} unanswered ask message(s):

${askList}

**This is your FINAL warning.**

If you attempt to complete again without responding to these asks, your session will be **TERMINATED** and the task will be marked as **FAILED**.

**Send ask-response messages NOW.**`
    ];

    const prompt = reminderPrompts[Math.min(newReminderCount - 1, reminderPrompts.length - 1)];

    log.info('dispatcher', `Injecting incoming ask reminder (attempt ${newReminderCount})`, {
      agentId,
      reminderCount: newReminderCount,
      incomingAsks: incomingAsks.map(a => a.from),
    });

    this.emit('worker:incoming-ask-reminder', {
      agentId,
      reminderCount: newReminderCount,
      incomingAsks,
    });

    try {
      // Interrupt current run and resume with reminder
      await runner.interrupt();
      const result = await runner.resume(sessionId, prompt);

      if (!result.success) {
        log.error('dispatcher', 'Reminder injection failed', {
          agentId,
          error: result.error,
        });
      }
    } catch (error) {
      log.error('dispatcher', 'Failed to inject incoming ask reminder', {
        agentId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Force error state after 3 failed reminder attempts
   */
  private async forceErrorForUnansweredAsks(
    agentId: string,
    worker: ActiveWorker,
    incomingAsks: Array<{ from: string; msgId: string }>,
    workerId: string
  ): Promise<void> {
    const { machine, runner } = worker;
    const askList = incomingAsks.map(a => `${a.from} (${a.msgId})`).join(', ');

    log.error('dispatcher', 'Forcing error after max reminders about unanswered asks', {
      agentId,
      workerId,
      incomingAsks: askList,
      reminderAttempts: 3,
    });

    // Kill the worker
    runner.kill(`unanswered-asks: ${agentId} failed to respond to [${askList}] after 3 reminders`);

    // Transition to error state
    await machine.error(`Failed to respond to incoming asks after 3 reminders: [${askList}]`);

    // Clean up using workerId for proper removal
    this.removeActiveWorker(agentId, workerId);
    this.writeWorkerState();

    this.emit('worker:error', {
      id: agentId,
      workerId,
      error: `Unanswered incoming asks after 3 reminders: [${askList}]`,
      transitionName: 'error',
    });

    log.info('dispatcher', 'Worker terminated for unanswered asks', { agentId, workerId });
  }

}
