/**
 * SDK type façade.
 *
 * Type-only imports from `@anthropic-ai/claude-agent-sdk` go through this
 * file instead of importing the SDK package directly. When the AgentLoop
 * path lands (phase 2+), these can be replaced with local declarations so
 * non-SDK runners stop depending on the package transitively.
 *
 * Runtime imports of `query()` are NOT re-exported here — that's a different
 * abstraction (LlmProvider). Sites that call query() will move to that
 * interface during phase 2.
 *
 * Only types should appear below.
 */

export type {
  McpServerConfig,
  HookCallbackMatcher,
  HookJSONOutput,
  SDKMessage,
  SDKResultMessage,
  CanUseTool,
  PermissionResult,
  SandboxSettings,
} from '@anthropic-ai/claude-agent-sdk';
