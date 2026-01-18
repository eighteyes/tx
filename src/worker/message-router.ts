/**
 * MessageRouter - Message Interception and Routing
 *
 * Responsibilities:
 * - Handling incoming worker messages (triggering spawns)
 * - Managing ask/ask-response flow
 * - Handling message revisions (interrupt + resume)
 * - Handling parity reminders
 * - Managing suspended sessions
 * - Building prompts for various message types
 *
 * Designed for extensibility with middleware pattern for
 * frontmatter manipulation (per user requirement).
 *
 * Extracted from WorkerDispatcher to separate concerns.
 */

import { EventEmitter } from 'node:events';
import { log } from '../shared/logger.ts';
import type { SdkRunner, SdkRunnerConfig } from './sdk-runner.ts';
import type { WorkerStateMachine } from '../state-machine/index.ts';
import type { MessageQueue } from '../queue/index.ts';
import type {
  DispatcherConfig,
  AgentConfig,
  MeshConfig,
  ActiveWorker,
  SuspendedSession,
  RevisionMessageEvent,
  AskMessageEvent,
  AskResponseMessageEvent,
  ParityReminderEvent,
  FrontmatterMiddleware,
  FrontmatterContext,
} from './types.ts';

/**
 * Dependencies injected into MessageRouter
 */
export interface MessageRouterDeps {
  config: DispatcherConfig;
  queue: MessageQueue;
  getActiveWorker: (agentId: string) => ActiveWorker | undefined;
  getMeshConfig: (meshName: string) => MeshConfig | undefined;
  loadMeshOnDemand: (meshName: string) => boolean;
  spawnWorker: (meshName: string, agent: AgentConfig) => Promise<void>;
  deleteActiveWorker: (agentId: string) => void;
  createRunner: (config: SdkRunnerConfig) => SdkRunner;
  createMachine: (agentId: string, meshName: string, agentConfig: AgentConfig) => WorkerStateMachine;
}

/**
 * MessageRouter - Handles all message interception and routing
 */
export class MessageRouter extends EventEmitter {
  private deps: MessageRouterDeps;
  private suspendedSessions: Map<string, SuspendedSession> = new Map();
  private frontmatterMiddleware: FrontmatterMiddleware[] = [];

  constructor(deps: MessageRouterDeps) {
    super();
    this.deps = deps;
  }

  // ===========================================================================
  // Middleware API (for extensibility)
  // ===========================================================================

  /**
   * Register frontmatter middleware
   * Middleware is called in order for each message's frontmatter
   */
  use(middleware: FrontmatterMiddleware): void {
    this.frontmatterMiddleware.push(middleware);
    log.debug('message-router', `Registered frontmatter middleware: ${middleware.name}`);
  }

  /**
   * Process frontmatter through middleware chain
   */
  async processFrontmatter(
    frontmatter: Record<string, unknown>,
    context: FrontmatterContext
  ): Promise<Record<string, unknown>> {
    let result = frontmatter;
    for (const mw of this.frontmatterMiddleware) {
      try {
        result = await mw.process(result, context);
      } catch (error) {
        log.error('message-router', `Frontmatter middleware ${mw.name} failed`, {
          error: (error as Error).message,
        });
      }
    }
    return result;
  }

  // ===========================================================================
  // Worker Message Handling
  // ===========================================================================

  /**
   * Handle incoming worker message - spawn worker if not already running
   */
  async handleWorkerMessage(agentId: string): Promise<void> {
    // Skip if worker already running
    if (this.deps.getActiveWorker(agentId)) {
      log.debug('message-router', `Worker already running, message queued`, { agentId });
      return;
    }

    // Parse mesh/agent from agentId
    const [meshName, agentName] = agentId.split('/');
    if (!meshName || !agentName) {
      log.error('message-router', `Invalid agentId format`, { agentId });
      return;
    }

    let meshConfig = this.deps.getMeshConfig(meshName);
    if (!meshConfig) {
      // Try JIT loading before failing
      log.info('message-router', 'Mesh not loaded, attempting JIT load', { meshName, agentId });
      const loaded = this.deps.loadMeshOnDemand(meshName);
      if (!loaded) {
        log.error('message-router', 'Mesh not found (JIT load failed)', { meshName, agentId });
        return;
      }
      meshConfig = this.deps.getMeshConfig(meshName);
      if (!meshConfig) {
        log.error('message-router', 'Mesh loaded but config missing', { meshName, agentId });
        return;
      }
    }

    const agent = meshConfig.agents.find(a => a.name === agentName);
    if (!agent) {
      log.error('message-router', `Agent not found in mesh`, { meshName, agentName, agentId });
      return;
    }

    log.info('message-router', `Spawning worker for message`, { agentId });
    this.emit('spawn-worker', { meshName, agent, meshConfig });

    // Let the event handler do the actual spawning
    await this.deps.spawnWorker(meshName, agent);
  }

  // ===========================================================================
  // Revision Handling
  // ===========================================================================

  /**
   * Handle message revision - interrupt active worker and resume with revised content
   * This enables mid-flight corrections when message files are edited.
   */
  async handleRevision(event: RevisionMessageEvent): Promise<void> {
    const { agentId, content, headline } = event;

    const activeWorker = this.deps.getActiveWorker(agentId);
    if (!activeWorker) {
      log.warn('message-router', `Revision received but no active worker found`, {
        agentId,
        headline,
      });
      return;
    }

    const sessionId = activeWorker.runner.getSessionId();
    if (!sessionId) {
      log.warn('message-router', `Revision received but worker has no session ID`, {
        agentId,
        headline,
      });
      return;
    }

    log.info('message-router', `Handling message revision`, {
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
      const revisionPrompt = this.buildRevisionPrompt(content, headline);

      log.info('message-router', `Resuming session with revised content`, {
        agentId,
        sessionId: sessionId.slice(0, 8),
      });

      // Resume the session with the revised content
      const result = await activeWorker.runner.resume(sessionId, revisionPrompt);

      if (result.success) {
        log.info('message-router', `Revision resume completed successfully`, {
          agentId,
          sessionId: sessionId.slice(0, 8),
        });
        this.emit('revision:complete', {
          agentId,
          sessionId,
          success: true,
        });
      } else {
        log.error('message-router', `Revision resume failed`, {
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
      log.error('message-router', `Failed to handle message revision`, {
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
  buildRevisionPrompt(content: string, headline?: string): string {
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

  // ===========================================================================
  // Ask Message Handling
  // ===========================================================================

  /**
   * Handle ask message - transition worker to awaiting state
   * When a worker writes an ask message to another agent, we:
   * 1. Find the worker that sent the ask (by from field)
   * 2. Transition it to awaiting state
   * 3. For ask-human: kill the worker (will resume on response)
   * 4. Set up timeout for await
   */
  async handleAskMessage(event: AskMessageEvent): Promise<void> {
    const { from: senderAgentId, to: targetAgentId, type: messageType } = event;

    const activeWorker = this.deps.getActiveWorker(senderAgentId);
    if (!activeWorker) {
      log.debug('message-router', `Ask message but no active worker found`, {
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
      log.warn('message-router', `Ask message but worker has no session ID`, {
        from: senderAgentId,
        to: targetAgentId,
      });
      return;
    }

    try {
      // ask-human is fire-and-forget - don't add to awaitingResponses
      if (messageType === 'ask-human') {
        log.info('message-router', `ask-human sent (fire-and-forget, no await)`, {
          from: senderAgentId,
          to: targetAgentId,
        });

        // Handle ask-human: kill worker and suspend session
        await this.handleAskHuman(senderAgentId, targetAgentId, sessionId, runner, machine);

        this.emit('worker:ask-human', {
          workerId: senderAgentId,
          target: targetAgentId,
        });
      } else if (currentStatus === 'awaiting') {
        // Already awaiting, add this target to the set
        log.info('message-router', `Adding await target`, {
          from: senderAgentId,
          to: targetAgentId,
          existingTargets: Array.from(machine.getAwaitingResponses()),
        });
        await machine.addAwaitTarget(targetAgentId);
      } else if (currentStatus === 'running' || currentStatus === 'idle') {
        // Enter awaiting state
        log.debug('message-router', `Worker entering await state`, {
          from: senderAgentId,
          to: targetAgentId,
          type: messageType,
          sessionId: sessionId.slice(0, 8),
        });
        await machine.enterAwait(targetAgentId, sessionId);

        // Set up timeout
        const timeout = machine.currentContext.awaitTimeout;
        const timeoutId = setTimeout(() => {
          this.emit('await:timeout', { agentId: senderAgentId });
        }, timeout);
        machine.currentContext.awaitTimeoutId = timeoutId;

        this.emit('worker:await', {
          workerId: senderAgentId,
          targets: [targetAgentId],
          sessionId,
          type: messageType,
        });
      } else {
        log.warn('message-router', `Cannot await from current state`, {
          from: senderAgentId,
          to: targetAgentId,
          currentStatus,
        });
      }
    } catch (error) {
      log.error('message-router', `Failed to enter await state`, {
        from: senderAgentId,
        to: targetAgentId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle ask-human: kill worker and store session for later resume
   */
  private async handleAskHuman(
    senderAgentId: string,
    targetAgentId: string,
    sessionId: string,
    runner: SdkRunner,
    machine: WorkerStateMachine
  ): Promise<void> {
    log.info('message-router', `Killing worker for ask-human (will resume on response)`, {
      from: senderAgentId,
      sessionId: sessionId.slice(0, 8),
    });

    try {
      // Extract mesh and agent info for later resume
      const [meshName, agentName] = senderAgentId.split('/');
      const meshConfig = this.deps.getMeshConfig(meshName);
      const agentConfig = meshConfig?.agents.find(a => a.name === agentName);

      if (!agentConfig) {
        log.error('message-router', `Cannot suspend: agent config not found`, {
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

      // Kill the worker
      runner.kill();

      this.emit('worker:suspended', {
        agentId: senderAgentId,
        sessionId,
        reason: 'ask-human',
        targetAgent: targetAgentId,
      });

      // Remove from active workers
      this.deps.deleteActiveWorker(senderAgentId);

      log.info('message-router', `Worker killed and suspended`, {
        from: senderAgentId,
        sessionId: sessionId.slice(0, 8),
      });
    } catch (killError) {
      log.error('message-router', `Failed to kill worker for ask-human`, {
        from: senderAgentId,
        error: (killError as Error).message,
      });
    }
  }

  // ===========================================================================
  // Ask-Response Handling
  // ===========================================================================

  /**
   * Handle ask-response message - resume awaiting worker
   */
  async handleAskResponse(event: AskResponseMessageEvent): Promise<void> {
    const { from: respondingAgentId, to: awaitingAgentId, content } = event;

    // Check for suspended session (killed due to ask-human)
    const suspended = this.suspendedSessions.get(awaitingAgentId);
    if (suspended && respondingAgentId === 'core/core') {
      log.info('message-router', `Human response received for suspended session`, {
        from: respondingAgentId,
        to: awaitingAgentId,
        sessionId: suspended.sessionId.slice(0, 8),
        suspendedFor: Date.now() - suspended.suspendedAt,
      });

      // Resume the suspended session with human response
      await this.resumeSuspendedSession(awaitingAgentId, suspended, content, event.headline);
      return;
    }

    const activeWorker = this.deps.getActiveWorker(awaitingAgentId);
    if (!activeWorker) {
      log.debug('message-router', `Ask-response but no active worker found`, {
        from: respondingAgentId,
        to: awaitingAgentId,
      });
      return;
    }

    const { machine, runner } = activeWorker;
    const currentStatus = machine.getStatus();

    if (currentStatus !== 'awaiting') {
      log.warn('message-router', `Ask-response but worker not in awaiting state`, {
        from: respondingAgentId,
        to: awaitingAgentId,
        currentStatus,
      });
      return;
    }

    // Check if we're actually waiting for this agent
    const awaitingResponses = machine.getAwaitingResponses();
    if (!awaitingResponses.has(respondingAgentId)) {
      log.warn('message-router', `Ask-response from unexpected agent`, {
        from: respondingAgentId,
        to: awaitingAgentId,
        awaiting: Array.from(awaitingResponses),
      });
      return;
    }

    try {
      log.info('message-router', `Received ask-response`, {
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
        await this.resumeAfterAllResponses(awaitingAgentId, respondingAgentId, content, event.headline, machine, runner);
      }
    } catch (error) {
      log.error('message-router', `Failed to handle ask-response`, {
        from: respondingAgentId,
        to: awaitingAgentId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Resume worker session after all ask responses are received
   */
  private async resumeAfterAllResponses(
    awaitingAgentId: string,
    respondingAgentId: string,
    content: string,
    headline: string | undefined,
    machine: WorkerStateMachine,
    runner: SdkRunner
  ): Promise<void> {
    const sessionId = machine.getAwaitSessionId();
    if (!sessionId) {
      log.error('message-router', `All responses received but no session ID`, {
        awaitingAgentId,
      });
      return;
    }

    // Check if runner is still actively processing
    if (runner.isRunning()) {
      log.info('message-router', `Runner still active, response queued for current run`, {
        awaitingAgentId,
        sessionId: sessionId.slice(0, 8),
      });
      return;
    }

    log.info('message-router', `All responses received, resuming session`, {
      awaitingAgentId,
      sessionId: sessionId.slice(0, 8),
    });

    // Build resume prompt with the response content
    const resumePrompt = this.buildAskResponsePrompt(respondingAgentId, content, headline);

    // Resume the session
    const result = await runner.resume(sessionId, resumePrompt);

    if (result.success) {
      log.info('message-router', `Session resumed successfully`, {
        awaitingAgentId,
        sessionId: sessionId.slice(0, 8),
      });
    } else {
      log.error('message-router', `Session resume failed`, {
        awaitingAgentId,
        error: result.error,
      });
    }
  }

  /**
   * Build a prompt for resuming with ask-response content
   */
  buildAskResponsePrompt(from: string, content: string, headline?: string): string {
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

  // ===========================================================================
  // Suspended Session Handling
  // ===========================================================================

  /**
   * Resume a suspended session with human response
   */
  private async resumeSuspendedSession(
    agentId: string,
    suspended: SuspendedSession,
    responseContent: string,
    headline?: string
  ): Promise<void> {
    const { sessionId, meshName, agentConfig } = suspended;

    log.info('message-router', `Resuming suspended session`, {
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
        workDir: this.deps.config.workDir,
        msgsDir: this.deps.config.msgsDir,
        sessionId,  // Resume existing session
      };

      const runner = this.deps.createRunner(runnerConfig);
      const machine = this.deps.createMachine(agentId, meshName, agentConfig);

      // Emit event for dispatcher to track the resumed worker
      this.emit('worker:resuming', {
        agentId,
        sessionId,
        meshName,
        agentConfig,
        runner,
        machine,
        resumePrompt,
      });

    } catch (error) {
      log.error('message-router', `Failed to resume suspended session`, {
        agentId,
        error: (error as Error).message,
      });
      // Clean up on failure
      this.suspendedSessions.delete(agentId);
    }
  }

  /**
   * Get suspended session for an agent
   */
  getSuspendedSession(agentId: string): SuspendedSession | undefined {
    return this.suspendedSessions.get(agentId);
  }

  /**
   * Check if agent has a suspended session
   */
  hasSuspendedSession(agentId: string): boolean {
    return this.suspendedSessions.has(agentId);
  }

  // ===========================================================================
  // Parity Reminder Handling
  // ===========================================================================

  /**
   * Handle parity reminder - inject feedback into worker when task-complete is blocked
   */
  async handleParityReminder(event: ParityReminderEvent): Promise<void> {
    const { agentId, pendingAsks, deletedFile } = event;

    const activeWorker = this.deps.getActiveWorker(agentId);
    if (!activeWorker) {
      log.warn('message-router', `Pending asks/tasks reminder: no active worker found`, {
        agentId,
        pendingAsks,
        deletedFile,
      });
      return;
    }

    const { runner } = activeWorker;
    const sessionId = runner.getSessionId();

    if (!sessionId) {
      log.warn('message-router', `Pending asks/tasks reminder: worker has no session ID`, {
        agentId,
        pendingAsks,
      });
      return;
    }

    log.info('message-router', `Handling pending asks/tasks reminder`, {
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

      log.info('message-router', `Resuming session with pending asks/tasks reminder`, {
        agentId,
        sessionId: sessionId.slice(0, 8),
      });

      // Resume the session with the reminder
      const result = await runner.resume(sessionId, reminderPrompt);

      if (result.success) {
        log.info('message-router', `Pending asks/tasks reminder: resume completed`, {
          agentId,
          sessionId: sessionId.slice(0, 8),
        });
        this.emit('parity:resume', {
          agentId,
          sessionId,
          success: true,
        });
      } else {
        log.error('message-router', `Pending asks/tasks reminder: resume failed`, {
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
      log.error('message-router', `Pending asks/tasks reminder: handling failed`, {
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
  buildParityReminderPrompt(pendingAsks: Array<{ msgId: string; to: string }>): string {
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
   * Build steering prompt for ask-human flow
   */
  buildAskHumanSteeringPrompt(): string {
    return `## Session Paused - Awaiting Human Response

You sent an ask-human message to request human input.

**IMPORTANT**: Your session is now PAUSED.
- DO NOT write task-complete
- DO NOT proceed with work
- WAIT for the ask-response message

The system will resume your session when the human responds.`;
  }
}
