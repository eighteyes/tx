/**
 * WorktreeManager - Git worktree lifecycle management
 *
 * Handles creating, managing, and cleaning up git worktrees for isolated mesh execution.
 * Each worktree provides a separate working directory with its own branch.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { log } from '../shared/logger.ts';

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  meshInstance: string;
}

export interface WorktreeOptions {
  basePath?: string;  // Base directory for worktrees (default: .ai/tx/worktrees)
  branchPrefix?: string;  // Branch name prefix (default: tx-worktree)
}

export class WorktreeManager {
  private workDir: string;
  private basePath: string;
  private branchPrefix: string;

  constructor(workDir: string, options: WorktreeOptions = {}) {
    this.workDir = workDir;
    this.basePath = options.basePath || path.join(workDir, '.ai', 'tx', 'worktrees');
    this.branchPrefix = options.branchPrefix || 'tx-worktree';

    // Ensure base path exists
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Create a git worktree for a mesh instance
   * @param meshInstance Unique mesh instance ID (e.g., "feature-dev-1234567890")
   * @returns Absolute path to the worktree
   */
  createWorktree(meshInstance: string): string {
    // Check if we're already running inside a worktree
    if (this.isInWorktree(this.workDir)) {
      throw new Error('Cannot create worktree: already running inside a worktree');
    }

    const timestamp = Date.now();
    const uniqueSuffix = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    const branchName = `${this.branchPrefix}-${meshInstance}-${uniqueSuffix}`;
    const worktreePath = path.join(this.basePath, `${meshInstance}-${uniqueSuffix}`);

    try {
      // Check if we're in a git repository
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: this.workDir,
        stdio: 'pipe',
      });

      // Create worktree with new branch
      execSync(`git worktree add "${worktreePath}" -b ${branchName}`, {
        cwd: this.workDir,
        stdio: 'pipe',
      });

      log.info('worktree', `Created worktree for ${meshInstance}`, {
        path: worktreePath,
        branch: branchName,
      });

      return worktreePath;
    } catch (error) {
      const errorMsg = (error as Error).message;
      log.error('worktree', `Failed to create worktree for ${meshInstance}`, {
        error: errorMsg,
      });
      throw new Error(`Failed to create worktree: ${errorMsg}`);
    }
  }

  /**
   * Remove a git worktree
   * @param meshInstance Mesh instance ID
   * @param force Force removal even if worktree has uncommitted changes
   */
  removeWorktree(meshInstance: string, force = false): void {
    try {
      // Find worktree path by mesh instance
      const worktrees = this.listWorktrees();
      const target = worktrees.find((w) => w.meshInstance === meshInstance);

      if (!target) {
        log.warn('worktree', `No worktree found for ${meshInstance}`);
        return;
      }

      const forceFlag = force ? '--force' : '';
      execSync(`git worktree remove "${target.path}" ${forceFlag}`, {
        cwd: this.workDir,
        stdio: 'pipe',
      });

      log.info('worktree', `Removed worktree for ${meshInstance}`, {
        path: target.path,
      });
    } catch (error) {
      const errorMsg = (error as Error).message;
      log.error('worktree', `Failed to remove worktree for ${meshInstance}`, {
        error: errorMsg,
      });
      throw new Error(`Failed to remove worktree: ${errorMsg}`);
    }
  }

  /**
   * Get the path to a worktree without creating it
   * Returns the most recent worktree path for the mesh instance
   * @param meshInstance Mesh instance ID
   * @returns Worktree path or undefined if not found
   */
  getWorktreePath(meshInstance: string): string | undefined {
    const worktrees = this.listWorktrees();
    const target = worktrees.find((w) => w.meshInstance === meshInstance);
    return target?.path;
  }

  /**
   * List all active worktrees managed by TX
   * @returns Array of worktree information
   */
  listWorktrees(): WorktreeInfo[] {
    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: this.workDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      return this.parseWorktreeList(output);
    } catch (error) {
      log.error('worktree', 'Failed to list worktrees', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Parse git worktree list --porcelain output
   */
  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const lines = output.trim().split('\n');

    let currentWorktree: Partial<WorktreeInfo> = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const worktreePath = line.substring('worktree '.length);

        // Only include TX-managed worktrees
        if (worktreePath.includes(this.basePath)) {
          currentWorktree.path = worktreePath;
        }
      } else if (line.startsWith('HEAD ')) {
        currentWorktree.head = line.substring('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        const branch = line.substring('branch '.length);
        currentWorktree.branch = branch.replace('refs/heads/', '');

        // Extract mesh instance from branch name
        // Format: tx-worktree-{meshInstance}-{timestamp}-{random}
        const escapedPrefix = this.branchPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = branch.match(new RegExp(`${escapedPrefix}-(.+)-(\\d+-[a-z0-9]+)$`));
        if (match) {
          currentWorktree.meshInstance = match[1];
        }
      } else if (line === '') {
        // End of worktree entry
        if (currentWorktree.path && currentWorktree.meshInstance) {
          worktrees.push(currentWorktree as WorktreeInfo);
        }
        currentWorktree = {};
      }
    }

    // Handle last entry if file doesn't end with blank line
    if (currentWorktree.path && currentWorktree.meshInstance) {
      worktrees.push(currentWorktree as WorktreeInfo);
    }

    return worktrees;
  }

  /**
   * Check if a worktree exists for a mesh instance
   */
  hasWorktree(meshInstance: string): boolean {
    return this.getWorktreePath(meshInstance) !== undefined;
  }

  /**
   * Check if a directory is inside a git worktree
   * @param dir Directory to check
   * @returns true if inside a worktree, false otherwise
   */
  private isInWorktree(dir: string): boolean {
    try {
      const gitDir = execSync('git rev-parse --git-dir', {
        cwd: dir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      // If the .git directory is a file (not a directory), we're in a worktree
      // Worktrees have a .git file that points to the actual git directory
      const gitPath = path.isAbsolute(gitDir) ? gitDir : path.join(dir, gitDir);

      if (fs.existsSync(gitPath)) {
        const stats = fs.statSync(gitPath);
        // If .git is a file, we're in a worktree
        if (stats.isFile()) {
          return true;
        }
      }

      // Alternative check: use git rev-parse --is-inside-worktree
      // and check if gitdir contains "worktrees"
      return gitDir.includes('worktrees');
    } catch {
      // If git command fails, we're not in a worktree
      return false;
    }
  }

  /**
   * Get worktree status (clean, dirty, conflicts)
   */
  getWorktreeStatus(meshInstance: string): 'clean' | 'dirty' | 'conflicts' | 'not-found' {
    const worktreePath = this.getWorktreePath(meshInstance);
    if (!worktreePath) return 'not-found';

    try {
      // Check for uncommitted changes
      const status = execSync('git status --porcelain', {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      if (status.trim() === '') return 'clean';

      // Check for merge conflicts
      if (status.includes('UU ') || status.includes('AA ') || status.includes('DD ')) {
        return 'conflicts';
      }

      return 'dirty';
    } catch {
      return 'not-found';
    }
  }
}
