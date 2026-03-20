// Guardrail Kill Handler
// Unified cleanup for all guardrail-enforced worker terminations

import { EventEmitter } from 'events';
import type { SessionManager } from './session-manager.ts';
import { log } from '../shared/logger.ts';

export interface GuardrailKillConfig {
  sessionManager: SessionManager;
  edgeCounters: Map<string, number>;
}

export interface CleanupSummary {
  sessionCleared: boolean;
  buffersCleared: number;
  edgeCounterReset: boolean;
  reason: string;
}

export class GuardrailKillHandler extends EventEmitter {
  private config: GuardrailKillConfig;

  constructor(config: GuardrailKillConfig) {
    super();
    this.config = config;
  }

  handle(sessionId: string, meshName: string, agentId: string, reason: string): CleanupSummary {
    let sessionCleared = false;
    let buffersCleared = 0;
    let edgeCounterReset = false;

    try {
      // 1. Clear suspended session from both in-memory and database
      const suspended = this.config.sessionManager.get(agentId);
      if (suspended) {
        this.config.sessionManager.markResumed(agentId);
        sessionCleared = true;
        log.debug('guardrail-kill-handler', 'Session cleared', { agentId, sessionId, reason });
      }

      // 2. Clear buffered responses
      const sm = this.config.sessionManager as any;
      const askBuffers = sm.askResponseBuffer as Map<string, unknown[]>;
      if (askBuffers && askBuffers.has(agentId)) {
        buffersCleared = askBuffers.get(agentId)?.length || 0;
        askBuffers.delete(agentId);
        log.debug('guardrail-kill-handler', 'Buffers cleared', { agentId, count: buffersCleared });
      }

      // 3. Reset edge counters for all outgoing edges from this agent
      const keysToDelete: string[] = [];
      for (const [key] of this.config.edgeCounters) {
        if (key.startsWith(agentId + '->')) {
          keysToDelete.push(key);
        }
      }
      edgeCounterReset = keysToDelete.length > 0;
      for (const key of keysToDelete) {
        this.config.edgeCounters.delete(key);
      }

      const summary: CleanupSummary = {
        sessionCleared,
        buffersCleared,
        edgeCounterReset,
        reason,
      };

      log.info('guardrail-kill-handler', 'Cleanup complete', { agentId, meshName, reason });
      return summary;
    } catch (err) {
      log.error('guardrail-kill-handler', 'Cleanup error', { agentId, error: String(err) });
      return { sessionCleared: false, buffersCleared: 0, edgeCounterReset: false, reason };
    }
  }
}
