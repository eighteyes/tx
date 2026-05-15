import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AnthropicProvider, type AnthropicLike } from '../anthropic-provider.ts';
import { collectStream, type ProviderRequest } from '../provider.ts';

/** Build a fake Anthropic client whose stream() yields the scripted events. */
function fakeClient(events: unknown[]): AnthropicLike {
  return {
    messages: {
      stream: async function* () {
        for (const e of events) yield e as never;
      } as AnthropicLike['messages']['stream'],
    },
  };
}

function baseRequest(over: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: 'claude-test',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    ...over,
  };
}

describe('AnthropicProvider — stream translation', () => {
  it('emits text-delta and message-stop for a text-only response', async () => {
    const provider = new AnthropicProvider({
      client: fakeClient([
        { type: 'message_start', message: { usage: { input_tokens: 12 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ', world' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
        { type: 'message_stop' },
      ]),
    });

    const result = await collectStream(provider.complete(baseRequest()));
    assert.equal(result.stopReason, 'end_turn');
    assert.deepEqual(result.message.content, [{ type: 'text', text: 'Hello, world' }]);
    assert.equal(result.usage.inputTokens, 12);
    assert.equal(result.usage.outputTokens, 3);
  });

  it('emits tool-use events with parsed JSON input', async () => {
    const provider = new AnthropicProvider({
      client: fakeClient([
        { type: 'message_start', message: { usage: { input_tokens: 5 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'Read' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file":' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"/etc/hostname"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } },
        { type: 'message_stop' },
      ]),
    });

    const result = await collectStream(provider.complete(baseRequest()));
    assert.equal(result.stopReason, 'tool_use');
    assert.deepEqual(result.message.content, [
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file: '/etc/hostname' } },
    ]);
  });

  it('handles interleaved text + tool_use blocks', async () => {
    const provider = new AnthropicProvider({
      client: fakeClient([
        { type: 'message_start', message: { usage: { input_tokens: 5 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading...' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'Read' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
        { type: 'message_stop' },
      ]),
    });

    const result = await collectStream(provider.complete(baseRequest()));
    assert.equal(result.message.content.length, 2);
    assert.equal(result.message.content[0].type, 'text');
    assert.equal((result.message.content[0] as { text: string }).text, 'Reading...');
    assert.equal(result.message.content[1].type, 'tool_use');
  });

  it('routes input_json_delta to the right tool by block index', async () => {
    const provider = new AnthropicProvider({
      client: fakeClient([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'Read' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu2', name: 'Glob' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":1}' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"b":2}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
        { type: 'message_stop' },
      ]),
    });

    const result = await collectStream(provider.complete(baseRequest()));
    const tools = result.message.content.filter(c => c.type === 'tool_use') as Array<{ id: string; input: Record<string, unknown> }>;
    const byId = Object.fromEntries(tools.map(t => [t.id, t.input]));
    assert.deepEqual(byId, { tu1: { a: 1 }, tu2: { b: 2 } });
  });

  it('produces empty input on malformed JSON without throwing', async () => {
    const provider = new AnthropicProvider({
      client: fakeClient([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'Read' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{this is not json' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]),
    });

    const result = await collectStream(provider.complete(baseRequest()));
    const tool = result.message.content.find(c => c.type === 'tool_use') as { input: Record<string, unknown> };
    assert.deepEqual(tool.input, {});
  });

  it('maps stop_reason variants', async () => {
    for (const [anthropicReason, expected] of [
      ['end_turn', 'end_turn'],
      ['tool_use', 'tool_use'],
      ['max_tokens', 'max_tokens'],
      ['stop_sequence', 'stop_sequence'],
    ] as const) {
      const provider = new AnthropicProvider({
        client: fakeClient([
          { type: 'message_start', message: { usage: { input_tokens: 1 } } },
          { type: 'message_delta', delta: { stop_reason: anthropicReason }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ]),
      });
      const result = await collectStream(provider.complete(baseRequest()));
      assert.equal(result.stopReason, expected, `${anthropicReason} should map to ${expected}`);
    }
  });

  it('propagates cache token counts when present', async () => {
    const provider = new AnthropicProvider({
      client: fakeClient([
        { type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 20 } } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } },
        { type: 'message_stop' },
      ]),
    });
    const result = await collectStream(provider.complete(baseRequest()));
    assert.equal(result.usage.cacheReadTokens, 50);
    assert.equal(result.usage.cacheWriteTokens, 20);
  });

  it('emits error event when stream throws mid-flight', async () => {
    const provider = new AnthropicProvider({
      client: {
        messages: {
          stream: async function* () {
            yield { type: 'message_start', message: { usage: { input_tokens: 1 } } } as never;
            throw new Error('connection reset');
          } as AnthropicLike['messages']['stream'],
        },
      },
    });

    await assert.rejects(
      collectStream(provider.complete(baseRequest())),
      /connection reset/,
    );
  });

  it('synthesizes message-stop when stream ends without one', async () => {
    const provider = new AnthropicProvider({
      client: fakeClient([
        { type: 'message_start', message: { usage: { input_tokens: 5 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
        { type: 'content_block_stop', index: 0 },
        // no message_delta or message_stop — premature stream close
      ]),
    });

    const result = await collectStream(provider.complete(baseRequest()));
    assert.equal(result.stopReason, 'end_turn');  // default
    assert.deepEqual(result.message.content, [{ type: 'text', text: 'hi' }]);
  });

  it('passes system, temperature, max_tokens, stop_sequences, and tools through', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const provider = new AnthropicProvider({
      client: {
        messages: {
          stream: async function* (params) {
            captured.push(params as unknown as Record<string, unknown>);
            yield { type: 'message_start', message: { usage: { input_tokens: 1 } } } as never;
            yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } } as never;
            yield { type: 'message_stop' } as never;
          } as AnthropicLike['messages']['stream'],
        },
      },
    });

    await collectStream(provider.complete({
      model: 'm1',
      system: 'be terse',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      tools: [{ name: 'Read', description: 'reads', input_schema: { type: 'object' } }],
      maxTokens: 256,
      temperature: 0.3,
      stopSequences: ['DONE'],
    }));

    assert.equal(captured.length, 1);
    const p = captured[0];
    assert.equal(p.model, 'm1');
    assert.equal(p.system, 'be terse');
    assert.equal(p.max_tokens, 256);
    assert.equal(p.temperature, 0.3);
    assert.deepEqual(p.stop_sequences, ['DONE']);
    assert.equal(Array.isArray(p.tools), true);
    assert.equal((p.tools as Array<{ name: string }>)[0].name, 'Read');
  });

  it('translates content blocks in messages bidirectionally', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const provider = new AnthropicProvider({
      client: {
        messages: {
          stream: async function* (params) {
            captured.push(params as unknown as Record<string, unknown>);
            yield { type: 'message_start', message: { usage: { input_tokens: 1 } } } as never;
            yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } } as never;
            yield { type: 'message_stop' } as never;
          } as AnthropicLike['messages']['stream'],
        },
      },
    });

    await collectStream(provider.complete({
      model: 'm1',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file: '/x' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'hello' }] },
      ],
    }));

    const msgs = captured[0].messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    assert.equal(msgs.length, 3);
    assert.equal(msgs[1].content[0].type, 'tool_use');
    assert.equal(msgs[2].content[0].type, 'tool_result');
    assert.equal(msgs[2].content[0].tool_use_id, 't1');
  });
});
