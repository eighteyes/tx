/**
 * ToolHost — the agent runtime's view of tool execution.
 *
 * AgentLoop calls `list()` to populate the request's `tools` field, then
 * calls `execute()` for each tool_use the model emits. Implementations live
 * in phase 3 (built-in Read/Write/Edit/Glob/Grep/Bash + MCP bridge).
 *
 * Distinct from LlmProvider on purpose: provider is pure transport, tool
 * host is environment-side execution.
 */

import type { ProviderContent, ProviderToolSpec } from './provider.ts';

export interface ToolExecutionResult {
  /** String for simple tools, structured blocks for tools that return mixed media. */
  content: string | ProviderContent[];
  /** When true, the assistant sees this as a tool error and may retry. */
  isError?: boolean;
}

export interface ToolHost {
  /** Tool specs to advertise to the model. */
  list(): ProviderToolSpec[];
  /** Run a tool. Errors should be caught and returned as `{ content, isError: true }`. */
  execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolExecutionResult>;
}
