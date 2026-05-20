/**
 * FakeProvider — scriptable in-memory LlmProvider for tests.
 *
 * Configure a sequence of canned responses (events + final stop). On each
 * `complete()` call the next scripted response is returned. Captures the
 * request so tests can assert what was sent.
 *
 * Intentionally minimal — no streaming semantics beyond yielding the scripted
 * event array. AgentLoop / collectStream tests use this; real-network testing
 * lives elsewhere.
 */

import type {
  LlmProvider,
  ProviderEvent,
  ProviderRequest,
  ProviderStopReason,
  ProviderUsage,
} from './provider.ts';

export interface ScriptedResponse {
  events: ProviderEvent[];
}

export class FakeProvider implements LlmProvider {
  readonly name: string;
  private readonly script: ScriptedResponse[] = [];
  readonly requests: ProviderRequest[] = [];

  constructor(name = 'fake') {
    this.name = name;
  }

  /** Push a canned response onto the queue. */
  enqueue(response: ScriptedResponse): this {
    this.script.push(response);
    return this;
  }

  /** Shorthand: respond with a single text turn and end_turn stop. */
  enqueueText(text: string, usage?: Partial<ProviderUsage>): this {
    return this.enqueue({
      events: [
        { type: 'text-delta', delta: text },
        { type: 'message-stop', stopReason: 'end_turn', usage: makeUsage(usage) },
      ],
    });
  }

  /** Shorthand: respond with a tool_use and tool_use stop. */
  enqueueToolUse(toolId: string, name: string, input: Record<string, unknown>, usage?: Partial<ProviderUsage>): this {
    return this.enqueue({
      events: [
        { type: 'tool-use-start', id: toolId, name },
        { type: 'tool-use-delta', id: toolId, partialJson: JSON.stringify(input) },
        { type: 'tool-use-end', id: toolId, input },
        { type: 'message-stop', stopReason: 'tool_use', usage: makeUsage(usage) },
      ],
    });
  }

  /** Shorthand: respond with an error mid-stream. */
  enqueueError(message: string): this {
    return this.enqueue({ events: [{ type: 'error', error: message }] });
  }

  /** Number of scripted responses still pending. */
  get pending(): number {
    return this.script.length;
  }

  async *complete(req: ProviderRequest): AsyncIterable<ProviderEvent> {
    // Snapshot messages (and tools) so callers can assert on the request
    // as-sent, not as-mutated-by-AgentLoop later.
    this.requests.push({
      ...req,
      messages: req.messages.map(m => ({ role: m.role, content: [...m.content] })),
      ...(req.tools ? { tools: req.tools.map(t => ({ ...t })) } : {}),
    });
    const next = this.script.shift();
    if (!next) {
      yield { type: 'error', error: 'FakeProvider: no scripted response' };
      return;
    }
    for (const ev of next.events) {
      // Honor an abort signal between event yields so tests can interrupt
      // long-running scripts via runner.kill() → abortController.abort().
      if (req.signal?.aborted) {
        yield { type: 'error', error: 'aborted' };
        return;
      }
      yield ev;
    }
  }
}

function makeUsage(over?: Partial<ProviderUsage>): ProviderUsage {
  return {
    inputTokens: over?.inputTokens ?? 0,
    outputTokens: over?.outputTokens ?? 0,
    cacheReadTokens: over?.cacheReadTokens,
    cacheWriteTokens: over?.cacheWriteTokens,
  };
}
