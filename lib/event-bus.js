const { Logger } = require('./logger');

class EventBus {
  static listeners = new Map(); // event -> [{ handler, priority, once }]
  static eventLog = []; // Last 1000 events
  static maxLogSize = 1000;
  static stats = new Map(); // event -> count
  static debugMode = process.env.TX_DEBUG_MODE === 'true';

  /**
   * Register an event listener
   * Supports wildcards: 'file:*' matches 'file:inbox:new', 'file:active:removed', etc.
   * Options: { priority: 10 } (higher = called first)
   */
  static on(event, handler, options = {}) {
    const priority = options.priority || 0;

    if (!EventBus.listeners.has(event)) {
      EventBus.listeners.set(event, []);
    }

    EventBus.listeners.get(event).push({
      handler,
      priority,
      once: false
    });

    // Sort by priority (highest first)
    EventBus.listeners.get(event).sort((a, b) => b.priority - a.priority);

    if (EventBus.debugMode) {
      console.log(`[EventBus] Listener registered: ${event} (priority: ${priority})`);
    }
  }

  /**
   * Register a one-time listener
   */
  static once(event, handler, options = {}) {
    const priority = options.priority || 0;

    if (!EventBus.listeners.has(event)) {
      EventBus.listeners.set(event, []);
    }

    EventBus.listeners.get(event).push({
      handler,
      priority,
      once: true
    });

    EventBus.listeners.get(event).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a specific listener for an event
   */
  static off(event, handler) {
    if (!EventBus.listeners.has(event)) {
      return;
    }

    const handlers = EventBus.listeners.get(event);
    const index = handlers.findIndex(listener => listener.handler === handler);

    if (index !== -1) {
      handlers.splice(index, 1);

      if (EventBus.debugMode) {
        console.log(`[EventBus] Listener removed: ${event}`);
      }
    }

    // Clean up empty handler arrays
    if (handlers.length === 0) {
      EventBus.listeners.delete(event);
    }
  }

  /**
   * Emit an event synchronously
   */
  static emit(event, data = {}) {
    EventBus._logEvent(event, data);
    EventBus._callListeners(event, data);
  }

  /**
   * Emit an event asynchronously
   */
  static async emitAsync(event, data = {}) {
    EventBus._logEvent(event, data);
    await EventBus._callListenersAsync(event, data);
  }

  /**
   * Call all matching listeners (sync)
   */
  static _callListeners(event, data) {
    const handlersToRemove = [];

    // Direct match
    if (EventBus.listeners.has(event)) {
      const handlers = EventBus.listeners.get(event);
      handlers.forEach((listener, index) => {
        try {
          listener.handler(data);
          if (listener.once) {
            handlersToRemove.push({ event, index });
          }
        } catch (error) {
          Logger.error('event-bus', `Handler error for ${event}`, {
            error: error.message,
            stack: error.stack
          });
        }
      });
    }

    // Wildcard matches
    EventBus.listeners.forEach((handlers, registeredEvent) => {
      if (registeredEvent.includes('*')) {
        const pattern = registeredEvent.replace('*', '.*');
        const regex = new RegExp(`^${pattern}$`);

        if (regex.test(event)) {
          handlers.forEach((listener, index) => {
            try {
              listener.handler(data);
              if (listener.once) {
                handlersToRemove.push({ event: registeredEvent, index });
              }
            } catch (error) {
              Logger.error('event-bus', `Handler error for ${registeredEvent}`, {
                error: error.message
              });
            }
          });
        }
      }
    });

    // Remove one-time listeners
    handlersToRemove.forEach(({ event: evt, index }) => {
      const handlers = EventBus.listeners.get(evt);
      handlers.splice(index, 1);
    });
  }

  /**
   * Call all matching listeners (async)
   */
  static async _callListenersAsync(event, data) {
    const handlersToRemove = [];

    // Direct match
    if (EventBus.listeners.has(event)) {
      const handlers = EventBus.listeners.get(event);
      for (const [index, listener] of handlers.entries()) {
        try {
          await Promise.resolve(listener.handler(data));
          if (listener.once) {
            handlersToRemove.push({ event, index });
          }
        } catch (error) {
          Logger.error('event-bus', `Handler error for ${event}`, {
            error: error.message
          });
        }
      }
    }

    // Wildcard matches
    for (const [registeredEvent, handlers] of EventBus.listeners) {
      if (registeredEvent.includes('*')) {
        const pattern = registeredEvent.replace('*', '.*');
        const regex = new RegExp(`^${pattern}$`);

        if (regex.test(event)) {
          for (const [index, listener] of handlers.entries()) {
            try {
              await Promise.resolve(listener.handler(data));
              if (listener.once) {
                handlersToRemove.push({ event: registeredEvent, index });
              }
            } catch (error) {
              Logger.error('event-bus', `Handler error for ${registeredEvent}`, {
                error: error.message
              });
            }
          }
        }
      }
    }

    // Remove one-time listeners
    handlersToRemove.forEach(({ event: evt, index }) => {
      const handlers = EventBus.listeners.get(evt);
      handlers.splice(index, 1);
    });
  }

  /**
   * Log event to internal log (last 1000 events)
   */
  static _logEvent(event, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      data
    };

    EventBus.eventLog.push(entry);
    if (EventBus.eventLog.length > EventBus.maxLogSize) {
      EventBus.eventLog.shift();
    }

    // Update stats
    const count = EventBus.stats.get(event) || 0;
    EventBus.stats.set(event, count + 1);

    if (EventBus.debugMode) {
      console.log(`[EventBus] Emit: ${event}`, data);
    }

    Logger.log('event-bus', `Event emitted: ${event}`, { event });
  }

  /**
   * Get event log, optionally filtered by event type
   */
  static getEventLog(eventFilter = null) {
    if (!eventFilter) {
      return [...EventBus.eventLog];
    }

    return EventBus.eventLog.filter(entry => entry.event === eventFilter);
  }

  /**
   * Clear event log
   */
  static clearEventLog() {
    EventBus.eventLog = [];
    EventBus.stats.clear();
  }

  /**
   * Get statistics
   */
  static getStats() {
    return {
      totalEvents: EventBus.eventLog.length,
      totalListeners: Array.from(EventBus.listeners.values()).reduce(
        (sum, handlers) => sum + handlers.length,
        0
      ),
      eventLog: EventBus.eventLog.length,
      events: Object.fromEntries(EventBus.stats)
    };
  }

  /**
   * Remove all listeners for an event
   */
  static removeAllListeners(event) {
    if (event) {
      EventBus.listeners.delete(event);
    } else {
      EventBus.listeners.clear();
    }
  }

  /**
   * Enable debug mode
   */
  static setDebugMode(enabled) {
    EventBus.debugMode = enabled;
  }
}

module.exports = { EventBus };
