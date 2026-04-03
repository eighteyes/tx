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
import { MessageQueue, type Message } from '../queue/index.ts';
import { SdkRunner, type SdkRunnerConfig, type AgentRouting, type ToolRestriction } from './sdk-runner.ts';
import { ChromeCliRunner } from './chrome-cli-runner.ts';
import type { Runner } from './runner.ts';
import type {SemanticModel, WorkerConfig, FSMConfig, EnsembleConfig} from '../shared/types.ts';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import { WorkerStateMachine, createLoggingMiddleware } from '../state-machine/index.ts';
import {WorkspaceManager, PromptInjector, type WorkspaceConfig, type FSMInjectionContext, type SituationalContext} from '../workspace/index.ts';
import {
  LifecycleHooks,
  QualityIterationError,
  QualityHaltError,
  QualityExhaustedError,
  type HookContext,
} from './hooks.ts';
import {
  type PreflightOutput,
} from '../quality/index.ts';
import type { ParityReminderEvent, MeshCompleteEvent } from '../core/consumer.ts';
import { resolveLifecycle } from './lifecycle-utils.ts';
import {MeshFSM, type FSMTransitionEvent, type FSMGateEvent, type FSMScriptEvent, type FSMFeedbackEvent, type FSMDispatchEvent, MeshConfigLoader, type MeshConfig, type AgentConfig, type ParallelBlock} from '../mesh/index.ts';
import { EnsembleCoordinator } from './ensemble-coordinator.ts';
import type { FSMStateConfig, FSMEnsembleConfig } from '../shared/types.ts';
import { SessionStore, SessionSummarizer } from '../session/index.ts';
import { WorkerLifecycleManager, type ActiveWorker, type TrackedMessage, type AddWorkerOptions } from './worker-lifecycle.ts';
import { SessionManager, type SuspendedSession, type BufferedResponse } from './session-manager.ts';
import { MetricsAggregator } from './metrics-aggregator.ts';
import { DispatchRouter } from './dispatch-router.ts';
import { buildRoutingSection, buildDispatcherRoutingSection, buildFreeRoutingSection } from '../prompt/sections/routing.ts';
import { WriteGate } from './write-gate.ts';
import { ReadGate } from './read-gate.ts';
import { IdentityGate } from './identity-gate.ts';
import { BashGuard } from './bash-guard.ts';
import { MessageGate } from './message-gate.ts';
import { GuardrailConfig } from './guardrail-config.ts';
import { GuardrailKillHandler } from './guardrail-kill-handler.ts';
import { buildPathContext, validateAgentArtifacts, findWriters, resolveManifestVariables, resolveManifestPath } from './manifest-validator.ts';
import { resolveManifestEligibility, formatDeadlockMessage } from './manifest-resolver.ts';
import { SystemMessageWriter } from '../core/system-message-writer.ts';
import { NudgeDetector } from './nudge-detector.ts';
import { ReliabilityManager } from '../reliability/reliability-manager.ts';
import YAML from 'yaml';

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

// MeshConfig, AgentConfig, and related types are now imported from '../mesh/index.ts'
// via the MeshConfigLoader module (Phase 2 refactoring)

export interface DispatcherConfig {
  workDir: string;
  msgsDir: string;
  meshesDir: string;
  lowMode?: boolean;
  ultraLowMode?: boolean;
  /** Pre-initialized session store (from start.ts). If provided, dispatcher will record sessions. */
  sessionStore?: SessionStore;
  /** Enable debug mode: adds forensics postHook to all meshes */
  debug?: boolean;
  /** Enable god mode: bypasses all permissions (unrestricted tool access) */
  godMode?: boolean;
  /** TX installation root directory (for script resolution via $TX_ROOT env var) */
  txRoot?: string;
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
  /** Revision mode - core decides behavior based on worker state */
  mode?: 'interrupt' | 'append' | 'replace';
}

/**
 * Event emitted by Consumer when a message is detected
 * DEPRECATED ASK: 'ask'/'ask-human' types are deprecated, use 'message' + routing
 */
interface AskMessageEvent {
  id: number;
  filepath: string;
  from: string;  // Agent that sent the message
  to: string;    // Recipient agent
  type: string;  // 'message' (preferred) or 'ask'/'ask-human' (DEPRECATED)
  headline?: string;
  msgId?: string;
  // Terminal-by-default additions
  crossesHumanBoundary?: boolean;  // True if targets core/core (human)
  isTerminal?: boolean;            // True if suspends the sender (always true for now)
}

/**
 * Event emitted by Consumer when a blocking HITL message is detected.
 * Agent sends message with `human: blocking` — worker stays alive awaiting response.
 */
interface BlockingHitlMessageEvent {
  id: number;
  filepath: string;
  from: string;
  to: string;
  type: string;
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
  // Boundary detection
  fromHumanBoundary?: boolean;  // true if from === 'core/core' (human response)
  resumesSuspension?: boolean;  // true if this should resume a suspended session
}

// TrackedMessage and ActiveWorker types are now imported from './worker-lifecycle.ts'

/**
 * Reason for session resume - used for logging and event naming
 */
type ResumeReason =
  | 'revision'
  | 'ask-human'
  | 'ask-response'
  | 'parity-reminder'
  | 'quality-iteration'
  | 'incoming-ask-reminder'
  | 'system-feedback'
  | 'artifact-retry'
  | 'blocking-hitl';

/**
 * Options for unified session resume
 */
interface ResumeSessionOptions {
  reason: ResumeReason;
  agentId: string;
  sessionId: string;
  prompt: string;
  runner: Runner;
  interrupt?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Result from session resume attempt
 */
interface ResumeSessionResult {
  success: boolean;
  error?: string;
}

/**
 * Options for spawning a worker
 */
interface SpawnWorkerOptions {
  /** If set, worker is part of ensemble - collect output instead of FSM transition */
  ensembleId?: string;
  /** Ensemble index (for differentiated context injection) */
  ensembleIndex?: number;
  /** Total number of agents in ensemble (for context injection) */
  ensembleTotal?: number;
  /** Skip post-hooks (for ensemble workers) */
  skipPostHooks?: boolean;
  /** FSM instance to use for context injection (ensemble workers use mesh FSM) */
  fsm?: MeshFSM;
  /** FSM state config for ensemble context */
  fsmStateConfig?: FSMStateConfig;
  /** Task message (for ensemble workers that don't poll queue) */
  task?: Message;
}

/**
 * System feedback event for direct injection into agent session
 */
interface SystemFeedbackEvent {
  agentId: string;
  feedback: string;
  reason: string;
}

// SuspendedSession is now imported from './session-manager.ts'

/**
 * Checkpoint entry: stores session state for start/end forks
 * - sessionId: session to fork from
 * - initMessageUuid: UUID of system:init message (for start-type forks, truncates to init state)
 */
interface CheckpointEntry {
  sessionId: string;
  initMessageUuid?: string;
}

/**
 * Resolve checkpoint config to a checkpoint type.
 * Handles backward compat: boolean true → 'start'
 */
function resolveCheckpointType(checkpoint: boolean | string | undefined): 'start' | 'end' | null {
  if (!checkpoint) return null;
  if (checkpoint === true) return 'start';
  if (checkpoint === 'both') return 'start';  // backward compat: 'both' treated as 'start'
  return checkpoint as 'start' | 'end';
}

export class WorkerDispatcher extends EventEmitter {
  private config: DispatcherConfig;
  private queue: MessageQueue;
  private running = false;
  private meshConfigs: Map<string, MeshConfig> = new Map();
  private meshFSMs: Map<string, MeshFSM> = new Map();  // mesh name -> FSM instance
  private workspaceManager: WorkspaceManager;
  private promptInjector: PromptInjector;
  private lifecycleHooks: LifecycleHooks;
  private boundMessageHandler: ((event: { agentId: string }) => void) | null = null;
  private boundRevisionHandler: ((event: RevisionMessageEvent) => void) | null = null;
  private boundAskMessageHandler: ((event: AskMessageEvent) => void) | null = null;
  private boundAskResponseHandler: ((event: AskResponseMessageEvent) => void) | null = null;
  private boundBlockingHitlHandler!: (event: BlockingHitlMessageEvent) => void;
  private boundParityReminderHandler: ((event: ParityReminderEvent) => void) | null = null;
  private boundMeshCompleteHandler: ((event: MeshCompleteEvent) => void) | null = null;
  private boundSystemFeedbackHandler: ((event: SystemFeedbackEvent) => void) | null = null;
  // Message tracking handlers for completion enforcement
  private boundCoreMessageTrackingHandler: ((event: { from: string; type: string; filepath: string }) => void) | null = null;
  private boundWorkerMessageTrackingHandler: ((event: { from: string; type: string; agentId: string; filepath?: string }) => void) | null = null;

  /** Deferred mesh completions — waiting for active workers to finish before finalizing */
  private pendingCompletions: Map<string, { completionAgent: string; receivedAt: number }> = new Map();
  private ensembleCoordinator: EnsembleCoordinator;
  private sessionStore?: SessionStore;
  private sessionSummarizer?: SessionSummarizer;

  // Extracted managers (Phase 1 refactoring)
  private workerLifecycle: WorkerLifecycleManager;
  private sessionManager: SessionManager;
  private guardrails: GuardrailConfig;

  // Extracted modules (Phase 2 refactoring)
  private configLoader: MeshConfigLoader;

  // Extracted modules (Phase 3 refactoring)
  private metricsAggregator: MetricsAggregator;

  // Routing error tracking for correction injection (key: "sender→target", value: retry count)
  private routingErrorCounts: Map<string, number> = new Map();

  // Edge iteration counters per turn (key: "mesh/from->mesh/to", value: message count)
  // Reset when a new turn starts (entry_point receives a task)
  private edgeCounters: Map<string, number> = new Map();

  // Mesh-wide message counters per turn (key: mesh name, value: total message count)
  // Reset when a new turn starts (entry_point receives a task)
  private meshMessageCounters: Map<string, number> = new Map();

  // Track completed agents per mesh session for preflight filtering
  // Key: mesh instance name, Value: set of agent names that have completed
  // Reset when entry_point receives a new task
  private completedAgents: Map<string, Set<string>> = new Map();

  // Cached manifest variable map per mesh — refreshed after each agent completes
  // Avoids stale session.yaml reads during preflight/post-validation
  // Key: mesh name, Value: resolved variable map (game-id, campaign-id, N, etc.)
  private cachedManifestVars: Map<string, Record<string, string>> = new Map();

  // Track written file paths per mesh for manifest routing
  // Key: mesh instance name, Value: set of resolved absolute paths confirmed written
  // Reset when entry_point receives a new task
  private writtenFiles: Map<string, Set<string>> = new Map();

  // Last completed session ID per agent — used by routing self-heal to resume
  // conversation context when spawning a correction worker after OAOM kill
  private lastCompletedSessionIds: Map<string, string> = new Map();

  // Cascade halt: track consecutive failures per agent to stop infinite respawn loops.
  // Persisted to SQLite queue to survive mesh restarts.
  // Reset on successful completion (messagesProcessed > 0 and no error).
  private static readonly CASCADE_HALT_THRESHOLD = 3;

  // Session checkpoints for forking — saves session state for start/end forks
  // Key: `${meshName}/${agentName}`, Value: CheckpointEntry with sessionId + optional initMessageUuid
  // Used by fork_from to resume from a previous agent's checkpoint
  // Note: Uses meshName (not meshInstance) so checkpoints persist within sequential mesh runs.
  private checkpoints: Map<string, CheckpointEntry> = new Map();

  // Parallel block tracking — manages fork/join execution for parallelism config
  // Key: `${meshName}:${blockIndex}`, Value: { agents to run, completed agents, exit agent }
  private parallelBlocks: Map<string, {
    agents: Set<string>;      // Agents in this block
    completed: Set<string>;   // Agents that have completed
    exitAgent: string;        // Exit agent to ungate when all complete
    entryAgent: string;       // Entry agent (fork point)
    timeout?: number;         // Optional timeout
    onPartial: 'continue' | 'abort';  // Behavior on partial failure
  }> = new Map();

  // Fan-out group tracking — manages dispatcher-routing fan-out/fan-in
  // Key: `${meshName}:${joinAgent}`, Value: { agents in group, completed agents, join agent }
  private fanOutGroups: Map<string, {
    agents: Set<string>;      // Agents in the parallel group
    completed: Set<string>;   // Agents that routed outcome:complete to join
    joinAgent: string;        // The gated join target
    startedAt: number;        // For timeout tracking
    fanIn: 'batch' | 'queue' | 'drain';
    transform?: 'summarize';
  }> = new Map();

  // Queue-first writer for system-authored messages
  systemWriter!: SystemMessageWriter;
  // Pending permission asks: agentId → { toolUseID, runner ref }
  private pendingPermissionAsks: Map<string, { toolUseID: string; runner: Runner }> = new Map();

  /** Feature name captured from entry message, persisted per mesh run */
  private meshFeatureNames: Map<string, string> = new Map();
  // Auto-nudge recovery for stalled routes
  private nudgeDetector?: NudgeDetector;
  // Reliability: circuit breakers, heartbeat, SLI, DLQ, safe-mode
  reliability?: ReliabilityManager;

  constructor(config: DispatcherConfig, queue: MessageQueue) {
    super();
    this.setMaxListeners(25);
    this.config = config;
    this.queue = queue;

    const stateFile = path.join(config.workDir, '.ai', 'tx', 'data', 'workers.json');
    this.workspaceManager = new WorkspaceManager(config.workDir);
    this.promptInjector = new PromptInjector();
    this.lifecycleHooks = new LifecycleHooks(config.workDir, queue, config.meshesDir);
    this.ensembleCoordinator = new EnsembleCoordinator();

    // Initialize extracted managers (Phase 1)
    this.workerLifecycle = new WorkerLifecycleManager(stateFile);
    this.sessionManager = new SessionManager(queue);

    // Initialize extracted modules (Phase 2)
    this.configLoader = new MeshConfigLoader({
      workDir: config.workDir,
      meshesDir: config.meshesDir,
    });

    // Initialize extracted modules (Phase 3)
    this.metricsAggregator = new MetricsAggregator(config.workDir);

    // Guardrail config (unified thresholds)
    this.guardrails = new GuardrailConfig(config.workDir);

    // Session awareness - use store from config if provided
    if (config.sessionStore) {
      this.sessionStore = config.sessionStore;
      this.sessionSummarizer = new SessionSummarizer(this.sessionStore);
      log.debug('dispatcher', 'Session awareness enabled');
    }

  }

  /**
   * Write worker state to disk (delegates to WorkerLifecycleManager)
   */
  private writeWorkerState(): void {
    this.workerLifecycle.writeState();
  }

  /**
   * Check if an agent should have session continuation enabled
   * Delegates to MeshConfigLoader (Phase 2 refactoring)
   */
  private shouldContinueAgent(agentName: string, continuation: boolean | string[] | undefined): boolean {
    return this.configLoader.shouldContinueAgent(agentName, continuation);
  }

  /**
   * Check if an agent should have cross-run session persistence
   * Delegates to MeshConfigLoader
   */
  private shouldPersistAgent(agentName: string, persistence: boolean | string[] | undefined): boolean {
    return this.configLoader.shouldPersistAgent(agentName, persistence);
  }

  // ============================================================================
  // Unified Session Resume
  // ============================================================================

  /**
   * Resume a session with consistent logging and event emission
   *
   * Consolidates the 6 different resume pathways:
   * - revision: User edits message file
   * - ask-human: Human responds to suspended agent
   * - ask-response: Agent responds to ask
   * - parity-reminder: Blocked task-complete reminder
   * - quality-iteration: Quality gate failure retry
   * - incoming-ask-reminder: Stuck detector reminder
   */
  private async resumeSession(options: ResumeSessionOptions): Promise<ResumeSessionResult> {
    const { reason, agentId, sessionId, prompt, runner, interrupt, metadata } = options;
    const shortSessionId = sessionId.slice(0, 8);

    try {
      // Optional interrupt before resume
      if (interrupt) {
        await runner.interrupt();
        this.emit(`${reason}:interrupt`, { agentId, sessionId, ...metadata });
      }

      log.info('dispatcher', `Resuming session`, {
        agentId,
        reason,
        sessionId: shortSessionId,
        ...metadata,
      });

      const result = await runner.resume(sessionId, prompt);

      if (result.success) {
        log.info('dispatcher', `Session resumed successfully`, {
          agentId,
          reason,
          sessionId: shortSessionId,
        });

        this.emit(`${reason}:complete`, {
          agentId,
          sessionId,
          success: true,
          ...metadata,
        });

        return { success: true };
      } else {
        log.error('dispatcher', `Session resume failed`, {
          agentId,
          reason,
          sessionId: shortSessionId,
          error: result.error,
        });

        this.emit(`${reason}:error`, {
          agentId,
          sessionId,
          error: result.error,
          ...metadata,
        });

        return { success: false, error: result.error };
      }
    } catch (error) {
      const errorMsg = (error as Error).message;

      log.error('dispatcher', `Session resume exception`, {
        agentId,
        reason,
        sessionId: shortSessionId,
        error: errorMsg,
      });

      this.emit(`${reason}:error`, {
        agentId,
        error: errorMsg,
        ...metadata,
      });

      return { success: false, error: errorMsg };
    }
  }

  // ============================================================================
  // Worker Instance Management (delegates to WorkerLifecycleManager)
  // ============================================================================

  /**
   * Add a worker instance (delegates to WorkerLifecycleManager)
   */
  private addActiveWorker(agentId: string, worker: AddWorkerOptions, taskFrom?: string): string {
    return this.workerLifecycle.add(agentId, worker, taskFrom);
  }

  /**
   * Remove a worker instance (delegates to WorkerLifecycleManager)
   */
  private removeActiveWorker(agentId: string, workerId: string): boolean {
    return this.workerLifecycle.remove(agentId, workerId);
  }

  /**
   * Normalize completion_agent / completion_agents / boundary_agents into an array
   * Supports backward compatibility with boundary_agents (deprecated)
   * Priority: completion_agents > boundary_agents > completion_agent
   */
  private normalizeCompletionAgents(config: MeshConfig | undefined): string[] {
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
   * Build environment variables to inject into agent shell.
   * TX_ROOT enables scripts to reference mesh resources via $TX_ROOT/meshes/...
   */
  private buildAgentEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    // TX_ROOT: derive from meshesDir (meshesDir = txRoot/meshes)
    // or use explicit txRoot from config if provided
    const txRoot = this.config.txRoot || path.dirname(this.config.meshesDir);
    env.TX_ROOT = txRoot;

    return env;
  }

  /**
   * Load project CLAUDE.md from workDir (project-level only, not ~/.claude/).
   * Checks workDir/CLAUDE.md and workDir/.claude/CLAUDE.md.
   */
  private loadProjectClaudeMd(): string | null {
    const candidates = [
      path.join(this.config.workDir, 'CLAUDE.md'),
      path.join(this.config.workDir, '.claude', 'CLAUDE.md'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const content = fs.readFileSync(candidate, 'utf-8').trim();
          if (content) return `## Project Instructions (CLAUDE.md)\n\n${content}`;
        } catch {}
      }
    }
    return null;
  }

  /**
   * Get worker by workerId (delegates to WorkerLifecycleManager)
   */
  private getWorkerByWorkerId(workerId: string): { agentId: string; worker: ActiveWorker } | undefined {
    return this.workerLifecycle.getByWorkerId(workerId);
  }

  /**
   * Get first worker for agent (delegates to WorkerLifecycleManager)
   */
  private getFirstWorkerForAgent(agentId: string): ActiveWorker | undefined {
    return this.workerLifecycle.getFirst(agentId);
  }

  /**
   * Get all workers for an agent (delegates to WorkerLifecycleManager)
   */
  getActiveWorkersForAgent(agentId: string): ActiveWorker[] {
    return this.workerLifecycle.getForAgent(agentId);
  }

  /**
   * Check if agent has any active workers (delegates to WorkerLifecycleManager)
   */
  hasActiveWorkers(agentId: string): boolean {
    return this.workerLifecycle.hasWorkers(agentId);
  }

  /**
   * Track a message sent by an active worker (delegates to WorkerLifecycleManager)
   * Also enforces the agent completion frontier (duplicate_target guardrail).
   */
  private trackMessageSent(fromAgentId: string, toAgentId: string, messageType: string, filepath?: string): void {
    // Defensive: skip tracking if fromAgentId is missing (e.g., incomplete event payload)
    if (!fromAgentId) {
      log.debug('dispatcher', 'trackMessageSent called without fromAgentId, skipping', { toAgentId, messageType });
      return;
    }
    const [meshName, agentName] = fromAgentId.split('/');

    // =========================================================================
    // Agent Completion Frontier: duplicate_target guardrail
    // Prevents agents from sending multiple messages to the same target in a single session.
    // This prevents cascade multiplication bugs (e.g., 3× delivery observed in narrative-engine-v2).
    // =========================================================================

    // Exemptions:
    // 1. core/core — agents legitimately send HITL, status, errors, completion to core
    // 2. dispatch type messages — fan-out is intentional
    // 3. Non-existent worker — might be manual message or timing issue
    const isDuplicateTargetExempt = toAgentId === 'core/core' || messageType === 'dispatch';

    if (!isDuplicateTargetExempt && this.workerLifecycle.hasSentToTarget(fromAgentId, toAgentId)) {
      const mode = this.guardrails.getMode('duplicate_target', meshName, agentName);

      if (mode.strict) {
        // Strict mode: block delivery entirely
        log.warn('dispatcher', 'duplicate_target BLOCKED — agent already sent to this target', {
          agentId: fromAgentId,
          target: toAgentId,
          messageType,
        });
        log.activity('guardrail:duplicate-target', fromAgentId, `BLOCKED duplicate send to ${toAgentId}`);

        // Inject system feedback to tell the agent it already sent to that target
        this.emit('system-feedback', {
          agentId: fromAgentId,
          feedback: `# Duplicate Target Blocked\n\nYou have already sent a message to \`${toAgentId}\` this session. Each agent can only be messaged once per session (completion frontier rule).\n\nIf you need to send updated information, complete your current work first and let the downstream agent request more information if needed.`,
          reason: 'duplicate_target',
        });

        // Do NOT track the message — it was blocked
        return;
      } else if (mode.warning) {
        // Warning mode: allow but inject feedback
        log.warn('dispatcher', 'duplicate_target WARNING — agent already sent to this target (allowed)', {
          agentId: fromAgentId,
          target: toAgentId,
          messageType,
        });
        log.activity('guardrail:duplicate-target:warning', fromAgentId, `duplicate send to ${toAgentId} (allowed)`);

        // Inject system feedback as a warning
        this.emit('system-feedback', {
          agentId: fromAgentId,
          feedback: `# Duplicate Target Warning\n\nYou have already sent a message to \`${toAgentId}\` this session. Sending multiple messages to the same target can cause cascade multiplication. Consider if this is intentional.`,
          reason: 'duplicate_target_warning',
        });
      }
    }

    // Add target to completion frontier (even for warning mode — we track it regardless)
    if (!isDuplicateTargetExempt) {
      this.workerLifecycle.addSentTarget(fromAgentId, toAgentId);
    }

    // Track the message normally
    this.workerLifecycle.trackMessage(fromAgentId, toAgentId, messageType, filepath);

    // Chaos contract: enforce max_messages limit
    const meshConfig = this.meshConfigs.get(meshName);
    const agentConfig = meshConfig?.agents.find(a => a.name === agentName);
    const maxMessages = this.guardrails.getMaxMessages(meshName, agentName) ?? agentConfig?.max_messages ?? null;

    if (maxMessages != null) {
      const workers = this.workerLifecycle.getForAgent(fromAgentId);
      const mode = this.guardrails.getMode('max_messages', meshName, agentName);
      for (const worker of workers) {
        if (worker.messagesSent.length >= maxMessages) {
          if (!mode.strict) {
            if (mode.warning) {
              log.warn('dispatcher', 'max_messages limit reached (warning mode)', {
                agentId: fromAgentId,
                maxMessages,
                messagesSent: worker.messagesSent.length,
              });
              log.activity('guardrail:max-messages:warning', fromAgentId, `max_messages warning (${worker.messagesSent.length}/${maxMessages}, allowed)`);
            }
            // Non-strict: allow the worker to continue
            continue;
          }
          log.warn('dispatcher', 'max_messages limit reached — killing worker', {
            agentId: fromAgentId,
            maxMessages,
            messagesSent: worker.messagesSent.length,
            destinations: worker.messagesSent.map(m => m.to),
          });
          log.activity('guardrail:max-messages', fromAgentId, `max_messages STRICT KILL (${maxMessages}) — killing worker`);
          worker.runner.kill('max_messages limit reached');

          // Notify core that agent was killed due to budget exhaustion
          this.systemWriter?.write({
            to: 'core/core',
            from: fromAgentId,
            headline: `Budget kill: ${agentName} hit max_messages (${worker.messagesSent.length}/${maxMessages})`,
            body: `Agent \`${fromAgentId}\` was killed after sending ${worker.messagesSent.length} messages (limit: ${maxMessages}).\n\nDestinations: ${worker.messagesSent.map(m => m.to).join(', ')}\n\nThis agent's work was forcibly terminated. Downstream agents may not have received expected input.`,
          });
        }
      }
    }

    // Edge iteration counting: increment counter for this routing edge
    // Skip core/core — agents should always be able to ask the human
    // Skip edges that exist in the routing config — configured cycles are intentional
    if (toAgentId !== 'core/core') {
      const edgeKey = `${fromAgentId}->${toAgentId}`;
      const count = (this.edgeCounters.get(edgeKey) || 0) + 1;
      this.edgeCounters.set(edgeKey, count);

      // Check if this edge is an explicitly configured route — exempt from edge limits
      const isConfiguredEdge = this.isConfiguredRoute(meshName, agentName, toAgentId.split('/')[1]);

      // Check if this edge has hit the iteration limit (resolved via guardrail chain)
      const routingFallback = this.guardrails.getRoutingFallback(meshName);
      if (!isConfiguredEdge && routingFallback.max && routingFallback.fallback && messageType === 'message' && count >= routingFallback.max) {
        log.warn('dispatcher', 'Edge iteration limit reached', {
          edge: edgeKey,
          count,
          max: routingFallback.max,
          fallback: routingFallback.fallback,
        });

        this.emit('edge:limit-reached', {
          meshName,
          from: fromAgentId,
          to: toAgentId,
          count,
          max: routingFallback.max,
          fallback: routingFallback.fallback,
        });
      }
    }

    // Mesh-wide message counting: increment counter and check limit
    const meshCount = (this.meshMessageCounters.get(meshName) || 0) + 1;
    this.meshMessageCounters.set(meshName, meshCount);

    // Check max_mesh_messages limit
    // First check mesh config.yaml directly, then fall back to guardrails chain
    const meshMaxMessages = meshConfig?.max_mesh_messages;
    let maxMeshLimit: number | null = null;
    if (meshMaxMessages !== undefined) {
      // Direct mesh config value (number or object with limit)
      if (typeof meshMaxMessages === 'number') {
        maxMeshLimit = meshMaxMessages;
      } else if (meshMaxMessages && typeof meshMaxMessages === 'object' && 'limit' in meshMaxMessages) {
        maxMeshLimit = meshMaxMessages.limit ?? null;
      }
    }
    // Fall back to guardrails chain if not set in mesh config
    if (maxMeshLimit === null) {
      maxMeshLimit = this.guardrails.getMaxMeshMessages(meshName);
    }

    if (maxMeshLimit !== null && meshCount >= maxMeshLimit) {
      const mode = this.guardrails.getMode('max_mesh_messages', meshName);
      if (!mode.strict) {
        if (mode.warning) {
          log.warn('dispatcher', 'max_mesh_messages limit reached (warning mode)', {
            meshName,
            maxMeshMessages: maxMeshLimit,
            messagesSent: meshCount,
          });
          log.activity('guardrail:max-mesh-messages:warning', meshName, `max_mesh_messages warning (${meshCount}/${maxMeshLimit}, allowed)`);
        }
        // Non-strict: allow the mesh to continue
      } else {
        // Strict mode: kill all active workers in this mesh
        log.warn('dispatcher', 'max_mesh_messages limit reached — killing all mesh workers', {
          meshName,
          maxMeshMessages: maxMeshLimit,
          messagesSent: meshCount,
        });
        log.activity('guardrail:max-mesh-messages', meshName, `max_mesh_messages STRICT KILL (${maxMeshLimit}) — killing all workers`);

        // Kill all workers in this mesh
        const meshPrefix = `${meshName}/`;
        for (const agentId of this.workerLifecycle.getAllAgentIds()) {
          if (agentId.startsWith(meshPrefix)) {
            for (const worker of this.workerLifecycle.getForAgent(agentId)) {
              worker.runner.kill('max_mesh_messages limit reached');
            }
          }
        }
      }
    }
  }

  // ============================================================================
  // Edge Iteration Limit Helpers
  // ============================================================================

  /**
   * Reset edge counters for a mesh (called on new turn at entry point)
   */
  private resetEdgeCounters(meshName: string): void {
    const prefix = `${meshName}/`;
    for (const key of this.edgeCounters.keys()) {
      if (key.startsWith(prefix)) {
        this.edgeCounters.delete(key);
      }
    }
    // Clean up per-agent session tracking scoped to this mesh
    for (const key of this.lastCompletedSessionIds.keys()) {
      if (key.startsWith(prefix)) {
        this.lastCompletedSessionIds.delete(key);
      }
    }
    // Note: checkpoints intentionally persist across sequential mesh runs (fork_from)
    this.completedAgents.delete(meshName);
    this.cachedManifestVars.delete(meshName);
    this.meshMessageCounters.delete(meshName);
    this.workerLifecycle.resetInvocationCounters(meshName);
    log.debug('dispatcher', 'Mesh state reset for new turn', { meshName });
  }

  /**
   * Check if a message should be redirected due to edge iteration limit.
   * Uses guardrail resolution chain for routing_retry_max and routing_fallback.
   * Returns the fallback agentId if limit reached, null otherwise.
   */
  private getEdgeFallback(
    fromAgentId: string,
    toAgentId: string,
    meshName: string,
  ): string | null {
    const { max, fallback } = this.guardrails.getRoutingFallback(meshName);
    if (!max || !fallback) return null;

    // Configured routes are exempt from edge limits — cycles are intentional
    const fromAgent = fromAgentId.split('/')[1];
    const toAgent = toAgentId.split('/')[1];
    if (this.isConfiguredRoute(meshName, fromAgent, toAgent)) return null;

    const edgeKey = `${fromAgentId}->${toAgentId}`;
    const count = this.edgeCounters.get(edgeKey) || 0;

    if (count < max) return null;

    // 'core' or 'complete' fallback targets resolve to core/core, not mesh/core
    if (fallback === 'core' || fallback === 'complete') {
      return 'core/core';
    }
    return `${meshName}/${fallback}`;
  }

  /**
   * Check if fromAgent→toAgent is an explicitly configured route in the mesh routing config.
   * Configured edges represent intentional cycles and are exempt from edge limits.
   */
  private isConfiguredRoute(meshName: string, fromAgent: string, toAgent: string): boolean {
    const meshConfig = this.meshConfigs.get(meshName);
    if (!meshConfig?.routing) return false;

    const routing = meshConfig.routing as Record<string, unknown>;
    const entry = routing[fromAgent];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;

    // Branch routing: { message: { oracle: "...", simulator: "..." } }
    // Check nested values for the target agent name
    for (const value of Object.values(entry as Record<string, unknown>)) {
      if (typeof value === 'string' && value === toAgent) return true;
      if (typeof value === 'object' && value !== null && toAgent in (value as Record<string, unknown>)) return true;
    }

    return false;
  }

  // ============================================================================
  // P1 Consolidation Helpers (Phase 2.5)
  // ============================================================================

  /**
   * Get first worker for agent with warning if not found
   * Consolidates the repeated pattern of lookup + warn
   */
  private getWorkerOrWarn(agentId: string, action: string): ActiveWorker | undefined {
    const worker = this.workerLifecycle.getFirst(agentId);
    if (!worker) {
      log.warn('dispatcher', `${action} but no active worker found`, { agentId });
    }
    return worker;
  }

  /**
   * Clean up a worker instance with configurable options
   * Consolidates the repeated cleanup sequence across multiple code paths
   */
  private cleanupWorker(
    agentId: string,
    workerId: string,
    options?: {
      emitUnhalted?: boolean;
      meshName?: string;
      clearBuffer?: boolean;
      unhaltReason?: string;
    }
  ): void {
    // Remove from lifecycle manager
    this.workerLifecycle.remove(agentId, workerId);

    // Clear session buffer (default: true)
    if (options?.clearBuffer !== false) {
      this.sessionManager.clearBuffer(agentId);
    }

    // Persist state
    this.workerLifecycle.writeState();

    // Check queue for next message
    this.processNextQueuedMessage(agentId);

    // Emit mesh unhalted event if requested
    if (options?.emitUnhalted && options?.meshName) {
      this.emit('mesh:unhalted', {
        meshName: options.meshName,
        reason: options.unhaltReason || 'worker-cleanup',
      });
    }
  }

  // ============================================================================
  // Guardrail Kill Convergence
  // ============================================================================

  /**
   * Single convergence point for all guardrail kills.
   * Runs full cleanup checklist and emits unified event.
   */
  private onGuardrailKill(event: {
    agentId: string;
    meshName: string;
    workerId: string;
    guardrail: string;
    reason: string;
    source: 'sdk-hook' | 'dispatcher';
  }): void {
    // 0. Capture session context BEFORE removing the worker (needed for DLQ)
    const workerInfo = this.getWorkerByWorkerId(event.workerId);
    const sessionId = workerInfo?.worker.runner.getSessionId() || undefined;
    const msgsSent = workerInfo?.worker.messagesSent?.length || 0;

    // 1. Remove worker from lifecycle
    this.workerLifecycle.remove(event.agentId, event.workerId);
    // 2. Clear suspended session + response buffer for this agent
    this.sessionManager.clearForAgent(event.agentId);
    // 3. Clear pending permission ask (if any)
    this.pendingPermissionAsks.delete(event.agentId);
    // 4. Persist state
    this.workerLifecycle.writeState();
    // 5. Process next queued message (prevent queue stall)
    this.processNextQueuedMessage(event.agentId);
    // 6. Unified activity log
    log.activity('guardrail:kill', event.agentId, `${event.guardrail}: ${event.reason} [${event.source}]`);
    // 7. Emit for start.ts (outgoing-tasks, inject-response, www status)
    this.emit('guardrail:kill', event);
    // 8. Reliability: record failure + route to DLQ for recovery
    //    Heartbeat kills already recorded failure in ReliabilityManager — skip to avoid double-counting
    if (this.reliability) {
      const isHeartbeatKill = event.reason.startsWith('heartbeat dead:');
      const category = this.guardrailToFailureCategory(event.guardrail, event.reason);
      if (!isHeartbeatKill) {
        this.reliability.recordFailure(event.meshName, event.agentId, category,
          `${event.guardrail}: ${event.reason}`);
      }
      this.reliability.deadLetter(event.meshName, event.agentId, category,
        `${event.guardrail}: ${event.reason}`, {
          sessionId,
          messagesSent: msgsSent,
          toAgent: event.agentId,
        });
    }
  }

  /**
   * Map kill reason strings to guardrail names and source types.
   */
  private inferGuardrail(reason: string): { guardrail: string; source: 'sdk-hook' | 'dispatcher' } {
    if (reason.startsWith('Bash guard')) return { guardrail: 'bash-guard', source: 'sdk-hook' };
    if (reason.startsWith('Write gate')) return { guardrail: 'write-gate', source: 'sdk-hook' };
    if (reason.startsWith('Read gate')) return { guardrail: 'read-gate', source: 'sdk-hook' };
    if (reason.startsWith('Identity gate')) return { guardrail: 'identity-gate', source: 'sdk-hook' };
    if (reason.includes('max_messages')) return { guardrail: 'max_messages', source: 'dispatcher' };
    if (reason.includes('max_mesh_messages')) return { guardrail: 'max_mesh_messages', source: 'dispatcher' };
    if (reason.includes('max_invocations')) return { guardrail: 'max_invocations', source: 'dispatcher' };
    return { guardrail: 'unknown', source: 'dispatcher' };
  }

  /**
   * Map guardrail name to FailureCategory for SLI/DLQ tracking.
   * Single source of truth for guardrail → failure category mapping.
   */
  private guardrailToFailureCategory(guardrail: string, reason: string): import('../reliability/sli-tracker.ts').FailureCategory {
    if (reason.startsWith('heartbeat dead:')) return 'stuck';
    switch (guardrail) {
      case 'bash-guard': return 'policy_violation';
      case 'write-gate': return 'guardrail_kill';
      case 'read-gate': return 'guardrail_kill';
      case 'identity-gate': return 'policy_violation';
      case 'max_messages': return 'guardrail_kill';
      case 'max_mesh_messages': return 'guardrail_kill';
      case 'max_invocations': return 'guardrail_kill';
      default: return 'crash';
    }
  }

  /**
   * Defer worker kill until safe state to avoid SDK abort errors
   * Used for ask-human flow where the worker may still be writing the message file
   * when the ask-message event fires (race condition).
   *
   * This waits for the worker to finish its current operation before killing.
   */
  private async deferWorkerKill(
    agentId: string,
    workerId: string,
    reason: string
  ): Promise<void> {
    const workerInfo = this.getWorkerByWorkerId(workerId);
    if (!workerInfo) {
      log.debug('dispatcher', 'deferWorkerKill: worker already cleaned up', { agentId, workerId });
      return;
    }

    const { runner } = workerInfo.worker;
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Always wait a tick for SDK cleanup
    await delay(100);

    // If runner is not actively processing, kill now
    if (!runner.isRunning()) {
      log.debug('dispatcher', 'deferWorkerKill: runner idle, killing', { agentId, workerId });
      runner.kill(reason);
      this.removeActiveWorker(agentId, workerId);
      return;
    }

    log.info('dispatcher', 'deferWorkerKill: waiting for safe state', { agentId, workerId, reason });

    // Wait for safe state or timeout
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        runner.off('output', onSafe);
        runner.off('message:idle', onSafe);
        clearTimeout(timeoutId);
      };

      const onSafe = async () => {
        cleanup();
        await delay(100);  // Extra delay for file write completion
        log.info('dispatcher', 'deferWorkerKill: killing after safe state', { agentId, workerId });
        runner.kill(reason);
        this.removeActiveWorker(agentId, workerId);
        resolve();
      };

      const timeoutId = setTimeout(async () => {
        cleanup();
        log.warn('dispatcher', 'deferWorkerKill: timeout, forcing kill', { agentId, workerId });
        runner.kill(reason);
        this.removeActiveWorker(agentId, workerId);
        resolve();
      }, 5000);

      runner.once('output', onSafe);
      runner.once('message:idle', onSafe);
    });
  }

  /**
   * Wire FSM events for observability
   * Consolidates the identical event wiring in initializeSingleFSM() and initializeFSMs()
   */
  private wireFSMEvents(fsm: MeshFSM, meshName: string): void {
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

    // Handle FSM feedback - inject directly into agent instead of writing file
    fsm.on('fsm:feedback', (event: FSMFeedbackEvent) => {
      if (!event.escalated) {
        this.handleFSMFeedback(event);
      }
    });

    // FSM dispatch — for non-ensemble states, FSM writes dispatch messages directly.
    // For ensemble states, FSM skips file dispatch to avoid double-spawn; we trigger
    // the ensemble handler here from the event instead.
    fsm.on('fsm:dispatch', (event: FSMDispatchEvent) => {
      log.info('mesh-fsm', 'FSM dispatched agents for new state', {
        meshName: event.meshName,
        fromState: event.fromState,
        toState: event.toState,
        agents: event.agents,
        triggerAgent: event.triggerAgent,
      });
      this.emit('fsm:dispatch', event);

      // Check if the target state is an ensemble state — trigger ensemble directly
      // (FSM no longer writes dispatch messages for ensemble states to prevent double-spawn)
      const targetFsm = this.meshFSMs.get(event.meshName);
      if (targetFsm) {
        const stateConfig = targetFsm.getStateConfig(event.toState);
        const isEnsemble = !!(stateConfig?.ensemble?.agents || (stateConfig?.ensemble as any)?.agent);
        if (isEnsemble && stateConfig) {
          log.info('dispatcher', 'Triggering ensemble from FSM dispatch event', {
            meshName: event.meshName,
            state: event.toState,
          });
          this.handleEnsembleState(event.meshName, stateConfig, targetFsm).catch((error) => {
            log.error('dispatcher', 'Ensemble state handling failed (from dispatch event)', {
              meshName: event.meshName,
              state: event.toState,
              error: (error as Error).message,
            });
          });
        }
      }
    });
  }

  // ============================================================================
  // Session Management (delegates to SessionManager)
  // ============================================================================

  /**
   * Check if a mesh has any pending ask-human (delegates to SessionManager)
   */
  hasPendingAskHumanForMesh(meshName: string): boolean {
    return this.sessionManager.hasPendingAskHumanForMesh(meshName);
  }

  /**
   * Check if any agent in this mesh has a pending permission ask.
   */
  private hasPendingPermissionForMesh(meshName: string): boolean {
    for (const agentId of this.pendingPermissionAsks.keys()) {
      if (agentId.startsWith(`${meshName}/`)) return true;
    }
    return false;
  }

  /**
   * Get the pending permission entry for a mesh (first match).
   */
  private getPendingPermissionForMesh(meshName: string): { agentId: string; toolUseID: string; runner: Runner } | undefined {
    for (const [agentId, entry] of this.pendingPermissionAsks) {
      if (agentId.startsWith(`${meshName}/`)) {
        return { agentId, ...entry };
      }
    }
    return undefined;
  }

  /**
   * Parse human response to determine allow/deny for permission ask.
   * Looks for affirmative keywords — anything else is a denial.
   */
  private parsePermissionResponse(body: string): boolean {
    const normalized = body.trim().toLowerCase();
    const allowPatterns = [
      /^y(es)?$/,
      /^allow$/,
      /^approve$/,
      /^ok$/,
      /^go$/,
      /^do it$/,
      /^permit$/,
    ];
    return allowPatterns.some(p => p.test(normalized));
  }

  /**
   * Get suspended session info for a mesh (delegates to SessionManager)
   */
  getSuspendedSessionForMesh(meshName: string): { agentId: string; suspended: SuspendedSession } | undefined {
    return this.sessionManager.getForMesh(meshName);
  }

  /**
   * Process the next queued message for an agent after unlock
   * This enables FIFO processing of queued messages
   */
  private processNextQueuedMessage(agentId: string): void {
    // Don't process if dispatcher is stopped
    if (!this.running) return;

    // Check if there are pending messages for this agent
    const pendingCount = this.queue.countPending(agentId);
    if (pendingCount > 0) {
      log.info('dispatcher', 'Processing next queued message', {
        agentId,
        pendingCount,
      });

      // Small delay to allow state to settle, then trigger handleWorkerMessage
      setTimeout(() => {
        if (this.running && !this.workerLifecycle.hasWorkers(agentId)) {
          this.handleWorkerMessage(agentId);
        }
      }, 50);
    }
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
        // Skip agents with suspended sessions - batching logic handles resume
        const suspended = this.sessionManager.get(agentId);
        if (suspended && suspended.reason === 'await-response') {
          log.debug('dispatcher', `Skipping queued message for suspended agent (awaiting batched responses)`, {
            agentId,
            meshName,
            remainingTargets: Array.from(suspended.targetAgents),
            pendingCount: suspended.pendingResponseCount,
          });
          continue;
        }

        log.info('dispatcher', `Found queued message for mesh agent, spawning worker`, {
          agentId,
          meshName,
          from: pendingMsg.from_agent,
          type: pendingMsg.type,
        });

        // Use setTimeout to avoid blocking the current handler
        setTimeout(() => {
          // Re-check suspension state - could have changed since scheduling
          const suspendedNow = this.sessionManager.get(agentId);
          if (suspendedNow && suspendedNow.reason === 'await-response') {
            log.debug('dispatcher', `Skipping scheduled spawn for agent now suspended`, { agentId });
            return;
          }

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
    const count = this.sessionManager.restoreFromDatabase((meshName, agentName) => {
      const meshConfig = this.meshConfigs.get(meshName);
      return meshConfig?.agents.find(a => a.name === agentName);
    });

    if (count > 0) {
      log.info('dispatcher', `Restored ${count} suspended session(s) from previous run`);

      // Check for sessions that are already fully buffered (all responses arrived pre-crash)
      this.resumeFullyBufferedSessions();
    }
  }

  /**
   * Resume sessions where all responses were already buffered during crash recovery
   * Called after restoreSuspendedSessions() to handle the case where responses
   * arrived before the crash but the session never got to resume.
   */
  private resumeFullyBufferedSessions(): void {
    // Collect sessions to resume (can't modify map during iteration)
    const toResume: Array<{ agentId: string; suspended: SuspendedSession }> = [];

    for (const meshConfig of this.meshConfigs.values()) {
      const meshName = meshConfig.mesh;
      const sessions = this.sessionManager.getAllForMesh(meshName);

      for (const { agentId, suspended } of sessions) {
        if (suspended.reason === 'await-response' && suspended.pendingResponseCount === 0) {
          toResume.push({ agentId, suspended });
        }
      }
    }

    for (const { agentId, suspended } of toResume) {
      const bufferedResponses = this.sessionManager.getAndClearBufferedResponses(agentId);

      if (bufferedResponses.length === 0) {
        log.warn('dispatcher', 'Fully buffered session has no responses to resume with', { agentId });
        continue;
      }

      log.info('dispatcher', 'Resuming fully-buffered session from crash recovery', {
        agentId,
        responseCount: bufferedResponses.length,
        sessionId: suspended.sessionId.slice(0, 8),
      });

      const combinedContent = this.sessionManager.buildAskResponsePrompt(bufferedResponses);
      this.resumeSuspendedSession(agentId, suspended, combinedContent,
        `${bufferedResponses.length} Responses (crash recovery)`);
    }
  }

  /**
   * Start the dispatcher - subscribes to consumer events for worker messages
   */
  async start(consumer?: EventEmitter): Promise<void> {
    if (this.running) return;

    // Load all mesh configs (includes FSM initialization - must await)
    await this.loadMeshConfigs();

    // Restore suspended sessions from SQLite (crash recovery)
    this.restoreSuspendedSessions();

    this.running = true;
    this.emit('start');

    // Initialize queue-first writer — share consumer's registry if available
    const registry = (consumer as any)?.systemFileRegistry ?? new Set<string>();
    this.systemWriter = new SystemMessageWriter(
      this.queue,
      this.config.msgsDir,
      (event, data) => consumer?.emit(event, data) ?? this.emit(event, data),
      registry
    );

    // Initialize auto-nudge detector from config
    const nudgeConfig = this.guardrails.getNudgeConfig?.() ?? {};
    this.nudgeDetector = new NudgeDetector(this.systemWriter, this.queue, nudgeConfig);

    // Initialize reliability manager (circuit breakers, heartbeat, SLI, DLQ, safe-mode)
    this.reliability = new ReliabilityManager(this.queue.getDb(), this.config.workDir);
    this.reliability.bindDispatcher({
      killAgent: (agentId: string, reason: string) => {
        return this.workerLifecycle.killForAgent(agentId, reason);
      },
      requeueMessage: (from: string, to: string, payload: Record<string, unknown>, extraFrontmatter?: Record<string, string>) => {
        this.systemWriter.write({
          from,
          to,
          headline: (payload.headline as string) || 'DLQ recovery',
          body: (payload.body as string) || '',
          extraFrontmatter: { ...extraFrontmatter, ...Object.fromEntries(
            Object.entries(payload).filter(([k]) => !['headline', 'body'].includes(k)).map(([k, v]) => [k, String(v)])
          )},
        });
      },
    });
    this.reliability.start();

    // Recover any pending DLQ entries from previous crash
    const dlqRecovery = this.reliability.recoverAll();
    if (dlqRecovery.length > 0) {
      log.info('dispatcher', 'DLQ startup recovery', {
        attempted: dlqRecovery.length,
        succeeded: dlqRecovery.filter(r => r.success).length,
        failed: dlqRecovery.filter(r => !r.success).length,
      });
    }

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
        log.warn('dispatcher', 'DEPRECATE: ask-message consumer event fired', { from: event.from, to: event.to });
        this.handleAskMessage(event);
      };
      consumer.on('ask-message', this.boundAskMessageHandler);

      // Subscribe to ask-response events for resuming awaiting workers
      this.boundAskResponseHandler = (event: AskResponseMessageEvent) => {
        log.warn('dispatcher', 'DEPRECATE: ask-response-message consumer event fired', { from: event.from, to: event.to });
        this.handleAskResponseMessage(event);
      };
      consumer.on('ask-response-message', this.boundAskResponseHandler);

      // Blocking HITL: agent asks human but keeps session alive
      this.boundBlockingHitlHandler = (event: BlockingHitlMessageEvent) => {
        this.handleBlockingHitlMessage(event);
      };
      consumer.on('blocking-hitl-message', this.boundBlockingHitlHandler);

      // Subscribe to parity-reminder events for injecting feedback when task-complete blocked
      this.boundParityReminderHandler = (event: ParityReminderEvent) => {
        this.handleParityReminder(event);
      };
      consumer.on('parity-reminder', this.boundParityReminderHandler);

      // Subscribe to mesh-complete events for analytics summary logging
      this.boundMeshCompleteHandler = (event: MeshCompleteEvent) => {
        this.handleMeshComplete(event);
      };
      consumer.on('mesh-complete', this.boundMeshCompleteHandler);

      // Subscribe to system-feedback events for direct injection
      this.boundSystemFeedbackHandler = (event: SystemFeedbackEvent) => {
        this.handleSystemFeedback(event);
      };
      consumer.on('system-feedback', this.boundSystemFeedbackHandler);

      // Track messages sent by workers for completion enforcement
      // When a worker writes a message, track it so we can verify task-complete was sent
      this.boundCoreMessageTrackingHandler = (event: { from: string; type: string; filepath: string }) => {
        this.trackMessageSent(event.from, 'core/core', event.type, event.filepath);
      };
      consumer.on('core-message', this.boundCoreMessageTrackingHandler);

      this.boundWorkerMessageTrackingHandler = (event: { from: string; type: string; agentId: string; filepath?: string }) => {
        // agentId in worker-message is the recipient (toAgent)
        this.trackMessageSent(event.from, event.agentId, event.type, event.filepath);
      };
      consumer.on('worker-message', this.boundWorkerMessageTrackingHandler);

      // Subscribe to fan-out events for parallel group tracking
      consumer.on('fan-out', (event: {
        meshName: string;
        agents: string[];
        sourceAgent: string;
        joinAgent: string | null;
        fanIn?: 'batch' | 'queue' | 'drain';
        transform?: 'summarize';
      }) => {
        if (event.joinAgent) {
          this.registerFanOutGroup(event.meshName, event.agents, event.joinAgent, event.fanIn, event.transform);
        } else {
          log.warn('dispatcher', 'Fan-out without detectable join agent - no gate applied', {
            meshName: event.meshName,
            agents: event.agents,
            sourceAgent: event.sourceAgent,
          });
        }
      });

      // Subscribe to fan-out-complete events for tracking completions
      consumer.on('fan-out-complete', (event: { meshName: string; agentName: string; joinAgent: string }) => {
        this.trackFanOutCompletion(event.meshName, event.agentName);
      });

    }
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

    // Skip FSM validation for individual ensemble worker messages.
    // The ensemble coordinator handles exit routing separately after all workers complete.
    // Individual worker messages would fail gate checks prematurely.
    if (this.ensembleCoordinator.hasActiveEnsembleForMesh(meshName)) {
      log.debug('mesh-fsm', 'Skipping FSM validation — ensemble active for mesh', {
        meshName,
        from: senderAgentId,
        to: targetAgentId,
      });
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
   * Handle incoming worker message - spawn worker for each message
   * Allows concurrent workers for the same agentId (runtime parallelism)
   * CRITICAL: This method is async to support awaiting FSM initialization
   */
  private async handleWorkerMessage(agentId: string): Promise<void> {
    if (!this.running) return;

    // Cancel any pending nudge for this target (message arrived)
    this.nudgeDetector?.cancelTimer(agentId);

    // OAOM (One-Agent-One-Message): Check if agent already has an active worker
    // Each agent processes exactly one message at a time; subsequent messages queue
    if (this.workerLifecycle.hasWorkers(agentId)) {
      // Check if agent is awaiting a response from the sender
      const suspended = this.sessionManager.get(agentId);
      if (suspended?.targetAgents) {
        const pendingMessage = this.queue.peekOne(agentId);
        const senderAgent = pendingMessage?.from_agent;

        if (senderAgent && suspended.targetAgents.has(senderAgent)) {
          log.info('dispatcher', 'Agent-to-agent message resolves await (type-agnostic)', {
            agentId,
            from: senderAgent,
          });

          // Route through ask-response handler to resume the awaiting worker
          const message = this.queue.pollOne(agentId);
          if (message) {
            const payload = message.payload || {};
            this.handleAskResponseMessage({
              id: message.id || 0,
              filepath: message.source_file || '',
              from: senderAgent,
              to: agentId,
              content: typeof payload.body === 'string' ? payload.body : JSON.stringify(payload),
              headline: typeof payload.headline === 'string' ? payload.headline : '',
              msgId: typeof payload.msg_id === 'string' ? payload.msg_id : undefined,
              fromHumanBoundary: false,
              resumesSuspension: false,
            });
          }
          return;
        }
      }

      // Blocking HITL: worker is alive but parked waiting for human response.
      // sessionManager has no record (no suspend call), so the await check above misses it.
      // Route core/core responses through handleAskResponseMessage to resume the worker.
      if (this.workerLifecycle.isBlockingHitl(agentId)) {
        const pendingMessage = this.queue.peekOne(agentId);
        const senderAgent = pendingMessage?.from_agent;

        if (senderAgent === 'core/core') {
          log.info('dispatcher', 'Blocking HITL: routing human response to handler', {
            agentId,
            from: senderAgent,
          });

          const message = this.queue.pollOne(agentId);
          if (message) {
            const payload = message.payload || {};
            this.handleAskResponseMessage({
              id: message.id || 0,
              filepath: message.source_file || '',
              from: senderAgent,
              to: agentId,
              content: typeof payload.body === 'string' ? payload.body : JSON.stringify(payload),
              headline: typeof payload.headline === 'string' ? payload.headline : '',
              msgId: typeof payload.msg_id === 'string' ? payload.msg_id : undefined,
            });
          }
          return;
        }
      }

      // Check if this is a drain-mode join agent — inject into running worker
      const [oaomMesh, oaomAgent] = agentId.split('/');
      const drainGroup = this.getDrainFanOutGroup(oaomMesh, oaomAgent);
      if (drainGroup) {
        log.info('dispatcher', 'Drain mode: injecting into running join agent', {
          agentId,
        });
        await this.injectDrainMessage(agentId, oaomMesh);
        return;
      }

      const queueDepth = this.queue.countPending(agentId);
      log.info('dispatcher', 'Agent busy, message remains queued (OAOM)', {
        agentId,
        queueDepth,
      });
      this.emit('agent:queued', { agentId, queueDepth });
      return; // Message stays in queue, will process when worker completes
    }

    log.debug('dispatcher', `Worker message received`, {
      agentId,
    });

    // Parse mesh/agent from agentId
    const [meshName, agentName] = agentId.split('/');
    if (!meshName || !agentName) {
      log.error('dispatcher', `Invalid agentId format`, { agentId });
      return;
    }

    // DYNAPROMPT: Check if this is a system/dynaprompt message for fragment injection
    const pendingMsg = this.queue.peekOne(agentId);
    if (pendingMsg?.from_agent === 'system/dynaprompt') {
      // Dynamic prompt injection — resume active session with fragment content
      const activeWorker = this.workerLifecycle.getWorker(agentId);
      if (activeWorker?.runner && activeWorker.sessionId) {
        const message = this.queue.pollOne(agentId);
        if (message) {
          const payload = message.payload || {};
          const fragmentContent = typeof payload.body === 'string' ? payload.body : '';
          const fragmentName = typeof payload.headline === 'string' ? payload.headline : undefined;

          log.info('dispatcher', 'Injecting dynaprompt fragment into active session', {
            agentId,
            sessionId: activeWorker.sessionId,
            fragmentName,
          });

          await this.resumeSession({
            reason: 'system-feedback',
            agentId,
            sessionId: activeWorker.sessionId,
            prompt: fragmentContent,
            runner: activeWorker.runner,
            metadata: { source: 'dynaprompt', fragment: fragmentName },
          });

          this.queue.markDelivered(message.id || 0);
        }
      } else {
        log.warn('dispatcher', 'Dynaprompt received but no active session', { agentId });
      }
      return;
    }

    // PERMISSION ASK: Check if any agent in this mesh has a pending permission ask.
    // The worker is still alive (blocked in canUseTool callback), waiting for human decision.
    // Route core/core responses to resolve the permission, then un-halt the mesh.
    if (this.hasPendingPermissionForMesh(meshName)) {
      const peeked = this.queue.peekOne(agentId);
      if (peeked && peeked.from_agent === 'core/core') {
        const pendingEntry = this.getPendingPermissionForMesh(meshName);
        if (pendingEntry) {
          const message = this.queue.pollOne(agentId);
          if (message) {
            const payload = message.payload || {};
            const responseBody = typeof payload.body === 'string' ? payload.body : JSON.stringify(payload);
            const allow = this.parsePermissionResponse(responseBody);

            log.info('dispatcher', `Human permission response — ${allow ? 'ALLOW' : 'DENY'}`, {
              meshName,
              agentId: pendingEntry.agentId,
              toolUseID: pendingEntry.toolUseID,
              responseBody: responseBody.slice(0, 200),
            });

            // Resolve the callback (unblocks the SDK process)
            pendingEntry.runner.resolvePermission(pendingEntry.toolUseID, allow, allow ? undefined : responseBody);

            // Clear halt state
            this.pendingPermissionAsks.delete(pendingEntry.agentId);
            this.clearHaltedFile(meshName);

            // Process any queued messages now that mesh is un-halted
            this.processQueuedMeshMessages(meshName);
            return;
          }
        }
      }

      // No core/core response yet — keep halted
      log.debug('dispatcher', 'Mesh halted for permission ask, message queued', {
        agentId,
        meshName,
      });
      this.emit('mesh:halted-message', {
        agentId,
        meshName,
        reason: 'pending-permission-ask',
      });
      return;
    }

    // MESH HALT: Check if mesh has pending ask-human
    // When ask-human is pending, the entire mesh is halted - no new workers spawn.
    // Messages remain queued and will be processed after human responds.
    if (this.hasPendingAskHumanForMesh(meshName)) {
      // Auto-resume: if the message is FROM core/core, treat it as a human response
      // This handles the case where human responds to wrong agent or via core directly
      const peeked = this.queue.peekOne(agentId);
      if (peeked && peeked.from_agent === 'core/core') {
        const suspendedInfo = this.getSuspendedSessionForMesh(meshName);
        if (suspendedInfo) {
          log.info('dispatcher', `Human response to halted mesh — auto-routing to suspended agent`, {
            meshName,
            targetAgent: agentId,
            suspendedAgent: suspendedInfo.agentId,
          });

          // Consume the misdirected message
          const message = this.queue.pollOne(agentId);
          if (message) {
            const payload = message.payload || {};
            // Clear halted state — mesh is resuming
            this.clearHaltedFile(meshName);
            // Route as ask-response to the actual suspended agent
            this.handleAskResponseMessage({
              id: message.id || 0,
              filepath: message.source_file || '',
              from: 'core/core',
              to: suspendedInfo.agentId,
              content: typeof payload.body === 'string' ? payload.body : JSON.stringify(payload),
              headline: typeof payload.headline === 'string' ? payload.headline : '',
              msgId: typeof payload.msg_id === 'string' ? payload.msg_id : undefined,
            });
            return;
          }
        }
      }

      const suspendedInfo = this.getSuspendedSessionForMesh(meshName);
      log.debug('dispatcher', `Mesh halted, message queued`, {
        agentId,
        meshName,
        suspendedAgent: suspendedInfo?.agentId,
      });

      // Write halted state for hook visibility
      if (suspendedInfo) {
        const pendingCount = this.queue.countPending(agentId);
        this.writeHaltedFile(meshName, suspendedInfo.agentId.split('/')[1] || suspendedInfo.agentId, pendingCount);
      }

      this.emit('mesh:halted-message', {
        agentId,
        meshName,
        reason: 'pending-ask-human',
        suspendedAgent: suspendedInfo?.agentId,
      });
      return;
    }

    // Get sender from the pending message for routing error feedback
    const pendingMessage = this.queue.peekOne(agentId);
    const senderAgentId = pendingMessage?.from_agent;

    let meshConfig = this.meshConfigs.get(meshName);
    if (!meshConfig) {
      // Try JIT loading before failing
      log.info('dispatcher', 'Mesh not loaded, attempting JIT load', { meshName, agentId });
      const loaded = await this.tryLoadMeshOnDemand(meshName);
      if (!loaded) {
        // Check if this is a parallel instance — use base-mesh from payload
        const baseMesh = pendingMessage?.payload?.['base-mesh'] as string | undefined;
        if (baseMesh) {
          log.info('dispatcher', 'Resolved parallel instance to base mesh', { meshName, baseMesh, agentId });
          // Ensure base mesh config is loaded
          if (!this.meshConfigs.has(baseMesh)) {
            await this.tryLoadMeshOnDemand(baseMesh);
          }
          meshConfig = this.meshConfigs.get(baseMesh);
          if (meshConfig) {
            // Cache the config under the instance name so future lookups are instant
            this.meshConfigs.set(meshName, meshConfig);
          }
        }

        if (!meshConfig) {
          log.error('dispatcher', 'Mesh not found (JIT load failed)', { meshName, agentId });
          // Inject routing correction back to sender (if we know who sent it)
          if (senderAgentId && senderAgentId !== 'core/core') {
            this.handleRoutingError(senderAgentId, agentId, meshName, 'mesh-not-found');
          }
          return;
        }
      } else {
        meshConfig = this.meshConfigs.get(meshName);
        if (!meshConfig) {
          log.error('dispatcher', 'Mesh loaded but config missing', { meshName, agentId });
          if (senderAgentId && senderAgentId !== 'core/core') {
            this.handleRoutingError(senderAgentId, agentId, meshName, 'mesh-not-found');
          }
          return;
        }
      }
    }

    // DLQ RECOVERY: recover front-matter triggers DLQ recovery for this mesh
    // Core agent or CLI can send: `recover: true` to trigger auto-recovery
    if (pendingMessage?.payload?.['recover'] === true || pendingMessage?.payload?.['recover'] === 'true') {
      if (this.reliability) {
        // rewind-to: <state> overrides DLQ session with checkpoint session
        const rewindTo = pendingMessage?.payload?.['rewind-to'] as string | undefined;
        const results = this.reliability.recoverForMesh(meshName, rewindTo || undefined);
        const succeeded = results.filter(r => r.success).length;
        log.info('dispatcher', 'DLQ recovery triggered by front-matter', {
          meshName, attempted: results.length, succeeded,
          rewindTo: rewindTo || null,
        });

        // Consume the recover message — its purpose is fulfilled
        this.queue.pollOne(agentId);

        // If entries were recovered, they'll flow through as new messages
        if (results.length > 0) return;
      }
    }

    // NEW MESH RUN: Clear stale state when task arrives at entry point
    // This handles crashed/abandoned meshes that never sent task-complete to core
    const entryPoint = meshConfig.entry_point || 'worker';
    if (agentName === entryPoint) {
      // Check for resume-mesh flag in frontmatter (allows resuming crashed mesh)
      const pendingMsg = this.queue.peekOne(agentId);
      const resumeMesh = pendingMsg?.payload?.['resume-mesh'] === true ||
                         pendingMsg?.payload?.['resume-mesh'] === 'true';

      // Check if this is an FSM internal dispatch (not a new mesh run from outside)
      // FSM dispatches come from 'system/fsm-dispatch' and should NOT reset the FSM
      const isFsmDispatch = pendingMsg?.from_agent === 'system/fsm-dispatch';

      // Reset edge iteration counters only for truly new external runs
      if (!isFsmDispatch) {
        this.resetEdgeCounters(meshName);
      }

      if (resumeMesh || isFsmDispatch) {
        // FSM dispatch: the FSM is already tracking state, just proceed with spawn
        if (isFsmDispatch) {
          log.debug('dispatcher', `FSM internal dispatch, preserving FSM state`, {
            meshName,
            agentId,
            currentFsmState: this.meshFSMs.get(meshName)?.getCurrentState(),
          });
        } else {
          log.info('dispatcher', `Resuming mesh (resume-mesh flag set)`, {
            meshName,
            agentId,
            hasSuspendedSessions: this.sessionManager.getSuspendedCount() > 0,
          });
        }
      } else {
        // Clear any stale state from previous incomplete run
        const hadState = this.sessionManager.getSuspendedCount() > 0 ||
                        this.sessionManager.getBufferedResponseCount(agentId) > 0 ||
                        this.meshFSMs.has(meshName);
        if (hadState) {
          // Save the current message before clearing — clearMeshState purges
          // all pending messages, but this message triggered the new run
          const savedMsg = this.queue.pollOne(agentId);

          log.info('dispatcher', `New mesh run at entry point, clearing stale state`, {
            meshName,
            agentId,
          });
          this.clearMeshState(meshName);

          // Re-insert the current message so the worker can poll it
          if (savedMsg) {
            this.queue.insert({
              from_agent: savedMsg.from_agent,
              to_agent: savedMsg.to_agent || agentId,
              type: savedMsg.type,
              payload: savedMsg.payload || {},
              source_file: savedMsg.source_file,
            });
          }
        }

        // Always (re-)initialize FSM for entry point runs — previous completion
        // may have deleted the FSM instance via clearMeshState
        // CRITICAL: Must await to ensure FSM state is persisted before checking isInitialized()
        if (meshConfig.fsm) {
          await this.initializeSingleFSM(meshName, meshConfig);
        }
      }

      // Free routing fan-out: no entry_point → spawn all agents with the trigger message
      if (meshConfig.routing_mode === 'free' && !meshConfig.entry_point) {
        const pendingMsg = this.queue.peekOne(agentId);
        const body = pendingMsg?.payload?.body || pendingMsg?.payload?.headline || '';

        // Fan-out: write task files for all agents except the first (who gets the original message)
        const allAgents = meshConfig.agents.map(a => a.name);
        for (let i = 1; i < allAgents.length; i++) {
          const targetAgentId = `${meshName}/${allAgents[i]}`;
          this.systemWriter.write({
            to: targetAgentId,
            from: 'system/fan-out',
            headline: `Free mode fan-out from ${pendingMsg?.from_agent || 'core/core'}`,
            body: String(body),
          });
        }
        log.info('dispatcher', 'Free mode fan-out: spawning all agents', {
          meshName,
          agents: allAgents,
        });
        // First agent proceeds with normal spawn below
      }

      // Manifest routing: resolve and spawn eligible agents instead of normal flow
      if (meshConfig.routing_mode === 'manifest' && meshConfig.manifest) {
        // Reset writtenFiles for new mesh run (unless resuming)
        if (!resumeMesh && !isFsmDispatch) {
          this.writtenFiles.set(meshName, new Set());
        }

        // Consume the trigger message — resolver handles spawning directly
        this.queue.pollOne(agentId);

        this.resolveAndSpawnManifestAgents(meshName, meshConfig);
        return; // Manifest mode handles its own spawning
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
      // Only route to ensemble handler if the message is for an agent IN the ensemble state
      // (coordinator or ensemble agent). Messages for other agents (e.g., scorer after runner
      // writes its output) should be processed normally, not hijacked by ensemble handler.
      const ensembleAgentName = currentState?.ensemble?.agent || currentState?.coordinator;
      const isForEnsembleAgent = ensembleAgentName === agentName;
      if ((isLegacyEnsemble || isNewEnsemble) && isForEnsembleAgent) {
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
      // Inject routing correction back to sender (if we know who sent it)
      if (senderAgentId && senderAgentId !== 'core/core') {
        this.handleRoutingError(senderAgentId, agentId, meshName, 'agent-not-found');
      }
      return;
    }

    // Edge iteration limit: redirect to fallback if edge is exhausted
    if (senderAgentId && senderAgentId !== 'core/core') {
      const fallbackAgentId = this.getEdgeFallback(senderAgentId, agentId, meshName);
      if (fallbackAgentId) {
        const edgeMode = this.guardrails.getMode('routing_error', meshName);
        const { max: edgeMax } = this.guardrails.getRoutingFallback(meshName);
        if (!edgeMode.strict) {
          // Non-strict: log and allow the message through
          if (edgeMode.warning) {
            log.warn('dispatcher', 'Edge limit reached (warning mode, allowing)', {
              originalTarget: agentId,
              fallback: fallbackAgentId,
              sender: senderAgentId,
            });
            log.activity('guardrail:routing-error:edge-limit:warning', agentId, `Edge limit warning (${edgeMax}) on ${senderAgentId}→${agentId} (allowed)`);
          }
          // Fall through to normal dispatch
        } else {
          const edgeKey = `${senderAgentId}->${agentId}`;
          const edgeCount = this.edgeCounters.get(edgeKey) || 0;
          log.info('dispatcher', 'Edge limit reached, redirecting to fallback', {
            originalTarget: agentId,
            fallback: fallbackAgentId,
            sender: senderAgentId,
            edgeCount,
            edgeMax,
          });
          log.activity('guardrail:routing-error:edge-limit', agentId, `Edge ${senderAgentId}→${agentId} hit limit (${edgeCount}/${edgeMax}), redirecting → ${fallbackAgentId}`);

          // Consume the message from the original target's queue
          const msg = this.queue.pollOne(agentId);
          if (msg) {
            // Re-insert to the fallback agent with a system note
            const systemNote = `[System: Edge ${senderAgentId}→${agentId} reached iteration limit (${edgeCount}/${edgeMax}). Redirected to ${fallbackAgentId}.]`;
            const body = msg.payload?.body ? `${systemNote}\n\n${msg.payload.body}` : systemNote;
            this.queue.insert({
              from_agent: msg.from_agent,
              to_agent: fallbackAgentId,
              type: msg.type,
              payload: { ...msg.payload, body },
            });
          }
          // Trigger dispatch for the fallback agent
          this.handleWorkerMessage(fallbackAgentId);
          return;
        }
      }
    }

    // Pre-dispatch artifact preflight: check target agent's manifest reads exist
    if (meshConfig.manifest) {
      const enforcement = meshConfig.manifest_enforcement;
      const preValidation = enforcement?.pre_validation !== false; // default: true

      if (preValidation) {
        const cachedVars = meshName ? this.cachedManifestVars.get(meshName) : undefined;
        const ctx = buildPathContext(this.config.workDir, meshConfig as any, cachedVars);
        const completedWriters = meshName ? Array.from(this.completedAgents.get(meshName) || []) : undefined;
        const result = validateAgentArtifacts(agent.name, meshConfig.manifest, 'reads', ctx, { completedWriters });

        if (result.missing.length > 0 || result.empty.length > 0) {
          const problems = [...result.missing.map(f => `${f} (missing)`), ...result.empty.map(f => `${f} (empty)`)];
          const writerAgents = [...new Set(problems.flatMap(p => {
            const fileId = p.split(' (')[0];
            return findWriters(fileId, meshConfig.manifest!);
          }))];

          const manifestMode = { strict: meshConfig.manifest_enforcement?.strict ?? false, warning: meshConfig.manifest_enforcement?.warning ?? true };
          if (!manifestMode.strict) {
            // Non-strict: allow dispatch, optionally warn
            if (manifestMode.warning) {
              log.warn('dispatcher', 'Pre-dispatch preflight failed (warning mode, allowing)', {
                agentId,
                problems,
                writerAgents,
              });
              log.activity('guardrail:preflight:warning', agentId, `Preflight warning: ${problems.join(', ')} (missing inputs, allowed)`);
            }
            // Fall through to normal dispatch
          } else {
            log.error('dispatcher', 'Pre-dispatch preflight failed: missing required inputs', {
              agentId,
              problems,
              writerAgents,
              sender: senderAgentId,
            });
            log.activity('guardrail:preflight', agentId, `Preflight STRICT BLOCKED: ${problems.join(', ')} — writers: ${writerAgents.join(', ')}`);

            this.emit('worker:preflight-failed', {
              agentId,
              missing: result.missing,
              empty: result.empty,
              writerAgents,
            });

            // Route error back to the sending coordinator
            if (senderAgentId && senderAgentId !== 'core/core') {
              const errorContent = `## Pre-Dispatch Preflight Failed\n\nCannot dispatch to **${agentId}**: missing required input files.\n\n**Missing:** ${problems.join(', ')}\n**Expected writers:** ${writerAgents.join(', ')}\n\nEnsure upstream agents write their required outputs before routing here.`;
              this.queue.insert({
                from_agent: agentId,
                to_agent: senderAgentId,
                type: 'message',
                payload: { headline: 'preflight-failed', body: errorContent },
              });
              // Consume the failed message
              this.queue.pollOne(agentId);
              this.handleWorkerMessage(senderAgentId);
              return;
            }
            // No sender to report to — proceed anyway (best effort)
          }
        }
      }
    }

    // Fan-out re-engagement: if a completed fan-out agent receives a peer message,
    // remove from completed set so it must re-complete before join ungates
    this.handleFanOutReEngagement(meshName, agentName);

    log.info('dispatcher', `Spawning worker for message`, { agentId });
    this.spawnWorker(meshName, agent);
  }

  /**
   * Handle message revision based on mode:
   * - interrupt: Hot inject via SDK (only if worker active, else treat as normal)
   * - append: Queue message (add to context)
   * - replace: Queue with "discard previous" preamble
   * Note: With parallelism, revisions affect the first worker for the agent
   */
  private async handleRevisionMessage(event: RevisionMessageEvent): Promise<void> {
    const { agentId, content, headline, mode = 'interrupt' } = event;

    const activeWorker = this.getFirstWorkerForAgent(agentId);
    const sessionId = activeWorker?.runner.getSessionId();
    const hasActiveWorker = !!activeWorker && !!sessionId;

    log.info('dispatcher', `Handling revision`, {
      agentId,
      mode,
      hasActiveWorker,
      sessionId: sessionId?.slice(0, 8),
      headline,
      contentLength: content.length,
    });

    // interrupt mode: hot inject if worker active, else queue as append
    if (mode === 'interrupt') {
      if (!hasActiveWorker) {
        log.warn('dispatcher', `Revision interrupt with no active worker - message may need manual queue`, { agentId });
        return;
      }

      // Hot inject into running worker
      if (activeWorker.runner.isRunning()) {
        activeWorker.runner.kill('revision: hot inject');
      }

      await this.resumeSession({
        reason: 'revision',
        agentId,
        sessionId: sessionId!,
        prompt: this.buildAppendPrompt(content, headline),
        runner: activeWorker.runner,
        interrupt: false,
        metadata: { headline, mode: 'interrupt' },
      });
      return;
    }

    // append mode: queue normally (handled by consumer as new message)
    if (mode === 'append') {
      if (hasActiveWorker && activeWorker.runner.isRunning()) {
        activeWorker.runner.kill('revision: append queued');
      }
      if (hasActiveWorker) {
        await this.resumeSession({
          reason: 'revision',
          agentId,
          sessionId: sessionId!,
          prompt: this.buildAppendPrompt(content, headline),
          runner: activeWorker.runner,
          interrupt: false,
          metadata: { headline, mode: 'append' },
        });
      }
      // If no active worker, consumer already queued the message
      return;
    }

    // replace mode: discard previous work
    if (mode === 'replace') {
      if (!hasActiveWorker) {
        log.warn('dispatcher', `Replace revision but no active worker`, { agentId });
        return;
      }

      if (activeWorker.runner.isRunning()) {
        activeWorker.runner.kill('revision: replace');
      }

      await this.resumeSession({
        reason: 'revision',
        agentId,
        sessionId: sessionId!,
        prompt: this.buildReplacePrompt(content, headline),
        runner: activeWorker.runner,
        interrupt: false,
        metadata: { headline, mode: 'replace' },
      });
    }
  }

  /**
   * Build prompt for append mode - add to context without discarding
   */
  private buildAppendPrompt(content: string, headline?: string): string {
    const parts: string[] = [];
    parts.push('## Human Follow-up\n');
    parts.push('The human added to their request while you were working:\n');
    if (headline) {
      parts.push(`**Subject**: ${headline}\n`);
    }
    parts.push('---\n');
    parts.push(content);
    parts.push('\n---');
    parts.push('\n**Action**: Incorporate this additional context into your current work.');
    return parts.join('\n');
  }

  /**
   * Build prompt for replace mode - discard previous work
   */
  private buildReplacePrompt(content: string, headline?: string): string {
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
      // Halt mesh when message crosses human boundary
      const crossesHumanBoundary = targetAgentId === 'core/core' && messageType !== 'task-complete';
      if (messageType === 'ask-human' || (messageType === 'message' && crossesHumanBoundary)) {
        if (messageType === 'ask-human') {
          log.warn('dispatcher', `DEPRECATED ASK: type 'ask-human' is deprecated, use 'message' to core/core`, {
            from: senderAgentId,
            to: targetAgentId,
          });
        }
        log.info('dispatcher', `ask-human: halting mesh for human response`, {
          from: senderAgentId,
          to: targetAgentId,
        });

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

        // Get pending ask-humans count for this agent
        const pendingAsks = this.queue.getPendingAsks(senderAgentId);
        const pendingAskHumans = pendingAsks.filter(a => a.to_agent === 'core/core');
        const pendingCount = pendingAskHumans.length;

        // Store session for later resume (via SessionManager)
        this.sessionManager.suspend(senderAgentId, {
          sessionId,
          reason: 'ask-human',
          meshName,
          agentConfig,
          targetAgents: [targetAgentId],
          pendingCount,
        });

        // Always persist sessionId for HITL, independent of continuation setting.
        // HITL resumption requires the original session context — without this,
        // the human's response would be delivered to a fresh worker with no memory
        // of what it asked.
        if (sessionId) {
          this.queue.setConversationId(senderAgentId, sessionId);
          log.info('dispatcher', `Session saved for HITL resume: ${senderAgentId}`, {
            sessionId: sessionId.slice(0, 8) + '...',
          });
        }

        // Defer worker kill to avoid race condition with SDK message processing
        // The worker may still be writing the ask-human message file when this event fires
        await this.deferWorkerKill(senderAgentId, workerId, 'ask-human: mesh halted for human response');

        this.emit('worker:suspended', {
          agentId: senderAgentId,
          workerId,
          sessionId,
          reason: 'ask-human',
          pendingResponseCount: pendingCount,
          targetAgents: [targetAgentId],
        });

        log.info('dispatcher', `Mesh halted - worker killed and suspended`, {
          from: senderAgentId,
          workerId,
          sessionId: sessionId.slice(0, 8),
          pendingResponseCount: pendingCount,
        });

        return; // Done - mesh is halted
      }

      if (currentStatus === 'awaiting') {
        // Already awaiting, add this target to the set
        log.info('dispatcher', `Adding await target`, {
          from: senderAgentId,
          to: targetAgentId,
          existingTargets: Array.from(machine.getAwaitingResponses()),
        });
        await machine.addAwaitTarget(targetAgentId);

        // Update queue await state with new target
        const existingState = this.queue.getAwaitState(senderAgentId);
        if (existingState) {
          const currentTargets = JSON.parse(existingState.target_agents);
          if (!currentTargets.includes(targetAgentId)) {
            currentTargets.push(targetAgentId);
            this.queue.setAwaiting(senderAgentId, sessionId, currentTargets);
          }
        }
      } else if (currentStatus === 'running' || currentStatus === 'idle') {
        // Enter awaiting state
        log.debug('dispatcher', `Worker entering await state`, {
          from: senderAgentId,
          to: targetAgentId,
          type: messageType,
          sessionId: sessionId.slice(0, 8),
        });
        await machine.enterAwait(targetAgentId, sessionId);

        // Set await state in queue for persistence
        this.queue.setAwaiting(senderAgentId, sessionId, [targetAgentId]);

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
        // Note: ask-human is handled above with early return (kills worker, halts mesh)
      } else {
        log.warn('dispatcher', `Cannot await from current state`, {
          from: senderAgentId,
          to: targetAgentId,
          currentStatus,
        });
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
   * Handle blocking HITL message — agent asks human but keeps session alive.
   *
   * Unlike ask-human (which kills the worker and suspends), blocking HITL:
   * - Flags the worker so the complete handler skips downstream routing
   * - Lets the worker finish its current turn naturally
   * - Pauses heartbeat monitoring (worker will be idle)
   * - On human response, resumes the same runner with the response
   *
   * This prevents the race condition where downstream agents fire before
   * the asking agent finishes its post-HITL work.
   */
  private handleBlockingHitlMessage(event: BlockingHitlMessageEvent): void {
    const { from: senderAgentId, to: targetAgentId } = event;

    const activeWorker = this.getFirstWorkerForAgent(senderAgentId);
    if (!activeWorker) {
      log.warn('dispatcher', 'Blocking HITL but no active worker — falling back to ask-message', {
        from: senderAgentId,
        to: targetAgentId,
      });
      // Fallback: treat as normal ask-human (fire the standard handler)
      this.handleAskMessage({
        ...event,
        crossesHumanBoundary: true,
        isTerminal: true,
      });
      return;
    }

    const sessionId = activeWorker.runner.getSessionId();
    if (!sessionId) {
      log.warn('dispatcher', 'Blocking HITL but no session ID — falling back to ask-message', {
        from: senderAgentId,
      });
      this.handleAskMessage({
        ...event,
        crossesHumanBoundary: true,
        isTerminal: true,
      });
      return;
    }

    // Flag the worker — complete handler will hold instead of routing
    this.workerLifecycle.setBlockingHitl(senderAgentId);

    // Persist sessionId for crash recovery (same as ask-human)
    this.queue.setConversationId(senderAgentId, sessionId);

    // Pause heartbeat monitoring — worker will be idle while awaiting response
    this.reliability?.unregisterAgent(senderAgentId);

    log.info('dispatcher', 'Blocking HITL: worker flagged, awaiting human response', {
      from: senderAgentId,
      to: targetAgentId,
      sessionId: sessionId.slice(0, 8),
    });

    this.emit('worker:blocking-hitl', {
      agentId: senderAgentId,
      sessionId,
      targetAgent: targetAgentId,
    });
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
      // Remove from suspended (via SessionManager - handles both in-memory and SQLite)
      this.sessionManager.markResumed(agentId);

      // Build routing reminder so agent remembers its next steps after HITL suspension
      const meshConfig = this.meshConfigs.get(meshName);
      const routingReminder = this.buildRoutingReminder(meshName, agentConfig.name, meshConfig);

      // Build the resume prompt with human response + routing context
      const resumePrompt = this.sessionManager.buildHumanResponsePrompt(responseContent, headline, routingReminder);

      // Create new runner config (minimal - session has system prompt)
      const runnerConfig: SdkRunnerConfig = {
        id: agentId,
        model: agentConfig.model,
        systemPrompt: '',  // Not needed for resume - session has it
        workDir: this.config.workDir,
        msgsDir: this.config.msgsDir,
        sessionId,  // Resume existing session
        permissions: agentConfig.permissions,  // Tool access control from mesh config
        godMode: this.config.godMode,  // God mode from CLI flag
        systemWriter: this.systemWriter,  // Permission denial notifications to core
        env: this.buildAgentEnv(),  // Environment variables for agent shell
      };

      // Chrome agents are fire-and-forget — cannot resume sessions
      if (agentConfig.chrome) {
        log.warn('dispatcher', 'Cannot resume chrome agent — fire-and-forget', { agentId });
        return;
      }

      const runner = new SdkRunner(runnerConfig, this.queue);

      // Create a new FSM for the resumed worker (meshConfig already fetched above for routing reminder)
      const isCompletionAgent = this.normalizeCompletionAgents(meshConfig).includes(agentConfig.name);
      const workerConfig: WorkerConfig = {
        id: agentId,
        model: agentConfig.model,
        prompt: agentConfig.prompt || '',
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
        systemWriter: this.systemWriter,
      };

      // Store in active workers and get the generated workerId
      // For resumed sessions (ask-human response), the task effectively comes from core/core
      const workerId = this.addActiveWorker(agentId, {
        runner,
        machine,
        startedAt: Date.now(),
        hookContext,
      }, 'core/core');

      // Set up minimal event handlers
      runner.on('complete', async (data) => {
        log.info('dispatcher', `Resumed worker completed`, {
          agentId,
          workerId,
          sessionId: sessionId.slice(0, 8),
        });

        // Track last completed session for routing self-heal
        if (data.sessionId) {
          this.lastCompletedSessionIds.set(agentId, data.sessionId);
        }

        this.removeActiveWorker(agentId, workerId);

        // Check if resumed worker exited while awaiting responses (same as normal handler)
        // This handles the case where the resumed worker sent messages during its session
        const currentStatus = machine.getStatus();
        const pendingOutgoingAsks = this.queue.getPendingAsks(agentId);
        const hasPendingAsks = pendingOutgoingAsks.length > 0;

        if (currentStatus === 'awaiting' || hasPendingAsks) {
          if (data.sessionId) {
            const fsmAwaitingResponses = machine.getAwaitingResponses();
            const sqliteTargets = pendingOutgoingAsks.map(a => a.to_agent);
            const allTargets = new Set([...fsmAwaitingResponses, ...sqliteTargets]);
            const pendingCount = Math.max(fsmAwaitingResponses.size, pendingOutgoingAsks.length);

            log.info('dispatcher', `Resumed worker exited while awaiting - re-suspending`, {
              agentId,
              workerId,
              sessionId: data.sessionId.slice(0, 8),
              targets: Array.from(allTargets),
            });

            this.sessionManager.suspend(agentId, {
              sessionId: data.sessionId,
              reason: 'await-response',
              meshName,
              agentConfig,
              targetAgents: Array.from(allTargets),
              pendingCount,
            });

            this.writeWorkerState();
            // Don't complete FSM or drain queue - wait for responses
            // But DO un-halt the mesh so other agents can process
            this.emit('mesh:unhalted', { meshName, reason: 'ask-human-resolved-await-pending' });
            this.processQueuedMeshMessages(meshName);
            return;
          }
        }

        try {
          await machine.complete(data);
        } catch (completeError) {
          log.warn('dispatcher', `Resumed worker machine.complete failed`, {
            agentId,
            workerId,
            error: (completeError as Error).message,
          });
        }

        this.emit('worker:complete', {
          ...data,
          transitionName: 'complete',
        });
        this.writeWorkerState();

        // OAOM: Check queue for next message
        this.processNextQueuedMessage(agentId);

        // MESH UN-HALT: Process any messages that were queued while mesh was halted
        // This runs after the resumed worker completes, checking all agents in the mesh
        this.emit('mesh:unhalted', { meshName, reason: 'ask-human-resolved' });
        this.processQueuedMeshMessages(meshName);
      });

      runner.on('error', (data) => {
        // Suppress error handling for workers killed intentionally (ask-human / ask-agent suspend)
        if (this.sessionManager.isSuspended(agentId)) {
          log.info('dispatcher', 'Suppressing error for suspended worker', {
            agentId, workerId,
          });
          this.removeActiveWorker(agentId, workerId);
          this.writeWorkerState();
          return;
        }

        // Guardrail kill convergence — unified cleanup path
        if (runner.wasGuardrailKill()) {
          const { guardrail, source } = this.inferGuardrail(runner.getKillReason()!);
          this.onGuardrailKill({
            agentId, meshName, workerId,
            guardrail, reason: runner.getKillReason()!, source,
          });
          this.emit('worker:error', { ...data, id: agentId, guardrailKill: true });
          return;
        }

        // Check if recovery will handle this (queued work exists)
        const hasQueuedWork = this.queue.countPending(agentId) > 0;
        const errorMsg = data?.error || String(data);
        const isAbortError = errorMsg.includes('aborted by user') ||
                            errorMsg.includes('process aborted');

        if (isAbortError && hasQueuedWork) {
          // Recovery will spawn new worker - not an error
          log.debug('dispatcher', 'Resume interrupted, recovery will handle', {
            agentId,
            workerId,
            queuedMessages: hasQueuedWork,
          });
        } else {
          log.error('dispatcher', `Resumed worker error`, {
            agentId,
            workerId,
            error: data.error,
          });
        }

        this.removeActiveWorker(agentId, workerId);
        this.emit('worker:error', { ...data, id: agentId });
        this.writeWorkerState();

        // OAOM: Check queue for next message on error too
        this.processNextQueuedMessage(agentId);

        // Even on error, the mesh is now un-halted - process queued messages
        this.emit('mesh:unhalted', { meshName, reason: 'ask-human-resolved-with-error' });
        this.processQueuedMeshMessages(meshName);
      });

      // Permission ask handler for resumed sessions
      runner.on('permission-ask', (data: { id: string; toolName: string; toolUseID: string }) => {
        log.info('dispatcher', 'Permission ask on resumed session', {
          agentId: data.id, toolName: data.toolName, meshName,
        });
        this.pendingPermissionAsks.set(data.id, { toolUseID: data.toolUseID, runner });
        if (meshName) {
          const pendingCount = this.queue.countPending(data.id);
          this.writeHaltedFile(meshName, agentConfig.name, pendingCount);
        }
        this.emit('worker:permission-ask', {
          agentId: data.id, toolName: data.toolName, meshName,
        });
      });

      // Initialize and start the FSM (use process.pid as the runner pid)
      await machine.initialize();
      await machine.start(process.pid);

      this.emit('worker:resumed', {
        agentId,
        sessionId,
        suspendedFor: Date.now() - suspended.suspendedAt,
      });

      // Resume the session with human response
      const result = await runner.resume(sessionId, resumePrompt);

      if (!result.success) {
        // Check if recovery will handle this (queued work exists)
        const hasQueuedWork = this.queue.countPending(agentId) > 0;
        const isAbortError = result.error?.includes('aborted by user') ||
                            result.error?.includes('process aborted');

        if (isAbortError && hasQueuedWork) {
          // Recovery will spawn new worker - not an error
          log.debug('dispatcher', 'Resume failed, recovery will handle', {
            agentId,
            queuedMessages: hasQueuedWork,
          });
        } else {
          log.error('dispatcher', `Resume failed`, {
            agentId,
            error: result.error,
          });
        }

        // OAOM: Clean up so agent can process queued messages
        this.removeActiveWorker(agentId, workerId);
        this.processNextQueuedMessage(agentId);
      }

      this.writeWorkerState();
    } catch (error) {
      log.error('dispatcher', `Failed to resume suspended session`, {
        agentId,
        error: (error as Error).message,
      });
      // Clean up on failure - remove session and all workers for this agent
      this.sessionManager.markResumed(agentId);
      this.workerLifecycle.deleteForAgent(agentId);

      // OAOM: Check queue for next message
      this.processNextQueuedMessage(agentId);
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
    const { from: respondingAgentId, to: awaitingAgentId, content, msgId: correlationId } = event;

    // NOTE: pending_asks table only tracks core/core boundary (parity gate)
    // await_state table tracks ALL agent-to-agent awaiting (session management)
    // We only call resolvePendingAsk() for responses from core/core

    // Agent Completion Frontier: Reset frontier for responding agent.
    // When agent A asks agent B and B responds, A can now send to B again.
    // This enables valid ask-response loops (narrator → oracle → narrator → oracle).
    // Only reset for agent-to-agent responses (not core/core responses).
    if (respondingAgentId !== 'core/core') {
      this.workerLifecycle.resetSentTargetForResponse(awaitingAgentId, respondingAgentId);
    }

    // Blocking HITL: worker is still active (not suspended), waiting for human response
    if (respondingAgentId === 'core/core' && this.workerLifecycle.isBlockingHitl(awaitingAgentId)) {
      const activeWorker = this.getFirstWorkerForAgent(awaitingAgentId);
      if (!activeWorker) {
        log.error('dispatcher', 'Blocking HITL response but worker gone', { awaitingAgentId });
        // Fall through to normal suspended session handling
      } else {
        const sessionId = activeWorker.runner.getSessionId();
        if (!sessionId) {
          log.error('dispatcher', 'Blocking HITL response but no sessionId', { awaitingAgentId });
        } else {
          log.info('dispatcher', 'Blocking HITL: resuming worker with human response', {
            from: respondingAgentId,
            to: awaitingAgentId,
            sessionId: sessionId.slice(0, 8),
          });

          // Resolve the pending ask
          this.queue.resolvePendingAsk(respondingAgentId, awaitingAgentId, correlationId);

          // Clear blocking state
          this.workerLifecycle.clearBlockingHitl(awaitingAgentId);

          // Re-register heartbeat monitoring (worker is about to resume)
          const [meshName, agentName] = awaitingAgentId.split('/');
          const meshReliability = meshName ? this.meshConfigs.get(meshName)?.reliability : undefined;
          this.reliability?.registerAgent(awaitingAgentId, meshReliability?.heartbeat);

          // Build resume prompt with routing reminder
          const meshConfig = this.meshConfigs.get(meshName);
          const agentConfig = meshConfig?.agents.find(a => a.name === agentName);
          const routingReminder = this.buildRoutingReminder(meshName, agentName, meshConfig);
          const resumePrompt = this.sessionManager.buildHumanResponsePrompt(
            content, event.headline, routingReminder
          );

          // Resume the SAME runner — no new process, no race condition
          await this.resumeSession({
            reason: 'blocking-hitl',
            agentId: awaitingAgentId,
            sessionId,
            prompt: resumePrompt,
            runner: activeWorker.runner,
          });

          return;
        }
      }
    }

    // Check for suspended session
    const suspended = this.sessionManager.get(awaitingAgentId);
    if (suspended) {
      // Handle ask-human responses (from core/core)
      if (suspended.reason === 'ask-human' && respondingAgentId === 'core/core') {
        // Buffer this response
        this.sessionManager.bufferResponse(awaitingAgentId, {
          from: respondingAgentId,
          content,
          headline: event.headline,
        });

        // Resolve the pending ask now that response is received
        this.queue.resolvePendingAsk(respondingAgentId, awaitingAgentId, correlationId);

        // Check SQLite for remaining pending ask count
        const remainingPendingAsks = this.queue.getPendingAsks(awaitingAgentId)
          .filter(a => a.to_agent === 'core/core');
        const remainingCount = remainingPendingAsks.length;

        log.info('dispatcher', `Human response received for suspended session`, {
          from: respondingAgentId,
          to: awaitingAgentId,
          sessionId: suspended.sessionId.slice(0, 8),
          suspendedFor: Date.now() - suspended.suspendedAt,
          remainingPendingAsks: remainingCount,
          bufferedResponses: this.sessionManager.getBufferedResponseCount(awaitingAgentId),
        });

        // Only resume when ALL pending ask-humans to core/core have been resolved
        if (remainingCount === 0) {
          // Get all buffered responses
          const bufferedResponses = this.sessionManager.getAndClearBufferedResponses(awaitingAgentId);

          log.info('dispatcher', `All ask-human responses received, resuming suspended session`, {
            from: respondingAgentId,
            to: awaitingAgentId,
            sessionId: suspended.sessionId.slice(0, 8),
            responseCount: bufferedResponses.length,
          });

          // Build combined content from all responses (buffer already cleared by getAndClearBufferedResponses)
          const combinedContent = this.sessionManager.buildBatchedAskResponseContent(bufferedResponses);

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
      if (suspended.reason === 'await-response') {
        const isDuplicate = !suspended.targetAgents.has(respondingAgentId);

        if (isDuplicate) {
          log.debug('dispatcher', `Ask-response from agent not in target set, injecting at runtime`, {
            from: respondingAgentId,
            to: awaitingAgentId,
            sessionId: suspended.sessionId.slice(0, 8),
          });

          // Inject duplicate response immediately at runtime (don't buffer)
          const combinedContent = this.sessionManager.buildAskResponsePrompt([{
            from: respondingAgentId,
            content,
            headline: event.headline,
          }]);

          await this.resumeSuspendedSession(awaitingAgentId, suspended, combinedContent, event.headline);
          return;
        }

        // Buffer this response (first response from this agent)
        this.sessionManager.bufferResponse(awaitingAgentId, {
          from: respondingAgentId,
          content,
          headline: event.headline,
        });

        // Remove responder from target agents (returns true if all responded)
        const allResponded = this.sessionManager.removeTargetAgent(awaitingAgentId, respondingAgentId);

        log.info('dispatcher', `Agent response received for suspended session`, {
          from: respondingAgentId,
          to: awaitingAgentId,
          sessionId: suspended.sessionId.slice(0, 8),
          suspendedFor: Date.now() - suspended.suspendedAt,
          remainingTargetAgents: Array.from(suspended.targetAgents),
          bufferedResponses: this.sessionManager.getBufferedResponseCount(awaitingAgentId),
        });

        // Resume when all awaited agents have responded
        if (allResponded) {
          const bufferedResponses = this.sessionManager.getAndClearBufferedResponses(awaitingAgentId);

          log.info('dispatcher', `All agent responses received, resuming suspended session`, {
            from: respondingAgentId,
            to: awaitingAgentId,
            sessionId: suspended.sessionId.slice(0, 8),
            responseCount: bufferedResponses.length,
          });

          // Build combined content from all responses (buffer already cleared)
          const combinedContent = this.sessionManager.buildAskResponsePrompt(bufferedResponses);

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
    const isDuplicate = !awaitingResponses.has(respondingAgentId);

    if (isDuplicate) {
      log.debug('dispatcher', `Ask-response from agent not in await set, injecting at runtime`, {
        from: respondingAgentId,
        to: awaitingAgentId,
      });

      // Inject duplicate response immediately if runner is active
      if (runner.isRunning()) {
        const sessionId = machine.getAwaitSessionId();
        if (sessionId) {
          log.info('dispatcher', `Injecting duplicate response to active runner`, {
            from: respondingAgentId,
            to: awaitingAgentId,
            sessionId: sessionId.slice(0, 8),
          });

          // Inject directly to the running session
          const injectionContent = this.sessionManager.buildAskResponsePrompt([{
            from: respondingAgentId,
            content,
            headline: event.headline,
          }]);

          await this.resumeSession({
            reason: 'ask-response',
            agentId: awaitingAgentId,
            sessionId,
            prompt: injectionContent,
            runner,
            metadata: { responseCount: 1, from: respondingAgentId, duplicate: true },
          });
        }
      } else {
        log.debug('dispatcher', `Duplicate response but runner not active, discarding`, {
          from: respondingAgentId,
          to: awaitingAgentId,
        });
      }
      return;
    }

    try {
      log.info('dispatcher', `Received ask-response`, {
        from: respondingAgentId,
        to: awaitingAgentId,
        remainingBefore: awaitingResponses.size,
      });

      // Buffer this response for aggregation
      this.sessionManager.bufferResponse(awaitingAgentId, {
        from: respondingAgentId,
        content,
        headline: event.headline,
      });

      // Resolve the pending ask now that response is received
      this.queue.resolvePendingAsk(respondingAgentId, awaitingAgentId, correlationId);

      // Phase 4: Track response in queue await state
      const queueResult = this.queue.receiveAwaitResponse(awaitingAgentId, respondingAgentId);

      // Remove responder from awaiting set (FSM machine)
      const allReceived = await machine.receiveResponse(respondingAgentId);

      // Verify queue and FSM agree on completion
      if (allReceived !== queueResult.allReceived) {
        log.warn('dispatcher', `Queue and FSM disagree on await completion`, {
          awaitingAgentId,
          queueAllReceived: queueResult.allReceived,
          fsmAllReceived: allReceived,
          queueRemaining: queueResult.remaining,
        });
      }

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
        const bufferedResponses = this.sessionManager.getAndClearBufferedResponses(awaitingAgentId);

        // Resume the session with all buffered responses
        await this.resumeSession({
          reason: 'ask-response',
          agentId: awaitingAgentId,
          sessionId,
          prompt: this.sessionManager.buildAskResponsePrompt(bufferedResponses),
          runner,
          metadata: { responseCount: bufferedResponses.length, from: respondingAgentId },
        });
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

  // Note: buildAskResponsePrompt and buildBatchedAskResponseContent moved to SessionManager

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

    // Interrupt and resume with parity reminder
    log.activity('guardrail:parity', agentId, `Parity reminder: ${pendingAsks.length} pending ask(s) blocking task-complete`);
    await this.resumeSession({
      reason: 'parity-reminder',
      agentId,
      sessionId,
      prompt: this.buildParityReminderPrompt(pendingAsks),
      runner,
      interrupt: true,
      metadata: { pendingAsks, deletedFile },
    });
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

      // Cleanup using consolidated helper
      this.cleanupWorker(agentId, workerId);
    } catch (error) {
      log.error('dispatcher', `Failed to handle await timeout`, {
        agentId,
        workerId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Kill all active workers for a mesh and clear associated state.
   * Called via SIGUSR2 control signal from `tx mesh kill`.
   * Aborts in-process SdkRunner workers, clears suspended sessions and pending asks.
   * Returns count of workers killed.
   */
  killMeshWorkers(meshName: string): number {
    const agentIds = this.workerLifecycle.getWorkersForMesh(meshName);
    let totalKilled = 0;

    for (const agentId of agentIds) {
      totalKilled += this.workerLifecycle.killForAgent(agentId, `mesh kill: ${meshName}`);
    }

    // Clear suspended sessions and buffered responses
    this.sessionManager.clearForMesh(meshName);

    // Clear pending asks from SQLite
    this.queue.clearPendingAsksForMesh(meshName);

    log.info('dispatcher', 'killMeshWorkers complete', {
      meshName,
      agentIds,
      totalKilled,
    });

    this.emit('mesh:killed', { meshName, killed: totalKilled, agents: agentIds });

    return totalKilled;
  }

  /**
   * Clear in-memory AND SQLite state for a mesh on completion
   * Called by consumer when task-complete to core passes parity gate
   * Also called on new run at entry point (unless resume-mesh flag set)
   */
  /**
   * Manifest routing: resolve eligible agents and spawn them.
   * Called at mesh start and after each agent completion.
   */
  private resolveAndSpawnManifestAgents(meshName: string, meshConfig: MeshConfig): void {
    const manifest = meshConfig.manifest!;
    const agentNames = meshConfig.agents.map(a => a.name);
    const completed = this.completedAgents.get(meshName) || new Set();
    const written = this.writtenFiles.get(meshName) || new Set();

    const cachedVars = this.cachedManifestVars.get(meshName);
    const pathContext = buildPathContext(this.config.workDir, meshConfig as any, cachedVars);

    const result = resolveManifestEligibility(manifest, agentNames, completed, written, pathContext);

    if (result.deadlock) {
      const message = formatDeadlockMessage(result);
      log.error('dispatcher', message, { meshName });
      log.activity('manifest:deadlock', meshName, message);

      // Send deadlock error to core
      if (this.systemWriter) {
        this.systemWriter.write({
          to: 'core/core',
          from: `${meshName}/manifest-resolver`,
          headline: 'Manifest deadlock detected',
          body: message,
        });
      }
      return;
    }

    if (result.eligible.length === 0) {
      // All agents completed — mesh success
      const completionAgents = this.normalizeCompletionAgents(meshConfig);
      if (completionAgents.length === 0 || completionAgents.every(a => completed.has(a))) {
        log.info('dispatcher', `Manifest routing: all agents completed, mesh done`, { meshName });
        log.activity('manifest:complete', meshName, 'All manifest agents completed');

        // Kill any remaining workers before clearing state
        this.killMeshWorkers(meshName);

        if (this.systemWriter) {
          this.systemWriter.write({
            to: 'core/core',
            from: `${meshName}/manifest-resolver`,
            headline: 'Mesh completed',
            body: 'All manifest pipeline agents have completed successfully.',
            injectResponse: true,
            extraFrontmatter: { status: 'complete' },
          });
        }
        this.clearMeshState(meshName);
      }
      return;
    }

    // Spawn all eligible agents directly — no queue message needed (spec: line 116)
    for (const agentName of result.eligible) {
      const agentId = `${meshName}/${agentName}`;

      // OAOM: skip if agent already has active worker
      if (this.workerLifecycle.hasWorkers(agentId)) {
        log.debug('dispatcher', `Manifest routing: skipping ${agentName}, worker active`, { meshName });
        continue;
      }

      const agentConfig = meshConfig.agents.find(a => a.name === agentName);
      if (!agentConfig) continue;

      // Build task context describing what the agent needs to write
      const writesNeeded = manifest
        .filter(e => e.writes.includes(agentName))
        .filter(e => {
          const resolved = resolveManifestPath(e, pathContext);
          return !resolved || !written.has(resolved);
        })
        .map(e => e.id);

      // Insert a synthetic task message into the queue so spawnWorker can poll it
      this.queue.insert({
        from_agent: `${meshName}/manifest-resolver`,
        to_agent: agentId,
        type: 'task',
        payload: {
          headline: 'Manifest routing: reads satisfied',
          body: `Your reads are satisfied. Write: [${writesNeeded.join(', ')}]`,
        },
      });

      log.info('dispatcher', `Manifest routing: spawning eligible agent`, {
        meshName,
        agentName,
        writesNeeded,
      });
      log.activity('manifest:spawn', agentId, `Eligible — writes needed: ${writesNeeded.join(', ')}`);

      // Spawn directly — no filesystem round-trip
      this.spawnWorker(meshName, agentConfig);
    }
  }

  /**
   * Handle manifest routing after an agent completes.
   * Updates writtenFiles with validated paths and resolves next agents.
   */
  private handleManifestCompletion(meshName: string, agentName: string, meshConfig: MeshConfig): void {
    const manifest = meshConfig.manifest!;
    const cachedVars = this.cachedManifestVars.get(meshName);
    const pathContext = buildPathContext(this.config.workDir, meshConfig as any, cachedVars);

    // Add confirmed write paths to writtenFiles (only if file actually exists on disk)
    if (!this.writtenFiles.has(meshName)) {
      this.writtenFiles.set(meshName, new Set());
    }
    const written = this.writtenFiles.get(meshName)!;

    const writeEntries = manifest.filter(e => e.writes.includes(agentName));
    for (const entry of writeEntries) {
      const resolved = resolveManifestPath(entry, pathContext);
      if (resolved && fs.existsSync(resolved)) {
        written.add(resolved);
      }
    }

    // Check if completion_agents just finished → immediate mesh completion
    const completionAgents = this.normalizeCompletionAgents(meshConfig);
    if (completionAgents.includes(agentName)) {
      log.info('dispatcher', `Manifest routing: completion agent finished, mesh done`, {
        meshName,
        agentName,
      });
      log.activity('manifest:complete', meshName, `Completion agent ${agentName} finished`);

      // Kill any sibling workers still running before clearing state
      this.killMeshWorkers(meshName);

      if (this.systemWriter) {
        this.systemWriter.write({
          to: 'core/core',
          from: `${meshName}/manifest-resolver`,
          headline: 'Mesh completed',
          body: `Completion agent '${agentName}' has finished.`,
          injectResponse: true,
          extraFrontmatter: { status: 'complete' },
        });
      }
      this.clearMeshState(meshName);
      return;
    }

    // Re-resolve and spawn next eligible agents
    this.resolveAndSpawnManifestAgents(meshName, meshConfig);
  }

  clearMeshState(meshName: string): void {
    // Clear sessions and buffers via SessionManager (handles both in-memory and SQLite)
    const { sessions: clearedSessions, buffers: clearedBuffers } = this.sessionManager.clearForMesh(meshName);

    // Clear FSM state for this mesh (both in-memory instance AND persisted SQLite row)
    // CRITICAL: Clean gate files BEFORE deleting FSM to avoid stale files causing infinite loops
    const fsm = this.meshFSMs.get(meshName);
    let clearedGateFiles = 0;
    if (fsm) {
      // Clean stale gate files from previous run
      clearedGateFiles = fsm.cleanGateFiles();
      fsm.getPersistence().deleteState(meshName);
      this.meshFSMs.delete(meshName);
    }

    // Clear SQLite suspended sessions for this mesh (survives restart)
    const clearedDbSessions = this.queue.clearSuspendedSessionsForMesh(meshName);

    // Purge stale pending messages from previous runs
    const clearedPendingMsgs = this.queue.clearPendingMessagesForMesh(meshName);

    // Clear session continuations unless persistence is enabled
    let clearedConversations = 0;
    let clearedNamedConversations = 0;
    const meshConfig = this.meshConfigs.get(meshName);
    if (!meshConfig?.persistence) {
      clearedConversations = this.queue.clearConversationsForMesh(meshName);
      clearedNamedConversations = this.queue.clearNamedConversationsForMesh(meshName);
    }

    // Clear instant-exit failure counts for this mesh
    const clearedInstantExitFailures = this.queue.clearInstantExitFailuresForMesh(meshName);

    if (clearedSessions > 0 || clearedBuffers > 0 || clearedDbSessions > 0 || clearedPendingMsgs > 0 || clearedConversations > 0 || clearedNamedConversations > 0 || clearedGateFiles > 0 || clearedInstantExitFailures > 0) {
      log.info('dispatcher', `Cleared mesh state on completion`, {
        meshName,
        clearedSessions,
        clearedBuffers,
        clearedDbSessions,
        clearedPendingMsgs,
        clearedConversations,
        clearedNamedConversations,
        clearedGateFiles,
        clearedInstantExitFailures,
        clearedFSM: !!fsm,
      });
    }

    // Clear routing error counts for this mesh
    for (const key of this.routingErrorCounts.keys()) {
      if (key.includes(`${meshName}/`)) {
        this.routingErrorCounts.delete(key);
      }
    }

    // Clear fan-out groups for this mesh
    for (const key of this.fanOutGroups.keys()) {
      if (key.startsWith(`${meshName}:`)) {
        this.fanOutGroups.delete(key);
      }
    }

    // Clear manifest routing state
    this.writtenFiles.delete(meshName);

    // Clear halted state file entry
    this.clearHaltedFile(meshName);
  }

  /**
   * Hot-reload mesh configs at runtime.
   * If meshName is provided, reloads only that mesh.
   * Otherwise reloads all meshes.
   */
  async reloadMeshConfigs(meshName?: string): Promise<void> {
    if (meshName) {
      // Single mesh reload
      const reloaded = this.configLoader.reload(meshName);
      if (reloaded) {
        const config = this.configLoader.get(meshName);
        if (config) {
          this.meshConfigs.set(meshName, config);

          // Re-register guardrails
          if (config.guardrails) {
            this.guardrails.registerMesh(meshName, config.guardrails);
          }

          // Re-init FSM only if no active workers for this mesh
          const activeWorkers = this.workerLifecycle.getWorkersForMesh(meshName);
          if (activeWorkers.length === 0 && config.fsm) {
            // Remove old FSM instance
            const oldFsm = this.meshFSMs.get(meshName);
            if (oldFsm) {
              this.meshFSMs.delete(meshName);
            }
            await this.initializeSingleFSM(meshName, config);
          }
        }
      }
      log.info('dispatcher', 'Reloaded mesh config', { meshName, success: reloaded });
    } else {
      // Full reload: clear all and re-scan
      this.configLoader.clear();
      await this.loadMeshConfigs();
      log.info('dispatcher', 'Reloaded all mesh configs');
    }
  }

  /**
   * Write halted mesh info to halted.json for hook/status consumption
   */
  private writeHaltedFile(meshName: string, suspendedAgent: string, pendingMessages: number): void {
    try {
      const haltedPath = path.join(this.config.workDir, '.ai', 'tx', 'data', 'halted.json');
      let halted: Record<string, { suspendedAgent: string; reason: string; since: string; pendingMessages: number }> = {};

      if (fs.existsSync(haltedPath)) {
        halted = JSON.parse(fs.readFileSync(haltedPath, 'utf-8'));
      }

      halted[meshName] = {
        suspendedAgent,
        reason: 'ask-human',
        since: new Date().toISOString(),
        pendingMessages,
      };

      fs.writeFileSync(haltedPath, JSON.stringify(halted, null, 2));
    } catch (err) {
      log.debug('dispatcher', 'Failed to write halted.json', { error: String(err) });
    }
  }

  /**
   * Clear a mesh entry from halted.json
   */
  private clearHaltedFile(meshName: string): void {
    try {
      const haltedPath = path.join(this.config.workDir, '.ai', 'tx', 'data', 'halted.json');
      if (!fs.existsSync(haltedPath)) return;

      const halted = JSON.parse(fs.readFileSync(haltedPath, 'utf-8'));
      if (halted[meshName]) {
        delete halted[meshName];
        fs.writeFileSync(haltedPath, JSON.stringify(halted, null, 2));
      }
    } catch (err) {
      log.debug('dispatcher', 'Failed to clear halted.json', { error: String(err) });
    }
  }

  /**
   * Resolve manifest template variables from session.yaml
   * Maps location placeholders like {game}, {campaign-id}, {N} to actual values
   */
  private resolveManifestVariables(
    meshName: string,
    wsLocations: Record<string, string>,
  ): Record<string, string> {
    const meshConfig = this.meshConfigs.get(meshName);
    const variablesConfig = (meshConfig as any)?.workspace?.variables;
    return resolveManifestVariables(this.config.workDir, wsLocations, variablesConfig);
  }

  /**
   * Handle routing errors when a message targets a non-existent mesh or agent.
   * Injects correction back to sender with valid options. After max retries, escalates to user.
   */
  private handleRoutingError(
    senderAgentId: string,
    targetAgentId: string,
    targetMeshName: string,
    errorType: 'mesh-not-found' | 'agent-not-found'
  ): void {
    const key = `${senderAgentId}→${targetAgentId}`;
    const retryCount = (this.routingErrorCounts.get(key) || 0) + 1;
    this.routingErrorCounts.set(key, retryCount);

    const [senderMesh, senderAgent] = senderAgentId.split('/');
    const maxRetries = this.guardrails.getRoutingMaxRetries(senderMesh, senderAgent);
    const routingMode = this.guardrails.getMode('routing_error', senderMesh, senderAgent);

    const availableMeshes = Array.from(this.meshConfigs.keys()).join(', ');

    log.info('dispatcher', 'Handling routing error', {
      senderAgentId,
      targetAgentId,
      errorType,
      retryCount,
      maxRetries,
      availableMeshes,
      mode: routingMode,
    });

    if (!routingMode.strict) {
      if (routingMode.warning) {
        log.warn('dispatcher', 'Routing error (warning mode)', { senderAgentId, targetAgentId, errorType, retryCount });
        log.activity('guardrail:routing-error:warning', senderAgentId, `Routing warning: ${targetAgentId} (${errorType}) — attempt ${retryCount}/${maxRetries} (injecting correction)`);

        // Build valid targets list from sender's mesh
        const senderMeshConfig = this.meshConfigs.get(senderMesh);
        const validAgents = senderMeshConfig
          ? senderMeshConfig.agents.map((a: AgentConfig) => `${senderMesh}/${a.name}`).join(', ')
          : availableMeshes;

        const correction = `## Routing Correction

Your message to **${targetAgentId}** could not be delivered — ${errorType === 'mesh-not-found' ? 'mesh does not exist' : 'agent not found'}.

**Only write to**: ${validAgents}`;

        this.emit('routing-error', {
          from: 'system/router',
          to: senderAgentId,
          content: correction,
          headline: 'Routing Correction',
        });
      }
      return;
    }

    log.activity('guardrail:routing-error', senderAgentId, `Routing STRICT: ${targetAgentId} (${errorType}) — attempt ${retryCount}/${maxRetries}`);

    if (retryCount >= maxRetries) {
      log.warn('dispatcher', 'Routing error max retries reached, escalating to user', {
        senderAgentId,
        targetAgentId,
        retryCount,
      });
      log.activity('guardrail:routing-escalate', senderAgentId, `Routing ESCALATED to human: ${senderAgentId}→${targetAgentId} failed ${maxRetries} times`);
      this.escalateRoutingError(senderAgentId, targetAgentId, targetMeshName, availableMeshes);
      this.routingErrorCounts.delete(key);
      return;
    }

    const errorReason = errorType === 'mesh-not-found'
      ? `Mesh "${targetMeshName}" does not exist`
      : `Agent not found in mesh "${targetMeshName}"`;

    const content = `## ROUTING ERROR

Your message to **${targetAgentId}** could not be delivered.

**Reason**: ${errorReason}

**Available meshes**: ${availableMeshes || 'none loaded'}

**Attempt**: ${retryCount}/${maxRetries}

Correct the target agent ID and resend your message.`;

    this.emit('routing-error', {
      from: 'system/router',
      to: senderAgentId,
      content,
      headline: 'Routing Error - Target Not Found',
    });
  }

  /**
   * Escalate routing error to user after max retries exhausted.
   * Writes ask-human message for human intervention.
   */
  private escalateRoutingError(
    senderAgentId: string,
    targetAgentId: string,
    targetMeshName: string,
    availableMeshes: string
  ): void {
    const content = `## ROUTING ESCALATION

Agent **${senderAgentId}** repeatedly tried to message non-existent target **${targetAgentId}**.

The agent has been corrected 3 times but continues to use invalid routing.

**Target mesh**: ${targetMeshName}
**Available meshes**: ${availableMeshes || 'none loaded'}

Please advise the agent or check mesh configuration.`;

    this.emit('routing-escalation', {
      from: senderAgentId,
      to: 'core/core',
      content,
      headline: 'Routing Error - Human Intervention Required',
    });
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
    if (consumer && this.boundBlockingHitlHandler) {
      consumer.off('blocking-hitl-message', this.boundBlockingHitlHandler);
    }
    if (consumer && this.boundParityReminderHandler) {
      consumer.off('parity-reminder', this.boundParityReminderHandler);
      this.boundParityReminderHandler = null;
    }
    if (consumer && this.boundMeshCompleteHandler) {
      consumer.off('mesh-complete', this.boundMeshCompleteHandler);
      this.boundMeshCompleteHandler = null;
    }
    if (consumer && this.boundSystemFeedbackHandler) {
      consumer.off('system-feedback', this.boundSystemFeedbackHandler);
      this.boundSystemFeedbackHandler = null;
    }

    // Kill all active workers (via WorkerLifecycleManager)
    this.workerLifecycle.killAll('shutdown: dispatcher stopping');
    this.workerLifecycle.clear();
    this.writeWorkerState();

    // Clean shutdown: clear all sessions so they don't restore on next start
    // Crash recovery still works - only clean shutdown clears
    const clearedSessions = this.sessionManager.clearAll();
    if (clearedSessions > 0) {
      log.info('dispatcher', 'Clean shutdown: cleared suspended sessions', { count: clearedSessions });
    }

    // Release per-agent/mesh maps to prevent leaks across restarts
    this.lastCompletedSessionIds.clear();
    this.checkpoints.clear();
    this.completedAgents.clear();
    this.cachedManifestVars.clear();
    this.edgeCounters.clear();
    this.meshMessageCounters.clear();

    this.emit('stop');
  }

  /**
   * Spawn a worker for an agent using SDK with FSM
   *
   * @param meshName - Name of the mesh
   * @param agent - Agent configuration
   * @param options - Optional spawn options (for ensemble mode, etc.)
   */
  private async spawnWorker(
    meshName: string,
    agent: AgentConfig,
    options: SpawnWorkerOptions = {}
  ): Promise<void> {
    const agentId = `${meshName}/${agent.name}`;
    const { ensembleId, ensembleIndex, ensembleTotal, skipPostHooks, fsm: ensembleFsm, fsmStateConfig, task: ensembleTask } = options;

    // Parallel gate: defer exit agent until all parallel agents complete
    if (this.isParallelGated(meshName, agent.name) || this.isFanOutGated(meshName, agent.name)) {
      log.info('dispatcher', 'Agent gated by incomplete parallel/fan-out block - deferring spawn', {
        agentId,
        meshName,
      });
      // Task stays in queue, will be processed when parallel block completes
      return;
    }

    // Check max_invocations guardrail before spawning
    const invocationCount = this.workerLifecycle.incrementInvocation(meshName, agent.name);
    const maxInvocations = this.guardrails.getMaxInvocations(meshName, agent.name);

    if (maxInvocations != null) {
      const mode = this.guardrails.getMode('max_invocations', meshName, agent.name);

      // At the limit: inject "final invocation" warning
      if (invocationCount === maxInvocations && mode.warning) {
        log.info('dispatcher', 'Agent at final invocation — injecting feedback', {
          agentId,
          invocationCount,
          maxInvocations,
        });
        this.emit('system-feedback', {
          agentId,
          meshName,
          feedback: `[GUARDRAIL] This is your final invocation (${invocationCount}/${maxInvocations}). Wrap up your work or escalate to core. You will not be re-invoked after this.`,
          source: 'max_invocations',
        });
      }

      // Past the limit: block or warn
      if (invocationCount > maxInvocations) {
        if (mode.strict) {
          log.warn('dispatcher', 'max_invocations limit reached — blocking spawn', {
            agentId,
            maxInvocations,
            invocationCount,
          });
          log.activity('guardrail:max-invocations', agentId, `max_invocations STRICT BLOCK (${invocationCount}/${maxInvocations}) — spawn denied`);

          this.systemWriter?.write({
            to: 'core/core',
            from: agentId,
            headline: `Budget kill: ${agent.name} hit max_invocations (${invocationCount}/${maxInvocations})`,
            body: `Agent \`${agentId}\` was denied spawn — invocation limit reached (${invocationCount}/${maxInvocations}).\n\nThis agent has been re-invoked too many times in this mesh run. The iteration loop may be stuck.\n\nConsider: reviewing rejection patterns, increasing the limit, or manually intervening.`,
          });
          return;
        }

        if (mode.warning) {
          log.warn('dispatcher', 'max_invocations limit reached (warning mode)', {
            agentId,
            maxInvocations,
            invocationCount,
          });
          log.activity('guardrail:max-invocations:warning', agentId, `max_invocations warning (${invocationCount}/${maxInvocations}, allowed)`);
        }
      }
    }

    try {
      // For ensemble workers, use provided task; otherwise peek from queue
      const nextMsg = ensembleTask || this.queue.peekOne(agentId);
      const taskId = nextMsg?.id != null ? String(nextMsg.id) : `${agentId}-${Date.now()}`;

      // Get mesh config (poll() already reloaded it from disk)
      const meshConfig = this.meshConfigs.get(meshName);

      // Create hook context with task info for quality hooks
      // Extract mesh-id from payload for parallel instance isolation
      const meshId = nextMsg?.payload?.['mesh-id'] as string | undefined;

      // Session isolation: Use mesh-id if present to create isolated session
      // Format: meshName:meshId (stable key for parallel instances)
      //     or: meshName-timestamp (unique per standard execution)
      const meshInstance = meshId
        ? `${meshName}:${meshId}`
        : `${meshName}-${Date.now()}`;

      const taskBody = nextMsg?.payload?.body as string || '';

      // Feature name: prefer message payload, fall back to stored per-mesh-run value
      const payloadFeature = nextMsg?.payload?.feature as string | undefined;
      const featureName = payloadFeature || this.meshFeatureNames.get(meshName);

      // Store feature name on first sight so downstream agents inherit it
      if (payloadFeature && !this.meshFeatureNames.has(meshName)) {
        this.meshFeatureNames.set(meshName, payloadFeature);
        log.info('dispatcher', 'Captured feature name for mesh run', { meshName, featureName: payloadFeature });
      }
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
        systemWriter: this.systemWriter,
        // Ensemble context
        ensembleId,
        ensembleIndex,
        ensembleTotal,
        agentConfig: agent,
      };

      // Register ensemble agent start if in ensemble mode
      if (ensembleId) {
        this.ensembleCoordinator.registerAgentStart(ensembleId, agent.name, ensembleIndex);
        log.info('dispatcher', 'Spawning ensemble worker', {
          agentId,
          ensembleId,
          ensembleIndex,
          ensembleTotal,
        });
      }

      // Initialize session metrics if first worker in this mesh instance (delegates to MetricsAggregator)
      if (meshInstance && !this.metricsAggregator.hasSession(meshInstance)) {
        this.metricsAggregator.initSession({
          meshInstance,
          meshName: meshConfig?.mesh || meshName,
        });

        log.info('mesh-run', 'Mesh run started', {
          meshInstance, meshName: meshConfig?.mesh || meshName, entryAgent: agentId,
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

      const lifecycle = meshConfig ? resolveLifecycle(meshConfig, this.config.debug) : undefined;

      log.info('dispatcher', 'Lifecycle resolved', {
        agentId,
        hasLifecycle: !!lifecycle,
        pre: lifecycle?.pre || [],
        post: lifecycle?.post || [],
      });

      // Execute pre-hooks if configured (skip for ensemble workers)
      if (lifecycle?.pre && lifecycle.pre.length > 0 && !ensembleId) {
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

      // ============================================================
      // PROMPT ASSEMBLY — Section-based, explicit ordering
      // Order: worktree → preamble → files → agent prompt → FSM →
      //        situational → workspace → rearmatter → parallel →
      //        messaging+routing (END)
      // ============================================================

      // --- Load raw agent prompt ---
      let agentPromptText: string;

      if (agent.prompt) {
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
        agentPromptText = fs.readFileSync(promptPath, 'utf-8');
      } else {
        // Command-only agent: minimal system prompt
        agentPromptText = `You are agent ${agent.name}. Execute the command provided in the user prompt.`;
      }

      // --- Resolve workspace directory (needed for template tokens + file paths) ---
      const workspaceConfig = agent.workspace || meshConfig?.workspace;
      let resolvedWorkspaceDir: string | undefined;

      // 1. FSM context $workspace variable (highest priority)
      const fsmObj = ensembleFsm || this.meshFSMs.get(meshName);
      if (fsmObj && fsmObj.isInitialized()) {
        const fsmCtx = fsmObj.getStatus().context;
        if (fsmCtx?.workspace && typeof fsmCtx.workspace === 'string') {
          resolvedWorkspaceDir = path.isAbsolute(fsmCtx.workspace as string)
            ? fsmCtx.workspace as string
            : path.join(this.config.workDir, fsmCtx.workspace as string);
        }
      }

      // 2. Resolved workspace location from manifest variables (per-turn path)
      if (!resolvedWorkspaceDir && workspaceConfig) {
        const wsLocations = (workspaceConfig as any)?.locations || {};
        if (Object.keys(wsLocations).length > 0) {
          const varMap = this.cachedManifestVars.get(meshName)
            || this.resolveManifestVariables(meshName, wsLocations);
          this.cachedManifestVars.set(meshName, varMap);
          if (varMap['workspace'] && !varMap['workspace'].includes('{')) {
            resolvedWorkspaceDir = path.isAbsolute(varMap['workspace'])
              ? varMap['workspace']
              : path.join(this.config.workDir, varMap['workspace']);
          }
        }
      }

      // 3. Static workspace config from agent/mesh
      if (workspaceConfig && !resolvedWorkspaceDir) {
        const workspace = this.workspaceManager.createWorkspace(taskId, workspaceConfig, featureName);
        resolvedWorkspaceDir = workspace.dir;
      }

      // Default workspace when nothing else is configured
      if (!resolvedWorkspaceDir) {
        resolvedWorkspaceDir = path.join(this.config.workDir, '.ai', 'tx', 'workspaces', meshName);
      }

      // Ensure directory exists
      if (!fs.existsSync(resolvedWorkspaceDir)) {
        fs.mkdirSync(resolvedWorkspaceDir, { recursive: true });
      }
      log.info('dispatcher', `Created workspace for task`, { agentId, taskId, dir: resolvedWorkspaceDir });

      // --- Replace template tokens in agent prompt ---
      agentPromptText = this.promptInjector.replaceTemplateTokens(agentPromptText, {
        workspace: resolvedWorkspaceDir,
      });

      // --- Collect files for preload (from load field + manifest auto-inject) ---
      const agentWrites: import('../workspace/index.ts').ManifestFileEntry[] = [];
      const agentReads: import('../workspace/index.ts').ManifestFileEntry[] = [];
      const preloadedFiles: Array<{ path: string; content: string }> = [];

      // Handle agent preload (load field)
      if (agent.load && agent.load.length > 0) {
        const glob = await import('fast-glob');

        for (const pattern of agent.load) {
          const resolvedPattern = path.isAbsolute(pattern)
            ? pattern
            : path.join(this.config.workDir, pattern);

          try {
            const matches = await glob.default(resolvedPattern, {
              cwd: this.config.workDir,
              absolute: true,
              onlyFiles: true,
              ignore: ['**/node_modules/**', '**/.git/**'],
            });

            for (const filePath of matches) {
              if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                if (stats.size > 200 * 1024) {
                  log.warn('dispatcher', `Skipping large file in preload: ${filePath} (${stats.size} bytes)`);
                  continue;
                }
                const content = fs.readFileSync(filePath, 'utf-8');
                const relativePath = path.relative(this.config.workDir, filePath);
                preloadedFiles.push({ path: relativePath, content });
              }
            }
          } catch (err) {
            log.warn('dispatcher', `Failed to resolve preload pattern: ${pattern}`, { error: String(err) });
          }
        }
      }

      // Collect manifest entries — content goes to preloadedFiles only (no dupe in contract)
      if (meshConfig?.manifest) {
        const wsLocations = (meshConfig as any).workspace?.locations || {};
        const wsBase = (meshConfig as any).workspace?.path || '';
        const varMap = this.cachedManifestVars.get(meshName) || this.resolveManifestVariables(meshName, wsLocations);
        // Inject runtime values so manifest path templates resolve correctly
        // {feature} comes from message frontmatter, not the manifest system
        if (featureName) {
          varMap['feature'] = featureName;
        }
        log.info('dispatcher', 'Manifest varMap after feature inject', {
          agentId, featureName, wsBase,
          varMap: Object.fromEntries(Object.entries(varMap)),
        });
        const meshAutoInject = meshConfig.autoInjectManifestFiles !== false;

        for (const entry of meshConfig.manifest) {
          let locationTemplate = wsLocations[entry.location || 'workspace'] || wsBase;
          for (const [key, value] of Object.entries(varMap)) {
            locationTemplate = locationTemplate.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
          }

          const resolvedPath = path.join(this.config.workDir, locationTemplate, entry.id);
          const fileEntry: import('../workspace/index.ts').ManifestFileEntry = {
            id: entry.id, path: resolvedPath, description: entry.description,
          };

          if (entry.reads?.includes(agent.name)) {
            const shouldAutoInject = entry.autoInject !== undefined ? entry.autoInject : meshAutoInject;

            if (!resolvedPath.includes('{') && fs.existsSync(resolvedPath)) {
              try {
                const content = fs.readFileSync(resolvedPath, 'utf-8');
                if (shouldAutoInject) {
                  // Content goes to preloadedFiles only — no inline dupe in file contract
                  const relativePath = path.relative(this.config.workDir, resolvedPath);
                  const alreadyPreloaded = preloadedFiles.some(f => f.path === relativePath);
                  if (!alreadyPreloaded) {
                    const stats = fs.statSync(resolvedPath);
                    if (stats.size <= 200 * 1024) {
                      preloadedFiles.push({ path: relativePath, content });
                    } else {
                      log.warn('dispatcher', `Skipping large file in manifest auto-inject: ${resolvedPath} (${stats.size} bytes)`);
                    }
                  }
                } else {
                  // No auto-inject: inline content in manifest contract
                  fileEntry.content = content;
                }
              } catch {
                // Non-fatal — file listed but unreadable
              }
            }
            agentReads.push(fileEntry);
          }
          if (entry.writes?.includes(agent.name)) agentWrites.push(fileEntry);
        }
        if (agentReads.length > 0 || agentWrites.length > 0) {
          log.info('dispatcher', `Collected file manifest`, {
            agentId,
            reads: agentReads.length,
            writes: agentWrites.length,
            preloaded: preloadedFiles.length,
          });
        }
      }

      if (preloadedFiles.length > 0) {
        log.info('dispatcher', `Collected preloaded files`, {
          agentId,
          count: preloadedFiles.length,
          fromLoad: agent.load?.length || 0,
          fromManifest: preloadedFiles.length - (agent.load?.length || 0),
        });
      }

      // --- Build FSM section ---
      let fsmSection = '';
      const fsm = ensembleFsm || this.meshFSMs.get(meshName);
      if (fsm && fsm.isInitialized()) {
        const currentStateConfig = fsmStateConfig || fsm.getCurrentStateConfig();
        if (currentStateConfig) {
          const status = fsm.getStatus();
          const contextWithEnsemble = ensembleId
            ? { ...status.context, ENSEMBLE_INDEX: ensembleIndex, ENSEMBLE_TOTAL: ensembleTotal }
            : status.context;

          const fsmContext: FSMInjectionContext = {
            meshName,
            currentState: status.currentState,
            stateConfig: currentStateConfig,
            context: contextWithEnsemble,
            contextDescriptions: fsm.getContextDescriptions(),
            gateRetries: status.gateRetries,
          };
          fsmSection = this.promptInjector.buildFSMSection(fsmContext);
          log.debug('mesh-fsm', 'Built FSM context section', {
            agentId,
            currentState: status.currentState,
            isEnsemble: !!ensembleId,
          });
        }
      }

      // --- Build situational awareness section ---
      const outgoingAsks = this.queue.getPendingAsks(agentId);
      const pendingTasks = this.queue.getPendingTasks(agentId);
      let situationalSection = '';

      if (outgoingAsks.length > 0 || pendingTasks.length > 0) {
        situationalSection = this.promptInjector.buildSituationalSection({
          outgoingAsks: outgoingAsks.map(a => ({
            msg_id: a.msg_id,
            to_agent: a.to_agent,
            created_at: a.created_at,
          })),
          incomingAsks: [],
          pendingTasks: pendingTasks.map(t => ({
            from_agent: t.from_agent,
            type: t.type,
            created_at: t.created_at,
            payload: t.payload as { headline?: string },
          })),
        });
        log.info('dispatcher', `Built situational context`, {
          agentId,
          outgoingAsks: outgoingAsks.length,
          pendingTasks: pendingTasks.length,
        });
      }

      // --- Build workspace section ---
      const workspaceInfo: import('../workspace/index.ts').WorkspaceInfo = {
        taskId,
        dir: resolvedWorkspaceDir,
        outputFiles: new Map(),
      };
      const workspaceSection = this.promptInjector.buildWorkspaceSection(workspaceInfo, taskId);

      // --- Build all prompt sections in order ---
      // Identity+situation → files+workspace → instructions → output constraints
      const agentCount = meshConfig?.agents?.length ?? 1;
      const promptSections: string[] = [];

      // 0. Project CLAUDE.md (loaded first so agent instructions can override)
      if (meshConfig?.load_claude_md !== false) {
        const claudeMdContent = this.loadProjectClaudeMd();
        if (claudeMdContent) promptSections.push(claudeMdContent);
      }

      // -- Identity + situation --
      // 1. Preamble (identity, tool guidance, address)
      promptSections.push(this.promptInjector.buildPreambleSection({
        agentCount,
        meshName: meshName!,
        agentName: agent.name,
        txRoot: this.config.txRoot || process.env.TX_ROOT,
        allowedTools: agent.permissions?.allowedTools,
      }));

      // 2. FSM context (what phase we're in)
      if (fsmSection) promptSections.push(fsmSection);

      // 3. Situational awareness (pending asks, queued tasks)
      if (situationalSection) promptSections.push(situationalSection);

      // 4. Parallel instance context — appended below after gates

      // -- Files + workspace --
      // 5. Task workspace (where to write)
      promptSections.push(workspaceSection);

      // 6. File contract + preloaded files (what files, their content)
      const fileSection = this.promptInjector.buildFileSection(agentReads, agentWrites, preloadedFiles);
      if (fileSection) promptSections.push(fileSection);

      // -- Instructions --
      // 7. Agent prompt (with template tokens already replaced)
      promptSections.push(agentPromptText);

      // 7b. Brain access (when mesh has brain: true)
      if (meshConfig?.brain === true && meshName !== 'brain') {
        promptSections.push(this.promptInjector.buildBrainSection(meshName!, agent.name));
        log.info('dispatcher', 'Appended brain access section', { agentId });
      }

      // 8-10. Rearmatter, parallel instance, messaging+routing — appended below after gates

      let systemPrompt = promptSections.filter(Boolean).join('\n\n');

      // Chaos contract: build gate hooks from manifest
      // workerRef is a mutable reference — populated after SdkRunner construction
      const workerRef: { current: Runner | null } = { current: null };
      const preToolUseHooks: unknown[] = [];

      // Create guardrail kill handler for centralized cleanup
      const killHandler = new GuardrailKillHandler({
        sessionManager: this.sessionManager,
        edgeCounters: this.edgeCounters,
      });

      // Wrapped killRunner that handles cleanup before kill
      const killRunner = (reason: string) => {
        if (workerRef.current && sessionId) {          // Cleanup state atomically
          killHandler.handle(sessionId, meshName!, agentId, reason);
          // Emit event for side-effect dispatch in start.ts
          this.emit('guardrail:kill', {
            sessionId: sessionId,
            meshName,
            agentId,
            reason,
          });
        }
        // Now kill the runner
        workerRef.current?.kill(reason);
      };

      // Write gate
      if (agentWrites.length > 0) {
        const writePaths = agentWrites.map(e => e.path).filter(p => !p.includes('{'));
        if (writePaths.length < agentWrites.length) {
          log.warn('write-gate', 'Skipping unresolved manifest paths', {
            agentId,
            skipped: agentWrites.filter(w => w.path.includes('{')).map(w => w.id),
          });
        }
        const writeGate = new WriteGate({
          agentId,
          allowedPaths: writePaths,
          workDir: this.config.workDir,
          killRunner,
          killThreshold: this.guardrails.getKillThreshold('write_gate', meshName!, agent.name),
          mode: this.guardrails.getMode('write_gate', meshName!, agent.name),
        });
        preToolUseHooks.push(writeGate.createFileToolHook(), writeGate.createBashHook());
        log.info('write-gate', 'Write gate enabled', {
          agentId,
          allowedPaths: writePaths.length,
          killThreshold: this.guardrails.getKillThreshold('write_gate', meshName!, agent.name),
        });
      }

      // Read gate
      if (agentReads.length > 0) {
        const readPaths = agentReads.map(e => e.path).filter(p => !p.includes('{'));
        const readGate = new ReadGate({
          agentId,
          allowedPaths: readPaths,
          workDir: this.config.workDir,
          killRunner,
          killThreshold: this.guardrails.getKillThreshold('read_gate', meshName!, agent.name),
          mode: this.guardrails.getMode('read_gate', meshName!, agent.name),
        });
        preToolUseHooks.push(readGate.createHook());
        log.info('read-gate', 'Read gate enabled', {
          agentId,
          allowedPaths: readPaths.length,
          killThreshold: this.guardrails.getKillThreshold('read_gate', meshName!, agent.name),
        });
      }

      // Identity gate - always enabled to catch agents forgetting their identity
      const identityGate = new IdentityGate({
        agentId,
        workDir: this.config.workDir,
        killRunner,
        killThreshold: this.guardrails.getKillThreshold('identity_gate', meshName!, agent.name),
        mode: this.guardrails.getMode('identity_gate', meshName!, agent.name),
      });
      preToolUseHooks.push(identityGate.createHook());
      log.debug('identity-gate', 'Identity gate enabled', {
        agentId,
        killThreshold: this.guardrails.getKillThreshold('identity_gate', meshName!, agent.name),
      });

      // Bash guard - block dangerous patterns when Bash is allowed
      const bashAllowed = agent.permissions?.allowedTools?.some(tool =>
        tool === 'Bash' || tool.startsWith('Bash(')
      ) || !agent.permissions;  // Default allows Bash
      if (bashAllowed && !this.config.godMode) {
        // Build allowed paths: meshes dir + TX_ROOT install dir + user-configured paths from config.yaml
        const bashAllowedPaths = [this.config.meshesDir];
        if (process.env.TX_ROOT) {
          bashAllowedPaths.push(process.env.TX_ROOT);
        }
        const userAllowedPaths = this.guardrails.getBashAllowedPaths(meshName!, agent.name);
        if (userAllowedPaths.length > 0) {
          bashAllowedPaths.push(...userAllowedPaths);
        }
        const bashGuard = new BashGuard({
          agentId,
          workDir: this.config.workDir,
          allowedPaths: bashAllowedPaths,
          killRunner,
          mode: this.guardrails.getMode('bash_guard', meshName!, agent.name),
        });
        preToolUseHooks.push(bashGuard.createHook());
        log.debug('bash-guard', 'Bash guard enabled', {
          agentId,
          mode: this.guardrails.getMode('bash_guard', meshName!, agent.name),
        });
      }

      // Safe mode gate: block tools based on current safe mode level
      if (this.reliability) {
        const safeModeHook = this.reliability.createSafeModeHook(meshName!, agentId);
        if (safeModeHook) {
          preToolUseHooks.push(safeModeHook);
          log.info('safe-mode', 'Safe mode hook enabled', {
            agentId,
            level: this.reliability.safeMode.getLevel(meshName!),
          });
        }
      }

      // Message gate: enforce max_messages at write time (prevents chokidar race)
      const maxMessages = this.guardrails.getMaxMessages(meshName!, agent.name) ?? (agent as any).max_messages ?? null;
      if (maxMessages != null) {
        const messageGate = new MessageGate({
          agentId,
          msgsDir: this.config.msgsDir,
          maxMessages,
          mode: this.guardrails.getMode('max_messages', meshName!, agent.name),
          killRunner: (reason: string) => {
            const workers = this.workerLifecycle.getForAgent(agentId);
            for (const w of workers) {
              w.runner.kill(reason);
            }
          },
        });
        preToolUseHooks.push(messageGate.createHook());
        log.debug('message-gate', 'Message gate enabled', {
          agentId,
          maxMessages,
          mode: this.guardrails.getMode('max_messages', meshName!, agent.name),
        });
      }

      // Orchestrator gate: restrict Write to msgs dir only
      if (agent.orchestrator) {
        const msgsDir = this.config.msgsDir;
        preToolUseHooks.push({
          matcher: 'Write',
          hooks: [async (input: any) => {
            const filePath = input?.tool_input?.file_path || '';
            if (!filePath.startsWith(msgsDir)) {
              log.warn('orchestrator-gate', `Blocked Write outside msgs dir`, {
                agentId,
                blockedPath: filePath,
                allowedDir: msgsDir,
              });
              return {
                decision: 'block',
                reason: `Orchestrator agents can only write to msgs dir. Blocked: ${filePath}`,
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason: `Orchestrator restricted: Write only allowed to ${msgsDir}`,
                },
              };
            }
            return { decision: 'allow' };
          }],
        });
        log.info('orchestrator-gate', 'Orchestrator gate enabled', { agentId, msgsDir });
      }

      const chaosHooks = preToolUseHooks.length > 0
        ? { PreToolUse: preToolUseHooks }
        : undefined;

      // Create worker config - frontmatter model override takes priority
      const frontmatterModel = nextMsg?.payload?.model as string | undefined;
      let model = frontmatterModel || agent.model;
      if (frontmatterModel) {
        log.info('dispatcher', `Using explicit model from frontmatter for ${agentId}`, {
          from: agent.model,
          to: frontmatterModel
        });
      }
      if (meshConfig?.dev_mode && !frontmatterModel) {
        const original = model;
        model = 'haiku' as SemanticModel;
        if (original !== 'haiku') {
          log.info('dispatcher', `[DEV MODE] ${meshName}: ${agent.name} model override`, { from: original, to: 'haiku' });
        }
      } else if (this.config.ultraLowMode) {
        model = 'haiku' as SemanticModel;
        log.info('dispatcher', `[ULTRA-LOW MODE] Forced model for ${agentId}`, {from: agent.model, to: model});
      } else if (this.config.lowMode && typeof model === 'string' && (model as string).includes('opus')) {
        model = (model as string).replace('opus', 'sonnet') as SemanticModel;
        log.info('dispatcher', `[LOW MODE] Demoted model for ${agentId}`, {from: agent.model, to: model});
      }

      // Use worktree path if set by pre-hooks, otherwise use default workDir
      const workDir = hookContext.worktreePath || this.config.workDir;

      // --- Remaining prompt sections (after gates) ---

      // 4 (cont). Parallel instance context (identity cluster)
      if (meshId) {
        systemPrompt += '\n\n' + this.promptInjector.buildParallelInstanceSection(meshName, meshId);
        log.info('dispatcher', `Appended parallel instance section`, {
          agentId,
          baseMesh: meshName,
          meshId,
        });
      }

      // 8. Rearmatter (output constraints)
      if (meshConfig?.rearmatter?.enabled) {
        systemPrompt += '\n\n' + this.promptInjector.buildRearmatterSection(meshConfig.rearmatter);
        log.info('dispatcher', `Appended rearmatter section`, {
          agentId,
          fields: meshConfig.rearmatter.fields || [],
        });
      }

      // 9. Guardrail state injection (budget awareness)
      {
        const lines: string[] = [];
        if (maxInvocations != null) {
          lines.push(`invocation: ${invocationCount} of ${maxInvocations}`);
        }
        const meshMsgCount = this.meshMessageCounters.get(meshName) || 0;
        const meshMsgLimit = meshConfig?.max_mesh_messages;
        const resolvedMeshMsgLimit = typeof meshMsgLimit === 'number' ? meshMsgLimit
          : (meshMsgLimit && typeof meshMsgLimit === 'object' && 'limit' in meshMsgLimit) ? (meshMsgLimit as { limit?: number | null }).limit
          : this.guardrails.getMaxMeshMessages(meshName);
        if (resolvedMeshMsgLimit != null) {
          lines.push(`mesh_messages: ${meshMsgCount} of ${resolvedMeshMsgLimit}`);
        }
        if (lines.length > 0) {
          systemPrompt += `\n\n## Guardrail State\n\n${lines.join('\n')}\n\nThese are your budget limits for this mesh run. Plan your work accordingly — if you are near a limit, prioritize completing or escalating over starting new work.`;
        }
      }

      // Worktree context (prepend to top) + path sanitization
      if (hookContext.worktreePath && hookContext.featureName) {
        const worktreeContext = `## Worktree Context

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
        systemPrompt = systemPrompt.replaceAll(this.config.workDir, '.');

        log.info('dispatcher', `Prepended worktree context`, {
          agentId,
          featureName: hookContext.featureName,
          worktreePath: hookContext.worktreePath,
        });
      }

      // 10. Messaging & routing (END of prompt — combined cohesive section)
      let routingConfig: Record<string, Record<string, string>> | undefined;
      let dispatcherRoutingCtx: import('../shared/types.ts').DispatchInjectionContext | undefined;

      let freeRoutingCtx: { agentName: string; allAgents: string[]; completionAgents?: string[] } | undefined;

      if (meshConfig?.routing_mode === 'manifest') {
        // Manifest mode: no inter-agent routing — agents write files, resolver handles orchestration
        log.debug('dispatcher', 'Manifest routing mode — skipping routing injection', { agentId });
      } else if (meshConfig?.routing_mode === 'free') {
        // Free mode: agents self-route from full roster
        const allAgents = meshConfig.agents.map(a => a.name);
        freeRoutingCtx = {
          agentName: agent.name,
          allAgents,
          completionAgents: meshConfig.completion_agents,
        };
        log.info('dispatcher', 'Built free routing context', {
          agentId,
          agents: allAgents,
          completionAgents: meshConfig.completion_agents,
        });
      } else if (meshConfig?.routing_mode === 'dispatcher' && meshConfig.routing) {
        const agentNames = meshConfig.agents.map(a => a.name);
        const router = new DispatchRouter(
          meshName,
          meshConfig.routing as import('../shared/types.ts').DispatcherRoutingConfig,
          agentNames
        );
        dispatcherRoutingCtx = router.getInjectionContext(agent.name);
        log.info('dispatcher', 'Built dispatcher routing context', {
          agentId,
          sentinel: dispatcherRoutingCtx.sentinel,
          isTerminal: dispatcherRoutingCtx.isTerminal,
          validOutcomes: dispatcherRoutingCtx.validOutcomes,
          peers: dispatcherRoutingCtx.peers,
        });
      } else {
        routingConfig = this.extractAgentRouting(meshName, agent.name, meshConfig);
        if (routingConfig && Object.keys(routingConfig).length > 0) {
          log.info('dispatcher', `Built agent routing config`, {
            agentId,
            routes: Object.keys(routingConfig),
          });
        }
      }

      const messagingSection = this.promptInjector.buildMessagingAndRoutingSection({
        meshName: meshName!,
        routing: routingConfig,
        dispatcherRouting: dispatcherRoutingCtx,
        freeRouting: freeRoutingCtx,
      });
      systemPrompt += '\n\n' + messagingSection;

      // Section 11: Worker recovery guidance (always-on, every agent)
      systemPrompt += '\n\n' + this.promptInjector.buildWorkerRecoverySection(meshName!, agent.name);

      // --- Save constructed prompt ---
      const fsmState = fsm?.isInitialized() ? fsm.getStatus().currentState : undefined;
      const promptMetadata: Record<string, unknown> = { taskId };
      if (featureName) promptMetadata.featureName = featureName;
      if (fsmState) promptMetadata.fsmState = fsmState;
      if (hookContext.worktreePath) promptMetadata.worktreePath = hookContext.worktreePath;

      try {
        await this.promptInjector.savePrompt(
          meshName,
          agent.name,
          systemPrompt,
          '',
          promptMetadata
        );
      } catch (error) {
        log.warn('dispatcher', 'Failed to save prompt (non-fatal)', {
          agentId,
          error: String(error),
        });
      }

      // --- Create worker config and state machine (prompt is fully assembled) ---
      const workerConfig: WorkerConfig = {
        id: agentId,
        model: model as SemanticModel,
        prompt: systemPrompt
      };

      const isCompletionAgent = this.normalizeCompletionAgents(meshConfig).includes(agent.name);
      const machine = new WorkerStateMachine(agentId, workerConfig, meshName, agent.name, 300000, isCompletionAgent);
      machine.use(createLoggingMiddleware('worker'));
      machine.on('transition', (event) => {
        this.emit('worker:transition', { ...event, entityType: 'worker' });
      });
      await machine.initialize();
      log.info('dispatcher', `Initializing worker`, { agentId });

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
      let resumeSessionAt: string | undefined;
      let forkSession: boolean | undefined;

      // Named conversation: conversation-id → stored SDK session ID
      const frontmatterConversationId = nextMsg?.payload?.['conversation-id'] as string | undefined;
      if (frontmatterConversationId) {
        const storedSessionId = this.queue.getNamedConversationSessionId(agentId, frontmatterConversationId);
        if (storedSessionId) {
          sessionId = storedSessionId;
          log.info('dispatcher', `Resuming named conversation '${frontmatterConversationId}' for ${agentId}`, {
            conversationId: frontmatterConversationId,
            sessionId: sessionId.slice(0, 8) + '...'
          });
        } else {
          log.info('dispatcher', `New named conversation '${frontmatterConversationId}' for ${agentId} (fresh session)`);
        }
      }

      // Raw SDK session-id (existing behavior)
      const frontmatterSessionId = nextMsg?.payload?.['session-id'] as string | undefined;
      if (!frontmatterConversationId && frontmatterSessionId) {
        sessionId = frontmatterSessionId;
        log.info('dispatcher', `Using explicit session-id from frontmatter for ${agentId}`, {
          sessionId: sessionId.slice(0, 8) + '...'
        });
      } else if (!sessionId && !frontmatterConversationId && agent.fork_from) {
        // Session forking: parse fork target for optional :end suffix
        // "narrator" (default=start) or "narrator:end" (full execution context)
        const [forkAgent, forkType] = agent.fork_from.includes(':')
          ? agent.fork_from.split(':') as [string, string]
          : [agent.fork_from, 'start'];

        const checkpointKey = `${meshName}/${forkAgent}`;
        const checkpoint = this.checkpoints.get(checkpointKey);
        if (checkpoint) {
          sessionId = checkpoint.sessionId;
          forkSession = true;  // always fork into new session (isolate from parent)

          if (forkType !== 'end' && checkpoint.initMessageUuid) {
            // Start fork: truncate to init state (system prompt + preloaded files only)
            resumeSessionAt = checkpoint.initMessageUuid;
          }
          // else: end fork — resume full session (no resumeSessionAt, gets full context)

          log.info('dispatcher', `Forking session from ${forkAgent}:${forkType} for ${agentId}`, {
            checkpointKey,
            sessionId,
            resumeSessionAt,
            forkType,
          });
        } else {
          log.warn('dispatcher', `fork_from specified but no checkpoint found for ${forkAgent}`, {
            agentId,
            checkpointKey,
            availableCheckpoints: Array.from(this.checkpoints.keys()),
          });
        }
      } else if (!frontmatterConversationId) {
        // Check for HITL-suspended session first (always honored, independent of continuation)
        const suspended = this.sessionManager.get(agentId);
        const hasSuspendedSession = suspended?.sessionId;

        if (hasSuspendedSession) {
          // HITL resume: always honor — agent asked human a question, human responded
          const existingSession = this.queue.getConversationId(agentId);
          if (existingSession) {
            sessionId = existingSession;
            log.info('dispatcher', `Resuming session for ${agentId}`, {
              sessionId: sessionId.slice(0, 8) + '...',
              reason: 'hitl-resume',
            });
          }
        } else if (this.shouldContinueAgent(agent.name, meshConfig?.continuation)
            || this.shouldPersistAgent(agent.name, meshConfig?.persistence)) {
          // Continuation/persistence: only resume if agent has an active (non-completed) session.
          // Completed sessions cause instant-exit: SDK resumes a finished conversation,
          // sees nothing to do, exits with 0 tokens in <10ms.
          const existingSession = this.queue.getConversationId(agentId);
          if (existingSession) {
            const lastCompleted = this.lastCompletedSessionIds.get(agentId);
            if (lastCompleted === existingSession) {
              // This session already completed — starting fresh to avoid instant-exit
              log.info('dispatcher', `Skipping stale completed session for ${agentId}`, {
                sessionId: existingSession.slice(0, 8) + '...',
                reason: 'completed-session-skip',
              });
              this.queue.clearConversationId(agentId);
            } else {
              sessionId = existingSession;
              log.info('dispatcher', `Resuming session for ${agentId}`, {
                sessionId: sessionId.slice(0, 8) + '...',
                reason: 'continuation',
              });
            }
          }
        }
      }

      const runnerConfig: SdkRunnerConfig = {
        id: agentId,
        model,  // Uses dev_mode / lowMode / ultraLowMode override, not raw agent.model
        systemPrompt,
        workDir,
        msgsDir: this.config.msgsDir,
        routing: routingConfig,
        mcpServers,
        toolRestriction: agent.orchestrator ? 'orchestrator' : meshConfig?.toolRestriction,  // Agent orchestrator overrides mesh-level
        sessionId,  // Resume session if continuation enabled
        resumeSessionAt,  // Point-in-time fork UUID (start forks only)
        forkSession,  // Branch into new session (fork isolation)
        command: agent.command,  // Agent-level slash command
        maxTurns: this.guardrails.getMaxTurns(meshName!, agent.name) ?? agent.max_turns,  // Guardrail > mesh config > null
        maxTurnsMode: this.guardrails.getMode('max_turns', meshName!, agent.name),
        hooks: chaosHooks,  // Chaos contract hooks (write-gate)
        thinking: agent.thinking,  // Extended thinking control (false = disabled)
        permissions: agent.permissions,  // Tool access control from mesh config
        godMode: this.config.godMode,  // God mode from CLI flag
        systemWriter: this.systemWriter,  // Permission denial notifications to core
        env: this.buildAgentEnv(),  // Environment variables for agent shell
        postconditions: agent.postconditions,  // Tool call postconditions from mesh config
        postconditionsMode: this.guardrails.getMode('postcondition', meshName!, agent.name),  // Guardrail mode
      };

      // Prompt size visibility: ~4 chars per token rough estimate
      const promptChars = systemPrompt.length;
      const promptTokensEstimate = Math.ceil(promptChars / 4);
      const PROMPT_WARNING_TOKENS = 80_000;  // Warn if system prompt > ~80K tokens
      if (promptTokensEstimate > PROMPT_WARNING_TOKENS) {
        log.warn('dispatcher', 'Large system prompt detected', {
          agentId, promptChars, promptTokensEstimate,
        });
        log.activity('guardrail:prompt-size', agentId, `System prompt ~${promptTokensEstimate} tokens (${promptChars} chars) — may limit agent output capacity`);
      } else {
        log.debug('dispatcher', 'System prompt size', {
          agentId, promptChars, promptTokensEstimate,
        });
      }

      const worker: Runner = agent.chrome
        ? new ChromeCliRunner({
            id: runnerConfig.id,
            model: runnerConfig.model,
            systemPrompt: runnerConfig.systemPrompt,
            workDir: runnerConfig.workDir,
            msgsDir: runnerConfig.msgsDir,
            maxTurns: runnerConfig.maxTurns,
            env: runnerConfig.env,
          }, this.queue)
        : new SdkRunner(runnerConfig, this.queue);
      workerRef.current = worker;  // Populate ref for write-gate kill callback

      // Reliability: register agent for heartbeat monitoring + circuit breaker check
      if (this.reliability) {
        const spawnCheck = this.reliability.canSpawn(meshName!, agentId);
        if (!spawnCheck.allowed) {
          log.warn('dispatcher', `Spawn blocked by reliability`, {
            agentId, reason: spawnCheck.reason,
          });
          log.activity('reliability:blocked', agentId, spawnCheck.reason || 'blocked');
          return;
        }
        // Pass mesh-level heartbeat config overrides (e.g. longer thresholds for slow agents)
        const meshReliability = meshName ? this.meshConfigs.get(meshName)?.reliability : undefined;
        this.reliability.registerAgent(agentId, meshReliability?.heartbeat);
      }

      // Parity gate: emit session-start for consumer to clear stale pending asks
      this.emit('session-start', { agentId });

      // Clear any stale ask-response buffer for this agent
      this.sessionManager.clearBuffer(agentId);

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
        // Reliability: heartbeat on output
        this.reliability?.recordHeartbeat(agentId);
        this.emit('worker:output', data);
      });

      worker.on('init', (data) => {
        if (data.sessionId) {
          // Eagerly persist sessionId — if the worker crashes mid-run, these survive:

          // 1. Guardrail steering can resume this session on routing/FSM violations
          this.lastCompletedSessionIds.set(agentId, data.sessionId);

          // 2. Continuation/persistence resume works even after crash
          this.queue.setConversationId(agentId, data.sessionId);

          // 3. Session store gets an early record (status: running)
          //    Completion will overwrite via INSERT OR REPLACE with final data
          if (this.sessionStore) {
            this.sessionStore.recordSession({
              id: data.sessionId,
              agentId,
              meshId: meshName,
              startedAt: Date.now(),
              transcriptPath: '',  // Not yet known — updated at completion
              finalStatus: 'running',
              createdAt: Date.now(),
            });
          }

          // 4. Start checkpoint for fork_from
          const cpType = resolveCheckpointType(agent.checkpoint);
          if (cpType === 'start') {
            const checkpointKey = `${meshName}/${agent.name}`;
            this.checkpoints.set(checkpointKey, {
              sessionId: data.sessionId,
            });
            log.info('dispatcher', `Start checkpoint saved at init for ${agentId}`, {
              checkpointKey,
              sessionId: data.sessionId,
            });
          }

          log.info('dispatcher', `Session eagerly persisted at init`, {
            agentId,
            sessionId: data.sessionId.slice(0, 8) + '...',
          });
        }

        this.emit('worker:init', data);
      });

      // Permission ask: agent wants to use an unapproved tool, waiting for human decision.
      // Halts mesh (same as ask-human) and tracks pending permission for response routing.
      worker.on('permission-ask', (data: { id: string; toolName: string; toolUseID: string }) => {
        log.info('dispatcher', 'Permission ask — mesh paused for human approval', {
          agentId: data.id,
          toolName: data.toolName,
          toolUseID: data.toolUseID,
          meshName,
        });

        // Track pending permission (for response routing)
        this.pendingPermissionAsks.set(data.id, {
          toolUseID: data.toolUseID,
          runner: worker,
        });

        // Halt mesh (same as ask-human — prevents other workers from spawning)
        if (meshName) {
          const pendingCount = this.queue.countPending(data.id);
          this.writeHaltedFile(meshName, agent.name, pendingCount);
        }

        this.emit('worker:permission-ask', {
          agentId: data.id,
          toolName: data.toolName,
          meshName,
        });
      });

      // init-anchor: first user message UUID — the earliest persistable anchor point.
      // system:init UUIDs are transient streaming events not stored in the session JSONL.
      // --resume-session-at requires a UUID that exists in the persisted session.
      worker.on('init-anchor', (data) => {
        const cpType = resolveCheckpointType(agent.checkpoint);
        if (cpType === 'start' && meshName) {
          const checkpointKey = `${meshName}/${agent.name}`;
          const existing = this.checkpoints.get(checkpointKey);
          if (existing) {
            existing.initMessageUuid = data.firstUserMessageUuid;
            log.info('dispatcher', `Init anchor set for ${agentId}`, {
              checkpointKey,
              firstUserMessageUuid: data.firstUserMessageUuid,
            });
          }
        }
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

        // Blocking HITL: worker finished its turn but is waiting for human response
        // Hold — don't route downstream, don't cleanup, don't complete FSM
        // Also prevents the pending-asks suspension check later from running,
        // which would incorrectly suspend a blocking HITL worker
        if (activeWorker?.blockingHitl) {
          log.info('dispatcher', 'Blocking HITL: holding completion until human responds', {
            agentId,
            workerId: currentWorkerId,
            sessionId: data.sessionId?.slice(0, 8),
          });
          // Save transcript for debugging but don't proceed with completion
          if (data.output) {
            this.saveSessionOutput(agentId, data.output);
          }
          return;
        }

        // Set worker output and sessionId in hook context for quality hooks
        workerHookContext.workerOutput = data.output;
        workerHookContext.sessionId = data.sessionId;

        // Save output for debugging (but DON'T complete FSM yet)
        let transcriptPath: string | null = null;
        if (data.output) {
          transcriptPath = this.saveSessionOutput(agentId, data.output);
        }

        // ENSEMBLE MODE: Record output and return early (no FSM transition, no post-hooks)
        if (workerHookContext.ensembleId) {
          log.info('dispatcher', `Ensemble worker completed, recording result`, {
            agentId,
            ensembleId: workerHookContext.ensembleId,
            ensembleIndex: workerHookContext.ensembleIndex,
            outputLength: data.output?.length || 0,
          });

          this.ensembleCoordinator.recordAgentResult(
            workerHookContext.ensembleId,
            agent.name,
            data.output || '',
            undefined, // no error
            workerHookContext.ensembleIndex
          );

          // Cleanup using consolidated helper
          this.cleanupWorker(agentId, currentWorkerId);

          this.emit('worker:complete', {
            ...data,
            workerId: currentWorkerId,
            ensembleId: workerHookContext.ensembleId,
            transitionName: 'ensemble-complete',
          });

          return;
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
                // Resume the session with feedback - 'complete' will fire again when done
                const resumeResult = await this.resumeSession({
                  reason: 'quality-iteration',
                  agentId,
                  sessionId: data.sessionId,
                  prompt: error.feedback,
                  runner: worker,
                  metadata: { iteration: workerHookContext.qualityIteration },
                });

                if (resumeResult.success) {
                  // Resume succeeded, the 'complete' event handler will be called again
                  return;
                }
                // Fall through to complete the FSM with the original result
              } else {
                // No sessionId available - fall back to legacy respawn behavior
                log.warn('dispatcher', 'No sessionId available, falling back to respawn', {
                  agentId,
                  workerId: currentWorkerId,
                  iteration: workerHookContext.qualityIteration,
                });

                // Complete FSM first to avoid race condition
                await machine.complete(data);
                // Cleanup worker state (processNextQueuedMessage will be called, but respawn below will add a new worker)
                this.cleanupWorker(agentId, currentWorkerId);

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
              // Cleanup using consolidated helper
              this.cleanupWorker(agentId, currentWorkerId);

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

            // Save to suspendedSessions via SessionManager (handles both in-memory and SQLite)
            this.sessionManager.suspend(agentId, {
              sessionId,
              reason: 'await-response',
              meshName,
              agentConfig: agent,
              targetAgents: Array.from(allTargets),
              pendingCount,
              hookContext: workerHookContext,
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

        // Artifact validation: check manifest writes, retry up to max_retry, then kill mesh
        const meshConfigForValidation = this.meshConfigs.get(meshName);
        if (meshConfigForValidation?.manifest) {
          const enforcement = meshConfigForValidation.manifest_enforcement;
          const postValidation = enforcement?.post_validation !== false; // default: true
          const maxRetry = enforcement?.max_retry ?? 2;

          if (postValidation) {
            // Refresh variable cache from session.yaml (agent just completed, session should be current)
            const wsLocs = (meshConfigForValidation as any)?.workspace?.locations || {};
            const freshVars = this.resolveManifestVariables(meshName, wsLocs);
            this.cachedManifestVars.set(meshName, freshVars);
            const ctx = buildPathContext(this.config.workDir, meshConfigForValidation as any, freshVars);
            const validation = validateAgentArtifacts(agent.name, meshConfigForValidation.manifest, 'writes', ctx);

            if (validation.missing.length > 0) {
              const manifestMode = { strict: meshConfigForValidation.manifest_enforcement?.strict ?? false, warning: meshConfigForValidation.manifest_enforcement?.warning ?? true };
              if (!manifestMode.strict) {
                // Non-strict: allow completion, optionally log
                if (manifestMode.warning) {
                  log.warn('dispatcher', 'Artifact post-validation failed (warning mode, allowing)', {
                    agentId,
                    missing: validation.missing,
                    meshName,
                  });
                  log.activity('guardrail:artifact-post:warning', agentId, `Artifact warning: ${validation.missing.join(', ')} missing (completing anyway)`);
                }
                // Fall through to normal completion
              } else {
                const retryCount = (workerHookContext.artifactRetryCount || 0) + 1;
                workerHookContext.artifactRetryCount = retryCount;

                this.emit('worker:artifact-missing', {
                  agentId,
                  missing: validation.missing,
                  meshName,
                  retry: retryCount,
                });

                if (retryCount >= maxRetry) {
                  log.error('dispatcher', `Artifact validation failed after ${retryCount} attempts, killing mesh`, {
                    agentId,
                    missing: validation.missing,
                    meshName,
                    maxRetry,
                  });
                  log.activity('guardrail:artifact-halt', agentId, `Artifact STRICT HALT: ${validation.missing.join(', ')} missing after ${retryCount} retries — killing mesh`);
                  this.emit('mesh:artifact-halt', { agentId, missing: validation.missing, meshName, retryCount });

                  this.cleanupWorker(agentId, currentWorkerId);
                  this.clearMeshState(meshName);
                  return;
                }

                log.warn('dispatcher', `Artifact validation: missing files, resuming for retry`, {
                  agentId,
                  missing: validation.missing,
                  checked: validation.checked,
                  retry: retryCount,
                  maxRetry,
                });
                log.activity('guardrail:artifact-retry', agentId, `Artifact STRICT RETRY (${retryCount}/${maxRetry}): ${validation.missing.join(', ')} missing — resuming session`);

                if (data.sessionId) {
                  const feedback = `Artifact validation failed. You were expected to write: ${validation.missing.join(', ')}. These files do not exist. Write them now.`;
                  const resumeResult = await this.resumeSession({
                    reason: 'artifact-retry',
                    agentId,
                    sessionId: data.sessionId,
                    prompt: feedback,
                    runner: worker,
                    metadata: { retry: retryCount, missing: validation.missing },
                  });

                  if (resumeResult.success) {
                    return; // 'complete' handler fires again after resume
                  }
                  log.warn('dispatcher', `Artifact retry resume failed, completing anyway`, { agentId });
                }
              }
            }
          }
        }

        // Postcondition validation: check if worker failed postcondition checks
        if (data.error && data.error.includes('Postcondition validation failed')) {
          const postconditionMode = this.guardrails.getMode('postcondition', meshName, agent.name);

          if (postconditionMode.strict) {
            // Strict mode: halt mesh execution and route error to core/core
            log.error('dispatcher', 'Postcondition validation failed (strict mode) - halting mesh', {
              agentId,
              meshName,
              error: data.error,
            });

            log.activity('guardrail:postcondition:halt', agentId, `Postcondition STRICT HALT: ${data.error}`);

            // Notify core/core of the failure
            this.systemWriter?.write({
              to: 'core/core',
              from: agentId,
              headline: `Postcondition validation failed: ${agent.name}`,
              body: `Agent \`${agentId}\` failed postcondition validation in strict mode.\n\n**Error**: ${data.error}\n\nThe mesh has been halted. Review the agent's postcondition configuration and ensure the agent performs the required actions.`,
            });

            // Complete FSM with error (this will mark the worker as errored)
            await machine.error(data.error);

            // Cleanup worker state
            this.cleanupWorker(agentId, currentWorkerId);

            // Halt the mesh
            this.emit('mesh:postcondition-halt', { agentId, meshName, error: data.error });
            this.clearMeshState(meshName);

            return;
          } else if (postconditionMode.warning) {
            // Warning mode: log and continue (feedback already injected by sdk-runner)
            log.warn('dispatcher', 'Postcondition validation failed (warning mode) - continuing', {
              agentId,
              meshName,
              error: data.error,
            });

            log.activity('guardrail:postcondition:warning', agentId, `Postcondition warning: ${data.error} (continuing)`);

            // Continue with normal completion (warning feedback already in session output)
          }
        }

        // Instant-exit detection: sdk-runner flagged this as a zero-work completion.
        // Halt the agent to prevent infinite respawn loops (nudge → instant-exit → nudge).
        if (data.error && data.error.includes('Instant-exit detected')) {
          const failCount = this.queue.incrementInstantExitFailure(agentId);

          log.warn('dispatcher', `Instant-exit failure ${failCount}/${WorkerDispatcher.CASCADE_HALT_THRESHOLD}`, {
            agentId, failCount, error: data.error,
          });

          if (failCount >= WorkerDispatcher.CASCADE_HALT_THRESHOLD) {
            log.error('dispatcher', `CASCADE HALT: ${agentId} failed ${failCount} consecutive times — halting mesh`, {
              agentId, meshName, failCount,
            });
            log.activity('guardrail:cascade-halt', agentId, `CASCADE HALT: ${failCount} consecutive instant-exits — mesh halted`);

            this.systemWriter?.write({
              to: 'core/core',
              from: agentId,
              headline: `Cascade halt: ${agent.name} instant-exited ${failCount} times`,
              body: `Agent \`${agentId}\` has instant-exited ${failCount} consecutive times (0 tool calls, <10s duration).\n\n` +
                `The mesh has been halted to prevent infinite respawn loops.\n\n` +
                `**Last error**: ${data.error}\n\n` +
                `Options:\n` +
                `1. \`tx mesh clear ${meshName}\` — reset and try again\n` +
                `2. Check the agent's prompt and command configuration\n` +
                `3. Check if the agent's session is stuck in a completed state`,
            });

            await machine.error(data.error);
            this.cleanupWorker(agentId, currentWorkerId);
            this.clearMeshState(meshName);
            return;
          }

          // Below threshold: route as error so downstream doesn't proceed with empty output
          await machine.error(data.error);
          this.cleanupWorker(agentId, currentWorkerId);
          this.emit('worker:error', {
            ...data,
            workerId: currentWorkerId,
            transitionName: 'error',
            instantExit: true,
          });
          return;
        }

        // Successful completion — reset cascade failure counter
        if (!data.error && data.messagesProcessed > 0) {
          this.queue.clearInstantExitFailure(agentId);
        }

        // Complete the FSM (after post-hooks pass or exhausted)
        // Defense-in-depth: catch ValidationError if worker tries to complete with pending asks
        try {
          await machine.complete(data);
        } catch (completeError) {
          const errorMsg = (completeError as Error).message;

          // Check if this is a protocol violation (completing with pending asks)
          if (errorMsg.includes('PROTOCOL VIOLATION') || errorMsg.includes('outstanding asks')) {
            // It's OUTGOING asks (awaiting responses) - just block
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

        // Accumulate worker metrics into session metrics (delegates to MetricsAggregator)
        if (data.metrics && workerHookContext.meshInstance) {
          this.metricsAggregator.trackWorkerComplete(workerHookContext.meshInstance, {
            agentId,
            model: agent.model,
            queries: data.metrics.queries,
            totalInputTokens: data.metrics.totalInputTokens,
            totalOutputTokens: data.metrics.totalOutputTokens,
            totalCostUsd: data.metrics.totalCostUsd,
            totalDurationMs: data.metrics.totalDurationMs,
            totalToolCalls: data.metrics.totalToolCalls,
            startedAt: data.metrics.startedAt,
            messageCount: data.metrics.messageCount,
            toolCalls: data.metrics.toolCalls,
          });
        }

        // Schedule nudge check BEFORE removing worker (needs messagesSent)
        if (this.nudgeDetector && activeWorker && meshConfig?.routing) {
          const agentNames = (meshConfig.agents || []).map((a: AgentConfig) => a.name);
          this.nudgeDetector.scheduleCheck({
            agentId,
            meshName,
            messagesSent: [...activeWorker.messagesSent],
            output: data.output || '',
            taskBody: workerHookContext.taskBody || '',
            routing: meshConfig.routing as Record<string, unknown>,
            agentNames,
          });
        }

        // Budget exhaustion detection: notify core when agent hit max_turns ceiling
        if (runnerConfig.maxTurns && data.metrics) {
          const totalTurns = data.metrics.queries.reduce((sum: number, q: { numTurns: number }) => sum + q.numTurns, 0);
          if (totalTurns >= runnerConfig.maxTurns) {
            log.warn('dispatcher', 'Agent exhausted max_turns budget', {
              agentId, maxTurns: runnerConfig.maxTurns, totalTurns,
            });
            this.systemWriter?.write({
              to: 'core/core',
              from: agentId,
              headline: `Budget exhausted: ${agent.name} hit max_turns (${totalTurns}/${runnerConfig.maxTurns})`,
              body: `Agent \`${agentId}\` completed after using all ${runnerConfig.maxTurns} turns. Its work may be incomplete.\n\n**Output summary** (last 500 chars):\n\`\`\`\n${(data.output || '').slice(-500)}\n\`\`\`\n\nConsider increasing \`max_turns\` for this agent or reviewing its task scope.`,
            });
          }
        }

        // Context saturation detection: agent completed with 0 messages sent
        // and consumed a large portion of context on input (prompt + loaded files)
        const messagesSent = activeWorker?.messagesSent?.length || 0;
        if (data.metrics && messagesSent === 0) {
          const totalInput = data.metrics.totalInputTokens || 0;
          const totalOutput = data.metrics.totalOutputTokens || 0;
          // High input-to-total ratio with low output suggests context saturation
          const MODEL_CONTEXT_WINDOW = 200_000;  // All Claude models via SDK
          const inputRatio = totalInput / MODEL_CONTEXT_WINDOW;
          if (inputRatio > 0.6 && totalOutput < 10_000) {
            log.warn('dispatcher', 'Context saturation detected', {
              agentId, totalInput, totalOutput,
              inputRatio: Math.round(inputRatio * 100) + '%',
              promptCharsEstimate: systemPrompt.length,
            });
            this.systemWriter?.write({
              to: 'core/core',
              from: agentId,
              headline: `Context saturated: ${agent.name} used ${Math.round(inputRatio * 100)}% of context window on input`,
              body: `Agent \`${agentId}\` completed without sending any messages. It consumed ~${Math.round(totalInput / 1000)}K of ~${MODEL_CONTEXT_WINDOW / 1000}K context tokens on input (system prompt + loaded files), leaving limited space for output.\n\nSystem prompt: ~${Math.round(systemPrompt.length / 4000)}K tokens\nOutput generated: ~${Math.round(totalOutput / 1000)}K tokens\n\nThis agent likely couldn't fit its full workflow into the remaining context. Consider:\n- Reducing the system prompt size\n- Splitting the task across multiple agents\n- Reducing file preloads\n- Starting a fresh session (clean context window)`,
            });
          }
        }

        // Track last completed session for routing self-heal (resume context on correction)
        if (data.sessionId) {
          this.lastCompletedSessionIds.set(agentId, data.sessionId);
        }

        this.removeActiveWorker(agentId, currentWorkerId);
        this.writeWorkerState();

        // Check for buffered ask-responses that arrived during race window
        // (between isRunning() check and completion)
        const bufferedResponses = this.sessionManager.getBufferedResponses(agentId);
        if (bufferedResponses.length > 0 && data.sessionId) {
          log.info('dispatcher', `Processing buffered ask-responses post-completion`, {
            agentId,
            sessionId: data.sessionId.slice(0, 8),
            responseCount: bufferedResponses.length,
          });

          // Clear and get responses atomically
          const responses = this.sessionManager.getAndClearBufferedResponses(agentId);

          // Resume session with buffered responses
          await this.resumeSession({
            reason: 'ask-response',
            agentId,
            sessionId: data.sessionId,
            prompt: this.sessionManager.buildAskResponsePrompt(responses),
            runner: worker,
            metadata: { responseCount: responses.length, postCompletion: true },
          });

          return; // New complete event will fire when resume finishes
        }

        this.sessionManager.clearBuffer(agentId);

        // Check if mesh session is complete
        this.checkSessionComplete(workerHookContext.meshInstance);

        // Check if a deferred mesh completion can now finalize
        const workerMeshName = agentId.split('/')[0];
        this.checkPendingCompletion(workerMeshName);

        // Save session ID for continuation (if enabled and session captured)
        const agentName = agentId.split('/')[1];
        if ((this.shouldContinueAgent(agentName, meshConfig?.continuation)
          || this.shouldPersistAgent(agentName, meshConfig?.persistence)) && data.sessionId) {
          this.queue.setConversationId(agentId, data.sessionId);
          log.info('dispatcher', `Session saved for ${agentId}`, {
            sessionId: data.sessionId.slice(0, 8) + '...'
          });
        }

        // Save named conversation mapping (conversation-id → SDK session)
        const messageConversationId = nextMsg?.payload?.['conversation-id'] as string | undefined;
        if (messageConversationId && data.sessionId) {
          this.queue.setNamedConversationSessionId(agentId, messageConversationId, data.sessionId);
          log.info('dispatcher', `Named conversation '${messageConversationId}' saved for ${agentId}`, {
            conversationId: messageConversationId,
            sessionId: data.sessionId.slice(0, 8) + '...'
          });
        }

        // Save end checkpoint for session forking.
        // Start checkpoints are saved at init time (early save). End checkpoints
        // capture the full execution context for continuation-style forks.
        // Preserves initMessageUuid from the start checkpoint if one was saved.
        const cpType = resolveCheckpointType(agent.checkpoint);
        if (cpType === 'end' && data.sessionId && meshName) {
          const checkpointKey = `${meshName}/${agentName}`;
          const existing = this.checkpoints.get(checkpointKey);
          this.checkpoints.set(checkpointKey, {
            sessionId: data.sessionId,
            initMessageUuid: existing?.initMessageUuid,  // preserve from init save
          });
          log.info('dispatcher', `End checkpoint saved for ${agentId}`, {
            checkpointKey,
            sessionId: data.sessionId.slice(0, 8) + '...',
          });
        } else if (cpType === 'start' && data.sessionId && meshName) {
          // Start-only checkpoint: update sessionId at completion (idempotent, session constant)
          const checkpointKey = `${meshName}/${agentName}`;
          const existing = this.checkpoints.get(checkpointKey);
          if (existing) {
            this.checkpoints.set(checkpointKey, {
              ...existing,
              sessionId: data.sessionId,
            });
          }
        }

        // Save reliability checkpoint at FSM state boundaries
        // Every agent completion in an FSM mesh records the session ID
        // keyed by the current FSM state — enables rewind-to recovery
        if (this.reliability && data.sessionId && meshName) {
          const fsm = this.meshFSMs.get(meshName);
          if (fsm?.isInitialized()) {
            const fsmState = fsm.getStatus().currentState;
            this.reliability.checkpoints.save({
              meshName,
              stateName: fsmState,
              agentId,
              sessionId: data.sessionId,
              fromState: fsmState,
              context: fsm.getContext() as Record<string, unknown>,
            });
          }
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
        // Always update if sessionStore exists — init eagerly created a 'running' record
        if (this.sessionStore && data.sessionId) {
          const sessionStartTime = activeWorker?.startedAt || Date.now();
          const sessionEndTime = Date.now();

          // Get files changed from the runner if available
          const filesChanged = activeWorker?.runner?.getFilesChanged?.() || undefined;

          // Record session metadata (overwrites init-time 'running' record)
          this.sessionStore.recordSession({
            id: data.sessionId,
            agentId,
            meshId: meshName,
            startedAt: sessionStartTime,
            endedAt: sessionEndTime,
            durationSeconds: Math.floor((sessionEndTime - sessionStartTime) / 1000),
            transcriptPath: transcriptPath || '',
            messageCount: data.metrics?.messageCount,
            toolCalls: data.metrics?.toolCalls,
            finalStatus: 'success',
            filesChanged,
            createdAt: Date.now(),
          });

          // Generate headline async (don't block completion)
          if (this.sessionSummarizer && transcriptPath) {
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
          }

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

        // Track completed agent for preflight filtering
        if (meshName) {
          if (!this.completedAgents.has(meshName)) {
            this.completedAgents.set(meshName, new Set());
          }
          this.completedAgents.get(meshName)!.add(agent.name);

          // Refresh cached manifest variables from session.yaml (now up-to-date)
          const wsLocations = (meshConfig as any)?.workspace?.locations || {};
          this.cachedManifestVars.set(meshName, this.resolveManifestVariables(meshName, wsLocations));

          // Manifest routing: update writtenFiles and resolve next agents
          if (meshConfig?.routing_mode === 'manifest' && meshConfig.manifest) {
            this.handleManifestCompletion(meshName, agent.name, meshConfig);
          }

          // Parallel block handling: spawn parallel agents when entry completes
          if (meshConfig?.parallelism) {
            this.handleParallelBlockCompletion(meshName, agent.name, meshConfig);
          }
        }

        this.emit('worker:complete', {
          ...data,
          workerId: currentWorkerId,
          transitionName: 'complete',
          qualityResult: workerHookContext.qualityPreflight
            ? { iterations: workerHookContext.qualityIteration || 1, passed: true }
            : undefined,
        });

        // Reliability: record successful completion
        const durationMs = Date.now() - (activeWorker?.startedAt || Date.now());
        this.reliability?.recordSuccess(meshName!, agentId, durationMs);

        // OAOM: Check queue for next message
        this.processNextQueuedMessage(agentId);
      });

      // Error transition with retry logic
      worker.on('error', async (data) => {
        const errorWorkerId = registeredWorkerId || 'unknown';

        // Track last completed session even on error — preserves conversation context
        // for guardrail steering and potential retry/resume flows
        if (data.sessionId) {
          this.lastCompletedSessionIds.set(agentId, data.sessionId);

          // Update session record from 'running' to 'error'
          if (this.sessionStore) {
            this.sessionStore.updateSession(data.sessionId, {
              endedAt: Date.now(),
              finalStatus: 'error',
            });
          }
        }

        // Suppress retry for workers killed intentionally (ask-human / ask-agent suspend)
        if (this.sessionManager.isSuspended(agentId)) {
          log.info('dispatcher', 'Suppressing retry for suspended worker', {
            agentId, workerId: errorWorkerId,
          });
          this.removeActiveWorker(agentId, errorWorkerId);
          return;
        }

        // Guardrail kill convergence — unified cleanup path
        if (worker.wasGuardrailKill()) {
          const { guardrail, source } = this.inferGuardrail(worker.getKillReason()!);
          this.onGuardrailKill({
            agentId, meshName: meshName!, workerId: errorWorkerId,
            guardrail, reason: worker.getKillReason()!, source,
          });
          this.emit('worker:error', { ...data, workerId: errorWorkerId, guardrailKill: true });
          return;
        }

        // Get hook context for this worker
        const workerInfo = registeredWorkerId ? this.getWorkerByWorkerId(registeredWorkerId) : null;
        const activeWorker = workerInfo?.worker;
        const workerHookContext = activeWorker?.hookContext || hookContext;

        // Check for expected exit patterns (CLI exits with code 1 after work, or abort from kill)
        const isExitCode1 = data.error?.includes('exited with code 1');
        const isAbortError = data.error?.includes('aborted by user') ||
                            data.error?.includes('process aborted');
        const workerWroteMessages = activeWorker?.messagesSent && activeWorker.messagesSent.length > 0;

        // If the worker wrote messages and then exited with code 1, treat as completion
        // The CLI regularly exits non-zero after successful work
        if (isExitCode1 && workerWroteMessages) {
          log.warn('dispatcher', `Worker exited with code 1 after writing messages — treating as completion`, {
            agentId, workerId: errorWorkerId,
            messagesSent: activeWorker!.messagesSent.length,
          });
          this.cleanupWorker(agentId, errorWorkerId);
          this.processNextQueuedMessage(agentId);
          return;
        }

        // Demote expected exits that didn't produce work — clean up without retry
        if (isAbortError) {
          log.debug('dispatcher', `Worker aborted (expected)`, {
            agentId, workerId: errorWorkerId,
          });
          this.cleanupWorker(agentId, errorWorkerId);
          this.processNextQueuedMessage(agentId);
          return;
        }

        // Max turns exhaustion: agent hit max_turns limit — don't retry, treat as completion
        const isMaxTurnsError = data.error?.includes('max turns') ||
                                data.error?.includes('error_max_turns');
        if (isMaxTurnsError) {
          log.warn('dispatcher', `Agent hit max_turns limit — treating as completion (no retry)`, {
            agentId, workerId: errorWorkerId, error: data.error,
          });
          this.systemWriter?.write({
            to: 'core/core',
            from: agentId,
            headline: `Budget exhausted: ${agent.name} hit max_turns`,
            body: `Agent \`${agentId}\` was stopped after reaching its max_turns limit. Its work may be incomplete.\n\nConsider increasing \`max_turns\` for this agent or reviewing its task scope.`,
          });
          this.cleanupWorker(agentId, errorWorkerId);
          this.processNextQueuedMessage(agentId);
          return;
        }

        // ENSEMBLE MODE: Record error and return early (no FSM retry logic)
        if (workerHookContext.ensembleId) {
          log.warn('dispatcher', `Ensemble worker failed, recording error`, {
            agentId,
            ensembleId: workerHookContext.ensembleId,
            ensembleIndex: workerHookContext.ensembleIndex,
            error: data.error,
          });

          this.ensembleCoordinator.recordAgentResult(
            workerHookContext.ensembleId,
            agent.name,
            '',
            data.error,
            workerHookContext.ensembleIndex
          );

          // Cleanup using consolidated helper
          this.cleanupWorker(agentId, errorWorkerId);

          this.emit('worker:error', {
            ...data,
            workerId: errorWorkerId,
            ensembleId: workerHookContext.ensembleId,
            transitionName: 'ensemble-error',
          });

          return;
        }

        await machine.error(data.error);

        // Reliability: categorize failure
        const category = data.error?.includes('usage policy') ? 'policy_violation'
          : data.error?.includes('timeout') ? 'timeout'
          : data.error?.includes('overloaded') ? 'model_error'
          : 'crash';

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
              this.processNextQueuedMessage(agentId);
            }
          }, 1000);
        } else {
          log.error('dispatcher', `Worker exhausted retries`, { agentId, workerId: errorWorkerId });

          // Reliability: route to DLQ with session context for recovery
          if (this.reliability) {
            const sessionId = activeWorker?.runner.getSessionId() || undefined;
            const msgsSent = activeWorker?.messagesSent?.length || 0;
            this.reliability.deadLetter(meshName!, agentId, category, data.error || 'Unknown error', {
              sessionId,
              messagesSent: msgsSent,
              fromAgent: nextMsg?.from_agent,
              toAgent: agentId,
              msgType: nextMsg?.type,
              payload: nextMsg?.payload as Record<string, unknown>,
              sourceFile: nextMsg?.source_file,
            });
          }

          // Cleanup using consolidated helper
          this.cleanupWorker(agentId, errorWorkerId);
        }

        this.emit('worker:error', { ...data, workerId: errorWorkerId, transitionName: 'error' });

        // Reliability: record failure
        this.reliability?.recordFailure(meshName!, agentId, category as any, data.error);
      });

      // Add worker to active workers with unique workerId for parallel execution
      // Pass taskFrom to track who sent the initial task (for completion message enforcement)
      const taskFrom = nextMsg?.from_agent;
      const workerId = this.addActiveWorker(agentId, {
        runner: worker,
        machine,
        startedAt: Date.now(),
        hookContext,
        startedPromise,  // Add promise to track 'start' transition
      }, taskFrom);
      // Set the registeredWorkerId so event handlers can reference it
      registeredWorkerId = workerId;
      log.debug('dispatcher', `Worker registered`, { agentId, workerId, taskFrom });
      this.writeWorkerState();
      // Emit spawn AFTER state write so status readers see the new worker
      this.emit('worker:spawn', { agentId, model: runnerConfig.model });

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

  // normalizeFSMConfig moved to MeshConfigLoader (Phase 2)

  /**
   * Try to load a mesh on-demand when a message arrives for an unloaded mesh
   * Delegates to MeshConfigLoader (Phase 2 refactoring)
   */
  private async tryLoadMeshOnDemand(meshName: string): Promise<boolean> {
    try {
      const loaded = this.configLoader.loadOnDemand(meshName);

      if (loaded) {
        // Sync the newly loaded config to local map
        const config = this.configLoader.get(meshName);
        if (config) {
          this.meshConfigs.set(meshName, config);

          // Register mesh-local guardrails if present
          if (config.guardrails) {
            this.guardrails.registerMesh(meshName, config.guardrails);
          }

          // Initialize FSM if needed - MUST await to ensure state is persisted
          // before any message validation or context injection
          if (config.fsm) {
            await this.initializeSingleFSM(meshName, config);
          }
        }
        log.info('dispatcher', 'Mesh loaded on-demand', { meshName });
        return true;
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

  // findConfigInDir moved to MeshConfigLoader (Phase 2)

  /**
   * Initialize FSM for a single mesh (called during JIT loading)
   * CRITICAL: This method is async and MUST be awaited to ensure FSM state is persisted
   * before any message validation occurs. The FSM.initialize() writes initial state to SQLite.
   */
  private async initializeSingleFSM(meshName: string, config: MeshConfig): Promise<void> {
    try {
      const fsm = new MeshFSM(
        meshName,
        config.fsm!,
        this.queue.getDatabase(),
        config._basePath || this.config.workDir,
        this.config.workDir,
        this.systemWriter
      );

      // Wire FSM events using consolidated helper
      this.wireFSMEvents(fsm, meshName);

      // CRITICAL: Clean stale gate files BEFORE initializing FSM state
      // This prevents infinite loops when re-running a mesh that left gate files from a prior run.
      // Must happen before initialize() which creates/loads persistent state.
      const clearedGateFiles = fsm.cleanGateFiles();
      if (clearedGateFiles > 0) {
        log.info('dispatcher', 'Cleaned stale gate files before FSM init', {
          meshName,
          clearedGateFiles,
        });
      }

      // Store in map first so it's accessible during initialization callbacks
      this.meshFSMs.set(meshName, fsm);

      // Initialize the FSM - MUST await to ensure state is persisted
      try {
        await fsm.initialize();
        log.debug('mesh-fsm', 'FSM initialized successfully', {
          meshName,
          initialState: fsm.getCurrentState(),
        });
      } catch (initError) {
        log.error('mesh-fsm', 'Failed to initialize FSM (JIT)', {
          meshName,
          error: (initError as Error).message,
        });
        // Remove from map on init failure so it can be retried
        this.meshFSMs.delete(meshName);
        throw initError;
      }
    } catch (error) {
      log.error('mesh-fsm', 'Failed to create FSM (JIT)', {
        meshName,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Load all mesh configs from meshes/ directory structure
   * Delegates to MeshConfigLoader (Phase 2 refactoring)
   * CRITICAL: This method is async because FSM initialization must complete
   * before the dispatcher starts processing messages.
   */
  private async loadMeshConfigs(): Promise<void> {
    // Wire up config loader events
    this.configLoader.on('mesh:loaded', (data) => this.emit('mesh:loaded', data));
    this.configLoader.on('mesh:invalid', (data) => this.emit('mesh:invalid', data));
    this.configLoader.on('error', (data) => this.emit('error', data));

    // Load all configs using the extracted module
    this.meshConfigs = this.configLoader.loadAll();

    // Register mesh-local guardrails from loaded configs
    for (const [meshName, config] of this.meshConfigs) {
      if (config.guardrails) {
        this.guardrails.registerMesh(meshName, config.guardrails);
      }
      if (config.dev_mode) {
        log.warn('dispatcher', `[DEV MODE] Mesh '${meshName}' has dev_mode enabled — all agents forced to haiku`, {
          meshName,
          agents: config.agents.map(a => `${a.name}(${a.model})`),
        });
      }
    }

    // Initialize FSMs for meshes that have fsm config - MUST await
    await this.initializeFSMs();
  }

  /**
   * Initialize FSM instances for meshes with fsm config
   * CRITICAL: This method is async and MUST be awaited to ensure all FSM states are persisted
   * before the dispatcher starts processing messages.
   */
  private async initializeFSMs(): Promise<void> {
    const initPromises: Promise<void>[] = [];

    for (const [meshName, config] of this.meshConfigs) {
      if (!config.fsm) continue;

      const initPromise = (async () => {
        try {
          const fsm = new MeshFSM(
            meshName,
            config.fsm!,
            this.queue.getDatabase(),
            config._basePath || this.config.workDir,
            this.config.workDir,
            this.systemWriter
          );

          // Wire FSM events using consolidated helper
          this.wireFSMEvents(fsm, meshName);

          // CRITICAL: Clean stale gate files BEFORE initializing FSM state
          // This prevents infinite loops when re-running a mesh that left gate files from a prior run.
          const clearedGateFiles = fsm.cleanGateFiles();
          if (clearedGateFiles > 0) {
            log.info('dispatcher', 'Cleaned stale gate files before FSM init', {
              meshName,
              clearedGateFiles,
            });
          }

          // Store in map first so it's accessible during initialization callbacks
          this.meshFSMs.set(meshName, fsm);

          // Initialize the FSM (loads or creates state) - MUST await
          try {
            await fsm.initialize();
            log.debug('mesh-fsm', 'FSM initialized successfully', {
              meshName,
              initialState: fsm.getCurrentState(),
            });
          } catch (initError) {
            log.error('mesh-fsm', 'Failed to initialize FSM', {
              meshName,
              error: (initError as Error).message,
            });
            // Remove from map on init failure
            this.meshFSMs.delete(meshName);
          }
        } catch (error) {
          log.error('mesh-fsm', `Failed to create FSM for mesh: ${meshName}`, {
            error: (error as Error).message,
          });
        }
      })();

      initPromises.push(initPromise);
    }

    // Wait for all FSM initializations to complete
    await Promise.all(initPromises);
  }

  // scanMeshDir, loadMeshConfigFromFile, loadMeshConfigsFromLegacyDir
  // have been extracted to MeshConfigLoader (Phase 2 refactoring)

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
   * Extract routing config for a specific agent from mesh config
   * Delegates to MeshConfigLoader (Phase 2 refactoring)
   */
  private extractAgentRouting(
    meshName: string,
    agentName: string,
    meshConfig?: MeshConfig
  ): Record<string, Record<string, string>> | undefined {
    return this.configLoader.extractAgentRouting(meshName, agentName, meshConfig);
  }

  // injectRoutingInstructions moved to prompt/sections/routing.ts (Phase 2)

  /**
   * Build a compact routing reminder for session resume.
   * Re-injects routing context so agents remember their next steps after HITL suspension.
   */
  private buildRoutingReminder(meshName: string, agentName: string, meshConfig?: MeshConfig): string | undefined {
    if (!meshConfig) return undefined;

    if (meshConfig.routing_mode === 'manifest' && meshConfig.manifest) {
      // Manifest mode: remind agent of its pending writes
      const writes = meshConfig.manifest
        .filter(e => e.writes?.includes(agentName))
        .map(e => e.id);
      if (writes.length === 0) return undefined;
      return `## Routing Reminder\nYou are in manifest routing mode. Write your output files to complete your task:\n${writes.map(w => `- \`${w}\``).join('\n')}\nThe system spawns the next agent when your files exist on disk.`;
    }

    if (meshConfig.routing_mode === 'free') {
      // Free mode: remind agent of full roster
      const allAgents = meshConfig.agents.map(a => a.name);
      return buildFreeRoutingSection(agentName, allAgents, meshConfig.completion_agents);
    }

    if (meshConfig.routing_mode === 'dispatcher' && meshConfig.routing) {
      // Dispatcher mode: remind agent of sentinel address and outcomes
      const agentNames = meshConfig.agents.map(a => a.name);
      const router = new DispatchRouter(
        meshName,
        meshConfig.routing as import('../shared/types.ts').DispatcherRoutingConfig,
        agentNames,
      );
      const ctx = router.getInjectionContext(agentName);
      return buildDispatcherRoutingSection(ctx.sentinel, ctx.validOutcomes, ctx.availableAgents, ctx.isTerminal, ctx.peers);
    }

    // Agent mode: remind agent of its routing table
    const routingConfig = this.extractAgentRouting(meshName, agentName, meshConfig);
    if (routingConfig && Object.keys(routingConfig).length > 0) {
      return buildRoutingSection(routingConfig, meshName);
    }

    return undefined;
  }

  /**
   * Get total active worker count across all agents
   */
  getActiveWorkerCount(): number {
    return this.workerLifecycle.getCount();
  }

  /**
   * Get list of active agent IDs (not worker IDs)
   * For backwards compatibility - returns unique agentIds that have workers
   */
  getActiveWorkerIds(): string[] {
    return this.workerLifecycle.getAgentIds();
  }

  /**
   * Get list of all active worker instance IDs
   * Returns unique workerIds for all running workers
   */
  getAllActiveWorkerIds(): string[] {
    return this.workerLifecycle.getAllWorkerIds();
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
    return this.workerLifecycle.getFirst(agentId)?.machine;
  }

  /**
   * Get all active worker state machines
   * Returns machines keyed by workerId for unique identification
   */
  getAllWorkerMachines(): Map<string, WorkerStateMachine> {
    const machines = new Map<string, WorkerStateMachine>();
    for (const [, workers] of this.workerLifecycle.entries()) {
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
   * Handle parallel block completion - spawn parallel agents when entry completes,
   * track parallel agent completions, and ungate exit when all parallel agents done.
   */
  private handleParallelBlockCompletion(meshName: string, completedAgentName: string, meshConfig: MeshConfig): void {
    if (!meshConfig.parallelism) return;

    for (let i = 0; i < meshConfig.parallelism.length; i++) {
      const block = meshConfig.parallelism[i];
      const blockKey = `${meshName}:${i}`;

      // Case 1: Entry agent completed - spawn parallel agents
      if (completedAgentName === block.entry) {
        log.info('dispatcher', 'Parallel block entry completed - spawning parallel agents', {
          meshName,
          entryAgent: block.entry,
          parallelAgents: block.agents,
        });

        // Initialize block tracking state
        this.parallelBlocks.set(blockKey, {
          agents: new Set(block.agents),
          completed: new Set(),
          exitAgent: block.exit,
          entryAgent: block.entry,
          timeout: block.timeout,
          onPartial: block.on_partial || 'continue',
        });

        // Spawn all parallel agents concurrently
        for (const agentName of block.agents) {
          const agentConfig = meshConfig.agents.find(a => a.name === agentName);
          if (agentConfig) {
            // Write task message to trigger the parallel agent
            this.writeParallelAgentTask(meshName, agentName, block.entry);
          }
        }

        this.emit('parallel:spawn', {
          meshName,
          blockKey,
          agents: block.agents,
          entry: block.entry,
          exit: block.exit,
        });
      }

      // Case 2: Parallel agent completed - track completion
      const blockState = this.parallelBlocks.get(blockKey);
      if (blockState && blockState.agents.has(completedAgentName)) {
        blockState.completed.add(completedAgentName);

        log.info('dispatcher', 'Parallel agent completed', {
          meshName,
          agent: completedAgentName,
          completed: blockState.completed.size,
          total: blockState.agents.size,
        });

        // Check if all parallel agents are done
        if (blockState.completed.size === blockState.agents.size) {
          const exitAgentId = `${meshName}/${blockState.exitAgent}`;

          log.info('dispatcher', 'All parallel agents completed - exit agent ungated', {
            meshName,
            exitAgent: blockState.exitAgent,
            completedAgents: Array.from(blockState.completed),
          });

          this.emit('parallel:complete', {
            meshName,
            blockKey,
            exitAgent: blockState.exitAgent,
            completedAgents: Array.from(blockState.completed),
          });

          // Clean up block state BEFORE triggering exit agent
          this.parallelBlocks.delete(blockKey);

          // Write system task for exit agent (queue-first, bypasses chokidar).
          // Agent-authored routing messages may not be queued yet — chokidar
          // can lag behind worker:complete or not be running at all (tests).
          const completedList = Array.from(blockState.completed);
          this.systemWriter.write({
            to: exitAgentId,
            from: 'system',
            headline: `All parallel agents completed`,
            body: `Parallel block complete. Agents finished: ${completedList.join(', ')}`,
          });

          // Process any additional queued messages (agent-authored routing)
          this.processNextQueuedMessage(exitAgentId);
        }
      }
    }
  }

  /**
   * Write a task message to trigger a parallel agent
   */
  private writeParallelAgentTask(meshName: string, agentName: string, entryAgent: string): void {
    this.systemWriter.write({
      to: `${meshName}/${agentName}`,
      from: 'system',
      headline: `Parallel fork from ${entryAgent}`,
      body: `Forked from parallel entry: ${entryAgent}`,
    });
  }

  /**
   * Check if an agent is gated by an incomplete parallel block
   */
  isParallelGated(meshName: string, agentName: string): boolean {
    for (const [blockKey, state] of this.parallelBlocks.entries()) {
      if (blockKey.startsWith(`${meshName}:`) && state.exitAgent === agentName) {
        // Exit agent is gated until all parallel agents complete
        return state.completed.size < state.agents.size;
      }
    }
    return false;
  }

  // ============================================================================
  // Fan-Out Group Management
  // ============================================================================

  /**
   * Register a fan-out group from consumer's fan-out event.
   * Creates tracking state for the parallel group and its join gate.
   */
  private registerFanOutGroup(
    meshName: string,
    agents: string[],
    joinAgent: string,
    fanIn: 'batch' | 'queue' | 'drain' = 'batch',
    transform?: 'summarize'
  ): void {
    const groupKey = `${meshName}:${joinAgent}`;

    // Don't overwrite if already tracking (edge case: re-trigger)
    if (this.fanOutGroups.has(groupKey)) {
      log.warn('dispatcher', 'Fan-out group already registered, skipping', {
        meshName, joinAgent, agents,
      });
      return;
    }

    this.fanOutGroups.set(groupKey, {
      agents: new Set(agents),
      completed: new Set(),
      joinAgent,
      startedAt: Date.now(),
      fanIn,
      transform,
    });

    log.info('dispatcher', 'Registered fan-out group', {
      meshName,
      agents,
      joinAgent,
      groupKey,
      fanIn,
      transform,
    });
  }

  /**
   * Track a fan-out agent completing (routing outcome:complete to join agent).
   * When all agents complete, ungates the join agent.
   */
  private trackFanOutCompletion(meshName: string, agentName: string): void {
    for (const [groupKey, group] of this.fanOutGroups.entries()) {
      if (!groupKey.startsWith(`${meshName}:`)) continue;
      if (!group.agents.has(agentName)) continue;

      group.completed.add(agentName);

      log.info('dispatcher', 'Fan-out agent completed', {
        meshName,
        agentName,
        groupKey,
        completed: Array.from(group.completed),
        total: group.agents.size,
      });

      // Check if all agents are done
      if (group.completed.size === group.agents.size) {
        const joinAgentId = `${meshName}/${group.joinAgent}`;
        const { fanIn, transform } = group;

        log.info('dispatcher', 'All fan-out agents completed - join agent ungated', {
          meshName,
          joinAgent: group.joinAgent,
          completedAgents: Array.from(group.completed),
          fanIn,
        });

        this.emit('fan-out:complete', {
          meshName,
          groupKey,
          joinAgent: group.joinAgent,
          completedAgents: Array.from(group.completed),
        });

        // Clean up group state BEFORE triggering join agent
        this.fanOutGroups.delete(groupKey);

        // Branch on fan_in mode
        if (fanIn === 'batch') {
          // Batch: combine all messages into one, spawn single worker
          this.deliverBatchToJoinAgent(meshName, joinAgentId, transform);
        } else {
          // Queue mode: current OAOM behavior (N cold starts)
          this.processNextQueuedMessage(joinAgentId);
        }
      }

      return; // Found the group, done
    }
  }

  /**
   * Handle re-engagement: a completed fan-out agent receives a peer message.
   * Removes from completed set so it must re-complete before join ungates.
   */
  private handleFanOutReEngagement(meshName: string, agentName: string): void {
    for (const [groupKey, group] of this.fanOutGroups.entries()) {
      if (!groupKey.startsWith(`${meshName}:`)) continue;
      if (!group.agents.has(agentName)) continue;

      if (group.completed.has(agentName)) {
        group.completed.delete(agentName);
        log.info('dispatcher', 'Fan-out agent re-engaged (removed from completed)', {
          meshName,
          agentName,
          groupKey,
          remainingCompleted: Array.from(group.completed),
        });
      }
      return;
    }
  }

  /**
   * Check if an agent is a join agent gated by an incomplete fan-out group.
   */
  isFanOutGated(meshName: string, agentName: string): boolean {
    const groupKey = `${meshName}:${agentName}`;
    const group = this.fanOutGroups.get(groupKey);
    if (!group) return false;
    // Drain mode: no gate — messages flow immediately
    if (group.fanIn === 'drain') return false;
    // Join agent is gated until all agents in the group have completed
    return group.completed.size < group.agents.size;
  }

  // ============================================================================
  // Fan-In Delivery Methods
  // ============================================================================

  /**
   * Deliver all pending messages to join agent as a single batched message.
   * Polls all queued messages, combines them, optionally summarizes, then
   * inserts a synthetic combined message and triggers OAOM processing.
   */
  private async deliverBatchToJoinAgent(
    meshName: string,
    joinAgentId: string,
    transform?: 'summarize'
  ): Promise<void> {
    const messages = this.queue.poll(joinAgentId);
    if (messages.length === 0) {
      log.warn('dispatcher', 'Batch delivery: no pending messages for join agent', {
        meshName, joinAgentId,
      });
      this.processNextQueuedMessage(joinAgentId);
      return;
    }

    log.info('dispatcher', 'Batch delivery: combining messages for join agent', {
      meshName,
      joinAgentId,
      messageCount: messages.length,
      transform,
    });

    let combinedBody = this.buildBatchedContent(messages);

    if (transform === 'summarize') {
      combinedBody = await this.summarizeContent(combinedBody, messages.length);
    }

    // Insert synthetic combined message
    this.queue.insert({
      from_agent: 'system/fan-in',
      to_agent: joinAgentId,
      type: 'task',
      payload: {
        headline: `Batched fan-in: ${messages.length} responses`,
        body: combinedBody,
        'fan-in-count': messages.length,
        'fan-in-sources': messages.map(m => m.from_agent),
      },
    });

    // Spawn join agent normally (OAOM: sees one combined message)
    this.processNextQueuedMessage(joinAgentId);
  }

  /**
   * Build combined markdown content from multiple messages for batch delivery.
   */
  private buildBatchedContent(messages: Message[]): string {
    const parts: string[] = [`## Batched Fan-In (${messages.length} responses)\n`];
    for (const msg of messages) {
      parts.push(`### From: ${msg.from_agent}`);
      if (msg.payload.headline) parts.push(`**Headline**: ${msg.payload.headline}`);
      if (msg.payload.body) parts.push(msg.payload.body as string);
      parts.push('');
    }
    return parts.join('\n');
  }

  /**
   * Summarize content using a haiku pre-pass (transform: summarize).
   * Falls back to raw content if summarization fails.
   */
  private async summarizeContent(content: string, count: number): Promise<string> {
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const prompt = `Summarize these ${count} agent responses into a single coherent briefing.\nPreserve key findings, decisions, and artifacts. Be concise but complete.\n\n${content}`;

      const result = query({
        prompt,
        options: {
          model: 'claude-haiku-4-5-20251001',
          maxTurns: 1,
          permissionMode: 'dontAsk',
          allowedTools: [],  // No tools needed for session summary
        }
      });

      let summary = '';
      for await (const event of result) {
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') summary += block.text;
          }
        }
      }

      if (summary) {
        log.info('dispatcher', 'Summarize transform completed', {
          inputLength: content.length,
          outputLength: summary.length,
          count,
        });
        return summary;
      }

      log.warn('dispatcher', 'Summarize transform produced empty output, using raw content');
      return content;
    } catch (error) {
      log.error('dispatcher', 'Summarize transform failed, using raw content', {
        error: (error as Error).message,
      });
      return content;
    }
  }

  /**
   * Build content string from a single message (for drain mode injection).
   */
  private buildSingleMessageContent(msg: Message): string {
    const parts: string[] = [];
    parts.push(`### From: ${msg.from_agent}`);
    if (msg.payload.headline) parts.push(`**Headline**: ${msg.payload.headline}`);
    if (msg.payload.body) parts.push(msg.payload.body as string);
    return parts.join('\n');
  }

  /**
   * Check if an agent is a join agent in a drain-mode fan-out group.
   * Returns group info if drain mode, null otherwise.
   */
  private getDrainFanOutGroup(meshName: string, agentName: string): { transform?: 'summarize' } | null {
    const groupKey = `${meshName}:${agentName}`;
    const group = this.fanOutGroups.get(groupKey);
    if (!group || group.fanIn !== 'drain') return null;
    return { transform: group.transform };
  }

  /**
   * Inject a message into a running drain-mode join agent via resumeSession.
   * Polls one message, optionally summarizes, then injects into the active worker.
   */
  private async injectDrainMessage(agentId: string, meshName: string): Promise<void> {
    const msg = this.queue.pollOne(agentId);
    if (!msg) return;

    const [, agentName] = agentId.split('/');
    let content = this.buildSingleMessageContent(msg);

    const drainGroup = this.getDrainFanOutGroup(meshName, agentName);
    if (drainGroup?.transform === 'summarize') {
      content = await this.summarizeContent(content, 1);
    }

    const workers = this.workerLifecycle.getForAgent(agentId);
    const activeWorker = workers[workers.length - 1];
    const sessionId = activeWorker?.runner.getSessionId();

    if (sessionId) {
      await this.resumeSession({
        reason: 'system-feedback',
        agentId,
        sessionId,
        prompt: `## New Fan-In Response\n\n${content}`,
        runner: activeWorker.runner,
        interrupt: true,
        metadata: { fanInDrain: true, from: msg.from_agent },
      });
    } else {
      log.warn('dispatcher', 'Drain injection: no active session for join agent, queuing', {
        agentId,
        from: msg.from_agent,
      });
    }
  }

  /**
   * Check if a mesh session is complete (no active workers from that mesh)
   *
   * Behavior depends on whether mesh has a completion_agent:
   * - WITH completion_agent: Just update timestamps, logging happens in handleMeshComplete
   * - WITHOUT completion_agent: Log and cleanup immediately (fallback behavior)
   */
  private checkSessionComplete(meshInstance: string | undefined): void {
    if (!meshInstance) return;

    const session = this.metricsAggregator.getSession(meshInstance);
    if (!session) return;

    // Check if any workers from this mesh are still active (flatten arrays)
    let activeInMesh = false;
    for (const [, workers] of this.workerLifecycle.entries()) {
      if (workers.some(w => w.hookContext?.meshInstance === meshInstance)) {
        activeInMesh = true;
        break;
      }
    }

    if (!activeInMesh) {
      // FSM meshes: don't mark complete until FSM reaches terminal state
      const fsm = this.meshFSMs.get(session.meshName);
      if (fsm && !fsm.isInTerminalState()) {
        log.debug('dispatcher', 'FSM mesh has no active workers but is not in terminal state — skipping session complete', {
          meshInstance,
          meshName: session.meshName,
          currentState: fsm.getCurrentState(),
        });
        return;
      }

      // Mark session complete (sets timestamps and duration)
      this.metricsAggregator.markSessionComplete(meshInstance);

      // Check if mesh has completion_agent(s) configured
      const meshConfig = this.meshConfigs.get(session.meshName);
      const completionAgents = this.normalizeCompletionAgents(meshConfig);
      const hasCompletionAgent = completionAgents.length > 0;

      if (hasCompletionAgent) {
        // Mesh has completion_agent(s) - logging will happen in handleMeshComplete
        // when a completion_agent sends task-complete to core/core
        // Just mark the session as ready for final logging
        log.debug('dispatcher', 'Session ready for completion_agent', {
          meshInstance,
          meshName: session.meshName,
          completionAgents,
        });
      } else {
        // No completion_agent - log and cleanup immediately (fallback behavior)
        log.sessionComplete(session);
        this.emit('session:complete', session);
        this.metricsAggregator.finalizeSession(meshInstance);
      }
    }
  }

  /**
   * Handle mesh-complete event from consumer
   * Called when completion_agent sends task-complete to core/core
   * Logs the session analytics summary and cleans up
   */
  private handleMeshComplete(event: MeshCompleteEvent): void {
    const { meshName, completionAgent } = event;

    // Check if other workers in this mesh are still active
    const activeWorkers = this.workerLifecycle.getWorkersForMesh(meshName)
      .filter(id => id !== completionAgent);  // Exclude the completion agent itself

    if (activeWorkers.length > 0) {
      // Defer completion — let active workers finish naturally
      this.pendingCompletions.set(meshName, {
        completionAgent,
        receivedAt: Date.now(),
      });

      log.info('dispatcher', 'Deferring mesh completion: waiting for active workers to finish', {
        meshName,
        completionAgent,
        activeWorkers,
        activeCount: activeWorkers.length,
      });
      return;
    }

    // No active workers — finalize immediately
    this.finalizeMeshCompletion(meshName, completionAgent);
  }

  /**
   * Check if a mesh has a pending (deferred) completion and finalize it
   * Called after every worker completes to see if the mesh can now be finalized
   */
  private checkPendingCompletion(meshName: string): void {
    const pending = this.pendingCompletions.get(meshName);
    if (!pending) return;

    const activeWorkers = this.workerLifecycle.getWorkersForMesh(meshName);

    if (activeWorkers.length === 0) {
      log.info('dispatcher', 'All workers finished, finalizing deferred mesh completion', {
        meshName,
        completionAgent: pending.completionAgent,
        deferredFor: Date.now() - pending.receivedAt,
      });

      this.pendingCompletions.delete(meshName);
      this.finalizeMeshCompletion(meshName, pending.completionAgent);
    } else {
      log.debug('dispatcher', 'Pending completion still waiting for workers', {
        meshName,
        activeWorkers,
        remainingCount: activeWorkers.length,
      });
    }
  }

  /**
   * Send brain-update on mesh completion (mesh-level aggregation)
   * Only fires once per mesh, with combined git diff and all agent outputs
   */
  private sendBrainUpdateOnMeshComplete(meshName: string, meshInstance: string, session: import('../shared/types.ts').SessionMetrics): void {
    log.info('dispatcher', 'Sending mesh-level brain update', {
      meshName,
      meshInstance,
      workerCount: session.workerCount,
    });

    try {
      const { execSync } = require('node:child_process');

      // Get git diff for the entire mesh run
      let gitDiff = '';
      try {
        gitDiff = execSync('git diff --cached', { cwd: this.config.workDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        if (!gitDiff.trim()) {
          gitDiff = execSync('git diff HEAD', { cwd: this.config.workDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        }
      } catch (error) {
        log.warn('dispatcher', 'Failed to get git diff for brain update', {
          error: (error as Error).message,
        });
        gitDiff = '(Unable to retrieve git diff)';
      }

      // Aggregate all agent outputs from session transcripts
      const sessionsDir = path.join(this.config.workDir, '.ai', 'tx', 'sessions');
      let aggregatedOutput = '';

      for (const worker of session.workers) {
        const agentDir = path.join(sessionsDir, worker.agentId.replace('/', '-'));
        if (fs.existsSync(agentDir)) {
          // Get the most recent output for this agent
          const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.md')).sort().reverse();
          if (files.length > 0) {
            const content = fs.readFileSync(path.join(agentDir, files[0]), 'utf-8');
            // Extract just the output (skip header)
            const outputMatch = content.match(/---\n\n([\s\S]+)$/);
            if (outputMatch) {
              aggregatedOutput += `\n## ${worker.agentId}\n${outputMatch[1]}\n`;
            }
          }
        }
      }

      if (!aggregatedOutput.trim()) {
        aggregatedOutput = '(No agent outputs available)';
      }

      // Build task message for brain
      const taskBody = `# Mesh Work Analysis Request

## Mesh Context
- **Mesh**: ${meshName}
- **Instance**: ${meshInstance}
- **Workers**: ${session.workerCount}
- **Duration**: ${session.totalDurationMs}ms
- **Cost**: $${session.totalCostUsd.toFixed(4)}

## Agent Outputs
${aggregatedOutput}

## Git Diff
\`\`\`diff
${gitDiff}
\`\`\`

---

Analyze this mesh run and document in your workspace:
- **Learnings**: Patterns, insights, and knowledge worth preserving
- **Side Effects**: Unintended consequences, breaking changes, performance/security implications
- **Opportunities**: Refactoring, generalization, related features to add
- **Tech Debt**: TODOs, missing error handling, testing gaps, code smells

Update BRAIN.md with any critical learnings that should persist across sessions.
`;

      this.systemWriter.write({
        to: 'brain/brain',
        from: 'core/core',
        headline: `Analyze mesh run - ${meshName}`,
        body: taskBody,
      });

      log.info('dispatcher', 'Mesh-level brain update sent', { meshName, meshInstance });
    } catch (error) {
      log.error('dispatcher', 'Failed to send mesh-level brain update', {
        meshName,
        meshInstance,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Finalize mesh completion — log analytics and clean up
   */
  private finalizeMeshCompletion(meshName: string, completionAgent: string): void {
    // Cancel any pending nudge timers for this mesh
    this.nudgeDetector?.cancelForMesh(meshName);

    // Reliability: cleanup mesh-level state, log status
    this.reliability?.cleanupMesh(meshName);
    this.reliability?.logStatus();

    // Find session by meshName (delegates to MetricsAggregator)
    const result = this.metricsAggregator.findSessionByMeshName(meshName);

    if (!result) {
      log.warn('dispatcher', 'Mesh complete event but no session metrics found', {
        meshName,
        completionAgent,
        availableSessions: this.metricsAggregator.getSessionKeys(),
      });
      return;
    }

    const { key: sessionKey } = result;

    // Ensure completion timestamps are set
    this.metricsAggregator.markSessionComplete(sessionKey);

    // Re-fetch session to get updated timestamps
    const finalSession = this.metricsAggregator.getSession(sessionKey);
    if (!finalSession) return;

    // Check if brain-update is configured in mesh lifecycle hooks
    const meshConfig = this.meshConfigs.get(meshName);
    if (meshConfig?.lifecycle?.post?.includes('brain-update')) {
      this.sendBrainUpdateOnMeshComplete(meshName, sessionKey, finalSession);
    }

    // Log mesh-run boundary for flow splitting
    log.info('mesh-run', 'Mesh run completed', {
      meshInstance: sessionKey,
      meshName,
      completionAgent,
      durationMs: finalSession.totalDurationMs,
      workerCount: finalSession.workerCount,
    });

    // Log session summary
    log.sessionComplete(finalSession);

    // Emit event for external consumers
    this.emit('session:complete', finalSession);

    // Cleanup (finalize removes from tracking)
    this.metricsAggregator.finalizeSession(sessionKey);

    log.debug('dispatcher', 'Mesh analytics logged on completion', {
      meshName,
      completionAgent,
      sessionKey,
      workerCount: finalSession.workerCount,
      totalCost: finalSession.totalCostUsd,
    });
  }

  /**
   * Handle system feedback - inject directly into agent's running session
   * Avoids writing message files that agents might try to respond to
   */
  private async handleSystemFeedback(event: SystemFeedbackEvent): Promise<void> {
    const { agentId, feedback, reason } = event;

    // Find active worker for this agent
    const workers = this.workerLifecycle.getForAgent(agentId);
    if (workers.length === 0) {
      log.warn('dispatcher', 'System feedback: no active worker, writing message file', {
        agentId,
        reason,
      });
      this.writeSystemFeedbackMessage(agentId, feedback, reason);
      return;
    }

    // Get the most recent worker
    const activeWorker = workers[workers.length - 1];
    const sessionId = activeWorker.runner.getSessionId();

    if (!sessionId) {
      log.warn('dispatcher', 'System feedback: worker has no session ID, writing message file', {
        agentId,
        reason,
      });
      this.writeSystemFeedbackMessage(agentId, feedback, reason);
      return;
    }

    // Check if worker has an active API query (mid-turn correction possible)
    const hasActiveQuery = activeWorker.runner.hasActiveQuery?.() ?? false;

    if (hasActiveQuery) {
      log.info('dispatcher', 'Injecting system feedback directly into agent session', {
        agentId,
        reason,
        sessionId: sessionId.slice(0, 8),
      });

      try {
        await this.resumeSession({
          reason: 'system-feedback',
          agentId,
          sessionId,
          prompt: feedback,
          runner: activeWorker.runner,
          interrupt: true,
          metadata: { systemFeedback: true, feedbackReason: reason },
        });
        return;
      } catch (error) {
        log.warn('dispatcher', 'System feedback injection failed, falling back to message file', {
          agentId,
          reason,
          error: (error as Error).message,
        });
      }
    }

    // Fallback: write message file for next invocation
    this.writeSystemFeedbackMessage(agentId, feedback, reason);
  }

  private writeSystemFeedbackMessage(agentId: string, feedback: string, reason: string): void {
    // Resume the agent's last session so it retains conversation context
    const lastSessionId = this.lastCompletedSessionIds.get(agentId);

    this.systemWriter.write({
      to: agentId,
      from: 'system/routing-validator',
      headline: 'Routing violation - use correct agent name',
      body: feedback,
      ...(lastSessionId ? { extraFrontmatter: { 'session-id': lastSessionId } } : {}),
    });

    if (lastSessionId) {
      log.info('dispatcher', 'Routing feedback includes session-id for context resume', {
        agentId,
        sessionId: lastSessionId.slice(0, 8) + '...',
        reason,
      });
    }
  }


  /**
   * Handle FSM feedback - inject directly into agent session
   * Called when FSM violation detected (first violation only, escalations still go to core)
   */
  private async handleFSMFeedback(event: FSMFeedbackEvent): Promise<void> {
    const { agentId, currentState, attemptedTarget, allowedTargets, violationType } = event;

    const allowedTargetsFormatted = allowedTargets.length > 0
      ? allowedTargets.map(t => `- \`${event.meshName}/${t}\``).join('\n')
      : '- (no specific agents configured for this state)';

    const reason = violationType === 'no-route'
      ? 'No exit route defined for this transition.'
      : `\`${attemptedTarget}\` not allowed from state \`${currentState}\`.`;

    const feedback = `# FSM Violation

${reason}

**Current state:** \`${currentState}\`
**Attempted:** \`${attemptedTarget}\`

**Allowed targets:**
${allowedTargetsFormatted}

Routes to \`core/core\` or other meshes are always permitted.`;

    // Emit system-feedback event for direct injection
    this.emit('system-feedback-internal', {
      agentId,
      feedback,
      reason: 'fsm-violation',
    });

    // Find active worker and inject directly
    const workers = this.workerLifecycle.getForAgent(agentId);
    if (workers.length === 0) {
      log.warn('dispatcher', 'FSM feedback: no active worker to inject into', {
        agentId,
        currentState,
        attemptedTarget,
      });
      return;
    }

    const activeWorker = workers[workers.length - 1];
    const sessionId = activeWorker.runner.getSessionId();

    if (!sessionId) {
      log.warn('dispatcher', 'FSM feedback: worker has no session ID', { agentId });
      return;
    }

    // Check if worker has an active API query (mid-turn correction possible)
    const hasActiveQuery = activeWorker.runner.hasActiveQuery?.() ?? false;

    if (hasActiveQuery) {
      // Worker is mid-turn — interrupt and inject feedback in real time
      log.info('dispatcher', 'Injecting FSM feedback into active session', {
        agentId,
        currentState,
        attemptedTarget,
        sessionId: sessionId.slice(0, 8),
      });

      try {
        await this.resumeSession({
          reason: 'system-feedback',
          agentId,
          sessionId,
          prompt: feedback,
          runner: activeWorker.runner,
          interrupt: true,
          metadata: { fsmFeedback: true, currentState, attemptedTarget },
        });
        return;
      } catch (error) {
        log.warn('dispatcher', 'FSM feedback injection failed, falling back to message', {
          agentId,
          error: (error as Error).message,
        });
      }
    }

    // Primary path: write routing-feedback message for next invocation
    // The rejected message was blocked at the gate — agent has already
    // made its decision and is exiting. Queue feedback for next spawn.
    // Include session-id so the new worker resumes with full conversation context.
    const lastSessionId = this.lastCompletedSessionIds.get(agentId);

    this.systemWriter.write({
      to: agentId,
      from: 'system/fsm-validator',
      headline: 'Routing violation - use correct agent name',
      body: feedback,
      ...(lastSessionId ? { extraFrontmatter: { 'session-id': lastSessionId } } : {}),
    });

    if (lastSessionId) {
      log.info('dispatcher', 'FSM feedback includes session-id for context resume', {
        agentId,
        sessionId: lastSessionId.slice(0, 8) + '...',
      });
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
    let task = this.queue.peekOne(agentId);
    if (!task) {
      // FSM-driven ensemble: synthesize task (no dispatch message written to prevent double-spawn)
      log.info('dispatcher', 'Synthesizing task for FSM-driven ensemble state', {
        meshName,
        state: stateConfig.name,
        agentId,
      });
      task = {
        from_agent: 'system/fsm-dispatch',
        to_agent: agentId,
        type: 'task',
        payload: {
          headline: `Execute task for state ${stateConfig.name}`,
          body: `FSM transitioned to ensemble state \`${stateConfig.name}\`. Execute your task.`,
        },
      };
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

    // Consume task from queue only if it came from the queue (not synthetic)
    const taskFromQueue = this.queue.peekOne(agentId);
    if (taskFromQueue) {
      this.queue.pollOne(agentId);
    }

    // Re-insert the task for each ensemble worker so SDK runner can poll it.
    // Each worker's SDK runner calls queue.pollOne(workerId) independently.
    // Without this, workers find no message and exit immediately with 0 processed.
    const ensembleTotal = agentsToSpawn.length;
    for (let i = 0; i < ensembleTotal; i++) {
      const workerAgentId = `${meshName}/${agentsToSpawn[i]}`;
      this.queue.insert({
        from_agent: task.from_agent,
        to_agent: workerAgentId,
        type: task.type,
        payload: { ...task.payload, _ensemble_index: i, _ensemble_total: ensembleTotal },
        source_file: undefined,
      });
    }

    this.emit('ensemble:start', {
      ensembleId,
      meshName,
      state: stateConfig.name,
      agents: agentsToSpawn,
    });

    // Get mesh config for agent lookup
    const meshConfig = this.meshConfigs.get(meshName);
    if (!meshConfig) {
      log.error('dispatcher', 'Mesh config not found for ensemble', {
        meshName,
        ensembleId,
      });
      return;
    }

    // Spawn all agents in parallel using unified spawnWorker
    const spawnPromises = agentsToSpawn.map((agentName, idx) => {
      const agentConfig = meshConfig.agents.find(a => a.name === agentName);
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
          'Agent not found in mesh config',
          idx
        );
        return Promise.resolve();
      }

      return this.spawnWorker(meshName, agentConfig, {
        ensembleId,
        ensembleIndex: idx,
        ensembleTotal,
        fsm,
        fsmStateConfig: stateConfig,
        task,
      });
    });

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
   * Resolve ensemble count from config
   * Delegates to EnsembleCoordinator (Phase 2 refactoring)
   */
  private resolveEnsembleCount(count: number | string | undefined, fsm: MeshFSM): number {
    return this.ensembleCoordinator.resolveEnsembleCount(count, fsm);
  }

  /**
   * Process FSM exit block after ensemble completion
   * Uses EnsembleCoordinator for routing evaluation (Phase 2 refactoring)
   */
  private async processFSMExit(
    meshName: string,
    fsm: MeshFSM,
    stateConfig: FSMStateConfig
  ): Promise<void> {
    log.info('mesh-fsm', 'Processing FSM exit', {
      meshName,
      state: stateConfig.name,
      hasExit: !!stateConfig.exit,
    });

    // Evaluate routing using EnsembleCoordinator
    const nextState = await this.ensembleCoordinator.evaluateExitRouting(fsm, stateConfig);

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
      await this.triggerNextStateAgent(meshName, fsm, nextState, fsm.getContext());
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
   * Uses EnsembleCoordinator for message writing (Phase 2 refactoring)
   */
  private async triggerNextStateAgent(
    meshName: string,
    fsm: MeshFSM,
    nextState: string,
    context: Record<string, unknown>
  ): Promise<void> {
    // Get the target agent using EnsembleCoordinator
    const targetAgent = this.ensembleCoordinator.getNextStateTargetAgent(fsm, nextState);

    if (!targetAgent) {
      log.debug('dispatcher', 'Next state has no agents, skipping trigger', {
        meshName,
        nextState,
      });
      return;
    }

    // Get ENSEMBLE_OUTPUT from context
    const ensembleOutput = context.ENSEMBLE_OUTPUT as string || '';
    const ensembleMetadata = context.ENSEMBLE_METADATA as Record<string, unknown> || {};

    // Write trigger message using EnsembleCoordinator
    const result = this.ensembleCoordinator.writeTriggerMessage({
      meshName,
      nextState,
      targetAgent,
      ensembleOutput,
      ensembleMetadata,
      msgsDir: this.config.msgsDir,
      writer: this.systemWriter,
    });

    if (!result.success) {
      log.error('dispatcher', 'Failed to write trigger message', {
        meshName,
        nextState,
        targetAgent,
        error: result.error,
      });
    }
  }


  /**
   * Nudge a worker to send a task-complete message to core/core
   * Called when worker completes without sending the expected completion message
   */
}
