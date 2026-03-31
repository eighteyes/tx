/**
 * ChromeCliRunner Unit Tests
 *
 * Tests for the CLI-based runner that spawns `claude --chrome` for browser-capable agents.
 * Converted from vitest to node:test with mock.module for child_process mocking.
 */

import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { MessageQueue } from '../../src/queue/index.ts';

// --- Mocks ---

// Build mock process factory (avoids shared state between tests)
function makeMockProcess() {
  return {
    stdout: { on: mock.fn() },
    stderr: { on: mock.fn() },
    on: mock.fn(),
    kill: mock.fn(),
    pid: 12345,
  };
}

function makeMockQueue(pendingMessages: unknown[] = []): MessageQueue {
  return {
    peek: mock.fn(() => null),
    dequeue: mock.fn(() => null),
    enqueue: mock.fn(),
    getById: mock.fn(),
    getPendingTasks: mock.fn(() => pendingMessages),
    getAll: mock.fn(() => []),
    markProcessed: mock.fn(),
    close: mock.fn(),
    countPending: mock.fn(() => pendingMessages.length),
    poll: mock.fn(() => []),
  } as unknown as MessageQueue;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-mesh/browser-agent',
    model: 'sonnet' as const,
    systemPrompt: 'You are a browser agent. Navigate to example.com and summarize.',
    workDir: '/tmp/test-workdir',
    msgsDir: '/tmp/test-workdir/.ai/tx/msgs',
    ...overrides,
  };
}

// The spawned process mock — shared reference so tests can reach into it
let currentMockProcess: ReturnType<typeof makeMockProcess>;
const spawnMock = mock.fn((_cmd: unknown, _args: unknown, _opts: unknown) => currentMockProcess);

describe('ChromeCliRunner', () => {
  // Dynamic module-under-test reference (loaded after mock.module)
  let ChromeCliRunner: any;

  before(async () => {
    // Mock node:child_process BEFORE importing ChromeCliRunner
    mock.module('node:child_process', {
      namedExports: {
        spawn: spawnMock,
      },
    });
    // Dynamic import to pick up the mocked spawn
    const m = await import('../../src/worker/chrome-cli-runner.ts');
    ChromeCliRunner = m.ChromeCliRunner;
  });

  beforeEach(() => {
    // Reset spawn call history; create fresh mock process
    spawnMock.mock.resetCalls();
    currentMockProcess = makeMockProcess();
  });

  it('should instantiate with config', () => {
    const queue = makeMockQueue();
    const runner = new ChromeCliRunner(makeConfig(), queue);
    assert.ok(runner);
    assert.equal(runner.getSessionId(), null);
    assert.equal(runner.isRunning(), false);
    runner.kill();
  });

  it('should return a WorkerResult from run()', async () => {
    const queue = makeMockQueue();
    const runner = new ChromeCliRunner(makeConfig(), queue);
    const runPromise = runner.run();

    // Trigger stdout data + close events
    const stdoutHandler = currentMockProcess.stdout.on.mock.calls.find((c: any) => c.arguments[0] === 'data')?.arguments[1];
    const closeHandler = currentMockProcess.on.mock.calls.find((c: any) => c.arguments[0] === 'close')?.arguments[1];

    stdoutHandler?.(Buffer.from('Page loaded: Example Domain'));
    closeHandler?.(0);

    const result = await runPromise;
    assert.equal(result.success, true);
    assert.ok(result.output?.includes('Example Domain'));
  });

  it('should dequeue task from queue and use as prompt', async () => {
    const task = {
      id: 1,
      from_agent: 'core/core',
      to_agent: 'test-mesh/browser-agent',
      payload: { headline: 'Scrape example.com', body: 'Navigate to example.com and extract the heading.' },
    };
    const queue = makeMockQueue([task]);
    const runner = new ChromeCliRunner(makeConfig(), queue);
    const runPromise = runner.run();

    const closeHandler = currentMockProcess.on.mock.calls.find((c: any) => c.arguments[0] === 'close')?.arguments[1];
    closeHandler?.(0);

    await runPromise;

    const spawnArgs = spawnMock.mock.calls[0].arguments[1] as string[];
    assert.ok(spawnArgs.includes('Navigate to example.com and extract the heading.'));
    assert.equal((queue.markProcessed as ReturnType<typeof mock.fn>).mock.calls.length, 1);
  });

  it('should emit start and complete events', async () => {
    const queue = makeMockQueue();
    const runner = new ChromeCliRunner(makeConfig(), queue);

    const events: string[] = [];
    runner.on('start', () => events.push('start'));
    runner.on('init', () => events.push('init'));
    runner.on('complete', () => events.push('complete'));

    const runPromise = runner.run();

    const closeHandler = currentMockProcess.on.mock.calls.find((c: any) => c.arguments[0] === 'close')?.arguments[1];
    closeHandler?.(0);

    await runPromise;
    assert.deepEqual(events, ['start', 'init', 'complete']);
  });

  it('should kill the child process', () => {
    const queue = makeMockQueue();
    const runner = new ChromeCliRunner(makeConfig(), queue);
    runner.run();

    runner.kill('test kill');
    assert.equal(currentMockProcess.kill.mock.calls.length, 1);
    assert.equal(currentMockProcess.kill.mock.calls[0].arguments[0], 'SIGTERM');
    assert.equal(runner.getKillReason(), 'test kill');
  });

  it('should build correct CLI args', () => {
    const queue = makeMockQueue();
    const runner = new ChromeCliRunner(makeConfig({ model: 'opus' }), queue);
    runner.run();

    const spawnArgs = spawnMock.mock.calls[0].arguments;
    assert.equal(spawnArgs[0], 'claude');
    const args = spawnArgs[1] as string[];
    assert.ok(args.includes('--chrome'));
    assert.ok(args.includes('--print'));
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('opus'));
    assert.ok(args.includes('--output-format'));
    assert.ok(args.includes('text'));
    assert.ok((spawnArgs[2] as any).cwd === '/tmp/test-workdir');
  });

  it('should handle non-zero exit as error', async () => {
    const queue = makeMockQueue();
    const runner = new ChromeCliRunner(makeConfig(), queue);

    const errors: string[] = [];
    runner.on('error', (data: any) => errors.push(data.error));

    const runPromise = runner.run();

    const stderrHandler = currentMockProcess.stderr.on.mock.calls.find((c: any) => c.arguments[0] === 'data')?.arguments[1];
    const closeHandler = currentMockProcess.on.mock.calls.find((c: any) => c.arguments[0] === 'close')?.arguments[1];

    stderrHandler?.(Buffer.from('CLI error: something broke'));
    closeHandler?.(1);

    const result = await runPromise;
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('CLI error'));
  });

  it('should return error from resume (unsupported)', async () => {
    const queue = makeMockQueue();
    const runner = new ChromeCliRunner(makeConfig(), queue);
    const result = await runner.resume('session-123', 'feedback');
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('not supported'));
  });

  it('should return false from resolvePermission (unsupported)', () => {
    const queue = makeMockQueue();
    const runner = new ChromeCliRunner(makeConfig(), queue);
    assert.equal(runner.resolvePermission('tool-use-123', true), false);
  });
});
