/**
 * ChromeCliRunner Unit Tests
 *
 * Tests for the CLI-based runner that spawns `claude --chrome` for browser-capable agents.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChromeCliRunner, type ChromeCliRunnerConfig } from '../../src/worker/chrome-cli-runner.ts';
import type { MessageQueue } from '../../src/queue/index.ts';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
const mockSpawn = vi.mocked(spawn);

function makeConfig(overrides?: Partial<ChromeCliRunnerConfig>): ChromeCliRunnerConfig {
  return {
    id: 'test-mesh/browser-agent',
    model: 'sonnet',
    systemPrompt: 'You are a browser agent. Navigate to example.com and summarize.',
    workDir: '/tmp/test-workdir',
    msgsDir: '/tmp/test-workdir/.ai/tx/msgs',
    ...overrides,
  };
}

function makeMockProcess() {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  };
}

function makeMockQueue(pendingMessages: unknown[] = []): MessageQueue {
  return {
    peek: vi.fn().mockReturnValue(null),
    dequeue: vi.fn().mockReturnValue(null),
    enqueue: vi.fn(),
    getById: vi.fn(),
    getPendingTasks: vi.fn().mockReturnValue(pendingMessages),
    getAll: vi.fn().mockReturnValue([]),
    markProcessed: vi.fn(),
    close: vi.fn(),
    countPending: vi.fn().mockReturnValue(pendingMessages.length),
  } as unknown as MessageQueue;
}

describe('ChromeCliRunner', () => {
  let runner: ChromeCliRunner;
  let queue: MessageQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = makeMockQueue();
  });

  afterEach(() => {
    runner?.kill();
  });

  it('should instantiate with config', () => {
    runner = new ChromeCliRunner(makeConfig(), queue);
    expect(runner).toBeDefined();
    expect(runner.getSessionId()).toBeNull();
    expect(runner.isRunning()).toBe(false);
  });

  it('should return a WorkerResult from run()', async () => {
    const mockProcess = makeMockProcess();
    mockSpawn.mockReturnValue(mockProcess as any);

    runner = new ChromeCliRunner(makeConfig(), queue);
    const runPromise = runner.run();

    const stdoutHandler = mockProcess.stdout.on.mock.calls.find(c => c[0] === 'data')?.[1];
    const closeHandler = mockProcess.on.mock.calls.find(c => c[0] === 'close')?.[1];

    stdoutHandler?.(Buffer.from('Page loaded: Example Domain'));
    closeHandler?.(0);

    const result = await runPromise;
    expect(result.success).toBe(true);
    expect(result.output).toContain('Example Domain');
  });

  it('should dequeue task from queue and use as prompt', async () => {
    const task = {
      id: 1,
      from_agent: 'core/core',
      to_agent: 'test-mesh/browser-agent',
      payload: { headline: 'Scrape example.com', body: 'Navigate to example.com and extract the heading.' },
    };
    queue = makeMockQueue([task]);
    const mockProcess = makeMockProcess();
    mockSpawn.mockReturnValue(mockProcess as any);

    runner = new ChromeCliRunner(makeConfig(), queue);
    const runPromise = runner.run();

    const closeHandler = mockProcess.on.mock.calls.find(c => c[0] === 'close')?.[1];
    closeHandler?.(0);

    await runPromise;

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('Navigate to example.com and extract the heading.');
    expect(queue.markProcessed).toHaveBeenCalledWith(1);
  });

  it('should emit start and complete events', async () => {
    const mockProcess = makeMockProcess();
    mockSpawn.mockReturnValue(mockProcess as any);

    runner = new ChromeCliRunner(makeConfig(), queue);

    const events: string[] = [];
    runner.on('start', () => events.push('start'));
    runner.on('init', () => events.push('init'));
    runner.on('complete', () => events.push('complete'));

    const runPromise = runner.run();

    const closeHandler = mockProcess.on.mock.calls.find(c => c[0] === 'close')?.[1];
    closeHandler?.(0);

    await runPromise;
    expect(events).toEqual(['start', 'init', 'complete']);
  });

  it('should kill the child process', () => {
    const mockProcess = makeMockProcess();
    mockProcess.kill.mockReturnValue(true);
    mockSpawn.mockReturnValue(mockProcess as any);

    runner = new ChromeCliRunner(makeConfig(), queue);
    runner.run();

    runner.kill('test kill');
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(runner.getKillReason()).toBe('test kill');
  });

  it('should build correct CLI args', () => {
    const mockProcess = makeMockProcess();
    mockSpawn.mockReturnValue(mockProcess as any);

    runner = new ChromeCliRunner(makeConfig({ model: 'opus' }), queue);
    runner.run();

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '--chrome',
        '--print',
        '--model', 'opus',
        '--output-format', 'text',
      ]),
      expect.objectContaining({
        cwd: '/tmp/test-workdir',
      }),
    );
  });

  it('should handle non-zero exit as error', async () => {
    const mockProcess = makeMockProcess();
    mockSpawn.mockReturnValue(mockProcess as any);

    runner = new ChromeCliRunner(makeConfig(), queue);

    const errors: string[] = [];
    runner.on('error', (data) => errors.push(data.error));

    const runPromise = runner.run();

    const stderrHandler = mockProcess.stderr.on.mock.calls.find(c => c[0] === 'data')?.[1];
    const closeHandler = mockProcess.on.mock.calls.find(c => c[0] === 'close')?.[1];

    stderrHandler?.(Buffer.from('CLI error: something broke'));
    closeHandler?.(1);

    const result = await runPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('CLI error');
  });

  it('should return error from resume (unsupported)', async () => {
    runner = new ChromeCliRunner(makeConfig(), queue);
    const result = await runner.resume('session-123', 'feedback');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported');
  });

  it('should return false from resolvePermission (unsupported)', () => {
    runner = new ChromeCliRunner(makeConfig(), queue);
    expect(runner.resolvePermission('tool-use-123', true)).toBe(false);
  });
});
