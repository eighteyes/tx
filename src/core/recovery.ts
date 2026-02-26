/**
 * recovery.ts - Agent state recovery and guidance system
 *
 * Responsibilities:
 * - Generate guidance messages for confused agents
 * - Track recovery request frequency per agent
 * - Escalate to human when agent is repeatedly stuck
 *
 * Recovery Channels:
 * - system/help: Deliberate request for state guidance
 * - system/stuck: Declare inability to proceed
 * - system/*: Any other system target (accidental - still handled)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { MessageQueue } from '../queue/index.ts';
import type { AgentStateSnapshot } from '../worker/dispatcher.ts';
import { log } from '../shared/logger.ts';
import type { SystemMessageWriter } from './system-message-writer.ts';

/**
 * Recovery request from a confused agent
 */
export interface RecoveryRequest {
  agentId: string;
  targetChannel: string;  // system/help, system/stuck, system/*
  msgId: string;
  body: string;
}

/**
 * Guidance data generated for an agent
 */
export interface GuidanceData {
  fsmState: string | null;
  validTransitions: string[];
  pendingAsks: Array<{ msgId: string; to: string; ageMs: number }>;
  workerStatus: string | null;
  isAwaiting: boolean;
  awaitingResponses: string[];
  sessionId: string | null;
  suggestion: string;
}

/**
 * Frequency tracking for recovery requests
 */
interface RequestTracker {
  count: number;
  firstAt: number;
}

/**
 * RecoveryHandler - Handles agent recovery requests via system/* channels
 *
 * When an agent writes to a system/* target (deliberately or accidentally),
 * this handler intercepts the message and provides state guidance.
 *
 * Features:
 * - Generates helpful guidance with FSM state, pending asks, valid routes
 * - Tracks request frequency per agent
 * - Escalates to human after ESCALATION_THRESHOLD requests in ESCALATION_WINDOW_MS
 */
export class RecoveryHandler {
  private requestCounts: Map<string, RequestTracker> = new Map();
  private readonly ESCALATION_THRESHOLD = 3;
  private readonly ESCALATION_WINDOW_MS = 60_000;  // 60 seconds

  constructor(
    private queue: MessageQueue,
    private getAgentState: (agentId: string) => AgentStateSnapshot | null,
    private watchDir: string,
    private writer?: SystemMessageWriter
  ) {}

  /**
   * Handle a recovery request from an agent
   * Returns 'guidance' if guidance was written, 'escalated' if escalated to human
   */
  handleRecoveryRequest(request: RecoveryRequest): 'guidance' | 'escalated' {
    const level = this.trackRequest(request.agentId);

    log.info('recovery', `Processing recovery request`, {
      agentId: request.agentId,
      target: request.targetChannel,
      level,
      threshold: this.ESCALATION_THRESHOLD,
    });

    if (level >= this.ESCALATION_THRESHOLD) {
      this.writeEscalation(request);
      return 'escalated';
    }

    this.writeGuidance(request, level);
    return 'guidance';
  }

  /**
   * Track request frequency and return current level
   * Resets counter if outside escalation window
   */
  private trackRequest(agentId: string): number {
    const now = Date.now();
    const existing = this.requestCounts.get(agentId);

    if (!existing || (now - existing.firstAt) > this.ESCALATION_WINDOW_MS) {
      // New window - reset counter
      this.requestCounts.set(agentId, { count: 1, firstAt: now });
      return 1;
    }

    // Within window - increment counter
    existing.count++;
    return existing.count;
  }

  /**
   * Build guidance data from agent state snapshot
   */
  private buildGuidance(agentId: string, state: AgentStateSnapshot | null, level: number): GuidanceData {
    const now = Date.now();

    const pendingAsks = (state?.pendingAsks || []).map(a => ({
      msgId: a.msgId,
      to: a.to,
      ageMs: now - a.createdAt,
    }));

    // Build suggestion based on state
    let suggestion = 'Continue with your current task.';

    if (state?.pendingAsks && state.pendingAsks.length > 0) {
      suggestion = `Await response to ${state.pendingAsks.length} pending ask(s) before sending task-complete.`;
    } else if (state?.worker?.isAwaiting) {
      suggestion = `You are awaiting responses from: ${state.worker.awaitingResponses.join(', ')}`;
    } else if (!state?.fsm) {
      suggestion = 'No FSM configured for this mesh. Check your routing and message format.';
    }

    return {
      fsmState: state?.fsm?.currentState || null,
      validTransitions: state?.fsm?.validExits || [],
      pendingAsks,
      workerStatus: state?.worker?.status || null,
      isAwaiting: state?.worker?.isAwaiting || false,
      awaitingResponses: state?.worker?.awaitingResponses || [],
      sessionId: state?.sessionId || null,
      suggestion,
    };
  }

  /**
   * Write guidance message back to the agent
   */
  private writeGuidance(request: RecoveryRequest, level: number): void {
    const state = this.getAgentState(request.agentId);
    const guidance = this.buildGuidance(request.agentId, state, level);

    const fsmState = guidance.fsmState || 'unknown';
    const workerStatus = guidance.workerStatus || 'unknown';
    const validExits = guidance.validTransitions;
    const pendingAsks = guidance.pendingAsks;

    const pendingAsksFormatted = pendingAsks.length > 0
      ? pendingAsks.map(a => `- \`${a.msgId}\` -> ${a.to} (${Math.round(a.ageMs / 1000)}s ago)`).join('\n')
      : '- None';

    const validRoutesFormatted = validExits.length > 0
      ? validExits.map(e => `- \`${e}\``).join('\n')
      : '- No FSM exits configured';

    const levelWarning = level >= 2
      ? `\n\n**Warning**: This is attempt ${level}/${this.ESCALATION_THRESHOLD}. Next request escalates to human.`
      : '';

    const body = `## Current State

| Property | Value |
|----------|-------|
| FSM State | \`${fsmState}\` |
| Worker Status | \`${workerStatus}\` |
| Pending Asks | ${pendingAsks.length} |
| Session | \`${guidance.sessionId || 'none'}\` |

## Valid Routes From Here

${validRoutesFormatted}

## Pending Asks (Must Resolve Before task-complete)

${pendingAsksFormatted}

## Suggested Action

${guidance.suggestion}${levelWarning}`;

    if (this.writer) {
      this.writer.write({
        to: request.agentId,
        from: 'system/recovery',
        type: 'guidance',
        headline: `State guidance for ${request.agentId}`,
        body,
      });
      return;
    }

    // Fallback: direct file write
    const timestamp = Date.now();
    const msgId = `guidance-${timestamp}`;
    const safeAgentId = request.agentId.replace('/', '-');
    const filename = `${timestamp}-guidance-system-recovery--${safeAgentId}-${msgId}.md`;
    const filepath = path.join(this.watchDir, filename);

    const content = `---
to: ${request.agentId}
from: system/recovery
type: guidance
msg-id: ${msgId}
headline: State guidance for ${request.agentId}
timestamp: ${new Date().toISOString()}
---

${body}
`;

    fs.writeFileSync(filepath, content);
    log.info('recovery', 'Wrote guidance message (fallback)', {
      to: request.agentId,
      level,
    });
  }

  /**
   * Write escalation message to core/core
   */
  private writeEscalation(request: RecoveryRequest): void {
    const state = this.getAgentState(request.agentId);

    const fsmState = state?.fsm?.currentState || 'unknown';
    const workerStatus = state?.worker?.status || 'unknown';
    const pendingAsksCount = state?.pendingAsks?.length || 0;

    const bodyPreview = request.body.length > 500
      ? request.body.slice(0, 500) + '...'
      : request.body;

    const body = `## Stuck Agent Report

Agent \`${request.agentId}\` has requested help ${this.ESCALATION_THRESHOLD} times in ${this.ESCALATION_WINDOW_MS / 1000}s.

### Current State
- FSM: \`${fsmState}\`
- Worker: \`${workerStatus}\`
- Pending Asks: ${pendingAsksCount}

### Last Request
Target: \`${request.targetChannel}\`
Body:
\`\`\`
${bodyPreview}
\`\`\`

### Recommended Actions
1. Check mesh logs for errors
2. Manually send ask-response if agent is awaiting
3. Kill and restart the mesh if state is corrupted

Please advise how to proceed.`;

    if (this.writer) {
      this.writer.write({
        to: 'core/core',
        from: 'system/recovery',
        type: 'message',
        headline: `Agent ${request.agentId} appears stuck`,
        body,
      });
    } else {
      const timestamp = Date.now();
      const msgId = `escalation-${timestamp}`;
      const filename = `${timestamp}-message-system-recovery--core-core-${msgId}.md`;
      const filepath = path.join(this.watchDir, filename);
      const content = `---\nto: core/core\nfrom: system/recovery\nmsg-id: ${msgId}\nheadline: Agent ${request.agentId} appears stuck\ntimestamp: ${new Date().toISOString()}\n---\n\n${body}\n`;
      fs.writeFileSync(filepath, content);
    }

    // Reset counter after escalation to give human time to intervene
    this.requestCounts.delete(request.agentId);

    log.warn('recovery', 'Escalated stuck agent to human', {
      agentId: request.agentId,
      target: request.targetChannel,
    });
  }

  /**
   * Clear request tracking for an agent (e.g., when mesh completes)
   */
  clearTracking(agentId: string): void {
    this.requestCounts.delete(agentId);
  }

  /**
   * Clear all tracking (e.g., on system reset)
   */
  clearAllTracking(): void {
    this.requestCounts.clear();
  }
}
