import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  collectStream,
  ProviderStreamError,
  type ProviderEvent,
  type ProviderMessage,
} from '../provider.ts';
import { FakeProvider } from '../fake-provider.ts';

async function* streamOf(events: ProviderEvent[]): AsyncIterable<ProviderEvent> {
  for (const e of events) yield e;
}

describe('collectStream', () => {
  it('produces an assistant text message on a pure text stream', async () => {
    const result = await collectStream(streamOf([
      { type: 'text-delta', delta: 'Hello, ' },
      { type: 'text-delta', delta: 'world!' },
      { type: 'message-stop', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 4 } },
    ]));

    assert.equal(result.message.role, 'assistant');
    assert.deepEqual(result.message.content, [{ type: 'text', text: 'Hello, world!' }]);
    assert.equal(result.stopReason, 'end_turn');
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4 });
  });

  it('produces tool_use blocks with parsed input', async () => {
    const result = await collectStream(streamOf([
      { type: 'tool-use-start', id: 't1', name: 'Read' },
      { type: 'tool-use-delta', id: 't1', partialJson: '{"file":"x"}' },
      { type: 'tool-use-end', id: 't1', input: { file: 'x' } },
      { type: 'message-stop', stopReason: 'tool_use', usage: { inputTokens: 5, outputTokens: 12 } },
    ]));

    assert.deepEqual(result.message.content, [
      { type: 'tool_use', id: 't1', name: 'Read', input: { file: 'x' } },
    ]);
    assert.equal(result.stopReason, 'tool_use');
  });

  it('flushes pending text before a tool_use', async () => {
    const result = await collectStream(streamOf([
      { type: 'text-delta', delta: 'Thinking...' },
      { type: 'tool-use-start', id: 't1', name: 'Read' },
      { type: 'tool-use-end', id: 't1', input: { file: 'x' } },
      { type: 'message-stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
    ]));

    assert.equal(result.message.content.length, 2);
    assert.deepEqual(result.message.content[0], { type: 'text', text: 'Thinking...' });
    assert.equal(result.message.content[1].type, 'tool_use');
  });

  it('handles multiple parallel tool_use blocks', async () => {
    const result = await collectStream(streamOf([
      { type: 'tool-use-start', id: 't1', name: 'Read' },
      { type: 'tool-use-start', id: 't2', name: 'Glob' },
      { type: 'tool-use-end', id: 't1', input: { file: 'a' } },
      { type: 'tool-use-end', id: 't2', input: { pattern: '*' } },
      { type: 'message-stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
    ]));

    const toolBlocks = result.message.content.filter(c => c.type === 'tool_use');
    assert.equal(toolBlocks.length, 2);
    const byId = Object.fromEntries(toolBlocks.map(t => [(t as { id: string }).id, t]));
    assert.equal((byId['t1'] as { name: string }).name, 'Read');
    assert.equal((byId['t2'] as { name: string }).name, 'Glob');
  });

  it('throws ProviderStreamError on error events', async () => {
    await assert.rejects(
      collectStream(streamOf([
        { type: 'text-delta', delta: 'partial' },
        { type: 'error', error: 'rate limited' },
      ])),
      (err: Error) => err instanceof ProviderStreamError && err.message === 'rate limited',
    );
  });

  it('propagates stop sequence', async () => {
    const result = await collectStream(streamOf([
      { type: 'text-delta', delta: 'STOPHERE' },
      { type: 'message-stop', stopReason: 'stop_sequence', stopSequence: 'STOPHERE',
        usage: { inputTokens: 1, outputTokens: 1 } },
    ]));
    assert.equal(result.stopReason, 'stop_sequence');
    assert.equal(result.stopSequence, 'STOPHERE');
  });
});

describe('FakeProvider', () => {
  it('captures requests for assertions', async () => {
    const p = new FakeProvider().enqueueText('ok');
    const req = { model: 'x', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }] };
    for await (const _ of p.complete(req)) { /* drain */ }
    assert.equal(p.requests.length, 1);
    assert.equal(p.requests[0].model, 'x');
  });

  it('returns scripted responses in order', async () => {
    const p = new FakeProvider().enqueueText('first').enqueueText('second');
    const r1 = await collectStream(p.complete({ model: 'x', messages: [] }));
    const r2 = await collectStream(p.complete({ model: 'x', messages: [] }));
    assert.deepEqual(r1.message.content, [{ type: 'text', text: 'first' }]);
    assert.deepEqual(r2.message.content, [{ type: 'text', text: 'second' }]);
    assert.equal(p.pending, 0);
  });

  it('returns error event when script is empty', async () => {
    const p = new FakeProvider();
    await assert.rejects(
      collectStream(p.complete({ model: 'x', messages: [] })),
      /no scripted response/,
    );
  });

  it('enqueueToolUse produces a complete tool_use block', async () => {
    const p = new FakeProvider().enqueueToolUse('t1', 'Read', { file: '/x' });
    const r = await collectStream(p.complete({ model: 'x', messages: [] }));
    assert.equal(r.stopReason, 'tool_use');
    assert.deepEqual(r.message.content, [
      { type: 'tool_use', id: 't1', name: 'Read', input: { file: '/x' } },
    ]);
  });

  it('enqueueError yields an error event', async () => {
    const p = new FakeProvider().enqueueError('boom');
    await assert.rejects(
      collectStream(p.complete({ model: 'x', messages: [] })),
      /boom/,
    );
  });
});

describe('LlmProvider contract — message round-tripping', () => {
  it('user → assistant text → user with tool_result is a valid history shape', () => {
    // This is mostly a TypeScript shape test: if it compiles, the type contract holds.
    const history: ProviderMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Read /etc/hostname' }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'Reading.' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file: '/etc/hostname' } },
      ]},
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'host.example' },
      ]},
    ];
    assert.equal(history.length, 3);
    assert.equal(history[2].content[0].type, 'tool_result');
  });
});
