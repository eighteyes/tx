/**
 * AgentLoop — runtime that drives LlmProvider in a tool-use cycle.
 *
 * Responsibilities:
 * - Hold the message history across turns.
 * - Call provider.complete(); accumulate the assistant message; emit
 *   forwarded provider events for observers (Runner implementations).
 * - On `tool_use` stop: execute each tool via ToolHost, append tool_result
 *   blocks, loop again.
 * - On any terminal stop (`end_turn` / `max_tokens` / `stop_sequence`)
 *   or maxTurns hit / abort signal: return result.
 *
 * Hook middleware (PreToolUse / PostToolUse / etc.) attaches in phase 2d —
 * the seams are already in place via the `tool-execution-start` and
 * `tool-execution-end` events plus the optional `interceptToolCall` hook.
 *
 * Stateless across runs — construct once per worker invocation.
 */

import { EventEmitter } from 'node:events';
import {
  ProviderStreamError,
  type LlmProvider,
  type ProviderContent,
  type ProviderEvent,
  type ProviderMessage,
  type ProviderRequest,
  type ProviderStopReason,
  type ProviderUsage,
} from './provider.ts';
import type { ToolExecutionResult, ToolHost } from './tool-host.ts';

export interface AgentLoopOptions {
  provider: LlmProvider;
  toolHost?: ToolHost;
  model: string;
  system?: string;
  maxTurns?: number;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
  /**
   * Optional pre/post hooks around each tool call. Returning `{ allow: false,
   * result }` from pre short-circuits execution with the supplied result.
   * Phase 2d will wire bash-guard / write-gate / read-gate / etc. through this.
   */
  hooks?: AgentLoopHooks;
}

export interface AgentLoopHooks {
  preToolUse?: (call: ToolCall, signal?: AbortSignal) => Promise<PreToolDecision> | PreToolDecision;
  postToolUse?: (call: ToolCall, result: ToolExecutionResult, signal?: AbortSignal) => Promise<ToolExecutionResult> | ToolExecutionResult;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type PreToolDecision =
  | { allow: true }
  | { allow: false; result: ToolExecutionResult };

export interface AgentLoopResult {
  messages: ProviderMessage[];
  stopReason: ProviderStopReason;
  totalUsage: ProviderUsage;
  turns: number;
  /** True if loop ended because maxTurns was hit. */
  maxTurnsHit: boolean;
  /** True if loop ended because the abort signal fired. */
  aborted: boolean;
}

/**
 * Events emitted (in addition to forwarded provider events):
 *   'turn-start'           { turn }
 *   'provider-event'       ProviderEvent
 *   'turn-end'             { turn, stopReason, usage }
 *   'tool-execution-start' { id, name, input }
 *   'tool-execution-end'   { id, name, result }
 *   'loop-end'             { stopReason, totalUsage, turns, maxTurnsHit, aborted }
 */
export class AgentLoop extends EventEmitter {
  constructor(private readonly opts: AgentLoopOptions) {
    super();
    this.setMaxListeners(50);
  }

  async run(initial: string | ProviderMessage[]): Promise<AgentLoopResult> {
    const messages: ProviderMessage[] = typeof initial === 'string'
      ? [{ role: 'user', content: [{ type: 'text', text: initial }] }]
      : [...initial];

    const totalUsage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
    let turns = 0;
    let stopReason: ProviderStopReason = 'end_turn';
    let maxTurnsHit = false;
    let aborted = false;

    while (true) {
      if (this.opts.signal?.aborted) {
        aborted = true;
        stopReason = 'error';
        break;
      }
      if (this.opts.maxTurns !== undefined && turns >= this.opts.maxTurns) {
        maxTurnsHit = true;
        break;
      }
      turns++;
      this.emit('turn-start', { turn: turns });

      const req: ProviderRequest = {
        model: this.opts.model,
        messages,
        ...(this.opts.system !== undefined ? { system: this.opts.system } : {}),
        ...(this.opts.toolHost ? { tools: this.opts.toolHost.list() } : {}),
        ...(this.opts.maxTokens !== undefined ? { maxTokens: this.opts.maxTokens } : {}),
        ...(this.opts.temperature !== undefined ? { temperature: this.opts.temperature } : {}),
        ...(this.opts.stopSequences ? { stopSequences: this.opts.stopSequences } : {}),
        ...(this.opts.signal ? { signal: this.opts.signal } : {}),
      };

      let collected: { blocks: ProviderContent[]; stopReason: ProviderStopReason; usage: ProviderUsage };
      try {
        collected = await this.consumeStream(this.opts.provider.complete(req));
      } catch (err) {
        if (err instanceof ProviderStreamError) {
          stopReason = 'error';
          break;
        }
        throw err;
      }

      messages.push({ role: 'assistant', content: collected.blocks });
      stopReason = collected.stopReason;
      this.accumulateUsage(totalUsage, collected.usage);
      this.emit('turn-end', { turn: turns, stopReason: collected.stopReason, usage: collected.usage });

      if (collected.stopReason !== 'tool_use') {
        break;
      }

      // Execute tool calls and append results
      const toolResults: ProviderContent[] = [];
      const toolCalls = collected.blocks.filter((c): c is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => c.type === 'tool_use');

      for (const call of toolCalls) {
        if (this.opts.signal?.aborted) {
          aborted = true;
          break;
        }
        const result = await this.executeToolCall(call);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        });
      }

      messages.push({ role: 'user', content: toolResults });

      if (aborted) {
        stopReason = 'error';
        break;
      }
    }

    this.emit('loop-end', { stopReason, totalUsage, turns, maxTurnsHit, aborted });
    return { messages, stopReason, totalUsage, turns, maxTurnsHit, aborted };
  }

  /**
   * Stream provider events, forwarding each via 'provider-event', and
   * accumulate into a structured assistant message + final stop/usage.
   */
  private async consumeStream(
    stream: AsyncIterable<ProviderEvent>,
  ): Promise<{ blocks: ProviderContent[]; stopReason: ProviderStopReason; usage: ProviderUsage }> {
    const blocks: ProviderContent[] = [];
    let currentText = '';
    const toolUses = new Map<string, { name: string }>();
    let stopReason: ProviderStopReason = 'end_turn';
    let usage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };

    for await (const ev of stream) {
      this.emit('provider-event', ev);

      switch (ev.type) {
        case 'text-delta':
          currentText += ev.delta;
          break;
        case 'tool-use-start':
          if (currentText) {
            blocks.push({ type: 'text', text: currentText });
            currentText = '';
          }
          toolUses.set(ev.id, { name: ev.name });
          break;
        case 'tool-use-delta':
          // Provider has already accumulated; nothing to do here.
          break;
        case 'tool-use-end': {
          const tu = toolUses.get(ev.id);
          if (tu) blocks.push({ type: 'tool_use', id: ev.id, name: tu.name, input: ev.input });
          break;
        }
        case 'message-stop':
          if (currentText) {
            blocks.push({ type: 'text', text: currentText });
            currentText = '';
          }
          stopReason = ev.stopReason;
          usage = ev.usage;
          break;
        case 'error':
          throw new ProviderStreamError(ev.error);
      }
    }

    return { blocks, stopReason, usage };
  }

  private async executeToolCall(call: ToolCall): Promise<ToolExecutionResult> {
    if (!this.opts.toolHost) {
      return { content: `No tool host configured; cannot execute ${call.name}`, isError: true };
    }

    // PreToolUse hook
    if (this.opts.hooks?.preToolUse) {
      try {
        const decision = await this.opts.hooks.preToolUse(call, this.opts.signal);
        if (!decision.allow) {
          this.emit('tool-execution-start', { id: call.id, name: call.name, input: call.input });
          this.emit('tool-execution-end', { id: call.id, name: call.name, result: decision.result });
          return decision.result;
        }
      } catch (err) {
        const errorResult: ToolExecutionResult = {
          content: `PreToolUse hook error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
        return errorResult;
      }
    }

    this.emit('tool-execution-start', { id: call.id, name: call.name, input: call.input });

    let result: ToolExecutionResult;
    try {
      result = await this.opts.toolHost.execute(call.name, call.input, this.opts.signal);
    } catch (err) {
      result = { content: err instanceof Error ? err.message : String(err), isError: true };
    }

    // PostToolUse hook (can rewrite result)
    if (this.opts.hooks?.postToolUse) {
      try {
        result = await this.opts.hooks.postToolUse(call, result, this.opts.signal);
      } catch (err) {
        result = {
          content: `PostToolUse hook error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    }

    this.emit('tool-execution-end', { id: call.id, name: call.name, result });
    return result;
  }

  private accumulateUsage(total: ProviderUsage, turn: ProviderUsage): void {
    total.inputTokens += turn.inputTokens;
    total.outputTokens += turn.outputTokens;
    if (turn.cacheReadTokens !== undefined) {
      total.cacheReadTokens = (total.cacheReadTokens ?? 0) + turn.cacheReadTokens;
    }
    if (turn.cacheWriteTokens !== undefined) {
      total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + turn.cacheWriteTokens;
    }
  }
}
