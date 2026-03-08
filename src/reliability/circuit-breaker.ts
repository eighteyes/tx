/**
 * CircuitBreaker - Prevent cascading failures in mesh execution
 *
 * Nine 3 pattern: When an agent or model repeatedly fails, stop
 * sending it work and fail fast instead of wasting tokens.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures exceeded threshold, requests fail immediately
 * - HALF_OPEN: After cooldown, allow one probe request
 *
 * Applied per agent (mesh/agent) to isolate failures.
 */

import { log } from '../shared/logger.ts';

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 3) */
  failureThreshold: number;
  /** Time in ms before trying again after opening (default: 60000) */
  cooldownMs: number;
  /** Time window for counting failures in ms (default: 300000 = 5 min) */
  windowMs: number;
}

export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

interface CircuitState {
  state: CircuitBreakerState;
  failures: number;
  lastFailureAt: number;
  openedAt: number;
  successesSinceHalfOpen: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  windowMs: 300_000,
};

export class CircuitBreaker {
  private circuits: Map<string, CircuitState> = new Map();
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a request should be allowed through
   */
  canExecute(agentId: string): boolean {
    const circuit = this.circuits.get(agentId);
    if (!circuit) return true;

    switch (circuit.state) {
      case 'closed':
        return true;

      case 'open': {
        const elapsed = Date.now() - circuit.openedAt;
        if (elapsed >= this.config.cooldownMs) {
          // Transition to half-open
          circuit.state = 'half_open';
          circuit.successesSinceHalfOpen = 0;
          log.info('circuit-breaker', 'Circuit half-open (probe allowed)', {
            agentId,
            cooldownMs: this.config.cooldownMs,
          });
          return true;
        }
        return false;
      }

      case 'half_open':
        // Allow single probe request
        return true;
    }
  }

  /**
   * Record a successful execution
   */
  recordSuccess(agentId: string): void {
    const circuit = this.circuits.get(agentId);
    if (!circuit) return;

    if (circuit.state === 'half_open') {
      // Close the circuit on success in half-open state
      circuit.state = 'closed';
      circuit.failures = 0;
      log.info('circuit-breaker', 'Circuit closed (recovery successful)', { agentId });
    }
  }

  /**
   * Record a failed execution
   */
  recordFailure(agentId: string, reason: string): void {
    const now = Date.now();
    let circuit = this.circuits.get(agentId);

    if (!circuit) {
      circuit = {
        state: 'closed',
        failures: 0,
        lastFailureAt: 0,
        openedAt: 0,
        successesSinceHalfOpen: 0,
      };
      this.circuits.set(agentId, circuit);
    }

    // Reset failure count if outside window
    if (now - circuit.lastFailureAt > this.config.windowMs) {
      circuit.failures = 0;
    }

    circuit.failures++;
    circuit.lastFailureAt = now;

    log.warn('circuit-breaker', 'Failure recorded', {
      agentId,
      failures: circuit.failures,
      threshold: this.config.failureThreshold,
      reason,
    });

    if (circuit.state === 'half_open') {
      // Failed during probe - reopen
      circuit.state = 'open';
      circuit.openedAt = now;
      log.error('circuit-breaker', 'Circuit reopened (probe failed)', { agentId, reason });
      return;
    }

    if (circuit.failures >= this.config.failureThreshold) {
      circuit.state = 'open';
      circuit.openedAt = now;
      log.error('circuit-breaker', 'Circuit opened (threshold exceeded)', {
        agentId,
        failures: circuit.failures,
        threshold: this.config.failureThreshold,
        reason,
      });
    }
  }

  /**
   * Get the current state of a circuit
   */
  getState(agentId: string): CircuitBreakerState {
    return this.circuits.get(agentId)?.state || 'closed';
  }

  /**
   * Get all circuit states (for status display)
   */
  getAllStates(): Map<string, { state: CircuitBreakerState; failures: number }> {
    const result = new Map<string, { state: CircuitBreakerState; failures: number }>();
    for (const [id, circuit] of this.circuits) {
      result.set(id, { state: circuit.state, failures: circuit.failures });
    }
    return result;
  }

  /**
   * Reset a specific circuit (manual recovery)
   */
  reset(agentId: string): void {
    this.circuits.delete(agentId);
    log.info('circuit-breaker', 'Circuit manually reset', { agentId });
  }

  /**
   * Reset all circuits (e.g., on mesh restart)
   */
  resetAll(): void {
    this.circuits.clear();
  }

  /**
   * Reset circuits for a specific mesh
   */
  resetForMesh(meshName: string): void {
    for (const agentId of this.circuits.keys()) {
      if (agentId.startsWith(`${meshName}/`)) {
        this.circuits.delete(agentId);
      }
    }
  }
}
