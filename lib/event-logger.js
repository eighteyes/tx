const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');

/**
 * EventLogger - Log events to .ai/tx/logs/events.jsonl
 *
 * Provides:
 * - JSONL logging (one event per line)
 * - Event history retrieval
 * - Log cleanup (retention policy)
 */
class EventLogger {
  static LOG_FILE = '.ai/tx/logs/events.jsonl';
  static MAX_LOG_SIZE = 10000; // Max events to keep

  /**
   * Log published event
   * @param {string} agentId - Target agent
   * @param {string} eventType - Event type
   * @param {string} content - Event content
   * @param {object} metadata - Event metadata
   */
  static log(agentId, eventType, content, metadata = {}) {
    try {
      // Ensure log directory exists
      fs.ensureDirSync(path.dirname(EventLogger.LOG_FILE));

      // Create log entry
      const entry = {
        timestamp: new Date().toISOString(),
        agentId,
        eventType,
        content,
        metadata
      };

      // Append to JSONL file
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(EventLogger.LOG_FILE, line);

      Logger.log('event-logger', `Event logged: ${eventType} → ${agentId}`);

      // Cleanup if needed (async, don't wait)
      EventLogger._cleanupAsync();
    } catch (error) {
      Logger.error('event-logger', `Failed to log event: ${error.message}`);
    }
  }

  /**
   * Get event history for agent
   * @param {string} agentId - Agent identifier (optional)
   * @param {number} limit - Max events to return
   * @returns {Array} Array of event entries
   */
  static getHistory(agentId = null, limit = 20) {
    try {
      if (!fs.existsSync(EventLogger.LOG_FILE)) {
        return [];
      }

      // Read all lines
      const content = fs.readFileSync(EventLogger.LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);

      // Parse JSONL
      let events = lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(e => e !== null);

      // Filter by agent if specified
      if (agentId) {
        events = events.filter(e => e.agentId === agentId);
      }

      // Return most recent events
      return events.slice(-limit);
    } catch (error) {
      Logger.error('event-logger', `Failed to read event history: ${error.message}`);
      return [];
    }
  }

  /**
   * Get events by type
   * @param {string} eventType - Event type to filter by
   * @param {number} limit - Max events to return
   * @returns {Array} Array of event entries
   */
  static getByType(eventType, limit = 20) {
    try {
      if (!fs.existsSync(EventLogger.LOG_FILE)) {
        return [];
      }

      const content = fs.readFileSync(EventLogger.LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);

      let events = lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(e => e !== null && e.eventType === eventType);

      return events.slice(-limit);
    } catch (error) {
      Logger.error('event-logger', `Failed to read events by type: ${error.message}`);
      return [];
    }
  }

  /**
   * Get events since timestamp
   * @param {Date|string} since - Timestamp to filter from
   * @returns {Array} Array of event entries
   */
  static getSince(since) {
    try {
      if (!fs.existsSync(EventLogger.LOG_FILE)) {
        return [];
      }

      const sinceDate = new Date(since);
      const content = fs.readFileSync(EventLogger.LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);

      return lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(e => e !== null && new Date(e.timestamp) >= sinceDate);
    } catch (error) {
      Logger.error('event-logger', `Failed to read events since ${since}: ${error.message}`);
      return [];
    }
  }

  /**
   * Clear event log
   */
  static clear() {
    try {
      if (fs.existsSync(EventLogger.LOG_FILE)) {
        fs.removeSync(EventLogger.LOG_FILE);
        Logger.log('event-logger', 'Event log cleared');
      }
    } catch (error) {
      Logger.error('event-logger', `Failed to clear event log: ${error.message}`);
    }
  }

  /**
   * Cleanup old events (async)
   * Keeps only MAX_LOG_SIZE most recent events
   * @private
   */
  static _cleanupAsync() {
    // Don't block on cleanup
    setImmediate(() => {
      try {
        if (!fs.existsSync(EventLogger.LOG_FILE)) {
          return;
        }

        const content = fs.readFileSync(EventLogger.LOG_FILE, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l.length > 0);

        // Only cleanup if over limit
        if (lines.length <= EventLogger.MAX_LOG_SIZE) {
          return;
        }

        // Keep only most recent events
        const keep = lines.slice(-EventLogger.MAX_LOG_SIZE);
        fs.writeFileSync(EventLogger.LOG_FILE, keep.join('\n') + '\n');

        Logger.log('event-logger', `Cleaned up event log (kept ${keep.length} events)`);
      } catch (error) {
        Logger.error('event-logger', `Failed to cleanup event log: ${error.message}`);
      }
    });
  }

  /**
   * Get log statistics
   * @returns {object} Statistics
   */
  static getStats() {
    try {
      if (!fs.existsSync(EventLogger.LOG_FILE)) {
        return { totalEvents: 0, byType: {}, byAgent: {} };
      }

      const content = fs.readFileSync(EventLogger.LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);

      const events = lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(e => e !== null);

      // Count by type
      const byType = {};
      const byAgent = {};

      events.forEach(e => {
        byType[e.eventType] = (byType[e.eventType] || 0) + 1;
        byAgent[e.agentId] = (byAgent[e.agentId] || 0) + 1;
      });

      return {
        totalEvents: events.length,
        byType,
        byAgent
      };
    } catch (error) {
      Logger.error('event-logger', `Failed to get stats: ${error.message}`);
      return { totalEvents: 0, byType: {}, byAgent: {} };
    }
  }
}

module.exports = { EventLogger };
