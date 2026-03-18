/**
 * BashGuard Unit Tests
 *
 * Tests the BashGuard class directly — instantiate with mock config,
 * call the hook with synthetic inputs, verify decisions.
 *
 * Test categories:
 * 1. workDir Boundary (primary security model)
 * 2. Catastrophic Denylist
 * 3. Network Access (explicitly allowed)
 * 4. God Mode (tested via permissions, not here)
 * 5. Violation Counting + Kill Threshold
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BashGuard } from '../../src/worker/bash-guard.ts';
import type { SyncHookJSONOutput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';

/**
 * Helper to create a valid PreToolUseHookInput for testing
 */
function makeInput(command: string): PreToolUseHookInput {
  return {
    session_id: 'test-session',
    transcript_path: '/tmp/test-transcript',
    cwd: '/tmp/test-workspace',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: 'test-tool-use-id',
  };
}

/**
 * Helper to create input with missing command field (edge case test)
 */
function makeEmptyInput(): PreToolUseHookInput {
  return {
    session_id: 'test-session',
    transcript_path: '/tmp/test-transcript',
    cwd: '/tmp/test-workspace',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: {},
    tool_use_id: 'test-tool-use-id',
  };
}

/**
 * Helper to call the hook and cast result to SyncHookJSONOutput
 * BashGuard always returns sync output (never async: true)
 */
async function callHook(guard: BashGuard, command: string): Promise<SyncHookJSONOutput> {
  const hook = guard.createHook();
  const result = await hook.hooks[0](makeInput(command), 'tool-1', { signal: new AbortController().signal });
  return result as SyncHookJSONOutput;
}

async function callHookEmpty(guard: BashGuard): Promise<SyncHookJSONOutput> {
  const hook = guard.createHook();
  const result = await hook.hooks[0](makeEmptyInput(), 'tool-1', { signal: new AbortController().signal });
  return result as SyncHookJSONOutput;
}

describe('BashGuard - workDir Boundary (ALLOW within workDir)', () => {
  let guard: BashGuard;
  let killCalled = false;
  let killReason = '';

  beforeEach(() => {
    killCalled = false;
    killReason = '';
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: (reason) => {
        killCalled = true;
        killReason = reason;
      },
      mode: { strict: true, warning: true },
    });
  });

  it('should approve ls within workDir', async () => {
    const result = await callHook(guard, 'ls /tmp/test-workspace/src');
    assert.equal(result.decision, 'approve');
  });

  it('should approve cat with relative path', async () => {
    const result = await callHook(guard, 'cat ./package.json');
    assert.equal(result.decision, 'approve');
  });

  it('should approve rm -rf within workDir', async () => {
    const result = await callHook(guard, 'rm -rf ./node_modules');
    assert.equal(result.decision, 'approve');
  });

  it('should approve echo redirect within workDir', async () => {
    const result = await callHook(guard, 'echo "test" > /tmp/test-workspace/out.txt');
    assert.equal(result.decision, 'approve');
  });

  it('should approve cd && ls within workDir', async () => {
    const result = await callHook(guard, 'cd /tmp/test-workspace/src && ls');
    assert.equal(result.decision, 'approve');
  });

  it('should approve git status (no path = within workDir)', async () => {
    const result = await callHook(guard, 'git status');
    assert.equal(result.decision, 'approve');
  });

  it('should approve npm install', async () => {
    const result = await callHook(guard, 'npm install');
    assert.equal(result.decision, 'approve');
  });

  it('should approve npm run build', async () => {
    const result = await callHook(guard, 'npm run build');
    assert.equal(result.decision, 'approve');
  });

  it('should approve echo to /dev/null (special path)', async () => {
    const result = await callHook(guard, 'echo test > /dev/null');
    assert.equal(result.decision, 'approve');
  });
});

describe('BashGuard - workDir Boundary (BLOCK outside workDir)', () => {
  let guard: BashGuard;

  beforeEach(() => {
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: () => {},
      mode: { strict: true, warning: true },
    });
  });

  // NOTE: BashGuard allows READS anywhere (Docker parity - you can read /etc inside container)
  // Only WRITE operations outside workDir are blocked

  it('should ALLOW cat /etc/hosts (reads permitted)', async () => {
    const result = await callHook(guard, 'cat /etc/hosts');
    assert.equal(result.decision, 'approve');
  });

  it('should ALLOW ls /tmp (reads permitted)', async () => {
    const result = await callHook(guard, 'ls /tmp');
    assert.equal(result.decision, 'approve');
  });

  it('should block touch /etc/hosts (write)', async () => {
    const result = await callHook(guard, 'touch /etc/hosts');
    assert.equal(result.decision, 'block');
    assert.ok(result.reason?.includes('/etc/hosts'));
  });

  it('should block mkdir /tmp/evil (write)', async () => {
    const result = await callHook(guard, 'mkdir /tmp/evil');
    assert.equal(result.decision, 'block');
    assert.ok(result.reason?.includes('/tmp'));
  });

  it('should block echo to /tmp/', async () => {
    const result = await callHook(guard, 'echo "evil" > /tmp/exploit.sh');
    assert.equal(result.decision, 'block');
    assert.ok(result.reason?.includes('/tmp'));
  });

  it('should block cp to /tmp/', async () => {
    const result = await callHook(guard, 'cp file.txt /tmp/');
    assert.equal(result.decision, 'block');
  });

  it('should block mv to /opt/', async () => {
    const result = await callHook(guard, 'mv file.txt /opt/evil');
    assert.equal(result.decision, 'block');
  });

  it('should block tar extract to /tmp/', async () => {
    const result = await callHook(guard, 'tar -xf file.tar -C /tmp/');
    assert.equal(result.decision, 'block');
  });

  it('should block cd to /tmp with destructive command', async () => {
    // cd outside workDir + destructive command = blocked
    const result = await callHook(guard, 'cd /tmp && rm -rf *');
    assert.equal(result.decision, 'block');
  });

  it('should block cd to /tmp even with read-only command (cd escape blocked)', async () => {
    // cd outside workDir triggers checkCdThenDestroy — blocks ANY command after cd escape
    // This is stricter than Docker but prevents sneaky multi-stage attacks
    const result = await callHook(guard, 'cd /tmp && ls');
    assert.equal(result.decision, 'block');
  });

  it('should block relative path escape (even for reads)', async () => {
    // Relative path escapes (../) are blocked regardless of operation type
    // This prevents traversal attacks even if the immediate op is "just a read"
    const result = await callHook(guard, 'cat ../../etc/passwd');
    assert.equal(result.decision, 'block');
  });

  it('should block relative path escape for writes', async () => {
    // Writes outside workDir are blocked
    const result = await callHook(guard, 'touch ../../etc/evil');
    assert.equal(result.decision, 'block');
  });

  it('should block symlink to outside workDir', async () => {
    const result = await callHook(guard, 'ln -s /etc/passwd ./link');
    assert.equal(result.decision, 'block');
  });

  it('should block sed -i on /etc/', async () => {
    const result = await callHook(guard, 'sed -i "s/foo/bar/" /etc/nginx.conf');
    assert.equal(result.decision, 'block');
  });

  it('should block git clone to /tmp/', async () => {
    const result = await callHook(guard, 'git clone https://github.com/x/y /tmp/repo');
    assert.equal(result.decision, 'block');
  });

  it('should block python write to /tmp/', async () => {
    const result = await callHook(guard, 'python -c "open(\'/tmp/x\',\'w\').write(\'evil\')"');
    assert.equal(result.decision, 'block');
  });

  it('should block node writeFileSync to /tmp/', async () => {
    const result = await callHook(guard, 'node -e "require(\'fs\').writeFileSync(\'/tmp/x\',\'y\')"');
    assert.equal(result.decision, 'block');
  });

  it('should block rsync to /tmp/', async () => {
    const result = await callHook(guard, 'rsync -a . /tmp/backup/');
    assert.equal(result.decision, 'block');
  });

  it('should block pip install --target /opt/', async () => {
    const result = await callHook(guard, 'pip install --target /opt/pkg foo');
    assert.equal(result.decision, 'block');
  });

  it('should block npm install --prefix /opt/', async () => {
    const result = await callHook(guard, 'npm install --prefix /opt/node foo');
    assert.equal(result.decision, 'block');
  });
});

describe('BashGuard - workDir Boundary (EDGE CASES)', () => {
  let guard: BashGuard;

  beforeEach(() => {
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: () => {},
      mode: { strict: true, warning: true },
    });
  });

  it('should ALLOW prefix attack reads (reads permitted)', async () => {
    // Reads are allowed anywhere - prefix attack only matters for writes
    const result = await callHook(guard, 'cat /tmp/test-workspace-evil/foo');
    assert.equal(result.decision, 'approve');
  });

  it('should block prefix attack writes', async () => {
    // Write to similar-but-different path should be blocked
    const result = await callHook(guard, 'touch /tmp/test-workspace-evil/foo');
    assert.equal(result.decision, 'block');
  });

  it('should block traversal reads (traversal patterns blocked)', async () => {
    // Traversal via ../ is blocked even for reads (prevents directory traversal attacks)
    const result = await callHook(guard, 'cat /tmp/test-workspace/../../../etc/passwd');
    assert.equal(result.decision, 'block');
  });

  it('should block traversal writes', async () => {
    const result = await callHook(guard, 'touch /tmp/test-workspace/../../../etc/evil');
    assert.equal(result.decision, 'block');
  });

  it('should block home dir writes ~/evil.sh', async () => {
    const result = await callHook(guard, 'touch ~/evil.sh');
    assert.equal(result.decision, 'block');
  });

  it('should block home dir reads (home expansion blocked)', async () => {
    // ~ and $HOME expansion is blocked for all operations (prevents home dir access)
    const result = await callHook(guard, 'cat ~/existing.sh');
    assert.equal(result.decision, 'block');
  });

  it('should approve curl with URL (not a file path)', async () => {
    const result = await callHook(guard, 'curl https://example.com');
    assert.equal(result.decision, 'approve');
  });

  it('should approve curl redirect within workDir', async () => {
    const result = await callHook(guard, 'curl https://example.com > /tmp/test-workspace/out.txt');
    assert.equal(result.decision, 'approve');
  });

  it('should block curl redirect to /tmp/', async () => {
    const result = await callHook(guard, 'curl https://example.com > /tmp/out');
    assert.equal(result.decision, 'block');
  });

  it('should approve git push (no local path)', async () => {
    const result = await callHook(guard, 'git push origin main');
    assert.equal(result.decision, 'approve');
  });

  it('should approve ssh (network, not file path)', async () => {
    const result = await callHook(guard, 'ssh user@host');
    assert.equal(result.decision, 'approve');
  });
});

describe('BashGuard - Catastrophic Denylist', () => {
  let guard: BashGuard;

  beforeEach(() => {
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: () => {},
      mode: { strict: true, warning: true },
    });
  });

  it('should block sudo apt install', async () => {
    const result = await callHook(guard, 'sudo apt install foo');
    assert.equal(result.decision, 'block');
    assert.ok(result.reason?.includes('sudo'));
  });

  it('should block su - root', async () => {
    const result = await callHook(guard, 'su - root');
    assert.equal(result.decision, 'block');
  });

  it('should block rm -rf /', async () => {
    const result = await callHook(guard, 'rm -rf /');
    assert.equal(result.decision, 'block');
    assert.ok(result.reason?.includes('Root filesystem destruction'));
  });

  it('should block rm -rf /*', async () => {
    const result = await callHook(guard, 'rm -rf /*');
    assert.equal(result.decision, 'block');
  });

  it('should block mkfs', async () => {
    const result = await callHook(guard, 'mkfs /dev/sda');
    assert.equal(result.decision, 'block');
  });

  it('should block reboot', async () => {
    const result = await callHook(guard, 'reboot');
    assert.equal(result.decision, 'block');
  });

  it('should block shutdown -h now', async () => {
    const result = await callHook(guard, 'shutdown -h now');
    assert.equal(result.decision, 'block');
  });

  it('should block systemctl restart', async () => {
    const result = await callHook(guard, 'systemctl restart nginx');
    assert.equal(result.decision, 'block');
  });

  it('should block kill -9 1', async () => {
    const result = await callHook(guard, 'kill -9 1');
    assert.equal(result.decision, 'block');
  });

  it('should block crontab -e', async () => {
    const result = await callHook(guard, 'crontab -e');
    assert.equal(result.decision, 'block');
  });

  it('should block docker run with host mount', async () => {
    const result = await callHook(guard, 'docker run -v /:/host ubuntu');
    assert.equal(result.decision, 'block');
  });

  it('should block dd to /dev/sda', async () => {
    const result = await callHook(guard, 'dd if=/dev/zero of=/dev/sda');
    assert.equal(result.decision, 'block');
  });
});

describe('BashGuard - Network Access (explicitly allowed)', () => {
  let guard: BashGuard;

  beforeEach(() => {
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: () => {},
      mode: { strict: true, warning: true },
    });
  });

  it('should approve curl https://api.example.com/data', async () => {
    const result = await callHook(guard, 'curl https://api.example.com/data');
    assert.equal(result.decision, 'approve');
  });

  it('should approve wget https://example.com/file.zip', async () => {
    const result = await callHook(guard, 'wget https://example.com/file.zip');
    assert.equal(result.decision, 'approve');
  });

  it('should approve ssh user@remote-server', async () => {
    const result = await callHook(guard, 'ssh user@remote-server');
    assert.equal(result.decision, 'approve');
  });

  it('should approve nc localhost 8080', async () => {
    const result = await callHook(guard, 'nc localhost 8080');
    assert.equal(result.decision, 'approve');
  });

  it('should approve git fetch origin', async () => {
    const result = await callHook(guard, 'git fetch origin');
    assert.equal(result.decision, 'approve');
  });

  it('should approve git diff HEAD~5 (revision syntax, not home dir)', async () => {
    const result = await callHook(guard, 'git diff HEAD~5..HEAD');
    assert.equal(result.decision, 'approve');
  });

  it('should approve git diff main...HEAD (range syntax)', async () => {
    const result = await callHook(guard, 'git diff --name-only main...HEAD');
    assert.equal(result.decision, 'approve');
  });

  it('should approve git log HEAD~10 (revision syntax)', async () => {
    const result = await callHook(guard, 'git log HEAD~10 --oneline');
    assert.equal(result.decision, 'approve');
  });

  it('should approve git diff with caret syntax HEAD^2', async () => {
    const result = await callHook(guard, 'git diff HEAD^2');
    assert.equal(result.decision, 'approve');
  });

  it('should approve npm publish', async () => {
    const result = await callHook(guard, 'npm publish');
    assert.equal(result.decision, 'approve');
  });
});

describe('BashGuard - Mode behavior', () => {
  // NOTE: Mode tests must use WRITE operations, not reads (reads are always allowed)

  it('should approve in warning mode (strict: false, warning: true)', async () => {
    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: () => {},
      mode: { strict: false, warning: true },
    });

    // Use a write operation that would violate workDir boundary
    const result = await callHook(guard, 'touch /etc/evil');
    assert.equal(result.decision, 'approve');
    assert.ok(result.systemMessage);
    assert.ok(result.systemMessage!.includes('violates security policy'));
  });

  it('should approve silently in disabled mode (strict: false, warning: false)', async () => {
    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: () => {},
      mode: { strict: false, warning: false },
    });

    // Use a write operation that would violate workDir boundary
    const result = await callHook(guard, 'touch /etc/evil');
    assert.equal(result.decision, 'approve');
    assert.equal(result.systemMessage, undefined);
  });

  it('should block silently in strict mode without warning (strict: true, warning: false)', async () => {
    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: () => {},
      mode: { strict: true, warning: false },
    });

    // Use a write operation that would violate workDir boundary
    const result = await callHook(guard, 'touch /etc/evil');
    assert.equal(result.decision, 'block');
    assert.equal(result.reason, undefined);
  });
});

describe('BashGuard - Violation Counting + Kill Threshold', () => {
  // NOTE: Violation tests must use WRITE operations, not reads (reads are always allowed)

  it('should kill runner after 3 violations in strict mode', async () => {
    let killCalled = false;
    let killReason = '';

    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: (reason) => {
        killCalled = true;
        killReason = reason;
      },
      mode: { strict: true, warning: true },
    });

    // First violation (write outside workDir)
    await callHook(guard, 'touch /etc/evil1');
    assert.equal(killCalled, false);

    // Second violation (write outside workDir)
    await callHook(guard, 'mkdir /tmp/evil');
    assert.equal(killCalled, false);

    // Third violation — should trigger kill
    await callHook(guard, 'touch /etc/evil2');
    assert.equal(killCalled, true);
    assert.ok(killReason.includes('3 security violations'));
  });

  it('should not kill in warning mode (strict: false)', async () => {
    let killCalled = false;

    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: () => {
        killCalled = true;
      },
      mode: { strict: false, warning: true },
    });

    // Multiple violations should not trigger kill in warning mode
    await callHook(guard, 'touch /etc/evil1');
    await callHook(guard, 'mkdir /tmp/evil');
    await callHook(guard, 'touch /etc/evil2');
    await callHook(guard, 'rm -rf /tmp/x');

    assert.equal(killCalled, false);
  });

  it('should reset violation count', async () => {
    let killCalled = false;

    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: () => {
        killCalled = true;
      },
      mode: { strict: true, warning: true },
    });

    // Two violations (writes outside workDir)
    await callHook(guard, 'touch /etc/evil1');
    await callHook(guard, 'mkdir /tmp/evil');

    // Reset
    guard.reset();

    // Two more violations after reset — should not kill
    await callHook(guard, 'touch /etc/evil2');
    await callHook(guard, 'rm -rf /tmp/x');

    assert.equal(killCalled, false);
  });
});

describe('BashGuard - Empty/null command handling', () => {
  let guard: BashGuard;

  beforeEach(() => {
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/tmp/test-workspace',
      killRunner: () => {},
      mode: { strict: true, warning: true },
    });
  });

  it('should approve empty command', async () => {
    const result = await callHook(guard, '');
    assert.equal(result.decision, 'approve');
  });

  it('should approve missing command field', async () => {
    const result = await callHookEmpty(guard);
    assert.equal(result.decision, 'approve');
  });
});
