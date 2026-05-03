/**
 * CostGate - Enforce max_cost (USD) limit per worker invocation
 *
 * Responsibilities:
 * - Track cumulative cost across SDK query results
 * - Kill the runner when cumulative cost exceeds the configured limit (strict mode)
 * - Inject a one-shot warning to core when threshold breached (warning mode)
 *
 * Unlike PreToolUse-hook gates, cost is only known after a query completes,
 * so this gate is driven by the runner's `query:result` event rather than
 * an SDK hook. Wire `recordQueryCost(costUsd)` to that event in the dispatcher.
 */

import { log } from '../shared/logger.ts';
import type { GuardrailMode } from './guardrail-config.ts';

export interface CostGateConfig {
  agentId: string;
  maxCostUsd: number;
  mode: GuardrailMode;
  killRunner: (reason: string) => void;
}

export class CostGate {
  private config: CostGateConfig;
  private cumulativeCostUsd = 0;
  private warned = false;
  private killed = false;

  constructor(config: CostGateConfig) {
    this.config = config;
  }

  /**
   * Record per-query cost (USD). Called once per SDK `result` message.
   * Side effect: kills the runner in strict mode when cumulative cost exceeds limit.
   */
  recordQueryCost(queryCostUsd: number): void {
    if (this.killed) return;
    if (!Number.isFinite(queryCostUsd) || queryCostUsd < 0) return;

    this.cumulativeCostUsd += queryCostUsd;
    const { strict, warning } = this.config.mode;
    const limit = this.config.maxCostUsd;

    if (this.cumulativeCostUsd <= limit) return;

    const logData = {
      agentId: this.config.agentId,
      cumulativeCostUsd: this.cumulativeCostUsd,
      maxCostUsd: limit,
      mode: { strict, warning },
    };

    if (!strict) {
      if (warning && !this.warned) {
        this.warned = true;
        log.warn('cost-gate', 'max_cost exceeded (warning mode, allowed)', logData);
        log.activity('guardrail:cost-gate:warning', this.config.agentId,
          `Cost gate warning: $${this.cumulativeCostUsd.toFixed(4)}/$${limit.toFixed(4)} (allowed)`);
      }
      return;
    }

    // Strict: kill the runner
    this.killed = true;
    log.warn('cost-gate', 'max_cost exceeded — killing worker', logData);
    log.activity('guardrail:cost-gate', this.config.agentId,
      `Cost gate STRICT KILL: $${this.cumulativeCostUsd.toFixed(4)}/$${limit.toFixed(4)}`);

    this.config.killRunner(
      `max_cost limit reached ($${this.cumulativeCostUsd.toFixed(4)}/$${limit.toFixed(4)})`
    );
  }

  getCumulativeCostUsd(): number {
    return this.cumulativeCostUsd;
  }

  reset(): void {
    this.cumulativeCostUsd = 0;
    this.warned = false;
    this.killed = false;
  }
}
