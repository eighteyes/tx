/**
 * WorktreeManager tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WorktreeManager } from '../worktree.ts';

describe('WorktreeManager', () => {
  const testDir = path.join(process.cwd(), '.test-worktree-manager');
  let manager: WorktreeManager;

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

    manager = new WorktreeManager(testDir);
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      // Remove all worktrees first
      try {
        const worktrees = manager.listWorktrees();
        for (const wt of worktrees) {
          try {
            manager.removeWorktree(wt.meshInstance, true);
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

  it('should create a worktree', () => {
    const meshInstance = 'test-mesh';
    const worktreePath = manager.createWorktree(meshInstance);

    assert.ok(worktreePath, 'Worktree path should be returned');
    assert.ok(fs.existsSync(worktreePath), 'Worktree directory should exist');
    assert.ok(worktreePath.includes(meshInstance), 'Path should include mesh instance name');
  });

  it('should list worktrees', () => {
    const meshInstance1 = 'mesh-1';
    const meshInstance2 = 'mesh-2';

    manager.createWorktree(meshInstance1);
    manager.createWorktree(meshInstance2);

    const worktrees = manager.listWorktrees();

    assert.ok(worktrees.length >= 2, 'Should have at least 2 worktrees');

    const mesh1Worktree = worktrees.find((w) => w.meshInstance === meshInstance1);
    const mesh2Worktree = worktrees.find((w) => w.meshInstance === meshInstance2);

    assert.ok(mesh1Worktree, 'Should find mesh-1 worktree');
    assert.ok(mesh2Worktree, 'Should find mesh-2 worktree');
    assert.ok(mesh1Worktree.branch.includes(meshInstance1), 'Branch should include mesh instance');
  });

  it('should get worktree path', () => {
    const meshInstance = 'test-mesh';
    const createdPath = manager.createWorktree(meshInstance);
    const retrievedPath = manager.getWorktreePath(meshInstance);

    assert.strictEqual(retrievedPath, createdPath, 'Retrieved path should match created path');
  });

  it('should return undefined for non-existent worktree', () => {
    const path = manager.getWorktreePath('non-existent');
    assert.strictEqual(path, undefined, 'Should return undefined for non-existent worktree');
  });

  it('should remove a worktree', () => {
    const meshInstance = 'test-mesh';
    const worktreePath = manager.createWorktree(meshInstance);

    assert.ok(fs.existsSync(worktreePath), 'Worktree should exist before removal');

    manager.removeWorktree(meshInstance);

    assert.ok(!fs.existsSync(worktreePath), 'Worktree should not exist after removal');
    assert.strictEqual(manager.getWorktreePath(meshInstance), undefined, 'Should not find worktree after removal');
  });

  it('should check if worktree exists', () => {
    const meshInstance = 'test-mesh';

    assert.strictEqual(manager.hasWorktree(meshInstance), false, 'Should not have worktree initially');

    manager.createWorktree(meshInstance);

    assert.strictEqual(manager.hasWorktree(meshInstance), true, 'Should have worktree after creation');

    manager.removeWorktree(meshInstance);

    assert.strictEqual(manager.hasWorktree(meshInstance), false, 'Should not have worktree after removal');
  });

  it('should get worktree status as clean', () => {
    const meshInstance = 'test-mesh';
    manager.createWorktree(meshInstance);

    const status = manager.getWorktreeStatus(meshInstance);
    assert.strictEqual(status, 'clean', 'New worktree should be clean');
  });

  it('should get worktree status as dirty when files are modified', () => {
    const meshInstance = 'test-mesh';
    const worktreePath = manager.createWorktree(meshInstance);

    // Modify a file
    fs.writeFileSync(path.join(worktreePath, 'README.md'), '# Modified');

    const status = manager.getWorktreeStatus(meshInstance);
    assert.strictEqual(status, 'dirty', 'Worktree with modified files should be dirty');
  });

  it('should get worktree status as not-found for non-existent worktree', () => {
    const status = manager.getWorktreeStatus('non-existent');
    assert.strictEqual(status, 'not-found', 'Should return not-found for non-existent worktree');
  });

  it('should handle custom base path', () => {
    const customBasePath = path.join(testDir, 'custom-worktrees');
    const customManager = new WorktreeManager(testDir, { basePath: customBasePath });

    const meshInstance = 'test-mesh';
    const worktreePath = customManager.createWorktree(meshInstance);

    assert.ok(worktreePath.includes('custom-worktrees'), 'Should use custom base path');
    assert.ok(fs.existsSync(worktreePath), 'Worktree should exist at custom path');

    // Cleanup
    customManager.removeWorktree(meshInstance, true);
  });

  it('should handle custom branch prefix', () => {
    const customManager = new WorktreeManager(testDir, { branchPrefix: 'custom-prefix' });

    const meshInstance = 'test-mesh';
    customManager.createWorktree(meshInstance);

    const worktrees = customManager.listWorktrees();
    const worktree = worktrees.find((w) => w.meshInstance === meshInstance);

    assert.ok(worktree?.branch.startsWith('custom-prefix'), 'Should use custom branch prefix');

    // Cleanup
    customManager.removeWorktree(meshInstance, true);
  });
});
