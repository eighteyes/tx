const { EventBus } = require('./event-bus');
const { EventFormatter } = require('./event-formatter');
const { EventLogger } = require('./event-logger');
const { TmuxInjector } = require('./tmux-injector');
const { Logger } = require('./logger');
const { ConfigLoader } = require('./config-loader');

/**
 * EventPublisher - Publish events directly to agents
 *
 * Integrates with EventBus to react to internal system events
 * and publish notifications to agents via direct tmux injection.
 *
 * Event Flow:
 * 1. System component emits EventBus event (e.g., agent:state:changed)
 * 2. EventPublisher listens to EventBus
 * 3. EventPublisher formats and publishes to agent
 * 4. Agent sees notification in tmux session
 */
class EventPublisher {
  static initialized = false;
  static config = null;

  /**
   * Initialize event publishing with EventBus integration
   */
  static initialize() {
    if (EventPublisher.initialized) {
      return;
    }

    // Load configuration
    EventPublisher.config = EventPublisher._loadConfig();

    if (!EventPublisher.config.enabled) {
      Logger.log('event-publisher', 'Event publishing disabled by config');
      return;
    }

    // Register EventBus listeners
    EventBus.on('agent:state:changed', EventPublisher._handleStateChange);
    EventBus.on('delivery:failed', EventPublisher._handleDeliveryFailed);
    EventBus.on('spawn:complete', EventPublisher._handleSpawnComplete);

    EventPublisher.initialized = true;
    Logger.log('event-publisher', 'Event publisher initialized with EventBus integration');
  }

  /**
   * Publish event to agent
   * @param {string} agentId - Target agent (e.g., 'research/interviewer')
   * @param {string} eventType - Event type (nudge, reminder, error, status)
   * @param {string} content - Event content (markdown)
   * @param {object} options - Options: { priority, ephemeral, metadata }
   * @returns {boolean} Success
   */
  static publish(agentId, eventType, content, options = {}) {
    try {
      // Check if enabled
      if (!EventPublisher.config?.enabled) {
        return false;
      }

      // Check if event type is enabled
      if (!EventPublisher._isEventTypeEnabled(eventType)) {
        Logger.log('event-publisher', `Event type ${eventType} disabled by config`);
        return false;
      }

      // Resolve session name
      const sessionName = EventPublisher._getSessionName(agentId);

      if (!sessionName) {
        Logger.warn('event-publisher', `Could not resolve session for ${agentId}`);
        return false;
      }

      // Check if session exists
      if (!TmuxInjector.sessionExists(sessionName)) {
        Logger.warn('event-publisher', `Session ${sessionName} not found for ${agentId}`);
        return false;
      }

      // Format event
      const formattedEvent = EventFormatter.format(eventType, content, options.metadata || {});

      // Inject into agent session
      TmuxInjector.injectText(sessionName, formattedEvent);

      // Log event (unless ephemeral)
      if (!options.ephemeral) {
        EventLogger.log(agentId, eventType, content, options.metadata || {});
      }

      // Emit EventBus event for observability
      EventBus.emit('event:published', {
        agentId,
        eventType,
        timestamp: Date.now(),
        ephemeral: !!options.ephemeral
      });

      Logger.log('event-publisher', `Event published: ${eventType} → ${agentId}`);

      return true;
    } catch (error) {
      Logger.error('event-publisher', `Failed to publish event: ${error.message}`, {
        agentId,
        eventType,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Broadcast event to multiple agents
   * @param {string[]} agentIds - Target agents
   * @param {string} eventType - Event type
   * @param {string} content - Event content
   * @param {object} options - Options
   * @returns {number} Number of successful publishes
   */
  static broadcast(agentIds, eventType, content, options = {}) {
    let successCount = 0;

    for (const agentId of agentIds) {
      if (EventPublisher.publish(agentId, eventType, content, options)) {
        successCount++;
      }
    }

    Logger.log('event-publisher', `Broadcast ${eventType} to ${successCount}/${agentIds.length} agents`);

    return successCount;
  }

  /**
   * Handle agent state change events from EventBus
   * @private
   */
  static _handleStateChange(data) {
    const { agentId, oldState, newState } = data;

    // Nudge on distraction
    if (newState === 'distracted') {
      EventPublisher.publish(agentId, 'nudge',
        EventFormatter.nudge(
          'You appear distracted - no activity detected',
          '- Send a status update if you\'re still working\n- Request help if you\'re blocked\n- Send task-complete if you\'re done'
        ),
        { metadata: { trigger: 'state_change', oldState, newState } }
      );
    }

    // Error notification
    if (newState === 'error') {
      EventPublisher.publish(agentId, 'error',
        EventFormatter.error('Agent entered error state', `Previous state: ${oldState}`),
        { metadata: { trigger: 'state_change', oldState, newState }, priority: 'high' }
      );
    }
  }

  /**
   * Handle delivery failure events from EventBus
   * @private
   */
  static _handleDeliveryFailed(data) {
    const { agentId, targetAgent, reason, messageId } = data;

    EventPublisher.publish(agentId, 'error',
      EventFormatter.error('Message delivery failed',
        `Target: ${targetAgent}\nReason: ${reason}\nMessage ID: ${messageId || 'unknown'}`
      ),
      { metadata: { trigger: 'delivery_failed', targetAgent, reason }, priority: 'high' }
    );
  }

  /**
   * Handle spawn complete events from EventBus
   * @private
   */
  static _handleSpawnComplete(data) {
    const { agentId, meshName } = data;

    EventPublisher.publish(agentId, 'status',
      EventFormatter.status('Agent spawned successfully', `Mesh: ${meshName}\nReady to receive tasks`),
      { metadata: { trigger: 'spawn_complete', meshName }, ephemeral: true }
    );
  }

  /**
   * Get tmux session name from agent ID
   * @private
   */
  static _getSessionName(agentId) {
    // Parse agent ID: mesh/agent or mesh-instance/agent
    const parts = agentId.split('/');

    if (parts.length !== 2) {
      return null;
    }

    const [mesh, agent] = parts;

    // Handle core special case
    if (mesh === 'core' && agent === 'core') {
      return 'core';
    }

    // Handle persistent mesh (mesh === agent)
    if (mesh === agent) {
      return mesh;
    }

    // Standard format: mesh-agent
    return `${mesh}-${agent}`;
  }

  /**
   * Load event publishing configuration
   * @private
   */
  static _loadConfig() {
    try {
      // Try to load from config file
      const configPath = '.ai/tx/config/events.json';
      const fs = require('fs-extra');

      if (fs.existsSync(configPath)) {
        return fs.readJsonSync(configPath);
      }
    } catch (error) {
      Logger.warn('event-publisher', `Failed to load config: ${error.message}`);
    }

    // Return defaults
    return {
      enabled: true,
      nudges: {
        enabled: true,
        inactivity_threshold: 2700000  // 45 minutes
      },
      reminders: {
        enabled: true
      },
      errors: {
        enabled: true
      },
      status: {
        enabled: true
      },
      logging: {
        file: '.ai/tx/logs/events.jsonl',
        retention_days: 7
      }
    };
  }

  /**
   * Check if event type is enabled
   * @private
   */
  static _isEventTypeEnabled(eventType) {
    if (!EventPublisher.config) {
      return false;
    }

    const typeConfig = EventPublisher.config[`${eventType}s`] || EventPublisher.config[eventType];

    if (!typeConfig) {
      return true; // Default to enabled if not configured
    }

    return typeConfig.enabled !== false;
  }

  /**
   * Shutdown event publisher
   */
  static shutdown() {
    if (!EventPublisher.initialized) {
      return;
    }

    // Remove EventBus listeners
    EventBus.off('agent:state:changed', EventPublisher._handleStateChange);
    EventBus.off('delivery:failed', EventPublisher._handleDeliveryFailed);
    EventBus.off('spawn:complete', EventPublisher._handleSpawnComplete);

    EventPublisher.initialized = false;
    Logger.log('event-publisher', 'Event publisher shutdown');
  }
}

module.exports = { EventPublisher };
