/**
 * AnthropicProvider — LlmProvider impl over @anthropic-ai/sdk (NOT the agent SDK).
 *
 * Uses `client.messages.stream()` and normalizes the raw event types
 * (message_start / content_block_start / content_block_delta / message_delta /
 * message_stop) into our ProviderEvent union.
 *
 * Client is injectable for unit testing — pass a fake `{ messages: { stream } }`
 * and avoid network calls.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LlmProvider,
  ProviderContent,
  ProviderEvent,
  ProviderMessage,
  ProviderRequest,
  ProviderStopReason,
  ProviderUsage,
} from './provider.ts';

/** Minimal shape we need from the Anthropic client (for DI / mocking). */
export interface AnthropicLike {
  messages: {
    stream(params: AnthropicStreamParams, opts?: { signal?: AbortSignal }): AsyncIterable<AnthropicRawEvent>;
  };
}

/**
 * Subset of Anthropic's MessageCreateParams that we use. Kept loose because
 * the SDK type names move around between minor versions and we don't want
 * to track those across upgrades.
 */
interface AnthropicStreamParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
  temperature?: number;
  stop_sequences?: string[];
  [extra: string]: unknown;
}

/** The raw event union we consume from Anthropic's stream. */
type AnthropicRawEvent =
  | { type: 'message_start'; message: { usage: { input_tokens: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } } }
  | { type: 'content_block_start'; index: number; content_block: { type: 'text'; text?: string } | { type: 'tool_use'; id: string; name: string; input?: unknown } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason?: string | null; stop_sequence?: string | null }; usage: { output_tokens: number } }
  | { type: 'message_stop' };

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseURL?: string;
  /** Override the underlying client (for tests). */
  client?: AnthropicLike;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: AnthropicLike;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.client = opts.client ?? (new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL }) as unknown as AnthropicLike);
  }

  async *complete(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    const params: AnthropicStreamParams = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: this.translateMessages(req.messages),
      ...(req.system !== undefined ? { system: req.system } : {}),
      ...(req.tools ? { tools: req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })) } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.stopSequences ? { stop_sequences: req.stopSequences } : {}),
      ...(req.extra ?? {}),
    };

    // Tracking state
    const blockIndexToToolId = new Map<number, string>();
    const toolPartialJson = new Map<string, string>();
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens: number | undefined;
    let cacheWriteTokens: number | undefined;
    let stopReason: ProviderStopReason = 'end_turn';
    let stopSequence: string | undefined;
    let emittedStop = false;

    let stream: AsyncIterable<AnthropicRawEvent>;
    try {
      stream = this.client.messages.stream(params, { signal: req.signal });
    } catch (err) {
      yield { type: 'error', error: errorMessage(err) };
      return;
    }

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            inputTokens = event.message.usage.input_tokens ?? 0;
            cacheReadTokens = event.message.usage.cache_read_input_tokens ?? undefined;
            cacheWriteTokens = event.message.usage.cache_creation_input_tokens ?? undefined;
            break;

          case 'content_block_start':
            if (event.content_block.type === 'tool_use') {
              blockIndexToToolId.set(event.index, event.content_block.id);
              toolPartialJson.set(event.content_block.id, '');
              yield {
                type: 'tool-use-start',
                id: event.content_block.id,
                name: event.content_block.name,
              };
            }
            // text blocks have no start emission — text-delta events carry everything
            break;

          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              yield { type: 'text-delta', delta: event.delta.text };
            } else if (event.delta.type === 'input_json_delta') {
              const toolId = blockIndexToToolId.get(event.index);
              if (toolId !== undefined) {
                const acc = (toolPartialJson.get(toolId) ?? '') + event.delta.partial_json;
                toolPartialJson.set(toolId, acc);
                yield { type: 'tool-use-delta', id: toolId, partialJson: event.delta.partial_json };
              }
            }
            break;

          case 'content_block_stop': {
            const toolId = blockIndexToToolId.get(event.index);
            if (toolId !== undefined) {
              const raw = toolPartialJson.get(toolId) ?? '';
              let parsed: Record<string, unknown> = {};
              if (raw.length > 0) {
                try {
                  parsed = JSON.parse(raw);
                } catch {
                  // Malformed input JSON — emit empty input; AgentLoop will produce a tool-error result
                }
              }
              yield { type: 'tool-use-end', id: toolId, input: parsed };
            }
            break;
          }

          case 'message_delta':
            if (event.delta.stop_reason) {
              stopReason = mapStopReason(event.delta.stop_reason);
            }
            if (event.delta.stop_sequence) {
              stopSequence = event.delta.stop_sequence;
            }
            outputTokens = event.usage.output_tokens ?? outputTokens;
            break;

          case 'message_stop':
            yield {
              type: 'message-stop',
              stopReason,
              usage: buildUsage(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
              ...(stopSequence !== undefined ? { stopSequence } : {}),
            };
            emittedStop = true;
            break;
        }
      }
    } catch (err) {
      yield { type: 'error', error: errorMessage(err) };
      return;
    }

    if (!emittedStop) {
      // Stream ended cleanly but no message_stop — synthesize one so downstream
      // collectors always see a terminal event.
      yield {
        type: 'message-stop',
        stopReason,
        usage: buildUsage(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
        ...(stopSequence !== undefined ? { stopSequence } : {}),
      };
    }
  }

  private translateMessages(messages: ProviderMessage[]): AnthropicStreamParams['messages'] {
    return messages.map(m => ({
      role: m.role,
      content: m.content.map(c => this.translateContent(c)),
    }));
  }

  private translateContent(c: ProviderContent): unknown {
    // Our types mirror Anthropic's, but be explicit so a type rename in the
    // SDK doesn't silently break the bridge.
    switch (c.type) {
      case 'text': return { type: 'text', text: c.text };
      case 'tool_use': return { type: 'tool_use', id: c.id, name: c.name, input: c.input };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: c.tool_use_id,
          content: c.content,
          ...(c.is_error !== undefined ? { is_error: c.is_error } : {}),
        };
    }
  }
}

function mapStopReason(s: string): ProviderStopReason {
  switch (s) {
    case 'end_turn': return 'end_turn';
    case 'tool_use': return 'tool_use';
    case 'max_tokens': return 'max_tokens';
    case 'stop_sequence': return 'stop_sequence';
    default: return 'end_turn';  // unknown future reason — treat as natural stop
  }
}

function buildUsage(
  input: number,
  output: number,
  cacheRead: number | undefined,
  cacheWrite: number | undefined,
): ProviderUsage {
  const u: ProviderUsage = { inputTokens: input, outputTokens: output };
  if (cacheRead !== undefined) u.cacheReadTokens = cacheRead;
  if (cacheWrite !== undefined) u.cacheWriteTokens = cacheWrite;
  return u;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
