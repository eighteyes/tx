const { Message } = require('../message');

/**
 * Git event logger
 * Logs git operations to the centralized event log
 */
class GitEventLogger {
  /**
   * Log worktree operation
   * @param {string} operation - Operation type (add, remove, prune)
   * @param {Object} result - Operation result
   * @param {Object} options - Logging options
   */
  static logWorktreeOperation(operation, result, options = {}) {
    const { from = 'user', to = 'user' } = options;

    const metadata = {
      from,
      to: to || from,
      type: 'git-worktree',
      status: result.success ? 'success' : 'error',
      operation,
      ...options
    };

    let task = '';
    let context = '';

    switch (operation) {
      case 'add':
        task = `Worktree created: ${result.branch}`;
        context = `Path: ${result.path}\n`;
        if (result.baseBranch) {
          context += `Base: ${result.baseBranch}\n`;
        }
        break;

      case 'remove':
        task = `Worktree removed: ${result.branch}`;
        context = `Path: ${result.path}\n`;
        if (result.forced) {
          context += `Force: true\n`;
        }
        break;

      case 'prune':
        task = 'Worktrees pruned';
        context = result.message;
        break;

      case 'list':
        task = 'Worktrees listed';
        context = `Count: ${result.worktrees.length}\n`;
        break;

      default:
        task = `Worktree operation: ${operation}`;
        context = JSON.stringify(result, null, 2);
    }

    return Message.send(to, task, context, metadata);
  }

  /**
   * Log merge operation
   * @param {string} operation - Operation type (start, status, conflicts, resolve, abort)
   * @param {Object} result - Operation result
   * @param {Object} options - Logging options
   */
  static logMergeOperation(operation, result, options = {}) {
    const { from = 'user', to = 'user' } = options;

    const metadata = {
      from,
      to: to || from,
      type: 'git-merge',
      status: result.success ? 'success' : (result.status || 'error'),
      operation,
      ...options
    };

    let task = '';
    let context = '';

    switch (operation) {
      case 'start':
        task = result.success
          ? `Merge completed: ${result.mergedBranch}`
          : `Merge started: ${result.mergedBranch}`;
        context = `Current branch: ${result.currentBranch}\n`;
        context += `Status: ${result.status}\n`;
        if (result.conflicts && result.conflicts.length > 0) {
          context += `Conflicts: ${result.conflicts.length}\n`;
        }
        break;

      case 'status':
        task = 'Merge status checked';
        context = `Status: ${result.status}\n`;
        if (result.mergeHead) {
          context += `Merge head: ${result.mergeHead}\n`;
        }
        if (result.conflictCount > 0) {
          context += `Conflicts: ${result.conflictCount}\n`;
        }
        break;

      case 'conflicts':
        task = 'Conflicts listed';
        context = `Count: ${result.count}\n`;
        if (result.conflicts.length > 0) {
          context += '\nFiles:\n';
          result.conflicts.forEach(c => {
            context += `- ${c.file} (${c.markerCount} markers)\n`;
          });
        }
        break;

      case 'resolve':
        task = result.success
          ? `Conflict resolved: ${result.file}`
          : `Conflict analysis: ${result.file}`;
        context = `Strategy: ${result.strategy}\n`;
        if (result.message) {
          context += `Message: ${result.message}\n`;
        }
        break;

      case 'abort':
        task = 'Merge aborted';
        context = result.message;
        break;

      default:
        task = `Merge operation: ${operation}`;
        context = JSON.stringify(result, null, 2);
    }

    return Message.send(to, task, context, metadata);
  }

  /**
   * Log conflict resolution event
   * @param {string} file - File with conflict
   * @param {Object} analysis - Conflict analysis
   * @param {Object} options - Logging options
   */
  static logConflictAnalysis(file, analysis, options = {}) {
    const { from = 'user', to = 'user' } = options;

    const metadata = {
      from,
      to: to || from,
      type: 'git-conflict',
      status: 'pending',
      file,
      ...options
    };

    const task = `Conflict analysis: ${file}`;
    let context = `Conflicts: ${analysis.conflictCount}\n`;
    context += `Type: ${analysis.fileInfo.extension}\n\n`;

    if (analysis.suggestion) {
      context += `Suggestions:\n${analysis.suggestion}\n\n`;
    }

    context += '## Conflicts\n\n';
    analysis.conflicts.forEach((c, i) => {
      context += `### Conflict ${i + 1}\n`;
      context += `Lines: ${c.lineStart}-${c.lineEnd}\n`;
      context += `Ours (${c.ours.label}): ${c.ours.content.length} lines\n`;
      context += `Theirs (${c.theirs.label}): ${c.theirs.content.length} lines\n\n`;
    });

    return Message.send(to, task, context, metadata);
  }
}

module.exports = { GitEventLogger };
