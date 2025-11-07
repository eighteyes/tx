const fs = require('fs-extra');
const path = require('path');
const { EventBus } = require('./event-bus');
const { Logger } = require('./logger');
const { TmuxInjector } = require('./tmux-injector');
const { Message } = require('./message');
const { RetryQueue } = require('./retry-queue');
const { Routing } = require('./routing');
const { AgentPath } = require('./utils/agent-path');

/**
 * Simplified queue system for single msgs/ folder
 *
 * Key changes from complex queue:
 * - Single directory: msgs/
 * - State tracked in state.json (not file location)
 * - Atomic renames (not file moves)
 * - Messages renamed to *-done.md when complete
 * - No auto-deletion on task-complete
 * - Single event listener: file:msgs:new
 * - Idle detection and FIFO queuing handled at TmuxInjector level
 */
class Queue {
  static initialized = false;

  /**
   * Initialize queue system
   */
  static initialize() {
    if (Queue.initialized) {
      return;
    }

    Logger.log('queue', 'Initializing simplified queue system');

    // Listen for new message files
    EventBus.on('file:msgs:new', Queue.handleNewMessage);

    // Start retry queue processor
    RetryQueue.start();

    Queue.initialized = true;
    Logger.log('queue', 'Simplified queue initialized');
  }

  /**
   * Handle new message file detected
   * Now just routes immediately - injection-level queuing handles idle waiting
   */
  static handleNewMessage({ mesh, agent, file, filepath }) {
    try {
      // Check if file still exists (might have been processed already)
      if (!fs.existsSync(filepath)) {
        Logger.log('queue', `File no longer exists: ${filepath}`);
        return;
      }

      // Parse message
      const message = Message.parseMessage(filepath);

      if (!message) {
        Logger.error('queue', `Failed to parse message: ${filepath}`);
        return;
      }

      // Route message directly - TmuxInjector will handle queueing and idle waiting
      Queue.routeMessage(mesh, agent, message, filepath);

    } catch (error) {
      Logger.error('queue', `Error processing message ${filepath}: ${error.message}`);
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
    const { status, to } = message.metadata;

    // No validation if no status
    if (!status) {
      return { valid: true };
    }

    return Routing.validateRoute(sourceMesh, sourceAgent, status, to);
  }

  /**
   * Route message to destination (synchronous)
   * This now just handles the injection, session determination is done earlier
   */
  static routeMessage(sourceMesh, sourceAgent, message, filepath) {
    const { to, type, from } = message.metadata;

    // Validate required fields
    if (!to) {
      Logger.error('queue', `Message missing 'to' field: ${filepath}`);
      return;
    }

    if (!from) {
      Logger.error('queue', `Message missing 'from' field: ${filepath}`);
      return;
    }

    // Validate routing against mesh config
    const validation = Queue.validateRouting(message, sourceMesh, sourceAgent);
    if (!validation.valid) {
      Logger.warn('queue', `Routing validation warning: ${validation.error}`, {
        filepath,
        from,
        to,
        status: message.metadata.status
      });
      // Continue routing but log the warning
    }

    // Get destination session
    const sessionName = Queue.getDestinationSession(to);

    if (!sessionName) {
      Logger.error('queue', `Invalid destination format: ${to}`);
      return;
    }

    // Check if target session exists
    if (!TmuxInjector.sessionExists(sessionName)) {
      Logger.warn('queue', `Target session not found: ${sessionName}, queueing for retry`, { from, to, filepath });

      // Add to retry queue instead of dropping
      const isPrompt = type === 'prompt';
      RetryQueue.enqueue(sessionName, filepath, isPrompt, 'session-not-found', {
        from,
        to,
        type
      });
      return;
    }

    // Inject message into target session
    try {
      // Pass isPrompt=true for prompt-type messages
      const isPrompt = type === 'prompt';
      const success = TmuxInjector.injectFile(sessionName, filepath, isPrompt);

      if (!success) {
        Logger.warn('queue', `Injection failed, queueing for retry: ${from} → ${to}`);
        RetryQueue.enqueue(sessionName, filepath, isPrompt, 'injection-failed', {
          from,
          to,
          type
        });
        return;
      }

      Logger.log('queue', `Routed: ${from} → ${to}`);

      // Record that this message was delivered to this agent (prevents re-delivery)
      Queue.recordMessageDelivery(filepath, to);

      // If this is a task-complete message going to core, mark it as done
      if (type === 'task-complete' && (to === 'core' || to === 'core/core')) {
        const filename = filepath.split('/').pop();
        Queue.completeMessage(sourceMesh, sourceAgent, filename);
        Logger.log('queue', `Marked task-complete as done: ${filename}`);
      }

    } catch (error) {
      Logger.error('queue', `Failed to inject message into ${sessionName}: ${error.message}`);

      // Queue for retry on error
      const isPrompt = type === 'prompt';
      RetryQueue.enqueue(sessionName, filepath, isPrompt, `error: ${error.message}`, {
        from,
        to,
        type
      });
    }
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
   */
  static getState(mesh, agent) {
    try {
      const statePath = `.ai/tx/mesh/${mesh}/agents/${agent}/state.json`;

      if (!fs.existsSync(statePath)) {
        return { active: null, status: 'idle' };
      }

      return fs.readJsonSync(statePath);

    } catch (error) {
      Logger.error('queue', `Error reading state: ${error.message}`);
      return { active: null, status: 'idle' };
    }
  }

  /**
   * Set state for an agent
   */
  static setState(mesh, agent, state) {
    try {
      const statePath = `.ai/tx/mesh/${mesh}/agents/${agent}/state.json`;
      fs.writeJsonSync(statePath, state, { spaces: 2 });
      Logger.log('queue', `State updated: ${mesh}/${agent} - ${state.status}`);

    } catch (error) {
      Logger.error('queue', `Error writing state: ${error.message}`);
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

    Logger.log('queue', 'Shutting down simplified queue');
    EventBus.off('file:msgs:new', Queue.handleNewMessage);

    // Stop retry queue processor
    RetryQueue.stop();

    Queue.initialized = false;
  }
}

module.exports = { Queue };
