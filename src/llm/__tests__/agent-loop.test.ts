import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AgentLoop, type AgentLoopResult } from '../agent-loop.ts';
import { FakeProvider } from '../fake-provider.ts';
import { FakeToolHost } from '../fake-tool-host.ts';

const READ_SPEC = {
  name: 'Read',
  description: 'reads a file',
  input_schema: { type: 'object', properties: { file: { type: 'string' } } },
};

describe('AgentLoop — single-turn flows', () => {
  it('completes after one provider call when stop_reason=end_turn', async () => {
    const provider = new FakeProvider().enqueueText('Hello!', { inputTokens: 10, outputTokens: 2 });
    const loop = new AgentLoop({ provider, model: 'test' });

    const result = await loop.run('Hi');
    assert.equal(result.turns, 1);
    assert.equal(result.stopReason, 'end_turn');
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0].role, 'user');
    assert.equal(result.messages[1].role, 'assistant');
    assert.deepEqual(result.totalUsage, { inputTokens: 10, outputTokens: 2 });
  });

  it('seeds the conversation when given a prebuilt message array', async () => {
    const provider = new FakeProvider().enqueueText('ok');
    const loop = new AgentLoop({ provider, model: 'test' });

    const result = await loop.run([
      { role: 'user', content: [{ type: 'text', text: 'A' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'B' }] },
      { role: 'user', content: [{ type: 'text', text: 'C' }] },
    ]);
    assert.equal(result.messages.length, 4);
  });

  it('passes system, model, tools through to the provider request', async () => {
    const provider = new FakeProvider().enqueueText('ok');
    const toolHost = new FakeToolHost().add(READ_SPEC, () => 'data');
    const loop = new AgentLoop({ provider, toolHost, model: 'm-1', system: 'sys', maxTokens: 100, temperature: 0.4 });

    await loop.run('Hi');
    const req = provider.requests[0];
    assert.equal(req.model, 'm-1');
    assert.equal(req.system, 'sys');
    assert.equal(req.maxTokens, 100);
    assert.equal(req.temperature, 0.4);
    assert.equal(req.tools?.[0].name, 'Read');
  });
});

describe('AgentLoop — tool-use cycle', () => {
  it('runs a tool, appends result, calls provider again', async () => {
    const provider = new FakeProvider()
      .enqueueToolUse('tu1', 'Read', { file: '/etc/hostname' }, { inputTokens: 5, outputTokens: 6 })
      .enqueueText('Done.', { inputTokens: 12, outputTokens: 2 });
    const toolHost = new FakeToolHost().add(READ_SPEC, () => 'host.example');
    const loop = new AgentLoop({ provider, toolHost, model: 'm' });

    const result = await loop.run('what is the host?');
    assert.equal(result.turns, 2);
    assert.equal(result.stopReason, 'end_turn');
    // user → assistant(toolUse) → user(toolResult) → assistant(text)
    assert.equal(result.messages.length, 4);
    assert.equal(result.messages[2].role, 'user');
    assert.equal(result.messages[2].content[0].type, 'tool_result');
    assert.equal((result.messages[2].content[0] as { tool_use_id: string }).tool_use_id, 'tu1');
    assert.equal(toolHost.calls.length, 1);
    assert.deepEqual(toolHost.calls[0], { name: 'Read', input: { file: '/etc/hostname' } });
    assert.deepEqual(result.totalUsage, { inputTokens: 17, outputTokens: 8 });
  });

  it('handles parallel tool_use blocks in one turn', async () => {
    const provider = new FakeProvider()
      // Single turn with two tool_use blocks
      .enqueue({
        events: [
          { type: 'tool-use-start', id: 'a', name: 'Read' },
          { type: 'tool-use-end', id: 'a', input: { file: 'A' } },
          { type: 'tool-use-start', id: 'b', name: 'Read' },
          { type: 'tool-use-end', id: 'b', input: { file: 'B' } },
          { type: 'message-stop', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } },
        ],
      })
      .enqueueText('Done');

    const toolHost = new FakeToolHost().add(READ_SPEC, (input) => `read:${input.file}`);
    const loop = new AgentLoop({ provider, toolHost, model: 'm' });

    const result = await loop.run('read both');
    assert.equal(toolHost.calls.length, 2);
    const toolResults = result.messages[2].content;
    assert.equal(toolResults.length, 2);
    assert.deepEqual(toolResults.map(r => (r as { content: string }).content), ['read:A', 'read:B']);
  });

  it('returns tool error to model when tool execution throws', async () => {
    const provider = new FakeProvider()
      .enqueueToolUse('t1', 'Read', { file: 'x' })
      .enqueueText('Sorry, that failed.');
    const toolHost = new FakeToolHost().add(READ_SPEC, () => { throw new Error('permission denied'); });
    const loop = new AgentLoop({ provider, toolHost, model: 'm' });

    const result = await loop.run('try');
    const toolResult = result.messages[2].content[0] as { is_error?: boolean; content: string };
    assert.equal(toolResult.is_error, true);
    assert.match(toolResult.content, /permission denied/);
    assert.equal(result.turns, 2);
  });

  it('reports tool error when tool host is missing', async () => {
    const provider = new FakeProvider()
      .enqueueToolUse('t1', 'Read', {})
      .enqueueText('done');
    const loop = new AgentLoop({ provider, model: 'm' });  // no toolHost

    const result = await loop.run('try');
    const toolResult = result.messages[2].content[0] as { is_error?: boolean };
    assert.equal(toolResult.is_error, true);
  });

  it('reports tool error when the named tool is unknown', async () => {
    const provider = new FakeProvider()
      .enqueueToolUse('t1', 'Nonexistent', {})
      .enqueueText('done');
    const loop = new AgentLoop({ provider, toolHost: new FakeToolHost(), model: 'm' });

    const result = await loop.run('try');
    const toolResult = result.messages[2].content[0] as { is_error?: boolean };
    assert.equal(toolResult.is_error, true);
  });
});

describe('AgentLoop — termination conditions', () => {
  it('stops at maxTurns when the model keeps requesting tools', async () => {
    const provider = new FakeProvider();
    // Script enough turns to exceed maxTurns
    for (let i = 0; i < 10; i++) provider.enqueueToolUse(`t${i}`, 'Read', { file: String(i) });

    const toolHost = new FakeToolHost().add(READ_SPEC, () => 'data');
    const loop = new AgentLoop({ provider, toolHost, model: 'm', maxTurns: 3 });

    const result = await loop.run('go');
    assert.equal(result.maxTurnsHit, true);
    assert.equal(result.turns, 3);
  });

  it('honors max_tokens stop reason as terminal', async () => {
    const provider = new FakeProvider().enqueue({
      events: [
        { type: 'text-delta', delta: 'partial...' },
        { type: 'message-stop', stopReason: 'max_tokens', usage: { inputTokens: 1, outputTokens: 5 } },
      ],
    });
    const loop = new AgentLoop({ provider, model: 'm', maxTurns: 5 });

    const result = await loop.run('verbose please');
    assert.equal(result.stopReason, 'max_tokens');
    assert.equal(result.turns, 1);
  });

  it('aborts via signal between turns', async () => {
    const controller = new AbortController();
    const provider = new FakeProvider();
    // First turn: tool_use; we abort after the tool
    provider.enqueueToolUse('t1', 'Read', {});
    provider.enqueueText('would not see this');

    const toolHost = new FakeToolHost().add(READ_SPEC, () => {
      controller.abort();
      return 'done';
    });
    const loop = new AgentLoop({ provider, toolHost, model: 'm', signal: controller.signal });

    const result = await loop.run('go');
    assert.equal(result.aborted, true);
    assert.equal(result.stopReason, 'error');
  });

  it('treats provider error as terminal', async () => {
    const provider = new FakeProvider().enqueueError('rate limited');
    const loop = new AgentLoop({ provider, model: 'm' });

    const result = await loop.run('go');
    assert.equal(result.stopReason, 'error');
    assert.equal(result.turns, 1);
  });
});

describe('AgentLoop — hooks', () => {
  it('preToolUse can short-circuit with a synthetic result', async () => {
    const provider = new FakeProvider()
      .enqueueToolUse('t1', 'Read', { file: '/etc/shadow' })
      .enqueueText('blocked');
    const toolHost = new FakeToolHost().add(READ_SPEC, () => 'should not run');

    const loop = new AgentLoop({
      provider,
      toolHost,
      model: 'm',
      hooks: {
        preToolUse: (call) => call.name === 'Read'
          ? { allow: false, result: { content: 'denied by policy', isError: true } }
          : { allow: true },
      },
    });

    const result = await loop.run('read shadow');
    assert.equal(toolHost.calls.length, 0, 'tool should not have executed');
    const toolResult = result.messages[2].content[0] as { is_error?: boolean; content: string };
    assert.equal(toolResult.is_error, true);
    assert.equal(toolResult.content, 'denied by policy');
  });

  it('postToolUse can rewrite the tool result', async () => {
    const provider = new FakeProvider()
      .enqueueToolUse('t1', 'Read', {})
      .enqueueText('done');
    const toolHost = new FakeToolHost().add(READ_SPEC, () => 'raw output');

    const loop = new AgentLoop({
      provider,
      toolHost,
      model: 'm',
      hooks: {
        postToolUse: (call, result) => ({ content: `[wrapped] ${result.content}` }),
      },
    });

    const result = await loop.run('read');
    const toolResult = result.messages[2].content[0] as { content: string };
    assert.equal(toolResult.content, '[wrapped] raw output');
  });

  it('preToolUse hook error surfaces as tool error', async () => {
    const provider = new FakeProvider()
      .enqueueToolUse('t1', 'Read', {})
      .enqueueText('done');
    const toolHost = new FakeToolHost().add(READ_SPEC, () => 'x');

    const loop = new AgentLoop({
      provider,
      toolHost,
      model: 'm',
      hooks: {
        preToolUse: () => { throw new Error('hook crashed'); },
      },
    });

    const result = await loop.run('go');
    const toolResult = result.messages[2].content[0] as { is_error?: boolean; content: string };
    assert.equal(toolResult.is_error, true);
    assert.match(toolResult.content, /PreToolUse hook error: hook crashed/);
  });
});

describe('AgentLoop — events', () => {
  it('emits expected sequence over a tool-use → end_turn run', async () => {
    const provider = new FakeProvider()
      .enqueueToolUse('t1', 'Read', { file: 'x' })
      .enqueueText('done');
    const toolHost = new FakeToolHost().add(READ_SPEC, () => 'data');
    const loop = new AgentLoop({ provider, toolHost, model: 'm' });

    const events: string[] = [];
    loop.on('turn-start', () => events.push('turn-start'));
    loop.on('turn-end', () => events.push('turn-end'));
    loop.on('tool-execution-start', () => events.push('tool-execution-start'));
    loop.on('tool-execution-end', () => events.push('tool-execution-end'));
    loop.on('loop-end', () => events.push('loop-end'));

    await loop.run('go');
    assert.deepEqual(events, [
      'turn-start', 'turn-end',
      'tool-execution-start', 'tool-execution-end',
      'turn-start', 'turn-end',
      'loop-end',
    ]);
  });

  it('forwards provider events via provider-event', async () => {
    const provider = new FakeProvider().enqueueText('hi');
    const loop = new AgentLoop({ provider, model: 'm' });

    const types: string[] = [];
    loop.on('provider-event', (e: { type: string }) => types.push(e.type));

    await loop.run('go');
    assert.deepEqual(types, ['text-delta', 'message-stop']);
  });
});
