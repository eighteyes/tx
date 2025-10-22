const fs = require('fs-extra');
const path = require('path');
const { EventBus } = require('./event-bus');
const { Logger } = require('./logger');
const { TmuxInjector } = require('./tmux-injector');
const { Message } = require('./message');

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
 */
class SimpleQueue {
  static initialized = false;

  /**
   * Initialize queue system
   */
  static initialize() {
    if (SimpleQueue.initialized) {
      return;
    }

    Logger.log('queue', 'Initializing simplified queue system');

    // Listen for new message files
    EventBus.on('file:msgs:new', SimpleQueue.handleNewMessage);

    SimpleQueue.initialized = true;
    Logger.log('queue', 'Simplified queue initialized');
  }

  /**
   * Handle new message file detected
   */
  static handleNewMessage({ mesh, agent, file, filepath }) {
    // Reduced logging verbosity - only log in debug mode
    // Logger.log('queue', `Processing new message: ${mesh}/${agent} - ${file}`);

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

      // Route message based on type and destination
      SimpleQueue.routeMessage(mesh, agent, message, filepath);

    } catch (error) {
      Logger.error('queue', `Error processing message ${filepath}: ${error.message}`);
    }
  }

  /**
   * Route message to destination
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

    // Reduced logging verbosity
    // Logger.log('queue', `Routing message: ${from} → ${to} (type: ${type})`);

    // Determine destination session
    let sessionName;

    if (to === 'core' || to === 'core/core') {
      // Both 'core' and 'core/core' route to the 'core' session
      sessionName = 'core';
    } else if (to.includes('/')) {
      // Format: mesh/agent (e.g., "test-echo/echo")
      const [targetMesh, targetAgent] = to.split('/');

      // Special case: core/core should map to just "core"
      if (targetMesh === 'core' && targetAgent === 'core') {
        sessionName = 'core';
      } else {
        // Find the actual tmux session (which may have a UUID suffix)
        // Pattern: {mesh}-{uuid}-{agent} or {mesh}-{agent}
        const sessions = TmuxInjector.listSessions();

        // Try to find exact match with instance (e.g., "test-echo-abc123-echo")
        const matchingSession = sessions.find(s => {
          // Match: starts with targetMesh, ends with -targetAgent
          return s.startsWith(`${targetMesh}-`) && s.endsWith(`-${targetAgent}`);
        });

        if (matchingSession) {
          sessionName = matchingSession;
        } else {
          // Fallback: try without UUID (old behavior)
          sessionName = `${targetMesh}-${targetAgent}`;
        }
      }
    } else {
      Logger.error('queue', `Invalid destination format: ${to}`);
      return;
    }

    // Check if target session exists before attempting injection
    if (!TmuxInjector.sessionExists(sessionName)) {
      Logger.warn('queue', `Target session not found: ${sessionName}, message queued for later delivery`, {
        from,
        to,
        sessionName,
        filepath
      });
      return;  // Leave message in queue for when agent comes online
    }

    // Inject message into target session
    try {
      // Reduced logging - only log successful routing
      TmuxInjector.injectFile(sessionName, filepath);
      Logger.log('queue', `Routed: ${from} → ${to}`);

      // If this is a task-complete message going to core, mark it as done
      if (type === 'task-complete' && to === 'core') {
        const filename = filepath.split('/').pop();
        SimpleQueue.completeMessage(sourceMesh, sourceAgent, filename);
        Logger.log('queue', `Marked task-complete as done: ${filename}`);
      }

    } catch (error) {
      Logger.error('queue', `Failed to inject message into ${sessionName}: ${error.message}`);
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
          const status = SimpleQueue.getQueueStatus(mesh, agentName);
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
          SimpleQueue.handleNewMessage({ mesh, agent, file, filepath });
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
          SimpleQueue.processQueueBacklog(mesh, agentName);
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
    if (!SimpleQueue.initialized) {
      return;
    }

    Logger.log('queue', 'Shutting down simplified queue');
    EventBus.off('file:msgs:new', SimpleQueue.handleNewMessage);
    SimpleQueue.initialized = false;
  }
}

module.exports = { SimpleQueue };
