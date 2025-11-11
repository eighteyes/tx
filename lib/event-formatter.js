const { Logger } = require('./logger');

/**
 * EventFormatter - Format events for agent display
 *
 * Provides consistent formatting for different event types:
 * - nudge: Gentle reminders (🔔)
 * - reminder: Scheduled notifications (⏰)
 * - error: Error notifications (❌)
 * - status: Status updates (ℹ️)
 */
class EventFormatter {
  /**
   * Format event for agent display
   * @param {string} eventType - Event type (nudge, reminder, error, status)
   * @param {string} content - Event content
   * @param {object} metadata - Additional metadata
   * @returns {string} Formatted event text
   */
  static format(eventType, content, metadata = {}) {
    const icon = EventFormatter._getIcon(eventType);
    const label = EventFormatter._getLabel(eventType);

    // Basic format: [icon] [label]: [content]
    let formatted = `${icon} **${label}**: ${content}`;

    // Add metadata if present
    if (metadata.source) {
      formatted += `\n\n_Source: ${metadata.source}_`;
    }

    if (metadata.priority === 'high') {
      formatted = `🚨 ${formatted}`;
    }

    return formatted;
  }

  /**
   * Create nudge event
   * @param {string} reason - Why the nudge is being sent
   * @param {string} suggestions - Suggested actions (markdown list)
   * @returns {string} Formatted nudge
   */
  static nudge(reason, suggestions) {
    let text = `🔔 **System Nudge**: ${reason}`;

    if (suggestions) {
      text += `\n\n**Suggestions:**\n${suggestions}`;
    }

    return text;
  }

  /**
   * Create reminder event
   * @param {string} title - Reminder title
   * @param {string} details - Reminder details
   * @returns {string} Formatted reminder
   */
  static reminder(title, details) {
    let text = `⏰ **Reminder**: ${title}`;

    if (details) {
      text += `\n\n${details}`;
    }

    return text;
  }

  /**
   * Create error notification
   * @param {string} error - Error message
   * @param {string} context - Additional context
   * @returns {string} Formatted error
   */
  static error(error, context) {
    let text = `❌ **Error Notification**: ${error}`;

    if (context) {
      text += `\n\n**Details:**\n${context}`;
    }

    return text;
  }

  /**
   * Create status update
   * @param {string} status - Status message
   * @param {string} details - Additional details
   * @returns {string} Formatted status
   */
  static status(status, details) {
    let text = `ℹ️ **Status Update**: ${status}`;

    if (details) {
      text += `\n\n${details}`;
    }

    return text;
  }

  /**
   * Get icon for event type
   * @private
   */
  static _getIcon(eventType) {
    const icons = {
      nudge: '🔔',
      reminder: '⏰',
      error: '❌',
      status: 'ℹ️'
    };

    return icons[eventType] || '📢';
  }

  /**
   * Get label for event type
   * @private
   */
  static _getLabel(eventType) {
    const labels = {
      nudge: 'System Nudge',
      reminder: 'Reminder',
      error: 'Error Notification',
      status: 'Status Update'
    };

    return labels[eventType] || 'Event';
  }
}

module.exports = { EventFormatter };
