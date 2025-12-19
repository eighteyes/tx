/**
 * Worktree Integration Test
 * Tests the full worktree workflow with dispatcher and hooks
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LifecycleHooks, type HookContext } from '../hooks.ts';
import { WorktreeManager } from '../../core/worktree.ts';
import { MessageQueue } from '../../queue/index.ts';

describe('Worktree Integration', () => {
  const testDir = path.join(process.cwd(), '.test-worktree-integration');
  let hooks: LifecycleHooks;
  let worktreeManager: WorktreeManager;
  let queue: MessageQueue;

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
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Test Project');
    execSync('git add .', { cwd: testDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: 'pipe' });

    // Create test queue
    const dbPath = path.join(testDir, 'test-queue.db');
    queue = new MessageQueue(dbPath);

    hooks = new LifecycleHooks(testDir, queue);
    worktreeManager = hooks.getWorktreeManager();
  });

  afterEach(() => {
    // Close queue
    queue.close();

    // Cleanup worktrees
    if (fs.existsSync(testDir)) {
      try {
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

  it('should execute full pre-mesh workflow with worktree creation', async () => {
    const meshInstance = 'feature-dev-123456789';
    const context: HookContext = {
      meshInstance,
      meshName: 'feature-dev',
      agentName: 'worker',
      workDir: testDir,
    };

    // Execute pre-hooks (simulating dispatcher behavior)
    await hooks.executePreHooks(['worktree:create'], context);

    // Verify worktree was created
    assert.ok(context.worktreePath, 'Worktree path should be set in context');
    assert.ok(fs.existsSync(context.worktreePath), 'Worktree directory should exist');

    // Verify worktree is in correct location
    const expectedBasePath = path.join(testDir, '.ai', 'tx', 'worktrees');
    assert.ok(context.worktreePath.startsWith(expectedBasePath), 'Worktree should be in correct base path');

    // Verify worktree has correct files
    const readmePath = path.join(context.worktreePath, 'README.md');
    assert.ok(fs.existsSync(readmePath), 'Worktree should have README.md');

    // Verify we can make changes in worktree without affecting main
    fs.writeFileSync(readmePath, '# Modified in Worktree');
    const mainReadme = fs.readFileSync(path.join(testDir, 'README.md'), 'utf-8');
    assert.strictEqual(mainReadme, '# Test Project', 'Main working directory should be unaffected');

    // Cleanup
    worktreeManager.removeWorktree(meshInstance, true);
  });

  it('should execute full post-mesh workflow with notification', async () => {
    const meshInstance = 'feature-dev-123456789';
    const context: HookContext = {
      meshInstance,
      meshName: 'feature-dev',
      agentName: 'worker',
      workDir: testDir,
    };

    // Create worktree first
    await hooks.executePreHooks(['worktree:create'], context);
    assert.ok(context.worktreePath, 'Worktree should be created');

    // Worktree should persist for user review (no cleanup hook called)
    assert.ok(fs.existsSync(context.worktreePath), 'Worktree should persist for review');

    // Cleanup
    worktreeManager.removeWorktree(meshInstance, true);
  });

  it('should execute full workflow with cleanup', async () => {
    const meshInstance = 'feature-dev-123456789';
    const context: HookContext = {
      meshInstance,
      meshName: 'feature-dev',
      agentName: 'worker',
      workDir: testDir,
    };

    // Pre-hooks: Create worktree
    await hooks.executePreHooks(['worktree:create'], context);
    const worktreePath = context.worktreePath;
    assert.ok(worktreePath && fs.existsSync(worktreePath), 'Worktree should exist');

    // Simulate mesh work: Make changes in worktree
    fs.writeFileSync(path.join(worktreePath, 'new-file.txt'), 'Created by mesh');

    // Post-hooks: Cleanup worktree
    await hooks.executePostHooks(['worktree:cleanup'], context);

    // Worktree should be removed
    assert.ok(!fs.existsSync(worktreePath), 'Worktree should be cleaned up');
    assert.strictEqual(worktreeManager.hasWorktree(meshInstance), false, 'Worktree should not exist');
  });

  it('should handle multiple concurrent worktrees', async () => {
    const mesh1 = 'feature-auth';
    const mesh2 = 'feature-ui';

    const context1: HookContext = {
      meshInstance: mesh1,
      meshName: 'feature-dev',
      agentName: 'worker1',
      workDir: testDir,
    };

    const context2: HookContext = {
      meshInstance: mesh2,
      meshName: 'feature-dev',
      agentName: 'worker2',
      workDir: testDir,
    };

    // Create two worktrees
    await hooks.executePreHooks(['worktree:create'], context1);
    await hooks.executePreHooks(['worktree:create'], context2);

    assert.ok(context1.worktreePath, 'Worktree 1 should be created');
    assert.ok(context2.worktreePath, 'Worktree 2 should be created');
    assert.notStrictEqual(context1.worktreePath, context2.worktreePath, 'Worktrees should have different paths');

    // Make different changes in each
    fs.writeFileSync(path.join(context1.worktreePath, 'auth.txt'), 'Auth feature');
    fs.writeFileSync(path.join(context2.worktreePath, 'ui.txt'), 'UI feature');

    // Verify isolation
    assert.ok(fs.existsSync(path.join(context1.worktreePath, 'auth.txt')), 'Auth file in worktree 1');
    assert.ok(!fs.existsSync(path.join(context1.worktreePath, 'ui.txt')), 'No UI file in worktree 1');
    assert.ok(fs.existsSync(path.join(context2.worktreePath, 'ui.txt')), 'UI file in worktree 2');
    assert.ok(!fs.existsSync(path.join(context2.worktreePath, 'auth.txt')), 'No auth file in worktree 2');

    // Cleanup
    worktreeManager.removeWorktree(mesh1, true);
    worktreeManager.removeWorktree(mesh2, true);
  });

  it('should handle worktree with uncommitted changes', async () => {
    const meshInstance = 'feature-dev-123456789';
    const context: HookContext = {
      meshInstance,
      meshName: 'feature-dev',
      agentName: 'worker',
      workDir: testDir,
    };

    // Create worktree
    await hooks.executePreHooks(['worktree:create'], context);
    const worktreePath = context.worktreePath!;

    // Make uncommitted changes
    fs.writeFileSync(path.join(worktreePath, 'changes.txt'), 'Uncommitted work');

    // Check status
    const status = worktreeManager.getWorktreeStatus(meshInstance);
    assert.strictEqual(status, 'dirty', 'Worktree should be dirty');

    // Force cleanup should work even with uncommitted changes
    await hooks.executePostHooks(['worktree:cleanup'], context);

    assert.ok(!fs.existsSync(worktreePath), 'Worktree should be removed even with uncommitted changes');
  });

  it('should execute pre and post hooks in sequence', async () => {
    const executionLog: string[] = [];

    // Add custom hooks that log execution
    hooks.addPreHook('log:start', (context) => {
      executionLog.push('pre:start');
    });

    hooks.addPostHook('log:end', (context) => {
      executionLog.push('post:end');
    });

    const meshInstance = 'feature-dev-123456789';
    const context: HookContext = {
      meshInstance,
      meshName: 'feature-dev',
      agentName: 'worker',
      workDir: testDir,
    };

    // Execute pre-hooks
    await hooks.executePreHooks(['log:start', 'worktree:create'], context);
    assert.ok(executionLog.includes('pre:start'), 'Pre-hook should execute');
    assert.ok(context.worktreePath, 'Worktree should be created');

    // Simulate mesh work...
    executionLog.push('mesh:work');

    // Execute post-hooks
    await hooks.executePostHooks(['log:end'], context);
    assert.ok(executionLog.includes('post:end'), 'Post-hook should execute');

    assert.deepStrictEqual(
      executionLog,
      ['pre:start', 'mesh:work', 'post:end'],
      'Execution should follow correct sequence'
    );

    // Cleanup
    worktreeManager.removeWorktree(meshInstance, true);
  });

  it('should fail worker spawn if pre-hook fails', async () => {
    // Add a failing pre-hook
    hooks.addPreHook('fail:validation', () => {
      throw new Error('Validation failed');
    });

    const meshInstance = 'feature-dev-123456789';
    const context: HookContext = {
      meshInstance,
      meshName: 'feature-dev',
      agentName: 'worker',
      workDir: testDir,
    };

    // Pre-hook should throw and prevent worker spawn
    await assert.rejects(
      () => hooks.executePreHooks(['fail:validation', 'worktree:create'], context),
      /Validation failed/,
      'Should propagate pre-hook error'
    );

    // Worktree should not be created (hook failed before reaching worktree:create)
    assert.strictEqual(context.worktreePath, undefined, 'Worktree should not be created');
  });

  it('should continue after post-hook failure', async () => {
    // Add a failing post-hook
    hooks.addPostHook('fail:notification', () => {
      throw new Error('Notification failed');
    });

    const meshInstance = 'feature-dev-123456789';
    const context: HookContext = {
      meshInstance,
      meshName: 'feature-dev',
      agentName: 'worker',
      workDir: testDir,
    };

    // Create worktree
    await hooks.executePreHooks(['worktree:create'], context);
    assert.ok(context.worktreePath, 'Worktree should be created');

    // Post-hook should not throw (errors are logged but swallowed)
    await hooks.executePostHooks(['fail:notification'], context);

    // Worktree should still exist
    assert.ok(fs.existsSync(context.worktreePath), 'Worktree should persist despite post-hook failure');

    // Cleanup
    worktreeManager.removeWorktree(meshInstance, true);
  });
});
