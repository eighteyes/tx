/**
 * SessionManager - Session Suspend/Resume State Management
 *
 * Manages suspended session state and response buffering:
 * - Tracks suspended sessions (ask-human, await-response)
 * - Buffers responses while awaiting multiple replies
 * - Persists sessions to SQLite for crash recovery
 * - Provides prompt builders for session resume
 *
 * Note: Actual session resume execution is handled by dispatcher
 * since it involves creating runners and wiring event handlers.
 * This manager handles the state tracking and data preparation.
 */

import { EventEmitter } from 'node:events';
import { log } from '../shared/logger.ts';
import type { MessageQueue } from '../queue/index.ts';
import type { HookContext } from './hooks.ts';
import type { SemanticModel } from '../shared/types.ts';

/**
 * Agent configuration (subset needed for session management)
 */
export interface AgentConfigMinimal {
  name: string;
  model: SemanticModel;
  prompt: string;
}

/**
 * Suspended session state (worker killed, awaiting resume)
 */
export interface SuspendedSession {
  sessionId: string;
  reason: 'ask-human' | 'await-response';
  suspendedAt: number;
  targetAgents: Set<string>;  // All agents we're awaiting responses from
  pendingResponseCount: number;  // Number of responses still awaited
  meshName: string;
  agentConfig: AgentConfigMinimal;
  hookContext?: HookContext;  // Preserved for await-response resumption
}

/**
 * Buffered response from an agent
 */
export interface BufferedResponse {
  from: string;
  content: string;
  headline?: string;
}

/**
 * Options for suspending a session
 */
export interface SuspendOptions {
  sessionId: string;
  reason: 'ask-human' | 'await-response';
  meshName: string;
  agentConfig: AgentConfigMinimal;
  targetAgents: string[];
  pendingCount: number;
  hookContext?: HookContext;
}

/**
 * Events emitted by SessionManager
 */
export interface SessionManagerEvents {
  'session:suspended': { agentId: string; sessionId: string; reason: string };
  'session:resumed': { agentId: string; sessionId: string };
}

/**
 * Manages suspended session state and response buffering
 */
export class SessionManager extends EventEmitter {
  private suspendedSessions: Map<string, SuspendedSession> = new Map();
  private askResponseBuffer: Map<string, BufferedResponse[]> = new Map();
  private queue: MessageQueue;

  constructor(queue: MessageQueue) {
    super();
    this.queue = queue;
  }

  // ============================================================================
  // Session Suspension
  // ============================================================================

  /**
   * Suspend a session (in-memory and SQLite persistence)
   */
  suspend(agentId: string, options: SuspendOptions): void {
    const { sessionId, reason, meshName, agentConfig, targetAgents, pendingCount, hookContext } = options;

    // Store in-memory
    this.suspendedSessions.set(agentId, {
      sessionId,
      reason,
      suspendedAt: Date.now(),
      targetAgents: new Set(targetAgents),
      pendingResponseCount: pendingCount,
      meshName,
      agentConfig,
      hookContext,
    });

    // Persist to SQLite for crash recovery
    this.queue.suspendSession(agentId, {
      sessionId,
      reason,
      suspendedAt: Date.now(),
      meshName,
      targetAgents,
      pendingCount,
      hookContext: hookContext ? JSON.stringify(hookContext) : undefined,
    });

    this.emit('session:suspended', { agentId, sessionId, reason });

    log.info('session-manager', 'Session suspended', {
      agentId,
      sessionId: sessionId.slice(0, 8),
      reason,
      targetAgents,
      pendingCount,
    });
  }

  /**
   * Mark a session as resumed (removes from tracking)
   */
  markResumed(agentId: string): SuspendedSession | undefined {
    const suspended = this.suspendedSessions.get(agentId);
    if (suspended) {
      this.suspendedSessions.delete(agentId);
      this.queue.resumeSession(agentId);
      this.emit('session:resumed', { agentId, sessionId: suspended.sessionId });

      log.info('session-manager', 'Session resumed', {
        agentId,
        sessionId: suspended.sessionId.slice(0, 8),
        suspendedFor: Date.now() - suspended.suspendedAt,
      });
    }
    return suspended;
  }

  /**
   * Get a suspended session by agent ID
   */
  get(agentId: string): SuspendedSession | undefined {
    return this.suspendedSessions.get(agentId);
  }

  /**
   * Check if an agent has a suspended session
   */
  isSuspended(agentId: string): boolean {
    return this.suspendedSessions.has(agentId);
  }

  /**
   * Check if a mesh has any pending ask-human (suspended sessions)
   * When ask-human is pending, the entire mesh should be halted.
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
   * Get suspended session info for a mesh
   */
  getForMesh(meshName: string): { agentId: string; suspended: SuspendedSession } | undefined {
    for (const [agentId, suspended] of this.suspendedSessions) {
      if (suspended.meshName === meshName) {
        return { agentId, suspended };
      }
    }
    return undefined;
  }

  /**
   * Get all suspended sessions for a mesh
   */
  getAllForMesh(meshName: string): Array<{ agentId: string; suspended: SuspendedSession }> {
    const results: Array<{ agentId: string; suspended: SuspendedSession }> = [];
    for (const [agentId, suspended] of this.suspendedSessions) {
      if (suspended.meshName === meshName) {
        results.push({ agentId, suspended });
      }
    }
    return results;
  }

  // ============================================================================
  // Response Buffering
  // ============================================================================

  /**
   * Buffer a response for an agent
   */
  bufferResponse(agentId: string, response: BufferedResponse): void {
    if (!this.askResponseBuffer.has(agentId)) {
      this.askResponseBuffer.set(agentId, []);
    }
    this.askResponseBuffer.get(agentId)!.push(response);

    log.debug('session-manager', 'Buffered response', {
      agentId,
      from: response.from,
      totalBuffered: this.askResponseBuffer.get(agentId)!.length,
    });
  }

  /**
   * Get and clear buffered responses for an agent
   */
  getAndClearBufferedResponses(agentId: string): BufferedResponse[] {
    const responses = this.askResponseBuffer.get(agentId) || [];
    this.askResponseBuffer.delete(agentId);
    return responses;
  }

  /**
   * Get buffered responses without clearing
   */
  getBufferedResponses(agentId: string): BufferedResponse[] {
    return this.askResponseBuffer.get(agentId) || [];
  }

  /**
   * Get buffered response count
   */
  getBufferedResponseCount(agentId: string): number {
    return this.askResponseBuffer.get(agentId)?.length || 0;
  }

  /**
   * Clear response buffer for an agent
   */
  clearBuffer(agentId: string): void {
    this.askResponseBuffer.delete(agentId);
  }

  // ============================================================================
  // Await Target Management (for await-response sessions)
  // ============================================================================

  /**
   * Remove a responding agent from a suspended session's target set
   * @returns true if all targets have responded
   */
  removeTargetAgent(agentId: string, respondingAgentId: string): boolean {
    const suspended = this.suspendedSessions.get(agentId);
    if (!suspended) return false;

    suspended.targetAgents.delete(respondingAgentId);
    suspended.pendingResponseCount = suspended.targetAgents.size;

    log.debug('session-manager', 'Removed target agent', {
      agentId,
      respondingAgentId,
      remainingTargets: Array.from(suspended.targetAgents),
    });

    return suspended.targetAgents.size === 0;
  }

  /**
   * Check if a suspended session is waiting for a specific agent
   */
  isAwaitingAgent(agentId: string, targetAgentId: string): boolean {
    const suspended = this.suspendedSessions.get(agentId);
    return suspended?.targetAgents.has(targetAgentId) ?? false;
  }

  // ============================================================================
  // Crash Recovery
  // ============================================================================

  /**
   * Restore suspended sessions from SQLite (for crash recovery)
   * Call this on startup with a callback to resolve agent configs
   */
  restoreFromDatabase(
    resolveAgentConfig: (meshName: string, agentName: string) => AgentConfigMinimal | undefined
  ): number {
    const dbSessions = this.queue.listSuspendedSessions();

    for (const s of dbSessions) {
      const [, agentName] = s.agentId.split('/');
      const agentConfig = resolveAgentConfig(s.meshName, agentName);

      if (!agentConfig) {
        log.warn('session-manager', 'Cannot restore suspended session: agent config not found', {
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

      log.info('session-manager', 'Restored suspended session', {
        agentId: s.agentId,
        sessionId: s.sessionId.slice(0, 8),
        reason: s.reason,
        suspendedFor: Date.now() - s.suspendedAt,
      });
    }

    if (dbSessions.length > 0) {
      log.info('session-manager', `Restored ${dbSessions.length} suspended session(s) from database`);
    }

    return dbSessions.length;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clear all state for a mesh (on completion or reset)
   */
  clearForMesh(meshName: string): { sessions: number; buffers: number } {
    let clearedSessions = 0;
    let clearedBuffers = 0;

    // Clear in-memory suspended sessions
    for (const [agentId, _] of this.suspendedSessions) {
      if (agentId.startsWith(`${meshName}/`)) {
        this.suspendedSessions.delete(agentId);
        clearedSessions++;
      }
    }

    // Clear in-memory response buffers
    for (const [agentId, _] of this.askResponseBuffer) {
      if (agentId.startsWith(`${meshName}/`)) {
        this.askResponseBuffer.delete(agentId);
        clearedBuffers++;
      }
    }

    // Clear SQLite suspended sessions
    const clearedDbSessions = this.queue.clearSuspendedSessionsForMesh(meshName);

    if (clearedSessions > 0 || clearedBuffers > 0) {
      log.debug('session-manager', 'Cleared mesh state', {
        meshName,
        clearedSessions,
        clearedBuffers,
        clearedDbSessions,
      });
    }

    return { sessions: clearedSessions, buffers: clearedBuffers };
  }

  /**
   * Clear all sessions (for shutdown)
   */
  clearAll(): number {
    const count = this.queue.clearAllSuspendedSessions();
    this.suspendedSessions.clear();
    this.askResponseBuffer.clear();
    return count;
  }

  /**
   * Get count of suspended sessions
   */
  getSuspendedCount(): number {
    return this.suspendedSessions.size;
  }

  // ============================================================================
  // Prompt Builders
  // ============================================================================

  /**
   * Build a resume prompt for ask-response
   * Aggregates multiple responses if needed
   */
  buildAskResponsePrompt(responses: BufferedResponse[]): string {
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
   * Used when resuming a suspended session waiting for multiple human responses
   */
  buildBatchedAskResponseContent(responses: BufferedResponse[]): string {
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
   * Build a resume prompt with human response
   */
  buildHumanResponsePrompt(content: string, headline?: string): string {
    return headline
      ? `## Human Response: ${headline}\n\n${content}`
      : `## Human Response\n\n${content}`;
  }
}
