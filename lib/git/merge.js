const { execSync, spawnSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { ConflictResolver } = require('./conflict-resolver');

/**
 * Git merge management
 * Provides operations for merge workflows with status tracking and AI-assisted resolution
 */
class Merge {
  /**
   * Execute merge command
   * @param {string} command - Command to execute (start, status, conflicts, resolve, abort)
   * @param {Array} args - Command arguments
   * @returns {Object|null} Result object or null
   */
  static async execute(command, args = []) {
    switch (command) {
      case 'start':
        return await this.start(args);
      case 'status':
        return await this.status(args);
      case 'conflicts':
        return await this.conflicts(args);
      case 'resolve':
        return await this.resolve(args);
      case 'abort':
        return await this.abort();
      default:
        throw new Error(`Unknown merge command: ${command}`);
    }
  }

  /**
   * Start a merge operation
   * @param {Array} args - [branch]
   * @returns {Object} Merge result
   */
  static async start(args) {
    if (args.length === 0) {
      throw new Error('Usage: tx tool merge start <branch>');
    }

    const branch = args[0];

    // Validate we're in a git repo
    try {
      execSync('git rev-parse --git-dir', { stdio: 'pipe' });
    } catch (error) {
      throw new Error('Not in a git repository');
    }

    // Check if already in merge state
    const repoRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8'
    }).trim();
    const mergeHeadPath = path.join(repoRoot, '.git', 'MERGE_HEAD');

    if (fs.existsSync(mergeHeadPath)) {
      throw new Error('Already in merge state. Resolve conflicts or abort first.');
    }

    // Get current branch
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8'
    }).trim();

    try {
      // Attempt merge
      execSync(`git merge ${branch}`, { stdio: 'pipe' });

      return {
        success: true,
        status: 'completed',
        currentBranch,
        mergedBranch: branch,
        conflicts: []
      };
    } catch (error) {
      // Merge has conflicts
      const conflicts = await this._getConflicts();

      return {
        success: false,
        status: 'conflicts',
        currentBranch,
        mergedBranch: branch,
        conflicts,
        message: `Merge has ${conflicts.length} conflict(s)`
      };
    }
  }

  /**
   * Get merge status
   * @param {Array} args - [--json]
   * @returns {Object} Merge status
   */
  static async status(args = []) {
    try {
      const repoRoot = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf8'
      }).trim();
      const mergeHeadPath = path.join(repoRoot, '.git', 'MERGE_HEAD');

      if (!fs.existsSync(mergeHeadPath)) {
        return {
          success: true,
          status: 'none',
          message: 'No merge in progress'
        };
      }

      // Get merge head commit
      const mergeHead = fs.readFileSync(mergeHeadPath, 'utf8').trim();

      // Get current branch
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf8'
      }).trim();

      // Get conflicts
      const conflicts = await this._getConflicts();

      return {
        success: true,
        status: conflicts.length > 0 ? 'conflicts' : 'in-progress',
        currentBranch,
        mergeHead,
        conflicts,
        conflictCount: conflicts.length
      };
    } catch (error) {
      throw new Error(`Failed to get merge status: ${error.message}`);
    }
  }

  /**
   * List merge conflicts
   * @param {Array} args - [--json]
   * @returns {Object} Conflicts list
   */
  static async conflicts(args = []) {
    try {
      const conflicts = await this._getConflicts();

      return {
        success: true,
        conflicts,
        count: conflicts.length
      };
    } catch (error) {
      throw new Error(`Failed to get conflicts: ${error.message}`);
    }
  }

  /**
   * Resolve a conflict
   * @param {Array} args - [file, --strategy=ours|theirs|ai]
   * @returns {Object} Resolution result
   */
  static async resolve(args) {
    if (args.length === 0) {
      throw new Error('Usage: tx tool merge resolve <file> [--strategy=ours|theirs|ai]');
    }

    const file = args[0];
    let strategy = 'ai'; // default

    // Parse --strategy option
    for (const arg of args) {
      if (arg.startsWith('--strategy=')) {
        strategy = arg.split('=')[1];
      }
    }

    if (!['ours', 'theirs', 'ai'].includes(strategy)) {
      throw new Error(`Invalid strategy: ${strategy}. Use ours, theirs, or ai`);
    }

    // Check if file exists and has conflicts
    if (!fs.existsSync(file)) {
      throw new Error(`File not found: ${file}`);
    }

    try {
      if (strategy === 'ours') {
        execSync(`git checkout --ours ${file}`, { stdio: 'pipe' });
        execSync(`git add ${file}`, { stdio: 'pipe' });
        return {
          success: true,
          file,
          strategy: 'ours',
          message: `Resolved ${file} using ours strategy`
        };
      } else if (strategy === 'theirs') {
        execSync(`git checkout --theirs ${file}`, { stdio: 'pipe' });
        execSync(`git add ${file}`, { stdio: 'pipe' });
        return {
          success: true,
          file,
          strategy: 'theirs',
          message: `Resolved ${file} using theirs strategy`
        };
      } else {
        // AI strategy - use ConflictResolver for structured analysis
        const analysis = await ConflictResolver.analyzeConflicts(file);
        const prompt = await ConflictResolver.createResolutionPrompt(file);

        return {
          success: false,
          file,
          strategy: 'ai',
          message: 'AI resolution requires agent processing',
          analysis,
          prompt,
          instructions: 'Use the prompt to guide conflict resolution, then apply with ConflictResolver.applyResolution()'
        };
      }
    } catch (error) {
      throw new Error(`Failed to resolve conflict: ${error.message}`);
    }
  }

  /**
   * Abort merge operation
   * @returns {Object} Abort result
   */
  static async abort() {
    try {
      // Check if in merge state
      const repoRoot = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf8'
      }).trim();
      const mergeHeadPath = path.join(repoRoot, '.git', 'MERGE_HEAD');

      if (!fs.existsSync(mergeHeadPath)) {
        return {
          success: true,
          message: 'No merge in progress'
        };
      }

      execSync('git merge --abort', { stdio: 'pipe' });

      return {
        success: true,
        message: 'Merge aborted successfully'
      };
    } catch (error) {
      throw new Error(`Failed to abort merge: ${error.message}`);
    }
  }

  /**
   * Get list of conflicted files
   * @private
   */
  static async _getConflicts() {
    try {
      const output = execSync('git diff --name-only --diff-filter=U', {
        encoding: 'utf8'
      }).trim();

      if (!output) {
        return [];
      }

      const files = output.split('\n');
      const conflicts = [];

      for (const file of files) {
        if (!file) continue;

        const content = fs.readFileSync(file, 'utf8');
        const markers = this._extractConflictMarkers(content);

        conflicts.push({
          file,
          markerCount: markers.length,
          markers
        });
      }

      return conflicts;
    } catch (error) {
      return [];
    }
  }

  /**
   * Extract conflict markers from file content
   * @private
   */
  static _extractConflictMarkers(content) {
    const markers = [];
    const lines = content.split('\n');
    let inConflict = false;
    let currentConflict = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('<<<<<<<')) {
        inConflict = true;
        currentConflict = {
          start: i,
          ours: [],
          theirs: [],
          oursLabel: line.substring(8),
          theirsLabel: ''
        };
      } else if (line.startsWith('=======') && inConflict) {
        currentConflict.separator = i;
      } else if (line.startsWith('>>>>>>>') && inConflict) {
        currentConflict.end = i;
        currentConflict.theirsLabel = line.substring(8);
        inConflict = false;
        markers.push(currentConflict);
        currentConflict = null;
      } else if (inConflict && currentConflict) {
        if (currentConflict.separator === undefined) {
          currentConflict.ours.push(line);
        } else {
          currentConflict.theirs.push(line);
        }
      }
    }

    return markers;
  }
}

module.exports = { Merge };
