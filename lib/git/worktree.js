const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

/**
 * Git worktree management
 * Provides operations for creating, listing, removing, and managing worktrees
 */
class Worktree {
  /**
   * Execute worktree command
   * @param {string} command - Command to execute (add, list, remove, prune)
   * @param {Array} args - Command arguments
   * @returns {Object|null} Result object or null
   */
  static async execute(command, args = []) {
    switch (command) {
      case 'add':
        return await this.add(args);
      case 'list':
        return await this.list(args);
      case 'remove':
        return await this.remove(args);
      case 'prune':
        return await this.prune();
      default:
        throw new Error(`Unknown worktree command: ${command}`);
    }
  }

  /**
   * Add a new worktree
   * @param {Array} args - [branch, --base=baseBranch]
   * @returns {Object} Worktree info
   */
  static async add(args) {
    if (args.length === 0) {
      throw new Error('Usage: tx tool worktree add <branch> [--base=branch]');
    }

    const branch = args[0];
    let baseBranch = null;

    // Parse --base option
    for (const arg of args) {
      if (arg.startsWith('--base=')) {
        baseBranch = arg.split('=')[1];
      }
    }

    // Validate we're in a git repo
    try {
      execSync('git rev-parse --git-dir', { stdio: 'pipe' });
    } catch (error) {
      throw new Error('Not in a git repository');
    }

    // Get repo root
    const repoRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8'
    }).trim();

    // Create worktree path: ../repo-branch
    const repoName = path.basename(repoRoot);
    const worktreePath = path.join(path.dirname(repoRoot), `${repoName}-${branch}`);

    // Check if worktree already exists
    if (fs.existsSync(worktreePath)) {
      throw new Error(`Worktree already exists at: ${worktreePath}`);
    }

    // Build git worktree add command
    const gitCmd = baseBranch
      ? `git worktree add -b ${branch} ${worktreePath} ${baseBranch}`
      : `git worktree add ${worktreePath} ${branch}`;

    try {
      execSync(gitCmd, { stdio: 'pipe' });
    } catch (error) {
      // Try creating a new branch if it doesn't exist
      try {
        execSync(`git worktree add -b ${branch} ${worktreePath}`, { stdio: 'pipe' });
      } catch (retryError) {
        throw new Error(`Failed to create worktree: ${retryError.message}`);
      }
    }

    return {
      success: true,
      branch,
      path: worktreePath,
      baseBranch
    };
  }

  /**
   * List all worktrees
   * @param {Array} args - [--json]
   * @returns {Object} Worktrees list
   */
  static async list(args = []) {
    try {
      const output = execSync('git worktree list --porcelain', {
        encoding: 'utf8'
      });

      const worktrees = this._parseWorktreeList(output);
      return {
        success: true,
        worktrees
      };
    } catch (error) {
      throw new Error(`Failed to list worktrees: ${error.message}`);
    }
  }

  /**
   * Remove a worktree
   * @param {Array} args - [branch]
   * @returns {Object} Removal result
   */
  static async remove(args) {
    if (args.length === 0) {
      throw new Error('Usage: tx tool worktree remove <branch>');
    }

    const branch = args[0];

    // Get repo root
    const repoRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8'
    }).trim();

    const repoName = path.basename(repoRoot);
    const worktreePath = path.join(path.dirname(repoRoot), `${repoName}-${branch}`);

    // Check if worktree exists
    if (!fs.existsSync(worktreePath)) {
      throw new Error(`Worktree not found: ${worktreePath}`);
    }

    try {
      // Remove worktree
      execSync(`git worktree remove ${worktreePath}`, { stdio: 'pipe' });
      return {
        success: true,
        branch,
        path: worktreePath
      };
    } catch (error) {
      // Try force removal if regular removal fails
      try {
        execSync(`git worktree remove --force ${worktreePath}`, { stdio: 'pipe' });
        return {
          success: true,
          branch,
          path: worktreePath,
          forced: true
        };
      } catch (retryError) {
        throw new Error(`Failed to remove worktree: ${retryError.message}`);
      }
    }
  }

  /**
   * Prune stale worktrees
   * @returns {Object} Prune result
   */
  static async prune() {
    try {
      execSync('git worktree prune', { stdio: 'pipe' });
      return {
        success: true,
        message: 'Pruned stale worktrees'
      };
    } catch (error) {
      throw new Error(`Failed to prune worktrees: ${error.message}`);
    }
  }

  /**
   * Parse git worktree list --porcelain output
   * @private
   */
  static _parseWorktreeList(output) {
    const worktrees = [];
    const lines = output.split('\n');
    let current = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current);
        }
        current = { path: line.substring(9) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.substring(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7).replace('refs/heads/', '');
      } else if (line.startsWith('bare')) {
        current.bare = true;
      } else if (line === '') {
        if (current.path) {
          worktrees.push(current);
          current = {};
        }
      }
    }

    if (current.path) {
      worktrees.push(current);
    }

    return worktrees;
  }
}

module.exports = { Worktree };
