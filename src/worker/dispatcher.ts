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
import { MessageQueue } from '../queue/index.ts';
import { SdkRunner, type SdkRunnerConfig, type AgentRouting, type ToolRestriction } from './sdk-runner.ts';
import type { SemanticModel, WorkerConfig } from '../shared/types.ts';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import { WorkerStateMachine, createLoggingMiddleware } from '../state-machine/index.ts';
import { WorkspaceManager, PromptInjector, type WorkspaceConfig } from '../workspace/index.ts';
import {
  LifecycleHooks,
  QualityIterationError,
  QualityHaltError,
  QualityExhaustedError,
  type HookContext,
} from './hooks.ts';
import { MeshValidator } from './mesh-validator.ts';
import {
  type GradedConfig,
  type GateType,
  type PreflightOutput,
} from '../quality/index.ts';

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

interface ContinuationConfig {
  type: 'session' | 'none';       // session = auto-resume, none = fresh each time
  // Phase 2:
  // compress_turn_count?: number; // Summarize after N turns
}

interface MeshConfig {
  mesh: string;
  description?: string;
  agents: AgentConfig[];
  entry_point?: string;
  workspace?: WorkspaceConfig;  // Optional workspace output schema
  worktree?: boolean;  // Shorthand: true = isolated worktree + auto-commit + cleanup
  continuation?: ContinuationConfig;  // Session continuation config
  lifecycle?: {
    pre?: string[];   // Pre-hooks executed before worker spawn
    post?: string[];  // Post-hooks executed after worker completion
  };
  routing?: MeshRouting;  // Agent routing tables
  toolRestriction?: ToolRestriction;  // Tool access policy for all agents in mesh
  graded?: GradedConfig;  // Quality stack config: true, false, or array of gate types
  iteration?: IterationConfig;  // Iteration config for graded meshes
  _basePath?: string;  // Internal: directory containing this config (for relative prompt paths)
}

/**
 * Resolve lifecycle hooks from config
 * Supports multiple shorthands that expand to lifecycle hooks:
 * - worktree: true → worktree:create + commit:auto (cleanup via /know:done)
 * - graded: true → quality:preflight + individual quality gates
 * - graded: ['checklist', 'rubric'] → quality:preflight + specific gates
 * Explicit lifecycle overrides all shorthands
 */
function resolveLifecycle(config: MeshConfig): { pre: string[]; post: string[] } | undefined {
  // Explicit lifecycle takes precedence
  if (config.lifecycle) {
    return {
      pre: config.lifecycle.pre || [],
      post: config.lifecycle.post || [],
    };
  }

  // Build lifecycle from shorthands
  const pre: string[] = [];
  const post: string[] = [];

  // graded: true/array shorthand → individual quality gate hooks
  if (config.graded) {
    pre.push('quality:preflight');

    // Determine which gates to use
    const gates: GateType[] = Array.isArray(config.graded) ? config.graded : [
      'checklist',
      'rubric',
      'adversarial',
      'accuracy',
      'summarizer',
      'deterministic',
    ];

    // Add each gate as an individual hook
    for (const gate of gates) {
      let hookName = `quality:${gate}`;

      // Only add iteration config to gates that can fail (not summarizer)
      if (gate !== 'summarizer') {
        const configParts: string[] = [];
        if (config.iteration?.onFail) {
          configParts.push(`onFail=${config.iteration.onFail}`);
        }
        if (config.iteration?.maxIterations) {
          configParts.push(`maxIterations=${config.iteration.maxIterations}`);
        }

        if (configParts.length > 0) {
          hookName += ':' + configParts.join(',');
        }
      }

      post.push(hookName);
    }
  }

  // worktree: true shorthand
  // NOTE: worktree:cleanup is NOT automatic - user runs /know:done to merge and cleanup
  if (config.worktree) {
    pre.unshift('worktree:create');  // worktree first
    post.push('commit:auto');        // commit changes, but KEEP worktree for review
  }

  // Only return if we have any hooks
  if (pre.length > 0 || post.length > 0) {
    return { pre, post };
  }

  return undefined;
}

interface AgentConfig {
  name: string;
  model: SemanticModel;
  prompt: string;  // Path to prompt file
  workspace?: WorkspaceConfig;  // Optional per-agent workspace config
  mcpServers?: Record<string, McpServerConfig>;  // MCP server configurations
  // Sampling parameters (optional, can be overridden via message frontmatter)
  temperature?: number;  // 0.0-1.0, controls randomness
  maxTokens?: number;    // Max tokens in response
  topP?: number;         // 0.0-1.0, nucleus sampling
}

export interface DispatcherConfig {
  workDir: string;
  msgsDir: string;
  meshesDir: string;
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
}

export class WorkerDispatcher extends EventEmitter {
  private config: DispatcherConfig;
  private queue: MessageQueue;
  private running = false;
  private activeWorkers: Map<string, ActiveWorker> = new Map();
  private meshConfigs: Map<string, MeshConfig> = new Map();
  private stateFile: string;
  private workspaceManager: WorkspaceManager;
  private promptInjector: PromptInjector;
  private lifecycleHooks: LifecycleHooks;
  private boundMessageHandler: ((event: { agentId: string }) => void) | null = null;
  private boundRevisionHandler: ((event: RevisionMessageEvent) => void) | null = null;
  private boundAskMessageHandler: ((event: AskMessageEvent) => void) | null = null;
  private boundAskResponseHandler: ((event: AskResponseMessageEvent) => void) | null = null;

  constructor(config: DispatcherConfig, queue: MessageQueue) {
    super();
    this.config = config;
    this.queue = queue;
    this.stateFile = path.join(config.workDir, '.ai', 'tx', 'data', 'workers.json');
    this.workspaceManager = new WorkspaceManager(config.workDir);
    this.promptInjector = new PromptInjector();
    this.lifecycleHooks = new LifecycleHooks(config.workDir, queue, config.meshesDir);
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
    }
  }

  /**
   * Handle incoming worker message - spawn worker if not already running
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

    const meshConfig = this.meshConfigs.get(meshName);
    if (!meshConfig) {
      log.error('dispatcher', `Mesh not found`, { meshName, agentId });
      return;
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
      if (currentStatus === 'awaiting') {
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

        // For ask-human messages: interrupt worker and inject steering
        // This prevents the worker from continuing and writing task-complete
        if (messageType === 'ask-human') {
          log.info('dispatcher', `Interrupting worker for ask-human`, {
            from: senderAgentId,
            sessionId: sessionId.slice(0, 8),
          });

          try {
            // Interrupt the current query
            await runner.interrupt();

            this.emit('worker:interrupt', {
              agentId: senderAgentId,
              sessionId,
              reason: 'ask-human',
            });

            // Resume with steering prompt that blocks further work
            const steeringPrompt = this.buildAskHumanSteeringPrompt();

            log.info('dispatcher', `Resuming with ask-human steering`, {
              from: senderAgentId,
              sessionId: sessionId.slice(0, 8),
            });

            // Resume the session with steering - this will complete when human responds
            // The 'complete' event will fire but FSM guard will block it if still awaiting
            const result = await runner.resume(sessionId, steeringPrompt);

            if (!result.success) {
              log.warn('dispatcher', `Ask-human steering resume returned error`, {
                from: senderAgentId,
                error: result.error,
              });
            }
          } catch (interruptError) {
            log.error('dispatcher', `Failed to interrupt/steer ask-human`, {
              from: senderAgentId,
              error: (interruptError as Error).message,
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
   * Handle ask-response message - resume awaiting worker
   * When an agent responds to an ask:
   * 1. Find the worker that's awaiting this response (by to field)
   * 2. Remove the responder from awaitingResponses
   * 3. If all responses received, resume the session
   */
  private async handleAskResponseMessage(event: AskResponseMessageEvent): Promise<void> {
    const { from: respondingAgentId, to: awaitingAgentId, content } = event;

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
      const workerConfig: WorkerConfig = {
        id: agentId,
        model: agent.model,
        prompt: systemPrompt
      };

      // Create state machine
      const machine = new WorkerStateMachine(agentId, workerConfig, meshName, agent.name);

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
      if (meshConfig?.continuation?.type === 'session') {
        const existingSession = this.queue.getConversationId(agentId);
        if (existingSession) {
          sessionId = existingSession;
          log.info('dispatcher', `Resuming session for ${agentId}`, {
            sessionId: sessionId.slice(0, 8) + '...'
          });
        }
      }

      // Merge sampling parameters: message frontmatter overrides agent config
      // This allows per-task overrides via message frontmatter
      const temperature = (nextMsg?.payload?.temperature as number | undefined) ?? agent.temperature;
      const maxTokens = (nextMsg?.payload?.maxTokens as number | undefined) ?? agent.maxTokens;
      const topP = (nextMsg?.payload?.topP as number | undefined) ?? agent.topP;

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
        // Sampling parameters (from agent config, overrideable via message frontmatter)
        temperature,
        maxTokens,
        topP,
      };

      const worker = new SdkRunner(runnerConfig, this.queue);
      this.emit('worker:spawn', { agentId, model: agent.model });

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

        this.activeWorkers.delete(agentId);
        this.writeWorkerState();

        // Save session ID for continuation (if enabled and session captured)
        if (meshConfig?.continuation?.type === 'session' && data.sessionId) {
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
    } catch (error) {
      log.error('dispatcher', 'Failed to load mesh configs', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      this.emit('error', { error: `Failed to load mesh configs: ${(error as Error).message}` });
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
        log.error('dispatcher', `Invalid mesh config: ${filename}`, {
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
        log.warn('dispatcher', `Mesh config warnings: ${filename}`, {
          warnings: validation.warnings
        });
      }

      const config = validation.config as MeshConfig;

      // Don't override project configs with global ones
      if (this.meshConfigs.has(config.mesh) && isGlobal) {
        return;
      }

      // Store base path for relative prompt resolution
      config._basePath = basePath;

      this.meshConfigs.set(config.mesh, config);
      log.info('dispatcher', `Loaded mesh: ${config.mesh}`, {
        source: isGlobal ? 'global' : 'project',
        basePath,
        agents: config.agents.map(a => a.name),
        warnings: validation.warnings.length,
        graded: config.graded,
        worktree: config.worktree,
        hasLifecycle: !!config.lifecycle,
      });
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
}
