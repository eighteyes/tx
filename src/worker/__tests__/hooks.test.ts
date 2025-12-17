/**
 * LifecycleHooks tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LifecycleHooks, type HookContext } from '../hooks.ts';

describe('LifecycleHooks', () => {
  const testDir = path.join(process.cwd(), '.test-lifecycle-hooks');
  let hooks: LifecycleHooks;

  beforeEach(() => {
    // Create test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    // Initialize git repo
    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });

    // Create initial commit
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Test');
    execSync('git add .', { cwd: testDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: 'pipe' });

    hooks = new LifecycleHooks(testDir);
  });

  afterEach(() => {
    // Cleanup worktrees
    if (fs.existsSync(testDir)) {
      try {
        const worktreeManager = hooks.getWorktreeManager();
        const worktrees = worktreeManager.listWorktrees();
        for (const wt of worktrees) {
          try {
            worktreeManager.removeWorktree(wt.meshInstance, true);
          } catch {
            // Ignore errors during cleanup
          }
        }
      } catch {
        // Ignore errors
      }

      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should register built-in pre-hooks', () => {
    assert.ok(hooks.hasPreHook('worktree:create'), 'Should have worktree:create pre-hook');
  });

  it('should register built-in post-hooks', () => {
    assert.ok(hooks.hasPostHook('worktree:cleanup'), 'Should have worktree:cleanup post-hook');
    assert.ok(hooks.hasPostHook('commit:auto'), 'Should have commit:auto post-hook');
  });

  it('should add custom pre-hook', () => {
    let executed = false;
    hooks.addPreHook('custom:pre', () => {
      executed = true;
    });

    assert.ok(hooks.hasPreHook('custom:pre'), 'Should have custom pre-hook');
    assert.ok(hooks.listPreHooks().includes('custom:pre'), 'Should list custom pre-hook');
  });

  it('should add custom post-hook', () => {
    hooks.addPostHook('custom:post', () => {});

    assert.ok(hooks.hasPostHook('custom:post'), 'Should have custom post-hook');
    assert.ok(hooks.listPostHooks().includes('custom:post'), 'Should list custom post-hook');
  });

  it('should execute pre-hooks sequentially', async () => {
    const execOrder: number[] = [];

    hooks.addPreHook('first', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      execOrder.push(1);
    });

    hooks.addPreHook('second', () => {
      execOrder.push(2);
    });

    const context: HookContext = {
      meshInstance: 'test-mesh',
      meshName: 'test',
      agentName: 'agent',
      workDir: testDir,
    };

    await hooks.executePreHooks(['first', 'second'], context);

    assert.deepStrictEqual(execOrder, [1, 2], 'Hooks should execute in order');
  });

  it('should execute post-hooks sequentially', async () => {
    const execOrder: number[] = [];

    hooks.addPostHook('first', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      execOrder.push(1);
    });

    hooks.addPostHook('second', () => {
      execOrder.push(2);
    });

    const context: HookContext = {
      meshInstance: 'test-mesh',
      meshName: 'test',
      agentName: 'agent',
      workDir: testDir,
    };

    await hooks.executePostHooks(['first', 'second'], context);

    assert.deepStrictEqual(execOrder, [1, 2], 'Hooks should execute in order');
  });

  it('should throw error for failed pre-hook', async () => {
    hooks.addPreHook('failing', () => {
      throw new Error('Pre-hook error');
    });

    const context: HookContext = {
      meshInstance: 'test-mesh',
      meshName: 'test',
      agentName: 'agent',
      workDir: testDir,
    };

    await assert.rejects(
      () => hooks.executePreHooks(['failing'], context),
      /Pre-hook "failing" failed/,
      'Should throw error for failed pre-hook'
    );
  });

  it('should not throw error for failed post-hook', async () => {
    hooks.addPostHook('failing', () => {
      throw new Error('Post-hook error');
    });

    const context: HookContext = {
      meshInstance: 'test-mesh',
      meshName: 'test',
      agentName: 'agent',
      workDir: testDir,
    };

    // Should not throw
    await hooks.executePostHooks(['failing'], context);
  });

  it('should create worktree with worktree:create hook', async () => {
    const context: HookContext = {
      meshInstance: 'test-mesh',
      meshName: 'test',
      agentName: 'agent',
      workDir: testDir,
    };

    await hooks.executePreHooks(['worktree:create'], context);

    assert.ok(context.worktreePath, 'Should set worktreePath in context');
    assert.ok(fs.existsSync(context.worktreePath), 'Worktree should exist');

    // Cleanup
    const worktreeManager = hooks.getWorktreeManager();
    worktreeManager.removeWorktree(context.meshInstance, true);
  });

  it('should cleanup worktree with worktree:cleanup hook', async () => {
    const context: HookContext = {
      meshInstance: 'test-mesh',
      meshName: 'test',
      agentName: 'agent',
      workDir: testDir,
    };

    // Create worktree first
    await hooks.executePreHooks(['worktree:create'], context);
    const worktreePath = context.worktreePath;

    assert.ok(worktreePath && fs.existsSync(worktreePath), 'Worktree should exist');

    // Cleanup worktree
    await hooks.executePostHooks(['worktree:cleanup'], context);

    assert.ok(!fs.existsSync(worktreePath), 'Worktree should be removed');
  });

  it('should share context between hooks', async () => {
    hooks.addPreHook('set-value', (context) => {
      context.customValue = 'test-value';
    });

    hooks.addPreHook('read-value', (context) => {
      assert.strictEqual(context.customValue, 'test-value', 'Should read value set by previous hook');
    });

    const context: HookContext = {
      meshInstance: 'test-mesh',
      meshName: 'test',
      agentName: 'agent',
      workDir: testDir,
    };

    await hooks.executePreHooks(['set-value', 'read-value'], context);
  });

  it('should warn for unknown hooks', async () => {
    const context: HookContext = {
      meshInstance: 'test-mesh',
      meshName: 'test',
      agentName: 'agent',
      workDir: testDir,
    };

    // Should not throw, just warn
    await hooks.executePreHooks(['unknown:hook'], context);
  });

  it('should overwrite hook when registered twice', () => {
    let value = 1;

    hooks.addPreHook('test', () => {
      value = 1;
    });

    hooks.addPreHook('test', () => {
      value = 2;
    });

    assert.ok(hooks.hasPreHook('test'), 'Hook should still be registered');
  });

  it('should provide access to worktree manager', () => {
    const manager = hooks.getWorktreeManager();
    assert.ok(manager, 'Should return worktree manager');
  });

  it('should list all registered hooks', () => {
    hooks.addPreHook('custom-pre-1', () => {});
    hooks.addPreHook('custom-pre-2', () => {});
    hooks.addPostHook('custom-post-1', () => {});

    const preHooks = hooks.listPreHooks();
    const postHooks = hooks.listPostHooks();

    assert.ok(preHooks.includes('custom-pre-1'), 'Should list custom-pre-1');
    assert.ok(preHooks.includes('custom-pre-2'), 'Should list custom-pre-2');
    assert.ok(postHooks.includes('custom-post-1'), 'Should list custom-post-1');
  });
});
