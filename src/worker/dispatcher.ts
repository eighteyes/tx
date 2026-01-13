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
import { EventEmitter } from 'node:events';
import YAML from 'yaml';
import { MessageQueue, type Message } from '../queue/index.ts';
import { SdkRunner, type SdkRunnerConfig, type AgentRouting, type ToolRestriction } from './sdk-runner.ts';
import type {SemanticModel, WorkerConfig, SessionMetrics, WorkerMetrics, FSMConfig, EnsembleConfig} from '../shared/types.ts';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { EnsembleCoordinator } from './ensemble-coordinator.ts';
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
  type GradedConfig,
  type PreflightOutput,
} from '../quality/index.ts';
import type { ParityReminderEvent } from '../core/consumer.ts';
import { resolveLifecycle } from './lifecycle-utils.ts';
import {MeshFSM, type FSMTransitionEvent, type FSMGateEvent, type FSMScriptEvent} from '../mesh/index.ts';

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
 * Iteration config for graded meshes
 */
interface IterationConfig {
  maxIterations?: number;  // Max re-runs on quality failure (default: 3)
  onFail?: 'loop' | 'halt';  // What to do on quality failure (default: loop)
}

// continuation field: boolean | string[] | undefined
// - true = all agents persist sessions
// - string[] = only listed agents persist sessions
// - undefined/false = no session persistence

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
  graded?: GradedConfig;  // Quality stack config: true, false, or array of gate types
  iteration?: IterationConfig;  // Iteration config for graded meshes
  fsm?: FSMConfig;  // FSM config for workflow orchestration
  ensemble?: EnsembleConfig;  // Ensemble execution config
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
  reason: 'ask-human';
  suspendedAt: number;
  targetAgent: string;  // Who the ask-human was sent to (e.g., "core/core")
  meshName: string;
  agentConfig: AgentConfig;
}

export class WorkerDispatcher extends EventEmitter {
  private config: DispatcherConfig;
  private queue: MessageQueue;
  private running = false;
  private activeWorkers: Map<string, ActiveWorker> = new Map();
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
  private sessionMetrics: Map<string, SessionMetrics> = new Map();
  private suspendedSessions: Map<string, SuspendedSession> = new Map();
  private stuckDetector: StuckAgentDetector;
  private ensembleCoordinator: EnsembleCoordinator;

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
      workers: Array.from(this.activeWorkers.entries()).map(([id, w]) => {
        const status = w.machine.getStatus();
        const baseState = {
          id,
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
      }),
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

  /**
   * Start the dispatcher - subscribes to consumer events for worker messages
   */
  async start(consumer?: EventEmitter): Promise<void> {
    if (this.running) return;

    // Load all mesh configs
    this.loadMeshConfigs();

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
   * Get active workers in format needed by stuck detector
   */
  private getActiveWorkersForDetector(): Map<string, ActiveWorkerInfo> {
    const result = new Map<string, ActiveWorkerInfo>();
    for (const [agentId, worker] of this.activeWorkers) {
      result.set(agentId, {
        runner: worker.runner,
        machine: worker.machine,
        startedAt: worker.startedAt,
        hookContext: worker.hookContext,
        lastOutputAt: worker.lastOutputAt,
      });
    }
    return result;
  }

  /**
   * Handle incoming worker message - spawn worker if not already running
   * Checks for ensemble pattern first, then falls back to single worker spawn
   */
  private handleWorkerMessage(agentId: string): void {
    if (!this.running) return;

    // Skip if worker already running
    if (this.activeWorkers.has(agentId)) {
      log.debug('dispatcher', `Worker already running, message queued`, { agentId });
      return;
    }

    // Parse mesh/agent from agentId
    const [meshName, agentName] = agentId.split('/');
    if (!meshName || !agentName) {
      log.error('dispatcher', `Invalid agentId format`, { agentId });
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

    // Check for ensemble pattern
    if (meshConfig.ensemble) {
      const entryAgent = meshConfig.entry_point || meshConfig.agents[0].name;
      // Only trigger ensemble if message is for entry point agent
      if (agentName === entryAgent) {
        log.info('dispatcher', 'Ensemble pattern detected', {
          mesh: meshName,
          agents: meshConfig.ensemble.agents.length,
        });
        this.handleEnsemblePattern(meshName, meshConfig).catch(error => {
          log.error('dispatcher', 'Ensemble execution failed', {
            meshName,
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
   */
  private async handleRevisionMessage(event: RevisionMessageEvent): Promise<void> {
    const { agentId, content, headline } = event;

    const activeWorker = this.activeWorkers.get(agentId);
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
   */
  private async handleAskMessage(event: AskMessageEvent): Promise<void> {
    const { from: senderAgentId, to: targetAgentId, type: messageType } = event;

    // Check for FSM transition (eager on first ask)
    const [meshName, agentName] = senderAgentId.split('/');
    if (meshName) {
      const fsm = this.meshFSMs.get(meshName);
      if (fsm && fsm.isInitialized()) {
        try {
          // Build frontmatter from event for FSM context
          const messageFrontmatter: Record<string, unknown> = {
            from: senderAgentId,
            to: targetAgentId,
            type: messageType,
            'msg-id': event.msgId,
            headline: event.headline,
          };

          const transitioned = await fsm.handleMessage(
            senderAgentId,
            targetAgentId,
            messageType,
            messageFrontmatter
          );

          if (transitioned) {
            log.info('dispatcher', 'FSM transition triggered by ask message', {
              meshName,
              from: senderAgentId,
              to: targetAgentId,
              messageType,
              newState: fsm.getCurrentState(),
            });
          }
        } catch (error) {
          // Script failures are fatal - halt the mesh
          log.error('dispatcher', 'FSM transition failed fatally', {
            meshName,
            error: (error as Error).message,
          });
          this.emit('mesh:halt', {
            meshName,
            reason: 'FSM script failure',
            error: (error as Error).message,
          });
        }
      }
    }

    const activeWorker = this.activeWorkers.get(senderAgentId);
    if (!activeWorker) {
      log.debug('dispatcher', `Ask message but no active worker found`, {
        from: senderAgentId,
        to: targetAgentId,
      });
      return;
    }

    const { machine, runner } = activeWorker;
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
        log.info('dispatcher', `Worker entering await state`, {
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

            // Store session for later resume
            this.suspendedSessions.set(senderAgentId, {
              sessionId,
              reason: 'ask-human',
              suspendedAt: Date.now(),
              targetAgent: targetAgentId,
              meshName,
              agentConfig,
            });

            // Kill the worker - no steering, no resume, just stop
            runner.kill();

            this.emit('worker:suspended', {
              agentId: senderAgentId,
              sessionId,
              reason: 'ask-human',
              targetAgent: targetAgentId,
            });

            // Remove from active workers
            this.activeWorkers.delete(senderAgentId);

            log.info('dispatcher', `Worker killed and suspended`, {
              from: senderAgentId,
              sessionId: sessionId.slice(0, 8),
            });
          } catch (killError) {
            log.error('dispatcher', `Failed to kill worker for ask-human`, {
              from: senderAgentId,
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
      // Remove from suspended
      this.suspendedSessions.delete(agentId);

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

      // Set up minimal event handlers
      runner.on('complete', async (data) => {
        log.info('dispatcher', `Resumed worker completed`, {
          agentId,
          sessionId: sessionId.slice(0, 8),
        });
        this.activeWorkers.delete(agentId);
        await machine.complete(data);
        this.emit('worker:complete', {
          ...data,
          transitionName: 'complete',
        });
        this.writeWorkerState();
      });

      runner.on('error', (error) => {
        log.error('dispatcher', `Resumed worker error`, {
          agentId,
          error: error.message,
        });
        this.activeWorkers.delete(agentId);
        this.emit('worker:error', { id: agentId, error: error.message });
        this.writeWorkerState();
      });

      // Store in active workers
      this.activeWorkers.set(agentId, {
        runner,
        machine,
        startedAt: Date.now(),
        hookContext,
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
      // Clean up on failure
      this.suspendedSessions.delete(agentId);
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

    // Check for suspended session (killed due to ask-human)
    const suspended = this.suspendedSessions.get(awaitingAgentId);
    if (suspended && respondingAgentId === 'core/core') {
      log.info('dispatcher', `Human response received for suspended session`, {
        from: respondingAgentId,
        to: awaitingAgentId,
        sessionId: suspended.sessionId.slice(0, 8),
        suspendedFor: Date.now() - suspended.suspendedAt,
      });

      // Resume the suspended session with human response
      await this.resumeSuspendedSession(awaitingAgentId, suspended, content, event.headline);
      return;
    }

    const activeWorker = this.activeWorkers.get(awaitingAgentId);
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

        log.info('dispatcher', `All responses received, resuming session`, {
          awaitingAgentId,
          sessionId: sessionId.slice(0, 8),
        });

        // Build resume prompt with the response content
        const resumePrompt = this.buildAskResponsePrompt(respondingAgentId, content, event.headline);

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
   */
  private buildAskResponsePrompt(from: string, content: string, headline?: string): string {
    const parts: string[] = [];

    parts.push('## Ask Response Received\n');
    parts.push(`Response received from **${from}**:\n`);

    if (headline) {
      parts.push(`**Subject**: ${headline}\n`);
    }

    parts.push('---\n');
    parts.push(content);
    parts.push('\n---');
    parts.push('\n**Action**: Process this response and continue with your task.');

    return parts.join('\n');
  }

  /**
   * Handle parity reminder - inject feedback into worker when task-complete is blocked
   * due to pending asks
   */
  private async handleParityReminder(event: ParityReminderEvent): Promise<void> {
    const { agentId, pendingAsks, deletedFile } = event;

    const activeWorker = this.activeWorkers.get(agentId);
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
    const activeWorker = this.activeWorkers.get(agentId);
    if (!activeWorker) {
      return;
    }

    const { machine } = activeWorker;
    if (machine.getStatus() !== 'awaiting') {
      return;  // Already transitioned out of awaiting
    }

    log.warn('dispatcher', `Await timeout expired`, {
      agentId,
      awaitingResponses: Array.from(machine.getAwaitingResponses()),
      awaitDuration: machine.getAwaitDuration(),
    });

    try {
      await machine.awaitTimeoutError();

      this.emit('worker:await-timeout', {
        workerId: agentId,
        awaitingResponses: Array.from(machine.getAwaitingResponses()),
      });

      // Cleanup
      this.activeWorkers.delete(agentId);
      this.writeWorkerState();
    } catch (error) {
      log.error('dispatcher', `Failed to handle await timeout`, {
        agentId,
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

    // Kill all active workers
    for (const [_id, { runner }] of this.activeWorkers) {
      runner.kill();
    }
    this.activeWorkers.clear();
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

      // Resolve lifecycle hooks (worktree: true, graded: true, or explicit lifecycle)
      log.info('dispatcher', 'Resolving lifecycle hooks', {
        agentId,
        hasMeshConfig: !!meshConfig,
        meshName: meshConfig?.mesh,
        hasGraded: meshConfig?.graded !== undefined,
        gradedValue: meshConfig?.graded,
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

      // Execute pre-hooks if configured (includes quality:preflight for graded meshes)
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

      // Inject operational guide (AGENTS.md) if present in mesh directory
      if (meshConfig?._basePath) {
        systemPrompt = await this.promptInjector.injectOperationalGuide(systemPrompt, meshConfig._basePath);
      }

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
            availableTransitions: status.availableTransitions,
            context: status.context,
            gateRetries: status.gateRetries,
          };
          systemPrompt = this.promptInjector.injectFSMContext(systemPrompt, fsmContext);
          log.debug('dispatcher', 'Injected FSM context into prompt', {
            agentId,
            currentState: status.currentState,
          });
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

      // Create worker config
      let model = agent.model;
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

      // Check for session continuation
      let sessionId: string | undefined;
      if (this.shouldContinueAgent(agent.name, meshConfig?.continuation)) {
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

      worker.on('output', (data) => {
        // Track last output time for stuck detection
        const activeWorker = this.activeWorkers.get(agentId);
        if (activeWorker) {
          activeWorker.lastOutputAt = Date.now();
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
        const activeWorker = this.activeWorkers.get(agentId);
        const workerHookContext = activeWorker?.hookContext || hookContext;

        // Wait for FSM 'start' transition to complete before proceeding
        // This fixes race condition when queue is empty (0 messages processed)
        if (activeWorker?.startedPromise) {
          await activeWorker.startedPromise;
        }

        // Set worker output and sessionId in hook context for quality hooks
        workerHookContext.workerOutput = data.output;
        workerHookContext.sessionId = data.sessionId;

        // Save output for debugging (but DON'T complete FSM yet)
        if (data.output) {
          this.saveSessionOutput(agentId, data.output);
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
                  iteration: workerHookContext.qualityIteration,
                });

                // Complete FSM first to avoid race condition
                await machine.complete(data);
                this.activeWorkers.delete(agentId);
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
                taskId: workerHookContext.taskId,
                feedback: error.feedback,
              });

              // Complete FSM before emitting events
              await machine.complete(data);
              this.activeWorkers.delete(agentId);
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

        // NOW complete the FSM (after post-hooks pass or exhausted)
        // Defense-in-depth: catch ValidationError if worker tries to complete with pending asks
        try {
          await machine.complete(data);
        } catch (completeError) {
          const errorMsg = (completeError as Error).message;

          // Check if this is a protocol violation (completing with pending asks)
          if (errorMsg.includes('PROTOCOL VIOLATION') || errorMsg.includes('outstanding asks')) {
            log.warn('dispatcher', `BLOCKED: task-complete while asks pending`, {
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

        this.activeWorkers.delete(agentId);
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

        this.emit('worker:complete', {
          ...data,
          transitionName: 'complete',
          qualityResult: workerHookContext.qualityPreflight
            ? { iterations: workerHookContext.qualityIteration || 1, passed: true }
            : undefined,
        });
      });

      // Error transition with retry logic
      worker.on('error', async (data) => {
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
            attempt: machine.currentContext.retryCount + 1,
            maxRetries: machine.currentContext.maxRetries
          });

          await machine.retry();
          // Recursively spawn again, but check if dispatcher is still running
          setTimeout(() => {
            if (this.running) {
              this.spawnWorker(meshName, agent);
            } else {
              log.debug('dispatcher', `Skipping retry, dispatcher stopped`, { agentId });
            }
          }, 1000);
        } else {
          log.error('dispatcher', `Worker exhausted retries`, { agentId });
          this.activeWorkers.delete(agentId);
          this.writeWorkerState();
        }

        this.emit('worker:error', { ...data, transitionName: 'error' });
      });

      this.activeWorkers.set(agentId, {
        runner: worker,
        machine,
        startedAt: Date.now(),
        hookContext,
        startedPromise,  // Add promise to track 'start' completion
      });
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
        log.info('fsm', 'State transition', {
          meshName: event.meshName,
          from: event.from,
          to: event.to,
          trigger: event.trigger,
          triggerAgent: event.triggerAgent,
        });
        this.emit('fsm:transition', event);
      });

      fsm.on('fsm:gate-check', (event: FSMGateEvent) => {
        log.debug('fsm', 'Gate check', {
          meshName: event.meshName,
          state: event.state,
          passed: event.passed,
          retryCount: event.retryCount,
        });
        this.emit('fsm:gate-check', event);
      });

      fsm.on('fsm:script-run', (event: FSMScriptEvent) => {
        if (!event.success) {
          log.error('fsm', 'Script failed', {
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
        log.error('fsm', 'Failed to initialize FSM (JIT)', {
          meshName,
          error: (error as Error).message,
        });
      });

      this.meshFSMs.set(meshName, fsm);
      log.info('dispatcher', 'Initialized FSM (JIT)', { meshName });
    } catch (error) {
      log.error('dispatcher', 'Failed to create FSM (JIT)', {
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
          log.info('fsm', 'State transition', {
            meshName: event.meshName,
            from: event.from,
            to: event.to,
            trigger: event.trigger,
            triggerAgent: event.triggerAgent,
          });
          this.emit('fsm:transition', event);
        });

        fsm.on('fsm:gate-check', (event: FSMGateEvent) => {
          log.debug('fsm', 'Gate check', {
            meshName: event.meshName,
            state: event.state,
            passed: event.passed,
            retryCount: event.retryCount,
          });
          this.emit('fsm:gate-check', event);
        });

        fsm.on('fsm:script-run', (event: FSMScriptEvent) => {
          if (!event.success) {
            log.error('fsm', 'Script failed', {
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
          log.error('fsm', 'Failed to initialize FSM', {
            meshName,
            error: (error as Error).message,
          });
        });

        this.meshFSMs.set(meshName, fsm);
      } catch (error) {
        log.error('dispatcher', `Failed to create FSM for mesh: ${meshName}`, {
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

      // Log warnings but still load the config
      if (validation.warnings.length > 0) {
        log.warn('dispatcher', `Mesh config warnings: ${rawConfig.mesh || filename}`, {
          mesh: rawConfig.mesh,
          warnings: validation.warnings
        });
      }

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
   */
  private saveSessionOutput(agentId: string, output: string): void {
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
    } catch (err) {
      log.error('dispatcher', `Failed to save session output`, { agentId, error: (err as Error).message });
    }
  }

  /**
   * Inject routing instructions into system prompt
   * Appends routing table to end of system prompt
   */
  private injectRoutingInstructions(
    systemPrompt: string,
    routing: AgentRouting,
    meshName: string
  ): string {
    const lines: string[] = [];
    lines.push('\n\n## Message Routing\n');
    lines.push('When you complete your work, route your response message based on the outcome:\n');

    for (const [status, dest] of Object.entries(routing)) {
      const targetAgent = dest.to === 'core' ? 'core/core' : dest.to;
      lines.push(`\n**Status: \`${status}\`**`);
      lines.push(`- Send message to: \`${targetAgent}\``);
      lines.push(`- Reason: ${dest.reason}`);
    }

    lines.push('\n\nSet the `to` field in your message frontmatter based on which status applies.');

    return systemPrompt + lines.join('\n');
  }

  /**
   * Extract routing config for a specific agent from mesh config
   * Transforms mesh format: { status: { destination: "reason" } }
   * To runner format: { status: { to: destination, reason: "reason" } }
   */
  private extractAgentRouting(
    meshName: string,
    agentName: string,
    meshConfig?: MeshConfig
  ): AgentRouting | undefined {
    if (!meshConfig?.routing) return undefined;

    const agentRouting = meshConfig.routing[agentName];
    if (!agentRouting) return undefined;

    // Transform mesh config format to SdkRunner format
    const result: AgentRouting = {};

    for (const [status, destinations] of Object.entries(agentRouting)) {
      // Each status maps to { destination_agent: "reason" }
      // Take the first (usually only) destination
      const entries = Object.entries(destinations);
      if (entries.length === 0) continue;

      const [destination, reason] = entries[0];

      // Build full agent path if not already qualified
      // "core" -> "core/core", "sourcer" -> "research/sourcer"
      const to = destination.includes('/')
        ? destination
        : destination === 'core'
          ? 'core/core'
          : `${meshName}/${destination}`;

      result[status] = { to, reason };
    }

    // Only return if we have any routes
    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * Get active worker count
   */
  getActiveWorkerCount(): number {
    return this.activeWorkers.size;
  }

  /**
   * Get list of active worker IDs
   */
  getActiveWorkerIds(): string[] {
    return Array.from(this.activeWorkers.keys());
  }

  /**
   * Check if dispatcher is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get worker state machine by agent ID
   */
  getWorkerMachine(agentId: string): WorkerStateMachine | undefined {
    return this.activeWorkers.get(agentId)?.machine;
  }

  /**
   * Get all active worker state machines
   */
  getAllWorkerMachines(): Map<string, WorkerStateMachine> {
    const machines = new Map<string, WorkerStateMachine>();
    for (const [id, worker] of this.activeWorkers) {
      machines.set(id, worker.machine);
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
   * Check if a mesh session is complete (no active workers from that mesh)
   * If complete, log session metrics and cleanup
   */
  private checkSessionComplete(meshInstance: string | undefined): void {
    if (!meshInstance) return;

    const session = this.sessionMetrics.get(meshInstance);
    if (!session) return;

    // Check if any workers from this mesh are still active
    const activeInMesh = Array.from(this.activeWorkers.values())
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

  /**
   * Handle ensemble pattern - run coordinator first, then spawn parallel agents
   *
   * Execution flow:
   * 1. Run coordinator agent (if configured) with original task
   * 2. Coordinator outputs SUBTASK markers (SUBTASK 1:, SUBTASK 2:, etc.)
   * 3. Parse coordinator output for SUBTASK markers
   * 4. Create and enqueue subtask messages to queue (one per parallel agent)
   * 5. Spawn parallel agents who poll queue for their subtasks
   * 6. Wait for all agents to complete
   * 7. (Optional) Run reviewer agent to synthesize results
   */
  private async handleEnsemblePattern(meshName: string, meshConfig: MeshConfig): Promise<void> {
    if (!meshConfig.ensemble) return;

    const entryAgent = meshConfig.entry_point || meshConfig.agents[0].name;
    const agentId = `${meshName}/${entryAgent}`;

    // Get the task message from queue
    const task = this.queue.peekOne(agentId);
    if (!task) {
      log.warn('dispatcher', 'No task found for ensemble', { meshName, agentId });
      return;
    }

    log.info('dispatcher', 'Starting ensemble execution', {
      mesh: meshName,
      coordinator: meshConfig.ensemble.coordinator,
      agents: meshConfig.ensemble.agents.length,
      reviewer: meshConfig.ensemble.reviewer,
      strategy: meshConfig.ensemble.aggregation_strategy,
    });

    // Start ensemble tracking
    const ensembleId = this.ensembleCoordinator.startEnsemble(
      meshName,
      meshConfig.ensemble,
      task
    );

    // Consume the task so it's not processed again
    this.queue.pollOne(agentId);

    // STEP 1: Run coordinator FIRST (if configured)
    let subtasks: Array<{ id: string; content: string; assignedAgent: string }> = [];

    if (meshConfig.ensemble.coordinator) {
      const coordinatorOutput = await this.runEnsembleCoordinator(
        meshName,
        meshConfig.ensemble.coordinator,
        task,
        meshConfig
      );

      if (!coordinatorOutput) {
        log.error('dispatcher', 'Coordinator failed to produce output', {
          meshName,
          ensembleId,
          coordinator: meshConfig.ensemble.coordinator,
        });

        // Emit failure and return
        this.emit('ensemble:complete', {
          meshName,
          ensembleId,
          success: false,
          error: 'Coordinator failed to produce output',
        });
        this.ensembleCoordinator.completeEnsemble(ensembleId);
        return;
      }

      // STEP 2: Parse SUBTASK markers from coordinator output
      subtasks = this.parseSubtaskMarkers(coordinatorOutput, meshConfig.ensemble.agents);

      if (subtasks.length === 0) {
        log.warn('dispatcher', 'Coordinator did not produce SUBTASK markers, using original task', {
          meshName,
          ensembleId,
          outputLength: coordinatorOutput.length,
        });

        // Fall back to original task for all agents
        subtasks = meshConfig.ensemble.agents.map((agentName, idx) => ({
          id: `subtask-${idx + 1}`,
          content: task.payload.body as string || '',
          assignedAgent: agentName,
        }));
      }

      log.info('dispatcher', 'Coordinator produced subtasks', {
        meshName,
        ensembleId,
        subtaskCount: subtasks.length,
        assignedAgents: subtasks.map(s => s.assignedAgent),
      });
    } else {
      // No coordinator - all agents get the original task
      subtasks = meshConfig.ensemble.agents.map((agentName, idx) => ({
        id: `subtask-${idx + 1}`,
        content: task.payload.body as string || '',
        assignedAgent: agentName,
      }));
    }

    // STEP 3: Enqueue subtask messages for each parallel agent
    const timestamp = Date.now();
    for (const subtask of subtasks) {
      const subtaskAgentId = `${meshName}/${subtask.assignedAgent}`;
      const subtaskMsgId = `ensemble-${ensembleId}-subtask-${subtask.id}`;

      await this.queue.insert({
        from_agent: meshConfig.ensemble.coordinator
          ? `${meshName}/${meshConfig.ensemble.coordinator}`
          : `${meshName}/ensemble`,
        to_agent: subtaskAgentId,
        type: 'task',
        payload: {
          'msg-id': subtaskMsgId,
          headline: `Ensemble subtask ${subtask.id}`,
          body: subtask.content,
          timestamp: new Date(timestamp).toISOString(),
          ensemble_id: ensembleId,
          subtask_id: subtask.id,
        },
      });

      log.debug('dispatcher', 'Enqueued subtask message', {
        ensembleId,
        subtaskId: subtask.id,
        toAgent: subtaskAgentId,
      });
    }

    // STEP 4: Spawn all ensemble agents in parallel
    const agentPromises = meshConfig.ensemble.agents.map(agentName =>
      this.spawnEnsembleAgent(meshName, agentName, task, ensembleId, meshConfig)
    );

    // Wait for all agents (don't fail if one fails)
    await Promise.allSettled(agentPromises);

    // STEP 5: Check if ensemble is complete and aggregate
    await this.checkEnsembleCompletion(meshName, ensembleId);
  }

  /**
   * Run the ensemble coordinator agent and capture its output
   * Returns the coordinator's output (should contain SUBTASK markers)
   */
  private async runEnsembleCoordinator(
    meshName: string,
    coordinatorName: string,
    task: Message,
    meshConfig: MeshConfig
  ): Promise<string | null> {
    const coordinatorId = `${meshName}/${coordinatorName}`;
    const agentConfig = meshConfig.agents.find(a => a.name === coordinatorName);

    if (!agentConfig) {
      log.error('dispatcher', 'Coordinator agent not found in mesh config', {
        meshName,
        coordinatorName,
        availableAgents: meshConfig.agents.map(a => a.name),
      });
      return null;
    }

    const timeout = meshConfig.ensemble?.timeout_ms || 120000;

    log.info('dispatcher', 'Starting ensemble coordinator', {
      coordinatorId,
      model: agentConfig.model,
      timeout,
    });

    try {
      // Build the system prompt for coordinator
      const promptPath = agentConfig.prompt.startsWith('/')
        ? agentConfig.prompt
        : path.join(meshConfig._basePath || this.config.workDir, agentConfig.prompt);

      if (!fs.existsSync(promptPath)) {
        throw new Error(`Coordinator prompt not found: ${promptPath}`);
      }

      let systemPrompt = fs.readFileSync(promptPath, 'utf-8');

      // Inject preamble
      const agentCount = meshConfig.agents?.length ?? 1;
      systemPrompt = this.promptInjector.injectPreamble(systemPrompt, { agentCount });

      // Create runner config for coordinator
      const runnerConfig: SdkRunnerConfig = {
        id: coordinatorId,
        model: agentConfig.model,
        systemPrompt,
        workDir: this.config.workDir,
        msgsDir: this.config.msgsDir,
      };

      const runner = new SdkRunner(runnerConfig, this.queue);

      // Capture coordinator output
      let coordinatorOutput = '';

      runner.on('output', (data) => {
        coordinatorOutput += data.data || '';
      });

      runner.on('error', (data) => {
        log.error('dispatcher', 'Coordinator error', {
          coordinatorId,
          error: data.error,
        });
      });

      // Enqueue the original task for the coordinator
      await this.queue.insert({
        from_agent: task.from_agent,
        to_agent: coordinatorId,
        type: 'task',
        payload: {
          ...task.payload,
          'msg-id': `coordinator-task-${Date.now()}`,
        },
      });

      // Run coordinator with timeout
      await Promise.race([
        runner.run(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Coordinator timeout after ${timeout}ms`)), timeout)
        ),
      ]);

      log.info('dispatcher', 'Coordinator completed', {
        coordinatorId,
        outputLength: coordinatorOutput.length,
      });

      return coordinatorOutput;
    } catch (err) {
      const errorMsg = (err as Error).message;
      log.error('dispatcher', 'Coordinator execution failed', {
        coordinatorId,
        error: errorMsg,
      });
      return null;
    }
  }

  /**
   * Parse SUBTASK markers from coordinator output
   * Format: SUBTASK 1: ... SUBTASK 2: ... etc.
   *
   * @param output - Coordinator output containing SUBTASK markers
   * @param agents - List of agent names to assign subtasks to
   * @returns Array of parsed subtasks with assigned agents
   */
  private parseSubtaskMarkers(
    output: string,
    agents: string[]
  ): Array<{ id: string; content: string; assignedAgent: string }> {
    const subtasks: Array<{ id: string; content: string; assignedAgent: string }> = [];

    // Match SUBTASK N: followed by content until next SUBTASK or end
    const subtaskRegex = /SUBTASK\s+(\d+):([\s\S]*?)(?=SUBTASK\s+\d+:|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = subtaskRegex.exec(output)) !== null) {
      const subtaskNum = parseInt(match[1], 10);
      const content = match[2].trim();

      // Assign to agent (round-robin if more subtasks than agents)
      const agentIndex = (subtaskNum - 1) % agents.length;
      const assignedAgent = agents[agentIndex];

      subtasks.push({
        id: `subtask-${subtaskNum}`,
        content,
        assignedAgent,
      });
    }

    return subtasks;
  }

  /**
   * Spawn single ensemble agent
   */
  private async spawnEnsembleAgent(
    meshName: string,
    agentName: string,
    task: Message,
    ensembleId: string,
    meshConfig: MeshConfig
  ): Promise<void> {
    const agentConfig = meshConfig.agents.find(a => a.name === agentName);
    if (!agentConfig) {
      log.error('dispatcher', 'Agent not found', { agentName, meshName });
      this.ensembleCoordinator.recordAgentResult(ensembleId, agentName, '', 'Agent not found');
      return;
    }

    const timeout = meshConfig.ensemble?.timeout_ms || 120000;
    const agentId = `${meshName}/${agentName}`;

    try {
      log.info('dispatcher', 'Spawning ensemble agent', { agentId, ensembleId });

      // Register agent start time for timing metrics
      this.ensembleCoordinator.registerAgentStart(ensembleId, agentName);

      // Build the system prompt for this agent
      const promptPath = agentConfig.prompt.startsWith('/')
        ? agentConfig.prompt
        : path.join(meshConfig._basePath || this.config.workDir, agentConfig.prompt);

      if (!fs.existsSync(promptPath)) {
        throw new Error(`Prompt not found: ${promptPath}`);
      }

      let systemPrompt = fs.readFileSync(promptPath, 'utf-8');

      // Inject preamble
      const agentCount = meshConfig.agents?.length ?? 1;
      systemPrompt = this.promptInjector.injectPreamble(systemPrompt, { agentCount });

      // Create runner config
      const runnerConfig: SdkRunnerConfig = {
        id: agentId,
        model: agentConfig.model,
        systemPrompt,
        workDir: this.config.workDir,
        msgsDir: this.config.msgsDir,
      };

      const runner = new SdkRunner(runnerConfig, this.queue);

      // Track result collection
      let result = '';
      let error: string | undefined;

      runner.on('output', (data) => {
        result += data.output || '';
      });

      runner.on('error', (data) => {
        error = data.error;
      });

      // Run with timeout
      await Promise.race([
        runner.run(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
        ),
      ]);

      // Record result
      this.ensembleCoordinator.recordAgentResult(ensembleId, agentName, result, error);
      log.debug('dispatcher', 'Ensemble agent completed', { agentName, ensembleId });
    } catch (err) {
      const errorMsg = (err as Error).message;
      this.ensembleCoordinator.recordAgentResult(
        ensembleId,
        agentName,
        '',
        errorMsg
      );
      log.warn('dispatcher', 'Ensemble agent failed', { agentName, error: errorMsg });
    }
  }

  /**
   * Check if ensemble is complete and aggregate
   */
  private async checkEnsembleCompletion(meshName: string, ensembleId: string): Promise<void> {
    if (!this.ensembleCoordinator.isComplete(ensembleId)) {
      log.debug('dispatcher', 'Ensemble not yet complete', { ensembleId });
      return;
    }

    log.info('dispatcher', 'Ensemble complete, aggregating results', { ensembleId });

    const result = await this.ensembleCoordinator.getAggregatedResult(ensembleId);
    if (!result) {
      log.error('dispatcher', 'Failed to get aggregated result', { ensembleId });
      return;
    }

    // Write result message to queue
    const timestamp = new Date().toISOString();
    const msgId = `ensemble-${Date.now()}`;

    await this.queue.insert({
      from_agent: `${meshName}/ensemble`,
      to_agent: 'core/core',
      type: 'task-complete',
      payload: {
        'msg-id': msgId,
        ensemble_id: ensembleId,
        headline: `Ensemble execution complete: ${meshName}`,
        body: result.output,
        timestamp,
        ...result.metadata,
      },
    });

    log.info('dispatcher', 'Ensemble result written to queue', {
      ensembleId,
      success: result.metadata.success,
    });

    // Cleanup
    this.ensembleCoordinator.completeEnsemble(ensembleId);

    // Emit event
    this.emit('ensemble:complete', {
      meshName,
      ensembleId,
      success: result.metadata.success,
    });
  }
}
