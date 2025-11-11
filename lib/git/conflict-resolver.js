const fs = require('fs-extra');
const { execSync } = require('child_process');

/**
 * AI-assisted conflict resolution helper
 * Provides structured conflict data for AI agents to process
 */
class ConflictResolver {
  /**
   * Get structured conflict data for AI processing
   * @param {string} file - File with conflicts
   * @returns {Object} Conflict analysis
   */
  static async analyzeConflicts(file) {
    if (!fs.existsSync(file)) {
      throw new Error(`File not found: ${file}`);
    }

    const content = fs.readFileSync(file, 'utf8');
    const conflicts = this._parseConflicts(content);
    const fileInfo = await this._getFileInfo(file);

    return {
      file,
      fileInfo,
      conflicts,
      conflictCount: conflicts.length,
      suggestion: this._generateSuggestion(conflicts, fileInfo)
    };
  }

  /**
   * Apply resolution to file
   * @param {string} file - File to resolve
   * @param {string} resolvedContent - Resolved content
   * @returns {Object} Resolution result
   */
  static async applyResolution(file, resolvedContent) {
    if (!fs.existsSync(file)) {
      throw new Error(`File not found: ${file}`);
    }

    // Backup original
    const backupPath = `${file}.conflict-backup`;
    fs.copyFileSync(file, backupPath);

    try {
      // Write resolved content
      fs.writeFileSync(file, resolvedContent);

      // Stage file
      execSync(`git add ${file}`, { stdio: 'pipe' });

      return {
        success: true,
        file,
        backupPath,
        message: 'Conflict resolved and staged'
      };
    } catch (error) {
      // Restore backup on error
      fs.copyFileSync(backupPath, file);
      throw new Error(`Failed to apply resolution: ${error.message}`);
    }
  }

  /**
   * Get all conflicted files with analysis
   * @returns {Array} List of conflicts with analysis
   */
  static async getAllConflicts() {
    try {
      const output = execSync('git diff --name-only --diff-filter=U', {
        encoding: 'utf8'
      }).trim();

      if (!output) {
        return [];
      }

      const files = output.split('\n').filter(f => f);
      const analyses = [];

      for (const file of files) {
        try {
          const analysis = await this.analyzeConflicts(file);
          analyses.push(analysis);
        } catch (error) {
          analyses.push({
            file,
            error: error.message
          });
        }
      }

      return analyses;
    } catch (error) {
      return [];
    }
  }

  /**
   * Parse conflict markers from content
   * @private
   */
  static _parseConflicts(content) {
    const conflicts = [];
    const lines = content.split('\n');
    let lineNum = 0;
    let inConflict = false;
    let currentConflict = null;

    for (const line of lines) {
      lineNum++;

      if (line.startsWith('<<<<<<<')) {
        inConflict = true;
        currentConflict = {
          lineStart: lineNum,
          ours: {
            label: line.substring(8).trim(),
            content: []
          },
          theirs: {
            label: '',
            content: []
          },
          context: {
            before: this._getContext(lines, lineNum - 1, -3),
            after: []
          }
        };
      } else if (line.startsWith('=======') && inConflict) {
        currentConflict.separator = lineNum;
      } else if (line.startsWith('>>>>>>>') && inConflict) {
        currentConflict.theirs.label = line.substring(8).trim();
        currentConflict.lineEnd = lineNum;
        currentConflict.context.after = this._getContext(lines, lineNum, 3);
        inConflict = false;
        conflicts.push(currentConflict);
        currentConflict = null;
      } else if (inConflict && currentConflict) {
        if (currentConflict.separator === undefined) {
          currentConflict.ours.content.push(line);
        } else {
          currentConflict.theirs.content.push(line);
        }
      }
    }

    return conflicts;
  }

  /**
   * Get context lines around conflict
   * @private
   */
  static _getContext(lines, startIdx, count) {
    const context = [];
    const step = count > 0 ? 1 : -1;
    const limit = Math.abs(count);

    for (let i = 0; i < limit; i++) {
      const idx = startIdx + (i * step);
      if (idx >= 0 && idx < lines.length) {
        context.push({
          line: idx + 1,
          content: lines[idx]
        });
      }
    }

    return step < 0 ? context.reverse() : context;
  }

  /**
   * Get file information for context
   * @private
   */
  static async _getFileInfo(file) {
    const info = {
      path: file,
      extension: file.split('.').pop(),
      size: fs.statSync(file).size
    };

    try {
      // Get file blame info
      const blame = execSync(`git log -1 --format="%an|%ae|%ai" -- ${file}`, {
        encoding: 'utf8'
      }).trim();

      if (blame) {
        const [author, email, date] = blame.split('|');
        info.lastModified = {
          author,
          email,
          date
        };
      }
    } catch (error) {
      // Ignore blame errors
    }

    return info;
  }

  /**
   * Generate AI-friendly suggestion
   * @private
   */
  static _generateSuggestion(conflicts, fileInfo) {
    const suggestions = [];

    if (conflicts.length === 1) {
      suggestions.push('Single conflict - review both versions and merge manually');
    } else if (conflicts.length > 5) {
      suggestions.push('Multiple conflicts - consider using strategy (ours/theirs) or manual review');
    }

    // Check for simple conflicts (line additions)
    const simpleConflicts = conflicts.filter(c =>
      c.ours.content.length === 0 || c.theirs.content.length === 0
    );

    if (simpleConflicts.length > 0) {
      suggestions.push(`${simpleConflicts.length} simple conflicts (additions only)`);
    }

    // File type suggestions
    const codeExtensions = ['js', 'ts', 'py', 'java', 'go', 'rs'];
    if (codeExtensions.includes(fileInfo.extension)) {
      suggestions.push('Code file - ensure syntax is preserved after resolution');
    }

    const configExtensions = ['json', 'yaml', 'yml', 'toml', 'ini'];
    if (configExtensions.includes(fileInfo.extension)) {
      suggestions.push('Config file - validate format after resolution');
    }

    return suggestions.join('. ');
  }

  /**
   * Create merge conflict prompt for AI
   * @param {string} file - File with conflicts
   * @returns {string} Formatted prompt
   */
  static async createResolutionPrompt(file) {
    const analysis = await this.analyzeConflicts(file);

    let prompt = `# Merge Conflict Resolution\n\n`;
    prompt += `File: ${analysis.file}\n`;
    prompt += `Type: ${analysis.fileInfo.extension}\n`;
    prompt += `Conflicts: ${analysis.conflictCount}\n\n`;

    if (analysis.suggestion) {
      prompt += `## Suggestions\n${analysis.suggestion}\n\n`;
    }

    for (let i = 0; i < analysis.conflicts.length; i++) {
      const conflict = analysis.conflicts[i];
      prompt += `## Conflict ${i + 1} (lines ${conflict.lineStart}-${conflict.lineEnd})\n\n`;

      if (conflict.context.before.length > 0) {
        prompt += `### Context Before\n\`\`\`\n`;
        conflict.context.before.forEach(ctx => {
          prompt += `${ctx.line}: ${ctx.content}\n`;
        });
        prompt += `\`\`\`\n\n`;
      }

      prompt += `### Current Branch (${conflict.ours.label})\n\`\`\`\n`;
      prompt += conflict.ours.content.join('\n');
      prompt += `\n\`\`\`\n\n`;

      prompt += `### Incoming Branch (${conflict.theirs.label})\n\`\`\`\n`;
      prompt += conflict.theirs.content.join('\n');
      prompt += `\n\`\`\`\n\n`;

      if (conflict.context.after.length > 0) {
        prompt += `### Context After\n\`\`\`\n`;
        conflict.context.after.forEach(ctx => {
          prompt += `${ctx.line}: ${ctx.content}\n`;
        });
        prompt += `\`\`\`\n\n`;
      }
    }

    prompt += `## Instructions\n`;
    prompt += `Review the conflicts above and provide a resolved version of the file.\n`;
    prompt += `Ensure the resolution maintains code functionality and follows best practices.\n`;

    return prompt;
  }
}

module.exports = { ConflictResolver };
