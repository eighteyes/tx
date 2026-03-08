/**
 * Reliability Module - March of Nines
 *
 * Implements four-nines (99.99%) reliability patterns for TX mesh execution:
 *
 * Nine 1 (90%):  Basic error handling, logging ✓ (existing)
 * Nine 2 (99%):  Dead letter queue, message retry, idempotency
 * Nine 3 (99.9%): Circuit breakers, heartbeat detection, structured traces
 * Nine 4 (99.99%): SLI tracking, failure taxonomy, safe-mode, canary checks
 *
 * Reference: Karpathy's "March of Nines" - each nine requires new approaches,
 * not just more of what got you the previous nine.
 */

export { DeadLetterQueue, type DLQEntry, type DLQStats } from './dead-letter-queue.ts';
export { CircuitBreaker, type CircuitBreakerConfig, type CircuitBreakerState } from './circuit-breaker.ts';
export { HeartbeatMonitor, type HeartbeatConfig, type AgentHealth } from './heartbeat-monitor.ts';
export { SLITracker, type SLIConfig, type SLISnapshot, type FailureCategory } from './sli-tracker.ts';
export { SafeMode, type SafeModeConfig, type SafeModeState } from './safe-mode.ts';
