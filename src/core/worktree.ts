/**
 * WorktreeManager - Git worktree lifecycle management for feature isolation
 *
 * Creates feature-named worktrees that integrate with /know:done workflow.
 * Naming: .ai/worktrees/{feature-name} with branch feature/{feature-name}
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { log } from '../shared/logger.ts';

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  featureName: string;
}

export interface WorktreeOptions {
  basePath?: string;  // Base directory for worktrees (default: .ai/worktrees)
}

export class WorktreeManager {
  private workDir: string;
  private basePath: string;

  constructor(workDir: string, options: WorktreeOptions = {}) {
    this.workDir = workDir;
    this.basePath = options.basePath || path.join(workDir, '.ai', 'worktrees');

    // Ensure base path exists
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Create a git worktree for a feature
   * @param featureName Feature name (e.g., "user-authentication")
   * @returns Absolute path to the worktree
   */
  createWorktree(featureName: string): string {
    // Validate feature name (kebab-case, no special chars)
    if (!/^[a-z0-9-]+$/.test(featureName)) {
      throw new Error(`Invalid feature name: "${featureName}". Use kebab-case (e.g., "user-auth")`);
    }

    // Check if we're already running inside a worktree
    if (this.isInWorktree(this.workDir)) {
      throw new Error('Cannot create worktree: already running inside a worktree');
    }

    const branchName = `feature/${featureName}`;
    const worktreePath = path.join(this.basePath, featureName);

    // Check if worktree already exists
    if (fs.existsSync(worktreePath)) {
      log.info('worktree', `Worktree already exists for ${featureName}, reusing`, {
        path: worktreePath,
      });
      // Ensure symlinks exist (may be missing from older worktrees)
      this.symlinkSharedDirs(worktreePath);
      return worktreePath;
    }

    try {
      // Check if we're in a git repository
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: this.workDir,
        stdio: 'pipe',
      });

      // Check if HEAD exists (repo has commits)
      try {
        execSync('git rev-parse HEAD', {
          cwd: this.workDir,
          stdio: 'pipe',
        });
      } catch {
        log.error('worktree', `Cannot create worktree: repository has no commits`, {
          featureName,
          hint: 'Make an initial commit before using worktrees',
        });
        throw new Error('Cannot create worktree: repository has no commits');
      }

      // Check if branch already exists
      let branchExists = false;
      try {
        execSync(`git rev-parse --verify ${branchName}`, {
          cwd: this.workDir,
          stdio: 'pipe',
        });
        branchExists = true;
      } catch {
        // Branch doesn't exist, we'll create it
      }

      // Create worktree (with existing or new branch)
      if (branchExists) {
        execSync(`git worktree add "${worktreePath}" ${branchName}`, {
          cwd: this.workDir,
          stdio: 'pipe',
        });
      } else {
        execSync(`git worktree add "${worktreePath}" -b ${branchName}`, {
          cwd: this.workDir,
          stdio: 'pipe',
        });
      }

      log.info('worktree', `Created worktree for feature: ${featureName}`, {
        path: worktreePath,
        branch: branchName,
      });

      // Symlink shared directories into worktree so agents can access
      // spec-graph, feature docs, and runtime state from worktree CWD
      this.symlinkSharedDirs(worktreePath);

      return worktreePath;
    } catch (error) {
      const errorMsg = (error as Error).message;
      log.error('worktree', `Failed to create worktree for ${featureName}`, {
        error: errorMsg,
      });
      throw new Error(`Failed to create worktree: ${errorMsg}`);
    }
  }

  /**
   * Symlink shared directories from main repo into worktree.
   * Agents running in worktrees need access to spec-graph, feature docs,
   * and tx runtime state which live in the main repo's .ai/ directory.
   */
  private symlinkSharedDirs(worktreePath: string): void {
    const sharedDirs = [
      '.ai/know',     // Spec-graph, feature docs, generated specs
      '.ai/tx',       // Runtime state, messages, sessions, logs
      '.ai/output',   // Workspace output (shared across agents)
    ];

    const worktreeAiDir = path.join(worktreePath, '.ai');
    if (!fs.existsSync(worktreeAiDir)) {
      fs.mkdirSync(worktreeAiDir, { recursive: true });
    }

    for (const dir of sharedDirs) {
      const sourcePath = path.join(this.workDir, dir);
      const targetPath = path.join(worktreePath, dir);

      // Skip if source doesn't exist
      if (!fs.existsSync(sourcePath)) continue;

      // If target exists as a real directory (not symlink), replace it.
      // Stale real directories from pre-symlink worktrees cause message routing failures.
      if (fs.existsSync(targetPath)) {
        const stats = fs.lstatSync(targetPath);
        if (stats.isSymbolicLink()) continue;  // Already symlinked — skip
        // Real directory exists — remove and replace with symlink
        log.info('worktree', `Replacing real directory with symlink: ${dir}`, {
          target: targetPath, source: sourcePath,
        });
        fs.rmSync(targetPath, { recursive: true });
      }

      try {
        fs.symlinkSync(sourcePath, targetPath, 'dir');
        log.debug('worktree', `Symlinked ${dir} into worktree`, {
          source: sourcePath,
          target: targetPath,
        });
      } catch (error) {
        log.warn('worktree', `Failed to symlink ${dir} into worktree`, {
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Remove a git worktree by feature name
   * @param featureName Feature name
   * @param force Force removal even if worktree has uncommitted changes
   */
  removeWorktree(featureName: string, force = false): void {
    const worktreePath = path.join(this.basePath, featureName);

    if (!fs.existsSync(worktreePath)) {
      log.warn('worktree', `No worktree found for ${featureName}`);
      return;
    }

    try {
      const forceFlag = force ? '--force' : '';
      execSync(`git worktree remove "${worktreePath}" ${forceFlag}`, {
        cwd: this.workDir,
        stdio: 'pipe',
      });

      log.info('worktree', `Removed worktree for ${featureName}`, {
        path: worktreePath,
      });
    } catch (error) {
      const errorMsg = (error as Error).message;
      log.error('worktree', `Failed to remove worktree for ${featureName}`, {
        error: errorMsg,
      });
      throw new Error(`Failed to remove worktree: ${errorMsg}`);
    }
  }

  /**
   * Get the path to a worktree by feature name
   * @param featureName Feature name
   * @returns Worktree path or undefined if not found
   */
  getWorktreePath(featureName: string): string | undefined {
    const worktreePath = path.join(this.basePath, featureName);
    return fs.existsSync(worktreePath) ? worktreePath : undefined;
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

        // Only include TX-managed worktrees (in our basePath)
        if (worktreePath.startsWith(this.basePath)) {
          currentWorktree.path = worktreePath;
          // Extract feature name from path (last segment)
          currentWorktree.featureName = path.basename(worktreePath);
        }
      } else if (line.startsWith('HEAD ')) {
        currentWorktree.head = line.substring('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        const branch = line.substring('branch '.length);
        currentWorktree.branch = branch.replace('refs/heads/', '');
      } else if (line === '') {
        // End of worktree entry
        if (currentWorktree.path && currentWorktree.featureName) {
          worktrees.push(currentWorktree as WorktreeInfo);
        }
        currentWorktree = {};
      }
    }

    // Handle last entry if output doesn't end with blank line
    if (currentWorktree.path && currentWorktree.featureName) {
      worktrees.push(currentWorktree as WorktreeInfo);
    }

    return worktrees;
  }

  /**
   * Check if a worktree exists for a feature
   */
  hasWorktree(featureName: string): boolean {
    return this.getWorktreePath(featureName) !== undefined;
  }

  /**
   * Check if a directory is inside a git worktree
   */
  private isInWorktree(dir: string): boolean {
    try {
      const gitDir = execSync('git rev-parse --git-dir', {
        cwd: dir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      const gitPath = path.isAbsolute(gitDir) ? gitDir : path.join(dir, gitDir);

      if (fs.existsSync(gitPath)) {
        const stats = fs.statSync(gitPath);
        // If .git is a file (not directory), we're in a worktree
        if (stats.isFile()) {
          return true;
        }
      }

      return gitDir.includes('worktrees');
    } catch {
      return false;
    }
  }

  /**
   * Get worktree status (clean, dirty, conflicts)
   */
  getWorktreeStatus(featureName: string): 'clean' | 'dirty' | 'conflicts' | 'not-found' {
    const worktreePath = this.getWorktreePath(featureName);
    if (!worktreePath) return 'not-found';

    try {
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

  /**
   * Get the branch name for a feature
   */
  getBranchName(featureName: string): string {
    return `feature/${featureName}`;
  }
}
