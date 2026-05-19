import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TmuxCliRunner, type TmuxIO, type TmuxCliRunnerConfig } from '../tmux-cli-runner.ts';
import { FakeCliAdapter } from '../../cli-adapter/fake-adapter.ts';
import type { ProviderMessage } from '../../llm/provider.ts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-tmux-cli-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Scriptable TmuxIO for tests. */
class FakeTmuxIO implements TmuxIO {
  sessions = new Set<string>();
  /** Sequenced pane content returned on each capturePane. */
  paneScript: string[] = [];
  /** Index into paneScript; sticks at end. */
  paneIdx = 0;
  /** Recorded send-keys calls. */
  sentKeys: Array<{ session: string; keys: string }> = [];
  /** Recorded sendText calls. */
  sentText: Array<{ session: string; text: string }> = [];
  spawnArgv: string[] | null = null;
  spawnEnv: Record<string, string> | null = null;
  spawnPid: number | null = 9999;
  spawnPgid: number | null = 9000;
  createSucceeds = true;
  spawnSucceeds = true;

  createSession(name: string, _workDir: string): boolean {
    if (!this.createSucceeds) return false;
    this.sessions.add(name);
    return true;
  }
  sessionExists(name: string): boolean { return this.sessions.has(name); }
  killSession(name: string): boolean { return this.sessions.delete(name); }
  sendKeys(name: string, keys: string): boolean {
    this.sentKeys.push({ session: name, keys });
    return true;
  }
  sendText(name: string, text: string): boolean {
    this.sentText.push({ session: name, text });
    return true;
  }
  capturePane(_name: string, _lines?: number): string {
    if (this.paneScript.length === 0) return '';
    const i = Math.min(this.paneIdx, this.paneScript.length - 1);
    this.paneIdx++;
    return this.paneScript[i];
  }
  async spawnInSession(_name: string, argv: string[], env: Record<string, string>): Promise<{ pid: number | null; pgid: number | null }> {
    if (!this.spawnSucceeds) return { pid: null, pgid: null };
    this.spawnArgv = argv;
    this.spawnEnv = env;
    return { pid: this.spawnPid, pgid: this.spawnPgid };
  }
}

function makeConfig(adapter: FakeCliAdapter, io: FakeTmuxIO, over: Partial<TmuxCliRunnerConfig> = {}): TmuxCliRunnerConfig {
  return {
    id: 'agent-w1',
    agentId: 'mesh/agent',
    workerId: 'w1',
    sessionName: 'tx-w-test',
    adapter,
    model: 'sonnet',
    workDir: tmpDir,
    msgsDir: tmpDir,
    txDataDir: tmpDir,
    task: 'do the thing',
    io,
    pollIntervalMs: 5,
    stableIdleTicks: 2,
    maxWallMs: 5000,
    ...over,
  };
}

describe('TmuxCliRunner — happy path', () => {
  it('discovers, spawns, polls until idle, emits complete', async () => {
    const transcript: ProviderMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'do the thing' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done!' }] },
    ];
    const adapter = new FakeCliAdapter({ transcript, done: true, isIdle: (p) => p.includes('$ ') });
    const io = new FakeTmuxIO();
    // Pane goes idle quickly
    io.paneScript = ['booting', '$ ', '$ ', '$ ', '$ '];

    const runner = new TmuxCliRunner(makeConfig(adapter, io));
    const events: string[] = [];
    runner.on('start', () => events.push('start'));
    runner.on('init', () => events.push('init'));
    runner.on('output', () => events.push('output'));
    runner.on('complete', () => events.push('complete'));

    const result = await runner.run();
    assert.equal(result.success, true);
    assert.ok(events.includes('start'));
    assert.ok(events.includes('init'));
    assert.ok(events.includes('complete'));
    assert.equal(io.sessions.size, 0, 'session torn down after complete');
  });

  it('passes adapter argv and env into spawn', async () => {
    const adapter = new FakeCliAdapter({ done: true });
    const io = new FakeTmuxIO();
    io.paneScript = ['$ ', '$ ', '$ ', '$ '];

    const runner = new TmuxCliRunner(makeConfig(adapter, io));
    await runner.run();

    assert.ok(io.spawnArgv);
    assert.equal(io.spawnArgv![0], '/usr/local/bin/fake');
    assert.ok(io.spawnArgv!.includes('--cwd'));
    assert.ok(io.spawnEnv);
    assert.equal(io.spawnEnv!.FAKE_TX_RUN, '1');
  });

  it('injects the initial task via sendText', async () => {
    const adapter = new FakeCliAdapter({ done: true });
    const io = new FakeTmuxIO();
    io.paneScript = ['$ ', '$ ', '$ ', '$ '];

    const runner = new TmuxCliRunner(makeConfig(adapter, io, { task: 'inject this' }));
    await runner.run();

    assert.equal(io.sentText.length, 1);
    assert.equal(io.sentText[0].text, 'inject this');
  });
});

describe('TmuxCliRunner — failure modes', () => {
  it('fails when adapter discovery returns null', async () => {
    const adapter = new FakeCliAdapter({ discovery: null });
    const io = new FakeTmuxIO();
    const runner = new TmuxCliRunner(makeConfig(adapter, io));
    let errored = '';
    runner.on('error', (e: { error: string }) => { errored = e.error; });

    const result = await runner.run();
    assert.equal(result.success, false);
    assert.match(errored, /could not discover binary/);
  });

  it('fails when createSession fails', async () => {
    const adapter = new FakeCliAdapter({ done: true });
    const io = new FakeTmuxIO();
    io.createSucceeds = false;
    const runner = new TmuxCliRunner(makeConfig(adapter, io));
    runner.on('error', () => { /* noop — required by EventEmitter */ });
    const result = await runner.run();
    assert.equal(result.success, false);
    assert.match(result.error!, /failed to create tmux session/);
  });

  it('fails when maxWallMs is exceeded', async () => {
    const adapter = new FakeCliAdapter({ done: false, isIdle: () => false });
    const io = new FakeTmuxIO();
    io.paneScript = ['busy busy busy'];
    const runner = new TmuxCliRunner(makeConfig(adapter, io, { maxWallMs: 50, pollIntervalMs: 10 }));
    runner.on('error', () => { /* noop */ });
    const result = await runner.run();
    assert.equal(result.success, false);
    assert.match(result.error!, /exceeded maxWallMs/);
  });
});

describe('TmuxCliRunner — kill / interrupt', () => {
  it('kill() interrupts the running loop and emits interrupted', async () => {
    const adapter = new FakeCliAdapter({ done: false, isIdle: () => false });
    const io = new FakeTmuxIO();
    io.paneScript = Array(200).fill('still working...');
    const runner = new TmuxCliRunner(makeConfig(adapter, io, { pollIntervalMs: 10, maxWallMs: 60_000 }));

    let interrupted = false;
    runner.on('interrupted', () => { interrupted = true; });

    const p = runner.run();
    // Give the loop a tick to start, then kill
    await new Promise(r => setTimeout(r, 30));
    runner.kill('user-cancel');
    const result = await p;
    assert.equal(result.success, false);
    assert.match(result.error!, /interrupted/);
    assert.equal(interrupted, true);
    assert.equal(runner.getKillReason(), 'user-cancel');
  });

  it('kill() sends interrupt key and tears down session', async () => {
    const adapter = new FakeCliAdapter({ done: false, isIdle: () => false });
    const io = new FakeTmuxIO();
    io.paneScript = Array(200).fill('busy');
    const runner = new TmuxCliRunner(makeConfig(adapter, io, { pollIntervalMs: 10, maxWallMs: 60_000 }));

    const p = runner.run();
    await new Promise(r => setTimeout(r, 30));
    runner.kill('test');
    await p;

    assert.ok(io.sentKeys.some(k => k.keys === 'C-c'), 'C-c was sent');
    assert.equal(io.sessions.size, 0, 'session was killed');
  });

  it('interrupt() is equivalent to kill("interrupt")', async () => {
    const adapter = new FakeCliAdapter({ done: false, isIdle: () => false });
    const io = new FakeTmuxIO();
    io.paneScript = Array(200).fill('busy');
    const runner = new TmuxCliRunner(makeConfig(adapter, io, { pollIntervalMs: 10, maxWallMs: 60_000 }));

    const p = runner.run();
    await new Promise(r => setTimeout(r, 30));
    await runner.interrupt();
    await p;

    assert.equal(runner.getKillReason(), 'interrupt');
  });
});

describe('TmuxCliRunner — Runner contract', () => {
  it('isRunning reflects run state', async () => {
    const adapter = new FakeCliAdapter({ done: true });
    const io = new FakeTmuxIO();
    io.paneScript = ['$ ', '$ ', '$ ', '$ '];
    const runner = new TmuxCliRunner(makeConfig(adapter, io));

    assert.equal(runner.isRunning(), false);
    const p = runner.run();
    // Briefly true during run
    await new Promise(r => setTimeout(r, 5));
    // After completion
    await p;
    assert.equal(runner.isRunning(), false);
  });

  it('resume() returns an error result (V1 stub)', async () => {
    const adapter = new FakeCliAdapter();
    const io = new FakeTmuxIO();
    const runner = new TmuxCliRunner(makeConfig(adapter, io));
    const result = await runner.resume('s1', 'hi');
    assert.equal(result.success, false);
    assert.match(result.error!, /resume not supported at runner level/);
  });

  it('resolvePermission returns false (boundary-only tier)', () => {
    const adapter = new FakeCliAdapter();
    const io = new FakeTmuxIO();
    const runner = new TmuxCliRunner(makeConfig(adapter, io));
    assert.equal(runner.resolvePermission('t', true), false);
  });

  it('wasGuardrailKill classifies non-operational kill reasons', async () => {
    const adapter = new FakeCliAdapter({ done: false, isIdle: () => false });
    const io = new FakeTmuxIO();
    io.paneScript = Array(50).fill('busy');
    const runner = new TmuxCliRunner(makeConfig(adapter, io, { pollIntervalMs: 10, maxWallMs: 60_000 }));

    const p = runner.run();
    await new Promise(r => setTimeout(r, 30));
    runner.kill('guardrail:max_messages');
    await p;
    assert.equal(runner.wasGuardrailKill(), true);
  });

  it('wasGuardrailKill is false for operational kill reasons', async () => {
    const adapter = new FakeCliAdapter({ done: false, isIdle: () => false });
    const io = new FakeTmuxIO();
    io.paneScript = Array(50).fill('busy');
    const runner = new TmuxCliRunner(makeConfig(adapter, io, { pollIntervalMs: 10, maxWallMs: 60_000 }));

    const p = runner.run();
    await new Promise(r => setTimeout(r, 30));
    runner.kill('revision: hot inject');
    await p;
    assert.equal(runner.wasGuardrailKill(), false);
  });
});
