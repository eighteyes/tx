const fs = require('fs-extra');
const { execSync } = require('child_process');
const path = require('path');
const { Logger } = require('./logger');

/**
 * SessionCapture - Captures tmux session output on agent shutdown
 *
 * Captures full pane history to .ai/tx/session/ for debugging and analysis
 */
class SessionCapture {
  /**
   * Capture session output before shutdown
   *
   * @param {string} mesh - Mesh name or instance
   * @param {string} agent - Agent name
   * @param {string} sessionName - Tmux session name
   * @returns {string|null} - Path to captured session file or null on error
   */
  static async captureSession(mesh, agent, sessionName) {
    try {
      Logger.log('session-capture', 'Capturing session output', {
        mesh,
        agent,
        sessionName
      });

      // Check if session exists
      if (!this.sessionExists(sessionName)) {
        Logger.warn('session-capture', 'Session not found', { sessionName });
        return null;
      }

      // Capture full pane output (with -e to capture escape sequences, then strip them)
      let output = execSync(`tmux capture-pane -t ${sessionName} -p -S -`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB max
        stdio: ['pipe', 'pipe', 'ignore']
      });

      // Strip ANSI escape codes
      output = this.stripAnsiCodes(output);

      // Generate filename
      const filename = this.generateFilename(mesh, agent);
      const filepath = path.join('.ai/tx/session', filename);

      // Get session metadata
      const sessionInfo = await this.getSessionInfo(sessionName);

      // Build content
      const content = this.formatCapture(mesh, agent, sessionInfo, output);

      // Write to file
      await fs.ensureDir('.ai/tx/session');
      await fs.writeFile(filepath, content);

      Logger.log('session-capture', 'Session captured successfully', {
        mesh,
        agent,
        filepath,
        size: output.length
      });

      return filepath;
    } catch (error) {
      Logger.error('session-capture', 'Failed to capture session', {
        mesh,
        agent,
        sessionName,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Check if tmux session exists
   */
  static sessionExists(sessionName) {
    try {
      execSync(`tmux has-session -t ${sessionName}`, {
        stdio: 'ignore'
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate filename for session capture
   * Format: MMDDHHMMSS-mesh-agent-seq.md
   */
  static generateFilename(mesh, agent) {
    const date = new Date();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');

    const timestamp = `${mm}${dd}${hh}${min}${ss}`;
    const sequence = this.getNextSequence(timestamp, mesh, agent);

    return `${timestamp}-${mesh}-${agent}-${sequence}.md`;
  }

  /**
   * Get next sequence number for this timestamp/mesh/agent combo
   */
  static getNextSequence(timestamp, mesh, agent) {
    try {
      const sessionDir = '.ai/tx/session';

      if (!fs.existsSync(sessionDir)) {
        return 1;
      }

      const files = fs.readdirSync(sessionDir);

      // Match files with same timestamp, mesh, and agent
      const pattern = new RegExp(`^${timestamp}-${this.escapeRegex(mesh)}-${this.escapeRegex(agent)}-(\\d+)\\.md$`);
      const sequences = files
        .map(f => f.match(pattern))
        .filter(Boolean)
        .map(m => parseInt(m[1]));

      return sequences.length > 0 ? Math.max(...sequences) + 1 : 1;
    } catch {
      return 1;
    }
  }

  /**
   * Escape regex special characters
   */
  static escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Strip ANSI escape codes and clean up captured output
   */
  static stripAnsiCodes(text) {
    let cleaned = text;

    // Remove ANSI escape sequences
    // Matches: ESC[ + any number of parameters + letter
    cleaned = cleaned.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    // Remove system-reminder blocks (Claude Code context injection)
    cleaned = cleaned.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');

    // Remove lines that are just "TMUX= tmux attach" commands (noise from status/help output)
    cleaned = cleaned.replace(/^[\s>]*TMUX=\s+tmux\s+attach\s+-t\s+[\w-]+\s*$/gm, '');

    return cleaned;
  }

  /**
   * Get session metadata from tmux
   */
  static async getSessionInfo(sessionName) {
    try {
      // Get session creation time (Unix timestamp)
      const createdRaw = execSync(`tmux display-message -t ${sessionName} -p "#{session_created}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      const created = new Date(parseInt(createdRaw) * 1000);

      return {
        created,
        ended: new Date()
      };
    } catch {
      return {
        created: null,
        ended: new Date()
      };
    }
  }

  /**
   * Format capture with frontmatter
   */
  static formatCapture(mesh, agent, sessionInfo, output) {
    const frontmatter = {
      mesh,
      agent,
      session_start: sessionInfo.created ? sessionInfo.created.toISOString() : 'unknown',
      session_end: sessionInfo.ended.toISOString(),
      captured_at: new Date().toISOString(),
      size_bytes: output.length
    };

    const yaml = Object.entries(frontmatter)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    return `---
${yaml}
---

# Session Output

\`\`\`
${output}
\`\`\`
`;
  }

  /**
   * Capture all active sessions for a mesh
   */
  static async captureMesh(meshInstance) {
    const sessions = this.getActiveSessions();
    const meshSessions = sessions.filter(s => s.startsWith(meshInstance + '-'));

    const captures = [];

    for (const sessionName of meshSessions) {
      // Parse session name to get agent
      // Format: {mesh-instance}-{agent}
      const agent = sessionName.substring(meshInstance.length + 1);

      const filepath = await this.captureSession(meshInstance, agent, sessionName);
      if (filepath) {
        captures.push({ agent, filepath });
      }
    }

    return captures;
  }

  /**
   * Get all active tmux sessions
   */
  static getActiveSessions() {
    try {
      const output = execSync('tmux list-sessions -F "#{session_name}"', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });

      return output.trim().split('\n').filter(s => s.length > 0);
    } catch {
      return [];
    }
  }
}

module.exports = { SessionCapture };
