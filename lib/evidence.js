const fs = require('fs-extra');
const path = require('path');

/**
 * Evidence Logger
 *
 * Captures evidence of system anomalies and failures for forensic analysis.
 * Writes to .ai/tx/logs/evidence.jsonl with full context information.
 */
class Evidence {
  static logsDir = '.ai/tx/logs';
  static evidenceLog = path.join(Evidence.logsDir, 'evidence.jsonl');
  static maxLines = 5000; // More lines for evidence

  /**
   * Evidence types
   */
  static Types = {
    ROUTING_FAILURE: 'routing_failure',
    MISSING_SESSION: 'missing_session',
    INVALID_FRONTMATTER: 'invalid_frontmatter',
    HARDCODED_FALLBACK: 'hardcoded_fallback',
    MESH_NOT_FOUND: 'mesh_not_found',
    AGENT_NOT_FOUND: 'agent_not_found',
    ORPHANED_MESSAGE: 'orphaned_message',
    DUPLICATE_PROCESSING: 'duplicate_processing',
    QUEUE_STUCK: 'queue_stuck',
    CONFIG_INVALID: 'config_invalid',
    DIRECTORY_MISSING: 'directory_missing',
    VALIDATION_FAILURE: 'validation_failure',
    PARSE_ERROR: 'parse_error',
    INVALID_MESSAGE: 'invalid_message',
    PROCESSING_ERROR: 'processing_error',
  };

  /**
   * Initialize logs directory
   */
  static init() {
    fs.ensureDirSync(Evidence.logsDir);
  }

  /**
   * Record evidence of a system anomaly
   *
   * @param {string} type - Evidence type from Evidence.Types
   * @param {string} description - Human-readable description
   * @param {object} context - Full context information
   * @param {string} context.mesh - Mesh name
   * @param {string} context.agent - Agent name
   * @param {string} context.file - File path
   * @param {string} context.queue - Queue name
   * @param {object} context.frontmatter - Message frontmatter
   * @param {string} context.component - Component that detected the issue
   * @param {object} context.additional - Any additional context
   */
  static record(type, description, context = {}) {
    Evidence.init();

    const entry = {
      timestamp: new Date().toISOString(),
      type,
      description,
      context: {
        mesh: context.mesh || null,
        agent: context.agent || null,
        file: context.file || null,
        queue: context.queue || null,
        frontmatter: context.frontmatter || null,
        component: context.component || 'unknown',
        ...context.additional
      }
    };

    try {
      fs.appendFileSync(Evidence.evidenceLog, JSON.stringify(entry) + '\n');

      // Trim log if too long
      const lines = fs.readFileSync(Evidence.evidenceLog, 'utf-8').split('\n').filter(l => l.trim());
      if (lines.length > Evidence.maxLines) {
        fs.writeFileSync(Evidence.evidenceLog, lines.slice(-Evidence.maxLines).join('\n') + '\n');
      }
    } catch (error) {
      console.error(`Failed to write evidence: ${error.message}`);
    }
  }

  /**
   * Get recent evidence entries
   *
   * @param {number} n - Number of entries to retrieve
   * @param {string} type - Optional filter by evidence type
   * @param {string} mesh - Optional filter by mesh
   * @returns {Array} Evidence entries
   */
  static tail(n = 50, type = null, mesh = null) {
    Evidence.init();

    const entries = [];

    if (fs.existsSync(Evidence.evidenceLog)) {
      const lines = fs.readFileSync(Evidence.evidenceLog, 'utf-8').split('\n').filter(l => l.trim());

      lines.forEach(line => {
        try {
          const entry = JSON.parse(line);

          // Apply filters
          if (type && entry.type !== type) return;
          if (mesh && entry.context.mesh !== mesh) return;

          entries.push(entry);
        } catch (e) {
          // Skip invalid JSON
        }
      });
    }

    // Sort by timestamp descending and return last N
    return entries
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, n);
  }

  /**
   * Get evidence summary grouped by type
   *
   * @returns {object} Summary with counts by type
   */
  static summary() {
    Evidence.init();

    const summary = {
      total: 0,
      byType: {},
      byMesh: {},
      recentCount: 0,
      oldestTimestamp: null,
      newestTimestamp: null
    };

    if (!fs.existsSync(Evidence.evidenceLog)) {
      return summary;
    }

    const now = new Date();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);

    const lines = fs.readFileSync(Evidence.evidenceLog, 'utf-8').split('\n').filter(l => l.trim());

    lines.forEach(line => {
      try {
        const entry = JSON.parse(line);
        summary.total++;

        // Count by type
        summary.byType[entry.type] = (summary.byType[entry.type] || 0) + 1;

        // Count by mesh
        if (entry.context.mesh) {
          summary.byMesh[entry.context.mesh] = (summary.byMesh[entry.context.mesh] || 0) + 1;
        }

        // Count recent (last hour)
        const timestamp = new Date(entry.timestamp);
        if (timestamp > oneHourAgo) {
          summary.recentCount++;
        }

        // Track timestamp range
        if (!summary.oldestTimestamp || timestamp < new Date(summary.oldestTimestamp)) {
          summary.oldestTimestamp = entry.timestamp;
        }
        if (!summary.newestTimestamp || timestamp > new Date(summary.newestTimestamp)) {
          summary.newestTimestamp = entry.timestamp;
        }
      } catch (e) {
        // Skip invalid JSON
      }
    });

    return summary;
  }

  /**
   * Clear evidence log
   */
  static clear() {
    Evidence.init();
    if (fs.existsSync(Evidence.evidenceLog)) {
      fs.removeSync(Evidence.evidenceLog);
    }
  }
}

module.exports = { Evidence };
