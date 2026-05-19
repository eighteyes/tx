import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AgentLoopRunner } from '../agent-loop-runner.ts';
import { FakeProvider } from '../../llm/fake-provider.ts';
import { FakeToolHost } from '../../llm/fake-tool-host.ts';

describe('AgentLoopRunner — happy path', () => {
  it('emits start → init → output → complete and returns success', async () => {
    const provider = new FakeProvider().enqueueText('Hi there!', { inputTokens: 5, outputTokens: 3 });
    const runner = new AgentLoopRunner({
      id: 'agent-w1', agentId: 'mesh/agent', provider,
      model: 'm', workDir: '/tmp', task: 'say hi',
    });

    const events: string[] = [];
    let outputData = '';
    runner.on('start', () => events.push('start'));
    runner.on('init', () => events.push('init'));
    runner.on('output', (e: { data: string }) => { outputData += e.data; events.push('output'); });
    runner.on('complete', () => events.push('complete'));

    const result = await runner.run();
    assert.equal(result.success, true);
    assert.deepEqual(events.slice(0, 3), ['start', 'init', 'output']);
    assert.ok(events.includes('complete'));
    assert.equal(outputData, 'Hi there!');
    assert.equal(result.sessionId, runner.getSessionId());
  });

  it('passes through provider tool calls and emits tool-marker output', async () => {
    const provider = new FakeProvider()
      .enqueueToolUse('t1', 'Read', { file: '/x' })
      .enqueueText('done');
    const toolHost = new FakeToolHost().add(
      { name: 'Read', input_schema: { type: 'object' } },
      () => 'contents',
    );
    const runner = new AgentLoopRunner({
      id: 'w1', agentId: 'mesh/a', provider, toolHost,
      model: 'm', workDir: '/tmp', task: 'read',
    });

    let output = '';
    runner.on('output', (e: { data: string }) => { output += e.data; });
    const result = await runner.run();
    assert.equal(result.success, true);
    assert.match(output, /\[tool: Read\]/);
    assert.match(output, /done/);
    assert.equal(toolHost.calls.length, 1);
  });
});

describe('AgentLoopRunner — error / interrupt', () => {
  it('emits error and returns failure when provider streams an error', async () => {
    const provider = new FakeProvider().enqueueError('rate limited');
    const runner = new AgentLoopRunner({
      id: 'w1', agentId: 'mesh/a', provider, model: 'm', workDir: '/tmp', task: 'x',
    });
    let interrupted = false;
    runner.on('interrupted', () => { interrupted = true; });

    const result = await runner.run();
    // AgentLoop maps provider error to stopReason='error' → treated as interrupt path
    assert.equal(result.success, false);
    assert.equal(interrupted, true);
  });

  it('kill() aborts a long-running loop and emits interrupted', async () => {
    // Slow provider that honors AbortSignal between yields.
    const provider = {
      name: 'slow',
      async *complete(req: { signal?: AbortSignal }) {
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 20));
          if (req.signal?.aborted) {
            yield { type: 'error' as const, error: 'aborted' };
            return;
          }
          yield { type: 'text-delta' as const, delta: `chunk ${i} ` };
        }
        yield { type: 'message-stop' as const, stopReason: 'end_turn' as const, usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const runner = new AgentLoopRunner({
      id: 'w1', agentId: 'mesh/a', provider, model: 'm', workDir: '/tmp', task: 'go',
    });

    let interrupted = false;
    runner.on('interrupted', () => { interrupted = true; });

    const p = runner.run();
    await new Promise(r => setTimeout(r, 30));
    runner.kill('user-cancel');
    const result = await p;
    assert.equal(result.success, false);
    assert.equal(runner.getKillReason(), 'user-cancel');
    assert.equal(interrupted, true);
  });
});

describe('AgentLoopRunner — Runner contract', () => {
  it('isRunning false at construction and after completion', async () => {
    const provider = new FakeProvider().enqueueText('hi');
    const runner = new AgentLoopRunner({
      id: 'w1', agentId: 'mesh/a', provider, model: 'm', workDir: '/tmp', task: 'x',
    });
    assert.equal(runner.isRunning(), false);
    await runner.run();
    assert.equal(runner.isRunning(), false);
  });

  it('getSessionId returns the synthetic id across run/resume', async () => {
    const provider = new FakeProvider().enqueueText('a').enqueueText('b');
    const runner = new AgentLoopRunner({
      id: 'w1', agentId: 'mesh/a', provider, model: 'm', workDir: '/tmp', task: 'x',
    });
    const sid = runner.getSessionId()!;
    await runner.run();
    assert.equal(runner.getSessionId(), sid);
    await runner.resume(sid, 'more');
    assert.equal(runner.getSessionId(), sid);
  });

  it('resume() carries history forward', async () => {
    const provider = new FakeProvider().enqueueText('first').enqueueText('second');
    const runner = new AgentLoopRunner({
      id: 'w1', agentId: 'mesh/a', provider, model: 'm', workDir: '/tmp', task: 'hello',
    });
    await runner.run();
    const sid = runner.getSessionId()!;
    await runner.resume(sid, 'follow-up');
    // Second provider request should include the prior assistant message + new user message
    const req2 = provider.requests[1];
    assert.ok(req2.messages.length >= 3);  // user + assistant + user
    assert.equal(req2.messages[0].role, 'user');
    assert.equal(req2.messages[req2.messages.length - 1].role, 'user');
  });

  it('resume() refuses on sessionId mismatch', async () => {
    const provider = new FakeProvider().enqueueText('hi');
    const runner = new AgentLoopRunner({
      id: 'w1', agentId: 'mesh/a', provider, model: 'm', workDir: '/tmp', task: 'x',
    });
    const result = await runner.resume('different-session', 'feedback');
    assert.equal(result.success, false);
    assert.match(result.error!, /sessionId mismatch/);
  });

  it('wasGuardrailKill classifies kill reasons', async () => {
    const provider = new FakeProvider();
    const runner = new AgentLoopRunner({
      id: 'w1', agentId: 'mesh/a', provider, model: 'm', workDir: '/tmp', task: 'x',
    });
    runner.kill('guardrail:bash');
    assert.equal(runner.wasGuardrailKill(), true);
    runner.kill('revision: hot inject');
    assert.equal(runner.wasGuardrailKill(), false);
  });

  it('resolvePermission returns false (V1; hooks land in phase 2d)', () => {
    const provider = new FakeProvider();
    const runner = new AgentLoopRunner({
      id: 'w1', agentId: 'mesh/a', provider, model: 'm', workDir: '/tmp', task: 'x',
    });
    assert.equal(runner.resolvePermission('t', true), false);
  });
});
