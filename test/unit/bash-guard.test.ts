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
import type { HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';

describe('BashGuard - workDir Boundary (ALLOW within workDir)', () => {
  let guard: BashGuard;
  let killCalled = false;
  let killReason = '';

  beforeEach(() => {
    killCalled = false;
    killReason = '';
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: (reason) => {
        killCalled = true;
        killReason = reason;
      },
      mode: { strict: true, warning: true },
    });
  });

  it('should approve ls within workDir', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'ls /workspace/tx-core/src' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve cat with relative path', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cat ./package.json' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve rm -rf within workDir', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'rm -rf ./node_modules' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve echo redirect within workDir', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'echo "test" > /workspace/tx-core/out.txt' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve cd && ls within workDir', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cd /workspace/tx-core/src && ls' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve git status (no path = within workDir)', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'git status' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve npm install', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'npm install' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve npm run build', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'npm run build' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve echo to /dev/null (special path)', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'echo test > /dev/null' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });
});

describe('BashGuard - workDir Boundary (BLOCK outside workDir)', () => {
  let guard: BashGuard;

  beforeEach(() => {
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: () => {},
      mode: { strict: true, warning: true },
    });
  });

  it('should block cat /etc/hosts', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cat /etc/hosts' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
    assert.ok((result as any).reason.includes('/etc/hosts'));
  });

  it('should block ls /tmp', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'ls /tmp' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
    assert.ok((result as any).reason.includes('/tmp'));
  });

  it('should block echo to /tmp/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'echo "evil" > /tmp/exploit.sh' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
    assert.ok((result as any).reason.includes('/tmp'));
  });

  it('should block cp to /tmp/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cp file.txt /tmp/' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block mv to /opt/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'mv file.txt /opt/evil' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block mkdir /tmp/evil', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'mkdir /tmp/evil' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block tar extract to /tmp/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'tar -xf file.tar -C /tmp/' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block cd to /tmp', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cd /tmp && ls' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block relative path escape', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cat ../../etc/passwd' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block symlink to outside workDir', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'ln -s /etc/passwd ./link' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block sed -i on /etc/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'sed -i "s/foo/bar/" /etc/nginx.conf' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block git clone to /tmp/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'git clone https://github.com/x/y /tmp/repo' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block python write to /tmp/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'python -c "open(\'/tmp/x\',\'w\').write(\'evil\')"' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block node writeFileSync to /tmp/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'node -e "require(\'fs\').writeFileSync(\'/tmp/x\',\'y\')"' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block rsync to /tmp/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'rsync -a . /tmp/backup/' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block pip install --target /opt/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'pip install --target /opt/pkg foo' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block npm install --prefix /opt/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'npm install --prefix /opt/node foo' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });
});

describe('BashGuard - workDir Boundary (EDGE CASES)', () => {
  let guard: BashGuard;

  beforeEach(() => {
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: () => {},
      mode: { strict: true, warning: true },
    });
  });

  it('should block prefix attack /workspace/tx-core-evil/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cat /workspace/tx-core-evil/foo' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block traversal /workspace/tx-core/../../../etc/passwd', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cat /workspace/tx-core/../../../etc/passwd' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block home dir ~/evil.sh', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cat ~/evil.sh' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should approve curl with URL (not a file path)', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'curl https://example.com' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve curl redirect within workDir', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'curl https://example.com > /workspace/tx-core/out.txt' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should block curl redirect to /tmp/', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'curl https://example.com > /tmp/out' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should approve git push (no local path)', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'git push origin main' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve ssh (network, not file path)', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'ssh user@host' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });
});

describe('BashGuard - Catastrophic Denylist', () => {
  let guard: BashGuard;

  beforeEach(() => {
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: () => {},
      mode: { strict: true, warning: true },
    });
  });

  it('should block sudo apt install', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'sudo apt install foo' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
    assert.ok((result as any).reason.includes('sudo'));
  });

  it('should block su - root', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'su - root' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block rm -rf /', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'rm -rf /' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
    assert.ok((result as any).reason.includes('Root filesystem destruction'));
  });

  it('should block rm -rf /*', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'rm -rf /*' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block mkfs', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'mkfs /dev/sda' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block reboot', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'reboot' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block shutdown -h now', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'shutdown -h now' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block systemctl restart', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'systemctl restart nginx' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block kill -9 1', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'kill -9 1' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block crontab -e', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'crontab -e' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block docker run with host mount', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'docker run -v /:/host ubuntu' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });

  it('should block dd to /dev/sda', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'dd if=/dev/zero of=/dev/sda' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
  });
});

describe('BashGuard - Network Access (explicitly allowed)', () => {
  let guard: BashGuard;

  beforeEach(() => {
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: () => {},
      mode: { strict: true, warning: true },
    });
  });

  it('should approve curl https://api.example.com/data', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'curl https://api.example.com/data' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve wget https://example.com/file.zip', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'wget https://example.com/file.zip' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve ssh user@remote-server', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'ssh user@remote-server' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve nc localhost 8080', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'nc localhost 8080' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve git fetch origin', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'git fetch origin' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve npm publish', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'npm publish' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });
});

describe('BashGuard - Mode behavior', () => {
  it('should approve in warning mode (strict: false, warning: true)', async () => {
    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: () => {},
      mode: { strict: false, warning: true },
    });

    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cat /etc/hosts' } }, 'tool-1', {}) as HookJSONOutput;
    assert.equal(result.decision, 'approve');
    assert.ok(result.systemMessage);
    assert.ok(result.systemMessage!.includes('violates security policy'));
  });

  it('should approve silently in disabled mode (strict: false, warning: false)', async () => {
    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: () => {},
      mode: { strict: false, warning: false },
    });

    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cat /etc/hosts' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
    assert.equal((result as any).systemMessage, undefined);
  });

  it('should block silently in strict mode without warning (strict: true, warning: false)', async () => {
    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: () => {},
      mode: { strict: true, warning: false },
    });

    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: 'cat /etc/hosts' } }, 'tool-1', {});
    assert.equal(result.decision, 'block');
    assert.equal((result as any).reason, undefined);
  });
});

describe('BashGuard - Violation Counting + Kill Threshold', () => {
  it('should kill runner after 3 violations in strict mode', async () => {
    let killCalled = false;
    let killReason = '';

    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: (reason) => {
        killCalled = true;
        killReason = reason;
      },
      mode: { strict: true, warning: true },
    });

    const hook = guard.createHook();

    // First violation
    await hook.hooks[0]({ tool_input: { command: 'cat /etc/hosts' } }, 'tool-1', {});
    assert.equal(killCalled, false);

    // Second violation
    await hook.hooks[0]({ tool_input: { command: 'ls /tmp' } }, 'tool-2', {});
    assert.equal(killCalled, false);

    // Third violation — should trigger kill
    await hook.hooks[0]({ tool_input: { command: 'cat /etc/passwd' } }, 'tool-3', {});
    assert.equal(killCalled, true);
    assert.ok(killReason.includes('3 security violations'));
  });

  it('should not kill in warning mode (strict: false)', async () => {
    let killCalled = false;

    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: () => {
        killCalled = true;
      },
      mode: { strict: false, warning: true },
    });

    const hook = guard.createHook();

    // Multiple violations should not trigger kill in warning mode
    await hook.hooks[0]({ tool_input: { command: 'cat /etc/hosts' } }, 'tool-1', {});
    await hook.hooks[0]({ tool_input: { command: 'ls /tmp' } }, 'tool-2', {});
    await hook.hooks[0]({ tool_input: { command: 'cat /etc/passwd' } }, 'tool-3', {});
    await hook.hooks[0]({ tool_input: { command: 'rm -rf /tmp/x' } }, 'tool-4', {});

    assert.equal(killCalled, false);
  });

  it('should reset violation count', async () => {
    let killCalled = false;

    const guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: () => {
        killCalled = true;
      },
      mode: { strict: true, warning: true },
    });

    const hook = guard.createHook();

    // Two violations
    await hook.hooks[0]({ tool_input: { command: 'cat /etc/hosts' } }, 'tool-1', {});
    await hook.hooks[0]({ tool_input: { command: 'ls /tmp' } }, 'tool-2', {});

    // Reset
    guard.reset();

    // Two more violations after reset — should not kill
    await hook.hooks[0]({ tool_input: { command: 'cat /etc/passwd' } }, 'tool-3', {});
    await hook.hooks[0]({ tool_input: { command: 'rm -rf /tmp/x' } }, 'tool-4', {});

    assert.equal(killCalled, false);
  });
});

describe('BashGuard - Empty/null command handling', () => {
  let guard: BashGuard;

  beforeEach(() => {
    guard = new BashGuard({
      agentId: 'test/worker',
      workDir: '/workspace/tx-core',
      killRunner: () => {},
      mode: { strict: true, warning: true },
    });
  });

  it('should approve empty command', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: { command: '' } }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });

  it('should approve missing command field', async () => {
    const hook = guard.createHook();
    const result = await hook.hooks[0]({ tool_input: {} }, 'tool-1', {});
    assert.equal(result.decision, 'approve');
  });
});
