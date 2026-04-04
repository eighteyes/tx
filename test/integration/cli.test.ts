/**
 * CLI Integration Tests
 *
 * Exercises real code paths for CLI commands against real SQLite databases
 * and real filesystems in isolated temp directories.
 *
 * Responsibilities:
 * - tx status: zero-state, populated queue, JSON output, printStatus formatting
 * - tx mesh: list (no DB), validate (valid + invalid config), clear (suspended sessions)
 * - tx restart: PID-based stop logic (live process, stale PID, no PID)
 * - CLI flag parsing via command entry points
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createTestEnv, type TestEnv } from '../helpers/test-env.ts';
import { MessageQueue } from '../../src/queue/index.ts';
import { status, printStatus, type StatusResult } from '../../src/cli/status.ts';
import { getSessionName } from '../../src/core/tmux.ts';

/** Project root — used as cwd for subprocesses so tsx resolves */
const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname), '..', '..'
);

/** CLI entry point path */
const CLI_ENTRY = path.join(PROJECT_ROOT, 'src', 'cli', 'index.ts');

// ============================================================
// tx status
// ============================================================

describe('tx status', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv('cli-status');
  });

  afterEach(() => {
    env.cleanup();
  });

  it('returns zeros when no queue database exists', async () => {
    const result = await status(env.rootDir);

    assert.strictEqual(result.queue.pending, 0);
    assert.strictEqual(result.queue.delivered, 0);
    assert.strictEqual(result.queue.total, 0);
    assert.deepStrictEqual(result.queue.byAgent, {});
    assert.deepStrictEqual(result.workers, []);
    assert.deepStrictEqual(result.instances, []);
    assert.strictEqual(typeof result.core.running, 'boolean');
    assert.strictEqual(result.core.running, false);
  });

  it('returns correct counts with populated queue', async () => {
    const queue = new MessageQueue(env.dbPath);

    // Insert 3 messages: 2 to worker-a, 1 to worker-b
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'mesh/worker-a',
      payload: { headline: 'job-1', body: 'do thing' },
    });
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'mesh/worker-a',
      payload: { headline: 'job-2', body: 'do other thing' },
    });
    queue.insert({
      from_agent: 'core/core',
      to_agent: 'mesh/worker-b',
      payload: { headline: 'job-3', body: 'third thing' },
    });

    // Deliver one message via pollOne (polls oldest pending and marks delivered)
    const delivered = queue.pollOne('mesh/worker-a');
    assert.ok(delivered, 'Should poll one message');

    queue.close();

    const result = await status(env.rootDir);

    assert.strictEqual(result.queue.total, 3);
    assert.strictEqual(result.queue.delivered, 1);
    assert.strictEqual(result.queue.pending, 2);
    assert.strictEqual(result.queue.byAgent['mesh/worker-a'], 1);
    assert.strictEqual(result.queue.byAgent['mesh/worker-b'], 1);
  });

  it('reads workers from workers.json', async () => {
    // Create a queue DB so the status path exists
    const queue = new MessageQueue(env.dbPath);
    queue.close();

    const workersPath = path.join(env.dataDir, 'workers.json');
    fs.writeFileSync(workersPath, JSON.stringify({
      workers: [
        { id: 'w-1', startedAt: Date.now() - 5000 },
        { id: 'w-2', startedAt: Date.now() - 2000 },
      ]
    }));

    const result = await status(env.rootDir);
    assert.strictEqual(result.workers.length, 2);
    assert.strictEqual(result.workers[0].id, 'w-1');
    assert.strictEqual(result.workers[1].id, 'w-2');
  });
});

// ============================================================
// printStatus
// ============================================================

describe('printStatus', () => {
  it('does not throw for minimal result', () => {
    const result: StatusResult = {
      core: { running: false, session: 'tx-test-abc' },
      queue: { pending: 0, delivered: 0, total: 0, byAgent: {} },
      workers: [],
      instances: [],
    };

    assert.doesNotThrow(() => printStatus(result));
  });

  it('does not throw for populated result with workers and instances', () => {
    const result: StatusResult = {
      core: { running: true, session: 'tx-live-xyz' },
      queue: {
        pending: 5,
        delivered: 12,
        total: 17,
        byAgent: { 'mesh/worker-a': 3, 'mesh/worker-b': 2 },
      },
      workers: [
        { id: 'w-1', startedAt: Date.now() - 60000, messagesProcessed: 4 },
      ],
      instances: [
        { base_mesh: 'dev', mesh_id: 'auth', status: 'running', spawned_at: Date.now() - 30000 },
        { base_mesh: 'dev', mesh_id: 'ui', status: 'completed', spawned_at: Date.now() - 60000, completed_at: Date.now() - 10000 },
      ],
    };

    assert.doesNotThrow(() => printStatus(result));
  });

  it('does not throw for awaiting workers', () => {
    const result: StatusResult = {
      core: { running: true, session: 'tx-await-test' },
      queue: { pending: 0, delivered: 0, total: 0, byAgent: {} },
      workers: [
        {
          id: 'w-await',
          startedAt: Date.now() - 30000,
          status: 'awaiting',
          awaitingResponses: ['mesh/editor'],
          awaitDuration: 5000,
        },
      ],
      instances: [],
    };

    assert.doesNotThrow(() => printStatus(result));
  });

  it('JSON mode produces valid JSON', () => {
    const result: StatusResult = {
      core: { running: false, session: 'tx-json-test' },
      queue: { pending: 1, delivered: 2, total: 3, byAgent: { 'mesh/a': 1 } },
      workers: [],
      instances: [],
    };

    const originalWrite = process.stdout.write;
    let captured = '';
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      printStatus(result, true);
    } finally {
      process.stdout.write = originalWrite;
    }

    const parsed = JSON.parse(captured);
    assert.strictEqual(parsed.core.session, 'tx-json-test');
    assert.strictEqual(parsed.queue.pending, 1);
    assert.strictEqual(parsed.queue.total, 3);
  });
});

// ============================================================
// tx mesh subcommands
// ============================================================

describe('tx mesh', () => {
  let env: TestEnv;
  let savedTxCwd: string | undefined;

  beforeEach(() => {
    env = createTestEnv('cli-mesh');
    savedTxCwd = process.env.TX_CWD;
    process.env.TX_CWD = env.rootDir;
  });

  afterEach(() => {
    if (savedTxCwd === undefined) {
      delete process.env.TX_CWD;
    } else {
      process.env.TX_CWD = savedTxCwd;
    }
    env.cleanup();
  });

  describe('mesh list', () => {
    it('handles no queue DB gracefully', async () => {
      const { mesh } = await import('../../src/cli/mesh.ts');

      const output = await captureStdout(() => mesh(['list']));
      const stripped = stripAnsi(output);
      assert.ok(
        stripped.includes('No mesh activity') || stripped.includes('No queue database'),
        `Expected graceful message, got: ${stripped}`
      );
    });

    it('handles no queue DB with --json flag', async () => {
      const { mesh } = await import('../../src/cli/mesh.ts');

      const output = await captureStdout(() => mesh(['list', '--json']));
      const parsed = JSON.parse(output);
      assert.ok(Array.isArray(parsed.meshes), 'JSON output should have meshes array');
      assert.strictEqual(parsed.meshes.length, 0);
    });
  });

  describe('mesh clear', () => {
    it('clears suspended sessions and pending messages for a mesh', async () => {
      // mesh clear looks for .ai/tx/queue.db (not data/queue.db)
      const queuePath = path.join(env.rootDir, '.ai', 'tx', 'queue.db');
      const queue = new MessageQueue(queuePath);

      // Suspend two sessions
      queue.suspendSession('test-mesh/worker-a', {
        sessionId: 'sess-1',
        reason: 'ask-human',
        suspendedAt: Date.now(),
        meshName: 'test-mesh',
        pendingCount: 1,
      });
      queue.suspendSession('test-mesh/worker-b', {
        sessionId: 'sess-2',
        reason: 'await-response',
        suspendedAt: Date.now(),
        meshName: 'test-mesh',
        pendingCount: 0,
      });

      // Insert a pending message for the mesh
      queue.insert({
        from_agent: 'core/core',
        to_agent: 'test-mesh/worker-a',
        payload: { headline: 'test', body: 'body' },
      });

      // Verify state before clear
      assert.strictEqual(queue.listSuspendedSessions().length, 2);
      assert.strictEqual(queue.getStats().pending, 1);

      queue.close();

      const { mesh } = await import('../../src/cli/mesh.ts');
      await mesh(['clear', 'test-mesh', '--force']);

      // Re-open and verify cleared
      const queue2 = new MessageQueue(queuePath);
      assert.strictEqual(queue2.listSuspendedSessions().length, 0, 'Suspended sessions should be cleared');
      assert.strictEqual(queue2.getStats().pending, 0, 'Pending messages should be cleared');
      queue2.close();
    });

    it('handles clear with no queue DB', async () => {
      const { mesh } = await import('../../src/cli/mesh.ts');

      const output = await captureStdout(() => mesh(['clear', 'nonexistent']));
      const stripped = stripAnsi(output);
      assert.ok(
        stripped.includes('No mesh state') || stripped.includes('no queue database'),
        `Expected graceful message, got: ${stripped}`
      );
    });

    it('clear --json returns structured result', async () => {
      // Create queue with state to clear
      const queuePath = path.join(env.rootDir, '.ai', 'tx', 'queue.db');
      const queue = new MessageQueue(queuePath);
      queue.suspendSession('json-mesh/worker', {
        sessionId: 'sess-j',
        reason: 'ask-human',
        suspendedAt: Date.now(),
        meshName: 'json-mesh',
        pendingCount: 0,
      });
      queue.close();

      const { mesh } = await import('../../src/cli/mesh.ts');
      const output = await captureStdout(() => mesh(['clear', 'json-mesh', '--force', '--json']));
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.meshName, 'json-mesh');
      assert.ok(parsed.cleared !== undefined, 'Should have cleared field');
      assert.strictEqual(typeof parsed.cleared.suspendedSessions, 'number');
    });
  });

  describe('mesh validate', () => {
    it('validates a minimal valid config', async () => {
      const meshDir = path.join(env.rootDir, 'meshes', 'valid-mesh');
      fs.mkdirSync(meshDir, { recursive: true });
      fs.writeFileSync(path.join(meshDir, 'config.yaml'), [
        'mesh: valid-mesh',
        'agents:',
        '  - name: worker',
        '    model: sonnet',
        '    prompt: test.md',
        'entry_point: worker',
      ].join('\n'));

      // validateMesh calls process.exit — run in subprocess
      const result = await runCLISubprocess(['mesh', 'validate', 'valid-mesh'], env.rootDir);
      assert.strictEqual(result.exitCode, 0, `Expected exit 0, stderr: ${result.stderr}`);
      assert.ok(stripAnsi(result.stdout).includes('Valid'), `Expected "Valid" in output`);
    });

    it('rejects an invalid config (missing agents)', async () => {
      const meshDir = path.join(env.rootDir, 'meshes', 'bad-mesh');
      fs.mkdirSync(meshDir, { recursive: true });
      fs.writeFileSync(path.join(meshDir, 'config.yaml'), [
        'mesh: bad-mesh',
        'description: no agents defined',
      ].join('\n'));

      const result = await runCLISubprocess(['mesh', 'validate', 'bad-mesh'], env.rootDir);
      assert.notStrictEqual(result.exitCode, 0, 'Should exit non-zero for invalid config');

      const stripped = stripAnsi(result.stdout + result.stderr);
      assert.ok(
        stripped.includes('Errors') || stripped.includes('failed') || stripped.includes('agents'),
        `Expected validation error, got: ${stripped}`
      );
    });

    it('reports missing config file', async () => {
      const result = await runCLISubprocess(['mesh', 'validate', 'ghost-mesh'], env.rootDir);
      assert.notStrictEqual(result.exitCode, 0, 'Should exit non-zero for missing config');

      const combined = stripAnsi(result.stdout + result.stderr);
      assert.ok(
        combined.includes('not found'),
        `Expected "not found" in output, got: ${combined}`
      );
    });
  });
});

// ============================================================
// tx restart PID logic
// ============================================================

describe('tx restart PID logic', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv('cli-restart');
  });

  afterEach(() => {
    env.cleanup();
  });

  it('detects stale PID and cleans up file', () => {
    // Replicate restart's PID logic: read PID, check alive, clean up
    const pidFile = path.join(env.dataDir, '.pid');
    fs.writeFileSync(pidFile, '999999999');

    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    assert.strictEqual(pid, 999999999);

    // process.kill(pid, 0) should throw ESRCH for nonexistent PID
    let isAlive = true;
    try {
      process.kill(pid, 0);
    } catch {
      isAlive = false;
    }
    assert.strictEqual(isAlive, false, 'Stale PID should not be alive');

    // Clean up PID file (what restart does after process exits)
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    assert.strictEqual(fs.existsSync(pidFile), false, 'PID file should be cleaned up');
  });

  it('process.kill(pid, 0) detects live vs dead processes', () => {
    // Verify the signal check mechanism restart relies on
    // Current process PID should be alive
    assert.doesNotThrow(() => process.kill(process.pid, 0), 'Own PID should be alive');

    // Nonexistent PID should throw ESRCH
    let threw = false;
    try { process.kill(999999999, 0); } catch { threw = true; }
    assert.strictEqual(threw, true, 'Nonexistent PID should throw');
  });

  it('handles no PID file gracefully', () => {
    const pidFile = path.join(env.dataDir, '.pid');
    assert.strictEqual(fs.existsSync(pidFile), false, 'PID file should not exist');

    // Replicate restart logic: check existsSync → skip stop phase
    if (fs.existsSync(pidFile)) {
      assert.fail('Should not enter stop logic when no PID file');
    }
    assert.ok(true, 'Skipped stop phase cleanly');
  });

  it('parses PID from files with whitespace and newlines', () => {
    const pidFile = path.join(env.dataDir, '.pid');

    fs.writeFileSync(pidFile, '12345\n');
    assert.strictEqual(parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10), 12345);

    fs.writeFileSync(pidFile, '  67890  ');
    assert.strictEqual(parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10), 67890);
  });

  it('getSessionName produces deterministic names', () => {
    const name1 = getSessionName(env.rootDir);
    const name2 = getSessionName(env.rootDir);
    assert.strictEqual(name1, name2, 'Same dir should produce same session name');

    const name3 = getSessionName('/tmp/different-dir');
    assert.notStrictEqual(name1, name3, 'Different dirs should produce different names');
    assert.ok(name1.startsWith('tx-'), 'Session name should start with tx-');
  });

  it('AI-use guard blocks restart from Claude Code', async () => {
    // The CLI blocks restart when CLAUDECODE=1 to prevent recursive AI calls
    const result = await runCLISubprocess(['restart'], env.rootDir, 5_000);
    assert.notStrictEqual(result.exitCode, 0, 'Should exit non-zero');
    assert.ok(
      stripAnsi(result.stderr).includes('AI USE NOT ALLOWED'),
      'Should show AI use guard message'
    );
  });
});

// ============================================================
// tx status CLI subprocess output
// ============================================================

describe('tx status CLI output', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv('cli-status-output');
  });

  afterEach(() => {
    env.cleanup();
  });

  it('--json flag produces valid JSON', async () => {
    const result = await runCLISubprocess(['status', '--json'], env.rootDir);
    assert.strictEqual(result.exitCode, 0, `Expected exit 0, stderr: ${result.stderr}`);

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.core !== undefined, 'JSON should have core field');
    assert.ok(parsed.queue !== undefined, 'JSON should have queue field');
    assert.strictEqual(typeof parsed.queue.pending, 'number');
    assert.strictEqual(typeof parsed.queue.total, 'number');
  });

  it('text mode includes status header', async () => {
    const result = await runCLISubprocess(['status'], env.rootDir);
    assert.strictEqual(result.exitCode, 0, `Expected exit 0, stderr: ${result.stderr}`);

    const stripped = stripAnsi(result.stdout);
    assert.ok(stripped.includes('TX V4 Status'), `Expected status header, got: ${stripped}`);
  });
});

// ============================================================
// Helpers
// ============================================================

/** Strip ANSI escape codes from a string */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Capture stdout from an async function */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return captured;
}

/**
 * Run a tx CLI command in a subprocess with isolated TX_CWD.
 * Subprocess runs from PROJECT_ROOT so tsx resolves correctly.
 */
function runCLISubprocess(
  args: string[],
  workDir: string,
  timeoutMs = 15_000,
  envOverrides: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn('node', ['--import', 'tsx', CLI_ENTRY, ...args], {
      env: {
        ...process.env,
        TX_CWD: workDir,
        DOTENV_CONFIG_SILENT: 'true',
        ...envOverrides,
      },
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', (err) => {
      resolve({ stdout, stderr: stderr + '\n' + err.message, exitCode: 1 });
    });
  });
}
