/**
 * LlmProvider — pure transport for chat completions with tools.
 *
 * Stateless. The caller (AgentLoop) owns the message history and decides
 * when to loop. The provider only knows how to: take a request, stream
 * normalized events back, and report token usage.
 *
 * Normalized over Anthropic and OpenAI Chat Completions semantics. Use
 * Anthropic-style stop reasons because TX is Anthropic-native; OpenAI
 * provider maps its `finish_reason` into this set.
 *
 * Pricing/cost is NOT a provider concern — it lives in a separate module
 * keyed by (provider name, model, token usage).
 */

/* ------------------------------------------------------------------ Messages */

export type ProviderRole = 'user' | 'assistant';

export type ProviderContent =
  /** Plain text block. */
  | { type: 'text'; text: string }
  /** Assistant emitted a tool call. The `input` is the parsed JSON args. */
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  /** User-side result of a prior tool call. `content` may be plain string or structured blocks. */
  | { type: 'tool_result'; tool_use_id: string; content: string | ProviderContent[]; is_error?: boolean };

export interface ProviderMessage {
  role: ProviderRole;
  content: ProviderContent[];
}

/* ----------------------------------------------------------------- Tool spec */

/** JSON-schema-shaped function declaration. Both providers consume this format. */
export interface ProviderToolSpec {
  name: string;
  description?: string;
  /** JSON schema describing the tool's input. */
  input_schema: Record<string, unknown>;
}

/* ------------------------------------------------------------------- Request */

export interface ProviderRequest {
  model: string;
  /** System prompt (Anthropic top-level / OpenAI role=system). */
  system?: string;
  messages: ProviderMessage[];
  tools?: ProviderToolSpec[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  /** Abort mid-stream. Both Anthropic SDK and fetch honor this. */
  signal?: AbortSignal;
  /**
   * Provider-specific extras (e.g. `{ "extended_thinking": true }` for
   * Anthropic, `{ "response_format": ... }` for OpenAI). Opaque; the
   * provider drops anything it doesn't recognize.
   */
  extra?: Record<string, unknown>;
}

/* --------------------------------------------------------------------- Usage */

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/* ------------------------------------------------------------- Stop reasons */

/**
 * Normalized stop reasons (Anthropic-style):
 *   end_turn      — model decided to stop (OpenAI: finish_reason='stop')
 *   tool_use      — model requests tool execution (OpenAI: 'tool_calls')
 *   max_tokens    — hit token cap (OpenAI: 'length')
 *   stop_sequence — hit a configured stop string
 *   error         — provider returned an error mid-stream
 */
export type ProviderStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'error';

/* -------------------------------------------------------------------- Events */

export type ProviderEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-use-start'; id: string; name: string }
  /** Streaming partial JSON for tool args. Most providers send these as text. */
  | { type: 'tool-use-delta'; id: string; partialJson: string }
  /** Tool call finalized; `input` is the parsed JSON. */
  | { type: 'tool-use-end'; id: string; input: Record<string, unknown> }
  | { type: 'message-stop'; stopReason: ProviderStopReason; usage: ProviderUsage; stopSequence?: string }
  | { type: 'error'; error: string };

/* ------------------------------------------------------------------ Provider */

export interface LlmProvider {
  /** Identifier — 'anthropic' | 'openai' | 'openai-compat:<host>' etc. Used for logging + pricing lookups. */
  readonly name: string;

  /**
   * Stream a chat completion. Events arrive in the order the provider produces them.
   * Always ends with a `message-stop` OR `error` event (never both, never neither).
   */
  complete(req: ProviderRequest): AsyncIterable<ProviderEvent>;
}

/* ----------------------------------------------------------- Helpers (pure) */

/**
 * Convenience: drain a provider stream into a fully-realized assistant message
 * plus stop reason and usage. AgentLoop will use this in single-shot mode;
 * streaming consumers iterate directly.
 */
export async function collectStream(
  stream: AsyncIterable<ProviderEvent>
): Promise<{
  message: ProviderMessage;
  stopReason: ProviderStopReason;
  usage: ProviderUsage;
  stopSequence?: string;
}> {
  const blocks: ProviderContent[] = [];
  let currentText = '';
  const toolUses = new Map<string, { name: string; rawJson: string; input?: Record<string, unknown> }>();
  let stopReason: ProviderStopReason = 'end_turn';
  let usage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
  let stopSequence: string | undefined;
  let errored: string | null = null;

  for await (const ev of stream) {
    switch (ev.type) {
      case 'text-delta':
        currentText += ev.delta;
        break;
      case 'tool-use-start':
        // Flush any pending text block
        if (currentText) {
          blocks.push({ type: 'text', text: currentText });
          currentText = '';
        }
        toolUses.set(ev.id, { name: ev.name, rawJson: '' });
        break;
      case 'tool-use-delta': {
        const t = toolUses.get(ev.id);
        if (t) t.rawJson += ev.partialJson;
        break;
      }
      case 'tool-use-end': {
        const t = toolUses.get(ev.id);
        if (t) {
          t.input = ev.input;
          blocks.push({ type: 'tool_use', id: ev.id, name: t.name, input: ev.input });
        }
        break;
      }
      case 'message-stop':
        if (currentText) {
          blocks.push({ type: 'text', text: currentText });
          currentText = '';
        }
        stopReason = ev.stopReason;
        usage = ev.usage;
        stopSequence = ev.stopSequence;
        break;
      case 'error':
        errored = ev.error;
        stopReason = 'error';
        break;
    }
  }

  if (errored !== null) {
    throw new ProviderStreamError(errored);
  }

  return {
    message: { role: 'assistant', content: blocks },
    stopReason,
    usage,
    stopSequence,
  };
}

export class ProviderStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderStreamError';
  }
}
