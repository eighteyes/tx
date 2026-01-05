/**
 * WorktreeManager tests
 *
 * Tests feature-aware worktree management for isolated development.
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
            manager.removeWorktree(wt.featureName, true);
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

  it('should create a worktree for a feature', () => {
    const featureName = 'user-auth';
    const worktreePath = manager.createWorktree(featureName);

    assert.ok(worktreePath, 'Worktree path should be returned');
    assert.ok(fs.existsSync(worktreePath), 'Worktree directory should exist');
    assert.ok(worktreePath.endsWith(featureName), 'Path should end with feature name');
  });

  it('should list worktrees', () => {
    const feature1 = 'feature-one';
    const feature2 = 'feature-two';

    manager.createWorktree(feature1);
    manager.createWorktree(feature2);

    const worktrees = manager.listWorktrees();

    assert.ok(worktrees.length >= 2, 'Should have at least 2 worktrees');

    const wt1 = worktrees.find((w) => w.featureName === feature1);
    const wt2 = worktrees.find((w) => w.featureName === feature2);

    assert.ok(wt1, 'Should find feature-one worktree');
    assert.ok(wt2, 'Should find feature-two worktree');
    assert.ok(wt1.branch.includes(feature1), 'Branch should include feature name');
  });

  it('should get worktree path', () => {
    const featureName = 'test-feature';
    const createdPath = manager.createWorktree(featureName);
    const retrievedPath = manager.getWorktreePath(featureName);

    assert.strictEqual(retrievedPath, createdPath, 'Retrieved path should match created path');
  });

  it('should return undefined for non-existent worktree', () => {
    const path = manager.getWorktreePath('non-existent');
    assert.strictEqual(path, undefined, 'Should return undefined for non-existent worktree');
  });

  it('should remove a worktree', () => {
    const featureName = 'test-feature';
    const worktreePath = manager.createWorktree(featureName);

    assert.ok(fs.existsSync(worktreePath), 'Worktree should exist before removal');

    manager.removeWorktree(featureName);

    assert.ok(!fs.existsSync(worktreePath), 'Worktree should not exist after removal');
    assert.strictEqual(manager.getWorktreePath(featureName), undefined, 'Should not find worktree after removal');
  });

  it('should check if worktree exists', () => {
    const featureName = 'test-feature';

    assert.strictEqual(manager.hasWorktree(featureName), false, 'Should not have worktree initially');

    manager.createWorktree(featureName);

    assert.strictEqual(manager.hasWorktree(featureName), true, 'Should have worktree after creation');

    manager.removeWorktree(featureName);

    assert.strictEqual(manager.hasWorktree(featureName), false, 'Should not have worktree after removal');
  });

  it('should get worktree status as clean', () => {
    const featureName = 'test-feature';
    manager.createWorktree(featureName);

    const status = manager.getWorktreeStatus(featureName);
    assert.strictEqual(status, 'clean', 'New worktree should be clean');
  });

  it('should get worktree status as dirty when files are modified', () => {
    const featureName = 'test-feature';
    const worktreePath = manager.createWorktree(featureName);

    // Modify a file
    fs.writeFileSync(path.join(worktreePath, 'README.md'), '# Modified');

    const status = manager.getWorktreeStatus(featureName);
    assert.strictEqual(status, 'dirty', 'Worktree with modified files should be dirty');
  });

  it('should get worktree status as not-found for non-existent worktree', () => {
    const status = manager.getWorktreeStatus('non-existent');
    assert.strictEqual(status, 'not-found', 'Should return not-found for non-existent worktree');
  });

  it('should handle custom base path', () => {
    const customBasePath = path.join(testDir, 'custom-worktrees');
    const customManager = new WorktreeManager(testDir, { basePath: customBasePath });

    const featureName = 'test-feature';
    const worktreePath = customManager.createWorktree(featureName);

    assert.ok(worktreePath.includes('custom-worktrees'), 'Should use custom base path');
    assert.ok(fs.existsSync(worktreePath), 'Worktree should exist at custom path');

    // Cleanup
    customManager.removeWorktree(featureName, true);
  });

  it('should use feature/{name} branch convention', () => {
    const featureName = 'test-feature';
    manager.createWorktree(featureName);

    const worktrees = manager.listWorktrees();
    const worktree = worktrees.find((w) => w.featureName === featureName);

    assert.ok(worktree, 'Should find worktree');
    assert.strictEqual(worktree.branch, `feature/${featureName}`, 'Branch should follow feature/{name} convention');
    assert.strictEqual(manager.getBranchName(featureName), `feature/${featureName}`, 'getBranchName should return correct branch');

    // Cleanup
    manager.removeWorktree(featureName, true);
  });

  it('should reject invalid feature names', () => {
    // Feature names must be kebab-case
    assert.throws(
      () => manager.createWorktree('Invalid Name'),
      /Invalid feature name/,
      'Should reject names with spaces'
    );

    assert.throws(
      () => manager.createWorktree('UPPERCASE'),
      /Invalid feature name/,
      'Should reject uppercase names'
    );

    assert.throws(
      () => manager.createWorktree('with_underscore'),
      /Invalid feature name/,
      'Should reject names with underscores'
    );
  });

  it('should reuse existing worktree for same feature', () => {
    const featureName = 'test-feature';
    const firstPath = manager.createWorktree(featureName);
    const secondPath = manager.createWorktree(featureName);

    assert.strictEqual(firstPath, secondPath, 'Should return same path for existing worktree');

    // Cleanup
    manager.removeWorktree(featureName, true);
  });
});
