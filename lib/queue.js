const fs = require('fs-extra');
const path = require('path');
const { EventBus } = require('./event-bus');
const { Logger } = require('./logger');
const { TmuxInjector } = require('./tmux-injector');
const { Message } = require('./message');
const { Routing } = require('./routing');
const { AgentPath } = require('./utils/agent-path');
const { PATHS } = require('./paths');
const { ConfigLoader } = require('./config-loader');

/**
 * Queue Utility Class
 *
 * Provides routing validation, session resolution, and queue status queries.
 * NO LONGER processes messages directly - EventLogConsumer handles message delivery.
 *
 * Responsibilities:
 * - Routing validation (validateRouting, validateCompletionAgent)
 * - Session name resolution (getDestinationSession)
 * - Queue status queries (getQueueStatus)
 * - Delivery tracking (recordMessageDelivery, hasMessageBeenDelivered)
 * - Backlog processing (processQueueBacklog)
 * - Backward compatible state APIs (getState, setState - deprecated)
 *
 * Message delivery is handled by:
 * - EventLogConsumer: Watches .ai/tx/msgs/ and delivers to agents
 * - SpawnHandler: Handles spawn-type messages
 */
class Queue {
  static initialized = false;

  /**
   * Initialize queue system
   * Listens for file:msgs:new events and handles immediate delivery or queuing
   */
  static initialize() {
    if (Queue.initialized) {
      return;
    }

    Logger.log('queue', 'Initializing simplified queue system');

    // Listen for new message files from Watcher
    EventBus.on('file:msgs:new', Queue.handleNewMessage);

    Queue.initialized = true;
    Logger.log('queue', 'Queue initialized and listening for messages');
  }

  /**
   * Handle new message file detected
   * Parse frontmatter, check if agent ready, deliver immediately or queue
   */
  static async handleNewMessage({ mesh, agent, file, filepath }) {
    const StateDB = require('./state-db');
    const { Heartbeat } = require('./heartbeat');
    const { MessageWriter } = require('./message-writer');

    try {
      // Parse filename to get routing info
      const { from: filenameFrom, type, msgId } = MessageWriter.parseFilename(file);

      // Parse message frontmatter to get actual routing info
      const content = await fs.readFile(filepath, 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

      if (!frontmatterMatch) {
        Logger.error('queue', `Invalid message format: ${filepath}`);
        return;
      }

      // Extract "to" and "from" from frontmatter (these have full mesh/instance paths)
      const frontmatterLines = frontmatterMatch[1].split('\n');
      let from = filenameFrom;
      let to = null;

      for (const line of frontmatterLines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();

        if (key.trim() === 'to') {
          to = value;
        } else if (key.trim() === 'from') {
          from = value;
        }
      }

      if (!to) {
        Logger.error('queue', `No "to" field in message frontmatter: ${filepath}`);
        return;
      }

      Logger.log('queue', `New message: ${from} → ${to} (${type}/${msgId})`);

      // Check if target agent session exists
      const targetSession = Heartbeat.getSessionForAgent(to);

      if (targetSession) {
        // Agent is ready - deliver immediately
        Logger.log('queue', `Agent ${to} is ready (session: ${targetSession}), delivering immediately`);

        TmuxInjector.injectFile(targetSession, filepath);

        // Record delivery in queue table with status=delivered
        const db = StateDB.init();
        db.prepare(`
          INSERT INTO message_queue (filepath, to_agent, from_agent, msg_type, msg_id, status, created_at, delivered_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'delivered', ?, ?, ?)
        `).run(filepath, to, from, type, msgId, Date.now(), Date.now(), Date.now());

        Logger.log('queue', `Message delivered immediately: ${to} (${msgId})`);
      } else {
        // Agent not ready - queue for later delivery
        Logger.log('queue', `Agent ${to} not ready, queueing message`);

        const db = StateDB.init();
        db.prepare(`
          INSERT INTO message_queue (filepath, to_agent, from_agent, msg_type, msg_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        `).run(filepath, to, from, type, msgId, Date.now(), Date.now());

        Logger.log('queue', `Message queued: ${to} (${msgId})`);
      }
    } catch (error) {
      Logger.error('queue', `Failed to handle message: ${error.message}`, {
        filepath,
        error: error.stack
      });
    }
  }

  /**
   * Get destination session name from 'to' field
   */
  static getDestinationSession(to) {
    if (!to) return null;

    if (to === 'core' || to === 'core/core') {
      return 'core';
    } else if (to.includes('/')) {
      const [targetMesh, targetAgent] = to.split('/');

      if (targetMesh === 'core' && targetAgent === 'core') {
        return 'core';
      } else {
        const sessions = TmuxInjector.listSessions();

        // First check if this is a persistent mesh with matching mesh/agent names
        // These sessions are named just "{mesh}" not "{mesh}-{agent}"
        if (targetMesh === targetAgent && sessions.includes(targetMesh)) {
          return targetMesh;
        }

        // Otherwise look for standard pattern: {mesh}-{uuid}-{agent} or {mesh}-{agent}
        const matchingSession = sessions.find(s => {
          return s.startsWith(`${targetMesh}-`) && s.endsWith(`-${targetAgent}`);
        });
        return matchingSession || `${targetMesh}-${targetAgent}`;
      }
    }
    return null;
  }

  /**
   * Validate message routing against mesh config rules
   */
  static validateRouting(message, sourceMesh, sourceAgent) {
    const { status, to, from } = message.metadata;

    // No validation if no status
    if (!status) {
      return { valid: true };
    }

    // Validate route against mesh config
    const routeValidation = Routing.validateRoute(sourceMesh, sourceAgent, status, to);
    if (!routeValidation.valid) {
      return routeValidation;
    }

    // Check iteration limit (max 3 iterations)
    const iterationCheck = Routing.checkIterationLimit(from, to, status, 3);
    if (iterationCheck.exceeded) {
      return {
        valid: false,
        error: `Max routing iterations exceeded for ${from} → ${to} (status: ${status}). Current: ${iterationCheck.count}, Limit: ${iterationCheck.limit}`
      };
    }

    return { valid: true };
  }

  /**
   * Load mesh config for a given mesh
   */
  static loadMeshConfig(meshName) {
    try {
      const configPath = PATHS.meshConfig(meshName);
      if (!fs.existsSync(configPath)) {
        return null;
      }
      return fs.readJsonSync(configPath);
    } catch (error) {
      Logger.warn('queue', `Failed to load mesh config for ${meshName}: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate completion_agent for task-complete messages
   */
  static validateCompletionAgent(sourceMesh, sourceAgent, type) {
    // Only validate task-complete messages
    if (type !== 'task-complete') {
      return;
    }

    // Load mesh config
    const meshConfig = Queue.loadMeshConfig(sourceMesh);
    if (!meshConfig) {
      Logger.warn('queue', `Cannot validate completion_agent: mesh config not found for ${sourceMesh}`);
      return;
    }

    // Check if completion_agent is specified
    if (!meshConfig.completion_agent) {
      Logger.warn('queue', `task-complete sent but no completion_agent specified in mesh config for ${sourceMesh}`, {
        from: `${sourceMesh}/${sourceAgent}`,
        type
      });
      return;
    }

    // Validate that the sending agent matches completion_agent
    if (sourceAgent !== meshConfig.completion_agent) {
      Logger.warn('queue', `task-complete sent by ${sourceAgent} but completion_agent is ${meshConfig.completion_agent}`, {
        mesh: sourceMesh,
        sender: sourceAgent,
        expected: meshConfig.completion_agent
      });
    } else {
      Logger.log('queue', `task-complete validated: sent by completion_agent ${sourceAgent}`, {
        mesh: sourceMesh,
        agent: sourceAgent
      });
    }
  }

  /**
   * Route message to destination (synchronous)
   * @deprecated This method is no longer used. EventLogConsumer handles message delivery.
   * Kept for backward compatibility only.
   */
  static routeMessage(sourceMesh, sourceAgent, message, filepath) {
    Logger.warn('queue', 'Queue.routeMessage() is deprecated and should not be called', {
      info: 'EventLogConsumer now handles all message delivery',
      from: message?.metadata?.from || 'unknown',
      to: message?.metadata?.to || 'unknown'
    });

    // No-op - EventLogConsumer handles message delivery
    // This method is kept for backward compatibility but does nothing
  }

  /**
   * Record that a message has been delivered to an agent
   * Prevents re-delivery of the same message to other agents
   */
  static recordMessageDelivery(filepath, deliveredTo) {
    try {
      const filename = path.basename(filepath);
      const deliveryDir = '.ai/tx/state/delivered';
      fs.ensureDirSync(deliveryDir);

      // Create a marker file: {msgid}.delivered with content showing which agent got it
      const msgIdMatch = filename.match(/-([a-z0-9]{6})\.md$/);
      if (!msgIdMatch) {
        return;
      }

      const msgId = msgIdMatch[1];
      const deliveryFile = path.join(deliveryDir, `${msgId}.json`);

      // Track delivery history
      let delivery = { msgId, deliveries: [] };
      if (fs.existsSync(deliveryFile)) {
        delivery = fs.readJsonSync(deliveryFile);
      }

      delivery.deliveries.push({
        to: deliveredTo,
        timestamp: new Date().toISOString()
      });

      fs.writeJsonSync(deliveryFile, delivery, { spaces: 2 });
      Logger.log('queue', `Recorded delivery: ${msgId} → ${deliveredTo}`);
    } catch (error) {
      Logger.warn('queue', `Failed to record message delivery: ${error.message}`);
    }
  }

  /**
   * Check if a centralized message has already been delivered
   * Prevents re-delivery of orphaned messages
   */
  static hasMessageBeenDelivered(filepath, toAgent = null) {
    try {
      const filename = path.basename(filepath);
      const msgIdMatch = filename.match(/-([a-z0-9]{6})\.md$/);
      if (!msgIdMatch) {
        return false;
      }

      const msgId = msgIdMatch[1];
      const deliveryFile = path.join('.ai/tx/state/delivered', `${msgId}.json`);

      if (!fs.existsSync(deliveryFile)) {
        return false;
      }

      const delivery = fs.readJsonSync(deliveryFile);

      // If no specific agent requested, check if delivered at all
      if (!toAgent) {
        return delivery.deliveries && delivery.deliveries.length > 0;
      }

      // Check if delivered to this specific agent
      return delivery.deliveries && delivery.deliveries.some(d => {
        // Match agent name or mesh/agent format
        return d.to === toAgent || d.to.endsWith(`/${toAgent}`);
      });
    } catch (error) {
      Logger.warn('queue', `Failed to check message delivery status: ${error.message}`);
      return false;
    }
  }

  /**
   * Mark message as complete (rename to *-done.md)
   */
  static completeMessage(mesh, agent, filename) {
    try {
      const msgsDir = `.ai/tx/mesh/${mesh}/agents/${agent}/msgs`;
      const currentPath = path.join(msgsDir, filename);
      const donePath = path.join(msgsDir, filename.replace('.md', '-done.md'));

      if (fs.existsSync(currentPath)) {
        fs.renameSync(currentPath, donePath);  // Atomic operation
        Logger.log('queue', `Message completed: ${filename} → ${filename.replace('.md', '-done.md')}`);
      }

    } catch (error) {
      Logger.error('queue', `Error completing message: ${error.message}`);
    }
  }

  /**
   * Mark message as failed (rename to *-failed.md)
   */
  static markMessageFailed(filepath, reason) {
    try {
      const failedPath = filepath.replace('.md', '-failed.md');

      if (fs.existsSync(filepath)) {
        // Append failure reason to message
        const content = fs.readFileSync(filepath, 'utf8');
        const failedContent = content + `\n\n---\n\n**ROUTING FAILED**: ${reason}\n`;
        fs.writeFileSync(failedPath, failedContent);
        fs.unlinkSync(filepath);

        Logger.log('queue', `Message marked as failed: ${path.basename(filepath)} → ${path.basename(failedPath)}`);
      }
    } catch (error) {
      Logger.error('queue', `Error marking message as failed: ${error.message}`);
    }
  }

  /**
   * Get queue status for a mesh/agent
   * Returns compatible format with old Queue.getQueueStatus
   */
  static getQueueStatus(mesh, agent = null) {
    try {
      if (agent) {
        // Get status for specific agent
        const msgsDir = `.ai/tx/mesh/${mesh}/agents/${agent}/msgs`;

        if (!fs.existsSync(msgsDir)) {
          return { total: 0, active: 0, done: 0, queued: 0 };
        }

        const files = fs.readdirSync(msgsDir).filter(f => f.endsWith('.md'));
        const doneFiles = files.filter(f => f.endsWith('-done.md'));
        const activeFiles = files.filter(f => !f.endsWith('-done.md'));

        return {
          total: files.length,
          active: activeFiles.length,
          done: doneFiles.length,
          queued: activeFiles.length  // Pending messages
        };

      } else {
        // Get status for entire mesh
        const agentsDir = `.ai/tx/mesh/${mesh}/agents`;

        if (!fs.existsSync(agentsDir)) {
          return { total: 0, active: 0, done: 0, queued: 0 };
        }

        const agents = fs.readdirSync(agentsDir).filter(d => {
          return fs.statSync(path.join(agentsDir, d)).isDirectory();
        });

        let total = 0, active = 0, done = 0, queued = 0;

        agents.forEach(agentName => {
          const status = Queue.getQueueStatus(mesh, agentName);
          total += status.total;
          active += status.active;
          done += status.done;
          queued += status.queued;
        });

        return { total, active, done, queued };
      }

    } catch (error) {
      Logger.error('queue', `Error getting queue status: ${error.message}`);
      return { total: 0, active: 0, done: 0, queued: 0 };
    }
  }

  /**
   * Get state for an agent
   * @deprecated Use StateManager.getState(agentId) instead
   * This method is maintained for backward compatibility only
   */
  static getState(mesh, agent) {
    Logger.warn('queue', 'Queue.getState() is deprecated. Use StateManager.getState() instead', {
      mesh,
      agent
    });

    // Delegate to StateManager (SQLite-backed)
    const { StateManager } = require('./state-manager');
    const agentId = `${mesh}/${agent}`;
    const state = StateManager.getState(agentId);

    if (!state) {
      return { active: null, status: 'idle' };
    }

    // Convert to old format for compatibility
    return {
      active: state.currentTask,
      status: state.state,
      last_activity: state.lastActivity,
      updated_at: state.updatedAt
    };
  }

  /**
   * Set state for an agent
   * @deprecated Use StateManager.transitionState(agentId, state) instead
   * This method is maintained for backward compatibility only
   */
  static setState(mesh, agent, state) {
    Logger.warn('queue', 'Queue.setState() is deprecated. Use StateManager.transitionState() instead', {
      mesh,
      agent,
      state: state.status
    });

    // Delegate to StateManager (SQLite-backed)
    const { StateManager } = require('./state-manager');
    const agentId = `${mesh}/${agent}`;

    try {
      // Map old status values to new state values
      const stateMapping = {
        'idle': StateManager.STATES.READY,
        'working': StateManager.STATES.WORKING,
        'blocked': StateManager.STATES.BLOCKED,
        'error': StateManager.STATES.ERROR
      };

      const newState = stateMapping[state.status] || StateManager.STATES.READY;
      StateManager.transitionState(agentId, newState);

      // Update task if present
      if (state.active) {
        StateManager.updateTask(agentId, state.active);
      }

      Logger.log('queue', `State delegated to StateManager: ${mesh}/${agent} - ${newState}`);
    } catch (error) {
      Logger.error('queue', `Error updating state via StateManager: ${error.message}`);
    }
  }

  /**
   * Process queue backlog for a mesh
   * Called when mesh/agent is first spawned
   */
  static processQueueBacklog(mesh, agent = null) {
    Logger.log('queue', `Processing queue backlog for ${mesh}${agent ? `/${agent}` : ''}`);

    try {
      if (agent) {
        // Process backlog for specific agent
        const msgsDir = `.ai/tx/mesh/${mesh}/agents/${agent}/msgs`;

        if (!fs.existsSync(msgsDir)) {
          return;
        }

        const files = fs.readdirSync(msgsDir)
          .filter(f => f.endsWith('.md') && !f.endsWith('-done.md'));

        files.forEach(file => {
          const filepath = path.join(msgsDir, file);
          Queue.handleNewMessage({ mesh, agent, file, filepath });
        });

        // Only log if there were messages to process
        if (files.length > 0) {
          Logger.log('queue', `Processed ${files.length} backlog messages for ${mesh}/${agent}`);
        }

      } else {
        // Process backlog for all agents in mesh
        const agentsDir = `.ai/tx/mesh/${mesh}/agents`;

        if (!fs.existsSync(agentsDir)) {
          return;
        }

        const agents = fs.readdirSync(agentsDir).filter(d => {
          return fs.statSync(path.join(agentsDir, d)).isDirectory();
        });

        agents.forEach(agentName => {
          Queue.processQueueBacklog(mesh, agentName);
        });
      }

    } catch (error) {
      Logger.error('queue', `Error processing backlog: ${error.message}`);
    }
  }

  /**
   * Shutdown queue
   */
  static shutdown() {
    if (!Queue.initialized) {
      return;
    }

    Logger.log('queue', 'Shutting down queue utility system');
    // REMOVED: Event listener cleanup (no longer registered)

    // Retry queue removed

    Queue.initialized = false;
  }
}

module.exports = { Queue };
