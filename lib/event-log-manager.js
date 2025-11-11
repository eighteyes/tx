const { EventLogConsumer } = require('./event-log-consumer');
const { Logger } = require('./logger');

/**
 * EventLogManager - Manages EventLogConsumers for all active agents
 *
 * Responsibilities:
 * - Tracks active agents and their consumers
 * - Starts/stops consumers when agents spawn/terminate
 * - Provides global enable/disable for event log system
 */
class EventLogManager {
  static consumers = new Map(); // agentId -> EventLogConsumer instance
  static enabled = false; // Global kill switch for event log system

  /**
   * Enable event log system globally
   */
  static enable() {
    EventLogManager.enabled = true;
    Logger.log('event-log-manager', 'Event log system enabled');
  }

  /**
   * Disable event log system globally
   */
  static disable() {
    EventLogManager.enabled = false;
    Logger.log('event-log-manager', 'Event log system disabled');
  }

  /**
   * Start a consumer for an agent
   * @param {string} agentId - Agent identifier (e.g., "core/core" or "research-807055/interviewer")
   */
  static async startConsumer(agentId) {
    console.log(`[DEBUG] EventLogManager.startConsumer called for ${agentId}`);
    console.log(`[DEBUG] EventLogManager.enabled = ${EventLogManager.enabled}`);

    if (!EventLogManager.enabled) {
      Logger.log('event-log-manager', `Event log system disabled, not starting consumer for ${agentId}`);
      return null;
    }

    // Check if consumer already exists
    if (EventLogManager.consumers.has(agentId)) {
      Logger.warn('event-log-manager', `Consumer already running for ${agentId}`);
      return EventLogManager.consumers.get(agentId);
    }

    Logger.log('event-log-manager', `Starting consumer for ${agentId}`);

    const consumer = new EventLogConsumer(agentId);
    await consumer.start();

    EventLogManager.consumers.set(agentId, consumer);
    Logger.log('event-log-manager', `Consumer started for ${agentId}`);

    return consumer;
  }

  /**
   * Stop a consumer for an agent
   * @param {string} agentId - Agent identifier
   */
  static async stopConsumer(agentId) {
    const consumer = EventLogManager.consumers.get(agentId);
    if (!consumer) {
      Logger.warn('event-log-manager', `No consumer found for ${agentId}`);
      return;
    }

    Logger.log('event-log-manager', `Stopping consumer for ${agentId}`);
    await consumer.stop();

    EventLogManager.consumers.delete(agentId);
    Logger.log('event-log-manager', `Consumer stopped for ${agentId}`);
  }

  /**
   * Stop all consumers
   */
  static async stopAllConsumers() {
    Logger.log('event-log-manager', `Stopping ${EventLogManager.consumers.size} consumers`);

    const stopPromises = [];
    for (const [agentId, consumer] of EventLogManager.consumers.entries()) {
      stopPromises.push(
        consumer.stop().catch(error => {
          Logger.error('event-log-manager', `Error stopping consumer for ${agentId}: ${error.message}`);
        })
      );
    }

    await Promise.all(stopPromises);
    EventLogManager.consumers.clear();

    Logger.log('event-log-manager', 'All consumers stopped');
  }

  /**
   * Get status of all consumers
   */
  static getStatus() {
    const consumers = [];
    for (const [agentId, consumer] of EventLogManager.consumers.entries()) {
      consumers.push({
        agentId,
        running: consumer.running,
        lastProcessed: consumer.lastProcessed
      });
    }

    return {
      enabled: EventLogManager.enabled,
      activeConsumers: consumers.length,
      consumers
    };
  }

  /**
   * Check if consumer is running for an agent
   */
  static isRunning(agentId) {
    const consumer = EventLogManager.consumers.get(agentId);
    return consumer && consumer.running;
  }
}

module.exports = { EventLogManager };
