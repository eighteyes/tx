import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CliAdapterRegistry,
  DEFAULT_INTERRUPT_KEY,
  type HookSpec,
} from '../adapter.ts';
import { FakeCliAdapter } from '../fake-adapter.ts';

describe('CliAdapterRegistry', () => {
  it('registers and retrieves adapters by name', () => {
    const r = new CliAdapterRegistry();
    const claude = new FakeCliAdapter({ name: 'claude' });
    const codex = new FakeCliAdapter({ name: 'codex' });
    r.register(claude).register(codex);
    assert.equal(r.get('claude'), claude);
    assert.equal(r.get('codex'), codex);
    assert.deepEqual(r.names().sort(), ['claude', 'codex']);
  });

  it('returns undefined for unknown adapters', () => {
    const r = new CliAdapterRegistry();
    assert.equal(r.get('nonexistent'), undefined);
  });

  it('replaces an adapter when re-registered under the same name', () => {
    const r = new CliAdapterRegistry();
    const first = new FakeCliAdapter({ name: 'claude' });
    const second = new FakeCliAdapter({ name: 'claude' });
    r.register(first).register(second);
    assert.equal(r.get('claude'), second);
    assert.equal(r.names().length, 1);
  });
});

describe('FakeCliAdapter — defaults', () => {
  it('exposes a usable default discovery + capability set', async () => {
    const a = new FakeCliAdapter();
    const d = await a.discover();
    assert.ok(d);
    assert.equal(typeof d!.binary, 'string');
    assert.equal(a.capabilities.sessionResume, true);
    assert.equal(a.capabilities.hookSupport, 'shell-scripts');
    assert.equal(a.capabilities.trustTier, 'full-hooks');
  });

  it('returns null discovery when explicitly disabled', async () => {
    const a = new FakeCliAdapter({ discovery: null });
    assert.equal(await a.discover(), null);
  });

  it('records buildArgs / buildResumeArgs / envOverrides calls', () => {
    const a = new FakeCliAdapter();
    a.buildArgs({ task: 't', workDir: '/x', txDataDir: '/x/.ai' });
    a.buildResumeArgs({ task: '', sessionId: 's1', workDir: '/x', txDataDir: '/x/.ai' });
    a.envOverrides({ task: 't', workDir: '/x', txDataDir: '/x/.ai' });
    assert.equal(a.buildArgsCalls.length, 1);
    assert.equal(a.buildResumeCalls.length, 1);
    assert.equal(a.envOverrideCalls.length, 1);
  });

  it('refuses resume when capability is disabled', () => {
    const a = new FakeCliAdapter({ capabilities: { sessionResume: false } });
    assert.throws(
      () => a.buildResumeArgs({ task: '', sessionId: 's1', workDir: '/x', txDataDir: '/x/.ai' }),
      /resume not supported/,
    );
  });
});

describe('FakeCliAdapter — transcript / idle / session', () => {
  it('readTranscript returns scripted messages with cursor', async () => {
    const a = new FakeCliAdapter({
      transcript: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      done: true,
    });
    const out = await a.readTranscript('/x/.fake/s1.jsonl');
    assert.equal(out.messages.length, 1);
    assert.equal(out.done, true);
  });

  it('extractSessionId pulls the filename stem by default', async () => {
    const a = new FakeCliAdapter();
    assert.equal(await a.extractSessionId('/x/.fake/abc123.jsonl'), 'abc123');
    assert.equal(await a.extractSessionId('no-session-id-here'), null);
  });

  it('isIdle uses the default prompt heuristic when no override given', () => {
    const a = new FakeCliAdapter();
    assert.equal(a.isIdle('output\n$ '), true);
    assert.equal(a.isIdle('still working...'), false);
  });

  it('isIdle honors a custom predicate', () => {
    const a = new FakeCliAdapter({ isIdle: (p) => p.includes('DONE') });
    assert.equal(a.isIdle('thinking...\nDONE'), true);
    assert.equal(a.isIdle('thinking...'), false);
  });
});

describe('FakeCliAdapter — hooks', () => {
  it('installHooks records to a sink when provided', async () => {
    const sink: HookSpec[] = [];
    const a = new FakeCliAdapter({ hookSink: sink });
    await a.installHooks('/x', [
      { event: 'PreToolUse', toolMatch: 'Bash', script: '/x/.tx/bash-guard' },
      { event: 'PostToolUse', toolMatch: 'Edit', script: '/x/.tx/write-gate' },
    ]);
    assert.equal(sink.length, 2);
    assert.equal(sink[0].event, 'PreToolUse');
    assert.equal(sink[1].toolMatch, 'Edit');
  });

  it('installHooks throws when the adapter declares hookSupport=none', async () => {
    const a = new FakeCliAdapter({
      capabilities: { hookSupport: 'none' },
    });
    await assert.rejects(
      a.installHooks('/x', [{ event: 'PreToolUse', script: '/x/h' }]),
      /refuse to install/,
    );
  });
});

describe('FakeCliAdapter — permissions', () => {
  it('detectPermissionPrompt returns null when no detector configured', () => {
    const a = new FakeCliAdapter();
    assert.equal(a.detectPermissionPrompt('anything'), null);
  });

  it('detectPermissionPrompt forwards to configured predicate', () => {
    const a = new FakeCliAdapter({
      permissionDetector: (p) => p.includes('Allow Bash')
        ? { kind: 'tool-use', details: p }
        : null,
    });
    assert.equal(a.detectPermissionPrompt('idle'), null);
    const hit = a.detectPermissionPrompt('Allow Bash command?');
    assert.ok(hit);
    assert.equal(hit!.kind, 'tool-use');
  });
});

describe('DEFAULT_INTERRUPT_KEY', () => {
  it('is the standard tmux C-c', () => {
    assert.equal(DEFAULT_INTERRUPT_KEY, 'C-c');
  });
});
