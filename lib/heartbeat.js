const StateDB = require('./state-db');
const { TmuxInjector } = require('./tmux-injector');
const { Logger } = require('./logger');
const fs = require('fs-extra');
const path = require('path');

/**
 * Heartbeat - Centralized periodic system checks
 *
 * Single interval timer that handles all system-level periodic tasks:
 * - Process pending message queue (deliver when agents ready)
 * - Check agent health status
 * - Check agent activity and state transitions
 * - Check for stuck/failed message deliveries
 *
 * Replaces scattered setInterval calls across ConsumerDaemon, HealthMonitor,
 * StateManager, and DeliveryMonitor.
 */
class Heartbeat {
  static interval = null;
  static running = false;
  static TICK_INTERVAL = 1000; // 1 second

  /**
   * Start the heartbeat
   */
  static start() {
    if (Heartbeat.running) {
      Logger.warn('heartbeat', 'Heartbeat already running');
      return;
    }

    Logger.log('heartbeat', 'Starting centralized heartbeat...');

    Heartbeat.interval = setInterval(async () => {
      try {
        await Heartbeat.tick();
      } catch (error) {
        Logger.error('heartbeat', `Heartbeat error: ${error.message}`, {
          error: error.stack
        });
      }
    }, Heartbeat.TICK_INTERVAL);

    Heartbeat.running = true;
    Logger.log('heartbeat', `Heartbeat started (interval: ${Heartbeat.TICK_INTERVAL}ms)`);
  }

  /**
   * Stop the heartbeat
   */
  static stop() {
    if (!Heartbeat.running) {
      return;
    }

    if (Heartbeat.interval) {
      clearInterval(Heartbeat.interval);
      Heartbeat.interval = null;
    }

    Heartbeat.running = false;
    Logger.log('heartbeat', 'Heartbeat stopped');
  }

  /**
   * Single heartbeat tick - performs all periodic checks
   */
  static async tick() {
    // 1. Process pending messages in queue
    await Heartbeat.processPendingMessages();

    // 2. Update dashboard (every 2 ticks = 2 seconds) - DISABLED
    // if (Heartbeat.tickCount % 2 === 0) {
    //   await Heartbeat.updateDashboard();
    // }

    // 3. Check agent health (every 5 ticks = 5 seconds)
    if (Heartbeat.tickCount % 5 === 0) {
      await Heartbeat.checkAgentHealth();
    }

    // 4. Check agent activity (every 2 ticks = 2 seconds)
    if (Heartbeat.tickCount % 2 === 0) {
      await Heartbeat.checkAgentActivity();
    }

    // 5. Check stuck deliveries (every 10 ticks = 10 seconds)
    if (Heartbeat.tickCount % 10 === 0) {
      await Heartbeat.checkStuckDeliveries();
    }

    Heartbeat.tickCount++;
  }

  static tickCount = 0;

  /**
   * Process pending messages in the queue
   * Check if target agents are ready and deliver
   */
  static async processPendingMessages() {
    const db = StateDB.init();

    // Get pending messages
    const pending = db.prepare(`
      SELECT * FROM message_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 50
    `).all();

    if (pending.length === 0) {
      return;
    }

    Logger.log('heartbeat', `Processing ${pending.length} pending message(s)`);

    for (const msg of pending) {
      try {
        // Check if target agent session exists
        const targetSession = Heartbeat.getSessionForAgent(msg.to_agent);

        if (targetSession) {
          // Agent is ready - deliver the message
          await Heartbeat.deliverMessage(msg);
        } else {
          // Agent not ready - check if message is too old (5 minute timeout)
          const age = Date.now() - msg.created_at;
          if (age > 5 * 60 * 1000) {
            Logger.warn('heartbeat', `Message ${msg.id} timed out after 5 minutes`, {
              to: msg.to_agent,
              filepath: msg.filepath
            });

            // Mark as failed
            db.prepare(`
              UPDATE message_queue
              SET status = 'failed',
                  error = 'Timeout: agent not ready after 5 minutes',
                  updated_at = ?
              WHERE id = ?
            `).run(Date.now(), msg.id);
          }
        }
      } catch (error) {
        Logger.error('heartbeat', `Failed to process message ${msg.id}: ${error.message}`, {
          to: msg.to_agent,
          error: error.stack
        });

        // Mark as failed
        db.prepare(`
          UPDATE message_queue
          SET status = 'failed',
              error = ?,
              updated_at = ?
          WHERE id = ?
        `).run(error.message, Date.now(), msg.id);
      }
    }
  }

  /**
   * Deliver a message to an agent session
   */
  static async deliverMessage(msg) {
    const db = StateDB.init();

    // Parse message frontmatter
    const content = await fs.readFile(msg.filepath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (!frontmatterMatch) {
      throw new Error('Invalid message format: no frontmatter found');
    }

    // Inject into agent session
    const targetSession = Heartbeat.getSessionForAgent(msg.to_agent);

    Logger.log('heartbeat', `Delivering message to ${msg.to_agent} via ${targetSession}`);

    // Use TmuxInjector to inject the file reference
    TmuxInjector.injectFile(targetSession, msg.filepath);

    // Mark as delivered
    db.prepare(`
      UPDATE message_queue
      SET status = 'delivered',
          delivered_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(Date.now(), Date.now(), msg.id);

    Logger.log('heartbeat', `Message delivered: ${msg.to_agent} (${path.basename(msg.filepath)})`);
  }

  /**
   * Get tmux session name for an agent
   * Handles both formats: "mesh/agent" and "mesh-instance/agent"
   */
  static getSessionForAgent(agentId) {
    const sessions = TmuxInjector.listSessions();

    // Handle ephemeral mesh shorthand (e.g., "core" -> session "core")
    // For ephemeral meshes where mesh name equals agent name (core/core, brain/brain)
    if (!agentId.includes('/')) {
      if (sessions.includes(agentId)) {
        return agentId;
      }
    }

    // Try exact match for full paths
    const parts = agentId.split('/');
    if (parts.length === 2) {
      const [mesh, agent] = parts;

      // Special case: ephemeral meshes where mesh == agent (e.g., "core/core" -> session "core")
      if (mesh === agent && sessions.includes(mesh)) {
        return mesh;
      }

      // Try: mesh-agent format (e.g., "core-core" for "core/core")
      const simpleFormat = `${mesh}-${agent}`;
      if (sessions.includes(simpleFormat)) {
        return simpleFormat;
      }

      // Try: mesh-instance-agent format (e.g., "test-echo-abc123-echo")
      const matchingSession = sessions.find(s => {
        // Match pattern: {mesh}-{instance}-{agent}
        const regex = new RegExp(`^${mesh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[a-f0-9]+-${agent}$`);
        return regex.test(s);
      });

      if (matchingSession) {
        return matchingSession;
      }
    }

    return null;
  }

  /**
   * Update dashboard panes (if dashboard session exists)
   * Moved from dashboard-watcher.js to centralize all periodic checks
   */
  static async updateDashboard() {
    try {
      const DASHBOARD_SESSION = 'tx-dashboard';
      const sessions = TmuxInjector.listSessions();

      // Only update if dashboard session exists
      if (!sessions.includes(DASHBOARD_SESSION)) {
        return;
      }

      // Delegate to dashboard-watcher module if it exists
      // This keeps the complex dashboard logic separate but triggered by heartbeat
      try {
        const { checkAndUpdate } = require('./dashboard-watcher');
        if (typeof checkAndUpdate === 'function') {
          checkAndUpdate();
        }
      } catch (error) {
        // Dashboard watcher not available or doesn't export checkAndUpdate
        // This is fine - dashboard is optional
      }
    } catch (error) {
      // Silently ignore dashboard errors - it's not critical
    }
  }

  /**
   * Check agent health status
   * TODO: Integrate with HealthMonitor logic
   */
  static async checkAgentHealth() {
    // Placeholder for future health check logic
    // This will integrate with HealthMonitor's performHealthCheck() method
  }

  /**
   * Check agent activity and state transitions
   * TODO: Integrate with StateManager logic
   */
  static async checkAgentActivity() {
    // Placeholder for future activity check logic
    // This will integrate with StateManager's checkAgentActivity() method
  }

  /**
   * Check for stuck/failed deliveries
   * TODO: Integrate with DeliveryMonitor logic
   */
  static async checkStuckDeliveries() {
    // Placeholder for future stuck delivery check logic
    // This will integrate with DeliveryMonitor's checkStuckMessages() method
  }
}

module.exports = { Heartbeat };
