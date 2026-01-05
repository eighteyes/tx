/**
 * Worktree Integration Test
 *
 * Tests the full worktree workflow with hooks and feature-aware naming.
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
            worktreeManager.removeWorktree(wt.featureName, true);
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
    const featureName = 'user-auth';
    const context: HookContext = {
      meshInstance: 'dev-worker-123',
      meshName: 'dev',
      agentName: 'worker',
      workDir: testDir,
      featureName,
    };

    // Execute pre-hooks (simulating dispatcher behavior)
    await hooks.executePreHooks(['worktree:create'], context);

    // Verify worktree was created
    assert.ok(context.worktreePath, 'Worktree path should be set in context');
    assert.ok(fs.existsSync(context.worktreePath), 'Worktree directory should exist');

    // Verify worktree path ends with feature name
    assert.ok(context.worktreePath.endsWith(featureName), 'Worktree path should end with feature name');

    // Verify branch name follows convention
    assert.strictEqual(context.worktreeBranch, `feature/${featureName}`, 'Branch should follow feature/{name} convention');

    // Verify worktree has correct files
    const readmePath = path.join(context.worktreePath, 'README.md');
    assert.ok(fs.existsSync(readmePath), 'Worktree should have README.md');

    // Verify we can make changes in worktree without affecting main
    fs.writeFileSync(readmePath, '# Modified in Worktree');
    const mainReadme = fs.readFileSync(path.join(testDir, 'README.md'), 'utf-8');
    assert.strictEqual(mainReadme, '# Test Project', 'Main working directory should be unaffected');

    // Cleanup
    worktreeManager.removeWorktree(featureName, true);
  });

  it('should execute full workflow - worktree persists for review', async () => {
    const featureName = 'api-endpoints';
    const context: HookContext = {
      meshInstance: 'dev-worker-123',
      meshName: 'dev',
      agentName: 'worker',
      workDir: testDir,
      featureName,
    };

    // Pre-hooks: Create worktree
    await hooks.executePreHooks(['worktree:create'], context);
    const worktreePath = context.worktreePath;
    assert.ok(worktreePath && fs.existsSync(worktreePath), 'Worktree should exist');

    // Simulate mesh work: Make changes in worktree
    fs.writeFileSync(path.join(worktreePath, 'new-file.txt'), 'Created by mesh');

    // Post-hooks: commit:auto runs, but NO automatic cleanup
    // (worktree:cleanup removed - cleanup happens via /know:done)

    // Worktree should STILL exist for user review
    assert.ok(fs.existsSync(worktreePath), 'Worktree should persist for review');
    assert.strictEqual(worktreeManager.hasWorktree(featureName), true, 'Worktree should still exist');

    // Manual cleanup (simulating /know:done)
    worktreeManager.removeWorktree(featureName, true);
    assert.ok(!fs.existsSync(worktreePath), 'Worktree should be cleaned up after manual removal');
  });

  it('should handle multiple concurrent worktrees for different features', async () => {
    const feature1 = 'auth-system';
    const feature2 = 'ui-components';

    const context1: HookContext = {
      meshInstance: 'dev-worker-1',
      meshName: 'dev',
      agentName: 'worker1',
      workDir: testDir,
      featureName: feature1,
    };

    const context2: HookContext = {
      meshInstance: 'dev-worker-2',
      meshName: 'dev',
      agentName: 'worker2',
      workDir: testDir,
      featureName: feature2,
    };

    // Create two worktrees
    await hooks.executePreHooks(['worktree:create'], context1);
    await hooks.executePreHooks(['worktree:create'], context2);

    assert.ok(context1.worktreePath, 'Worktree 1 should be created');
    assert.ok(context2.worktreePath, 'Worktree 2 should be created');
    assert.notStrictEqual(context1.worktreePath, context2.worktreePath, 'Worktrees should have different paths');

    // Verify feature-based naming
    assert.ok(context1.worktreePath.endsWith(feature1), 'Worktree 1 path should match feature');
    assert.ok(context2.worktreePath.endsWith(feature2), 'Worktree 2 path should match feature');

    // Make different changes in each
    fs.writeFileSync(path.join(context1.worktreePath, 'auth.txt'), 'Auth feature');
    fs.writeFileSync(path.join(context2.worktreePath, 'ui.txt'), 'UI feature');

    // Verify isolation
    assert.ok(fs.existsSync(path.join(context1.worktreePath, 'auth.txt')), 'Auth file in worktree 1');
    assert.ok(!fs.existsSync(path.join(context1.worktreePath, 'ui.txt')), 'No UI file in worktree 1');
    assert.ok(fs.existsSync(path.join(context2.worktreePath, 'ui.txt')), 'UI file in worktree 2');
    assert.ok(!fs.existsSync(path.join(context2.worktreePath, 'auth.txt')), 'No auth file in worktree 2');

    // Cleanup
    worktreeManager.removeWorktree(feature1, true);
    worktreeManager.removeWorktree(feature2, true);
  });

  it('should handle worktree with uncommitted changes', async () => {
    const featureName = 'dirty-feature';
    const context: HookContext = {
      meshInstance: 'dev-worker-123',
      meshName: 'dev',
      agentName: 'worker',
      workDir: testDir,
      featureName,
    };

    // Create worktree
    await hooks.executePreHooks(['worktree:create'], context);
    const worktreePath = context.worktreePath!;

    // Make uncommitted changes
    fs.writeFileSync(path.join(worktreePath, 'changes.txt'), 'Uncommitted work');

    // Check status
    const status = worktreeManager.getWorktreeStatus(featureName);
    assert.strictEqual(status, 'dirty', 'Worktree should be dirty');

    // Force cleanup via manual removal (simulating /know:done with force)
    worktreeManager.removeWorktree(featureName, true);

    assert.ok(!fs.existsSync(worktreePath), 'Worktree should be removed even with uncommitted changes');
  });

  it('should execute pre and post hooks in sequence', async () => {
    const executionLog: string[] = [];

    // Add custom hooks that log execution
    hooks.addPreHook('log:start', () => {
      executionLog.push('pre:start');
    });

    hooks.addPostHook('log:end', () => {
      executionLog.push('post:end');
    });

    const featureName = 'sequence-test';
    const context: HookContext = {
      meshInstance: 'dev-worker-123',
      meshName: 'dev',
      agentName: 'worker',
      workDir: testDir,
      featureName,
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
    worktreeManager.removeWorktree(featureName, true);
  });

  it('should fail if featureName is missing for worktree hook', async () => {
    const context: HookContext = {
      meshInstance: 'dev-worker-123',
      meshName: 'dev',
      agentName: 'worker',
      workDir: testDir,
      // No featureName!
    };

    // Pre-hook should throw because featureName is required
    await assert.rejects(
      () => hooks.executePreHooks(['worktree:create'], context),
      /Worktree requires feature:/,
      'Should throw when featureName is missing'
    );

    // Worktree should not be created
    assert.strictEqual(context.worktreePath, undefined, 'Worktree should not be created');
  });

  it('should fail worker spawn if pre-hook fails before worktree', async () => {
    // Add a failing pre-hook
    hooks.addPreHook('fail:validation', () => {
      throw new Error('Validation failed');
    });

    const featureName = 'fail-test';
    const context: HookContext = {
      meshInstance: 'dev-worker-123',
      meshName: 'dev',
      agentName: 'worker',
      workDir: testDir,
      featureName,
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

    const featureName = 'post-fail-test';
    const context: HookContext = {
      meshInstance: 'dev-worker-123',
      meshName: 'dev',
      agentName: 'worker',
      workDir: testDir,
      featureName,
    };

    // Create worktree
    await hooks.executePreHooks(['worktree:create'], context);
    assert.ok(context.worktreePath, 'Worktree should be created');

    // Post-hook should not throw (errors are logged but swallowed)
    await hooks.executePostHooks(['fail:notification'], context);

    // Worktree should still exist
    assert.ok(fs.existsSync(context.worktreePath), 'Worktree should persist despite post-hook failure');

    // Cleanup
    worktreeManager.removeWorktree(featureName, true);
  });

  it('should reuse existing worktree for same feature', async () => {
    const featureName = 'reuse-test';
    const context1: HookContext = {
      meshInstance: 'dev-worker-1',
      meshName: 'dev',
      agentName: 'worker',
      workDir: testDir,
      featureName,
    };

    const context2: HookContext = {
      meshInstance: 'dev-worker-2',
      meshName: 'dev',
      agentName: 'worker',
      workDir: testDir,
      featureName, // Same feature!
    };

    // Create first worktree
    await hooks.executePreHooks(['worktree:create'], context1);
    const firstPath = context1.worktreePath;

    // "Create" second worktree - should reuse
    await hooks.executePreHooks(['worktree:create'], context2);
    const secondPath = context2.worktreePath;

    assert.strictEqual(firstPath, secondPath, 'Should reuse existing worktree for same feature');

    // Cleanup
    worktreeManager.removeWorktree(featureName, true);
  });
});
