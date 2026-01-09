/**
 * Worker - V4 Ephemeral Worker Process
 *
 * Workers are ephemeral - they run, complete their task, and exit.
 * Uses the Claude Agent SDK for conversation management with resume support.
 */

// Export SDK runner and dispatcher
export { SdkRunner, type SdkRunnerConfig } from './sdk-runner.ts';
export { WorkerDispatcher, type DispatcherConfig } from './dispatcher.ts';

// Export mesh validator
export {
  MeshValidator,
  type MeshConfigSchema,
  type MeshAgentConfig,
  type ValidationResult,
  type RearmatterConfig,
  type MeshRouting,
  type AgentRouting,
  type RoutingRule,
  type WorkspaceConfigSchema
} from './mesh-validator.ts';

// Export stuck agent detector
export {
  StuckAgentDetector,
  type StuckAgentConfig,
  type StuckAgent,
  type ActiveWorkerInfo,
  DEFAULT_STUCK_CONFIG
} from './stuck-detector.ts';
