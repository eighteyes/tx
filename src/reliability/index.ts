/**
 * Reliability Module - March of Nines
 *
 * Implements four-nines (99.99%) reliability patterns for TX mesh execution:
 *
 * Nine 1 (90%):  Basic error handling, logging ✓ (existing)
 * Nine 2 (99%):  Dead letter queue, session-aware recovery, idempotency
 * Nine 3 (99.9%): Circuit breakers, heartbeat detection, structured traces
 * Nine 4 (99.99%): SLI tracking, failure taxonomy, safe-mode, canary checks
 *
 * Key insight: Recovery via session resume (not raw message replay) preserves
 * full conversation history and tool state. Reference: Karpathy's "March of Nines"
 */

export { DeadLetterQueue, type DLQEntry, type DLQStats, type RecoveryMode, type RecoveryResult } from './dead-letter-queue.ts';
export { ReliabilityManager, type ReliabilityConfig, type ReliabilityStatus, type FailureContext, type SessionResumeHandler, type RequeueHandler } from './reliability-manager.ts';
export { CircuitBreaker, type CircuitBreakerConfig, type CircuitBreakerState } from './circuit-breaker.ts';
export { HeartbeatMonitor, type HeartbeatConfig, type AgentHealth } from './heartbeat-monitor.ts';
export { SLITracker, type SLIConfig, type SLISnapshot, type FailureCategory } from './sli-tracker.ts';
export { SafeMode, type SafeModeConfig, type SafeModeState } from './safe-mode.ts';
