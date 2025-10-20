const fs = require('fs-extra');
const path = require('path');
const { Message } = require('./message');
const { EventBus } = require('./event-bus');
const { AtomicState } = require('./atomic-state');
const { Logger } = require('./logger');
const { Watcher } = require('./watcher');
const { Evidence } = require('./evidence');

class Queue {
  static initialized = false;
  static recentNotifications = new Map(); // Track recent notifications to prevent duplicates

  /**
   * Clear all message directories on startup
   * Ensures clean state before watcher starts
   */
  static clearAllMessages() {
    try {
      const meshesDir = '.ai/tx/mesh';

      if (!fs.existsSync(meshesDir)) {
        Logger.log('queue', 'No meshes directory found, skipping message cleanup');
        return;
      }

      const meshDirs = fs.readdirSync(meshesDir);
      let totalCleared = 0;

      meshDirs.forEach(mesh => {
        // Clear mesh-level queues
        const queues = ['inbox', 'next', 'active', 'outbox', 'complete', 'archive'];
        queues.forEach(queue => {
          const queueDir = path.join(meshesDir, mesh, 'msgs', queue);
          if (fs.existsSync(queueDir)) {
            const files = fs.readdirSync(queueDir).filter(f => f.endsWith('.md'));
            files.forEach(file => {
              fs.removeSync(path.join(queueDir, file));
              totalCleared++;
            });
          }
        });

        // Clear agent-level queues
        const agentsDir = path.join(meshesDir, mesh, 'agents');
        if (fs.existsSync(agentsDir)) {
          const agents = fs.readdirSync(agentsDir);
          agents.forEach(agent => {
            queues.forEach(queue => {
              const agentQueueDir = path.join(agentsDir, agent, 'msgs', queue);
              if (fs.existsSync(agentQueueDir)) {
                const files = fs.readdirSync(agentQueueDir).filter(f => f.endsWith('.md'));
                files.forEach(file => {
                  fs.removeSync(path.join(agentQueueDir, file));
                  totalCleared++;
                });
              }
            });
          });
        }
      });

      if (totalCleared > 0) {
        Logger.log('queue', `Cleared ${totalCleared} message files on startup`);
      }
    } catch (error) {
      Logger.error('queue', `Failed to clear messages: ${error.message}`, {
        error: error.stack
      });
    }
  }

  /**
   * Initialize queue event listeners
   * Called on system startup to register all event handlers
   */
  static init() {
    if (Queue.initialized) return;

    // Listen for new files in mesh inbox
    EventBus.on('file:inbox:new', ({ mesh, file }) => {
      Queue.processInbox(mesh);
    });

    // Listen for new files in agent inbox
    EventBus.on('file:agent-inbox:new', ({ mesh, agent, file }) => {
      Queue.processAgentInbox(mesh, agent);
    });

    // Listen for new files in agent next (move to active)
    EventBus.on('file:agent-next:new', ({ mesh, agent, file }) => {
      Queue.processAgentNext(mesh, agent);
    });

    // Listen for request to process next
    EventBus.on('queue:process:next', ({ mesh }) => {
      Queue.processNext(mesh);
    });

    // Listen for file completion
    EventBus.on('file:complete:new', ({ mesh }) => {
      Queue.processNext(mesh);
    });

    // Listen for active removal
    EventBus.on('file:active:removed', ({ mesh }) => {
      Queue.processNext(mesh);
    });

    // Listen for agent active removal (process agent next)
    EventBus.on('file:agent-active:removed', ({ mesh, agent }) => {
      Queue.processAgentNext(mesh, agent);
    });

    // Listen for ask messages (fast-track to agent inbox)
    EventBus.on('file:ask:new', ({ mesh, agent, file }) => {
      // Ask messages go directly to agent for fast processing
      Logger.log('queue', 'Ask message fast-tracked', { mesh, agent, file });
      Queue.processAgentInbox(mesh, agent);
    });

    // Listen for ask responses
    EventBus.on('file:ask-response:new', ({ mesh, agent, file }) => {
      // Ask responses go to agent inbox
      Logger.log('queue', 'Ask response delivered', { mesh, agent, file });
      Queue.processAgentInbox(mesh, agent);
    });

    // Listen for outbox messages (responses from agents waiting to be routed)
    EventBus.on('file:outbox:new', ({ mesh, file, filepath }) => {
      Logger.log('queue', 'Processing mesh-level outbox event', { mesh, file });
      try {
        Queue.processOutbox(mesh, null, file, filepath);
      } catch (error) {
        Logger.error('queue', `Error processing mesh outbox: ${error.message}`, {
          mesh,
          file,
          filepath,
          error: error.stack
        });
      }
    });

    // Listen for agent outbox messages
    EventBus.on('file:agent-outbox:new', ({ mesh, agent, file, filepath }) => {
      Logger.log('queue', 'Processing agent-level outbox event', { mesh, agent, file });
      try {
        Queue.processOutbox(mesh, agent, file, filepath);
      } catch (error) {
        Logger.error('queue', `Error processing agent outbox: ${error.message}`, {
          mesh,
          agent,
          file,
          filepath,
          error: error.stack
        });
      }
    });

    // Listen for agent active files (notify agent to process task)
    EventBus.on('file:agent-active:new', ({ mesh, agent, file, filepath }) => {
      Queue.notifyAgent(mesh, agent, file, filepath);
    });

    Queue.initialized = true;
    Logger.log('queue', 'Queue system initialized');
  }

  /**
   * Process all queued messages for a mesh when it spawns
   * Processes queues in order: outbox → active → next → inbox
   * This ensures all backlog is delivered when a mesh comes online (eventual consistency)
   *
   * @param {string} mesh - Mesh name to process
   */
  static processQueueBacklog(mesh) {
    try {
      const meshDir = `.ai/tx/mesh/${mesh}`;
      const agentsDir = path.join(meshDir, 'agents');

      if (!fs.existsSync(meshDir)) {
        Logger.log('queue', 'Mesh directory not found for backlog processing', { mesh });
        return;
      }

      Logger.log('queue', 'Processing queue backlog for mesh', { mesh });

      // Process in order: outbox → active → next → inbox
      const queueOrder = ['outbox', 'active', 'next', 'inbox'];

      // 1. Process mesh-level queues
      Logger.log('queue', 'Processing mesh-level queues', { mesh });
      queueOrder.forEach(queue => {
        Queue._processQueueBacklogForPath(meshDir, queue, null);
      });

      // 2. Process agent-level queues for all agents
      if (fs.existsSync(agentsDir)) {
        const agents = fs.readdirSync(agentsDir);

        agents.forEach(agent => {
          const agentDir = path.join(agentsDir, agent);
          Logger.log('queue', 'Processing agent queues', { mesh, agent });

          queueOrder.forEach(queue => {
            Queue._processQueueBacklogForPath(agentDir, queue, agent);
          });
        });
      }

      Logger.log('queue', 'Queue backlog processing complete', { mesh });
    } catch (error) {
      Logger.error('queue', `Failed to process queue backlog: ${error.message}`, {
        mesh,
        error: error.stack
      });
    }
  }

  /**
   * Process a specific queue for backlog
   * Handles the first file in the queue, which recursively processes the rest
   *
   * @param {string} baseDir - Base directory (mesh or agent)
   * @param {string} queue - Queue name (outbox, active, next, inbox)
   * @param {string|null} agent - Agent name (null for mesh-level)
   */
  static _processQueueBacklogForPath(baseDir, queue, agent) {
    try {
      const queueDir = path.join(baseDir, 'msgs', queue);

      if (!fs.existsSync(queueDir)) {
        return;
      }

      const queueFiles = fs.readdirSync(queueDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      if (queueFiles.length === 0) {
        return;
      }

      const mesh = baseDir.match(/\.ai\/tx\/mesh\/([^/]+)/)?.[1];
      if (!mesh) return;

      Logger.log('queue', `Processing ${queue} backlog`, {
        mesh,
        agent,
        fileCount: queueFiles.length
      });

      // Process first file based on queue type
      const firstFile = queueFiles[0];
      const firstFilepath = path.join(queueDir, firstFile);

      if (queue === 'outbox') {
        // For outbox: route to destination
        Queue.processOutbox(mesh, agent, firstFile, firstFilepath);
      } else if (queue === 'active') {
        // For active: notify agent to process
        if (agent) {
          Queue.notifyAgent(mesh, agent, firstFile, firstFilepath);
        }
        // For mesh-level active: would need mesh-level agent handling
      } else if (queue === 'next') {
        // For next: move to active (only if active is empty)
        if (agent) {
          Queue.processAgentNext(mesh, agent);
        } else {
          Queue.processNext(mesh);
        }
      } else if (queue === 'inbox') {
        // For inbox: move to next (only if next is empty)
        if (agent) {
          Queue.processAgentInbox(mesh, agent);
        } else {
          Queue.processInbox(mesh);
        }
      }
    } catch (error) {
      Logger.error('queue', `Failed to process queue backlog for ${queue}: ${error.message}`, {
        error: error.stack
      });
    }
  }

  /**
   * Get default agent for a mesh from its config
   *
   * @param {string} mesh - Mesh name
   * @returns {string|null} Default agent name or null if not found
   */
  static getDefaultAgent(mesh) {
    try {
      const configPath = path.join('meshes', 'mesh-configs', `${mesh}.json`);

      if (!fs.existsSync(configPath)) {
        Evidence.record(
          Evidence.Types.CONFIG_INVALID,
          `Mesh config not found: ${mesh}`,
          {
            mesh,
            component: 'queue',
            additional: { configPath }
          }
        );
        return null;
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // First try entry_point
      if (config.entry_point) {
        return config.entry_point;
      }

      // Fall back to first agent in agents array
      if (config.agents && config.agents.length > 0) {
        const firstAgent = config.agents[0];

        // Extract agent name if it has category prefix (e.g., "test/echo" -> "echo")
        if (firstAgent.includes('/')) {
          return firstAgent.split('/')[1];
        }

        return firstAgent;
      }

      Evidence.record(
        Evidence.Types.CONFIG_INVALID,
        `Mesh config has no entry_point or agents: ${mesh}`,
        {
          mesh,
          component: 'queue',
          additional: { config }
        }
      );

      return null;
    } catch (error) {
      Evidence.record(
        Evidence.Types.CONFIG_INVALID,
        `Failed to read mesh config: ${error.message}`,
        {
          mesh,
          component: 'queue',
          additional: { error: error.stack }
        }
      );
      return null;
    }
  }

  /**
   * Process inbox: move first message to next (if next is empty)
   */
  static processInbox(mesh) {
    try {
      const meshDir = `.ai/tx/mesh/${mesh}`;
      const inboxDir = path.join(meshDir, 'msgs', 'inbox');

      fs.ensureDirSync(inboxDir);

      // Get first file from inbox (FIFO)
      const inboxFiles = fs.readdirSync(inboxDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      if (inboxFiles.length === 0) {
        // Inbox is empty
        return;
      }

      const firstFile = inboxFiles[0];
      const fromPath = path.join(inboxDir, firstFile);

      // Read frontmatter to determine target agent
      const content = fs.readFileSync(fromPath, 'utf8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let targetAgent = null;

      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const toMatch = frontmatter.match(/^to:\s*(.+)$/m);
        if (toMatch) {
          const toValue = toMatch[1].trim();
          // If "to" is mesh/agent format, extract agent
          if (toValue.includes('/')) {
            targetAgent = toValue.split('/')[1];
          }
        }
      }

      // Fallback to current_agent from mesh state
      if (!targetAgent) {
        const { AtomicState } = require('./atomic-state');
        const state = AtomicState.read(mesh);
        targetAgent = state.current_agent;
      }

      if (!targetAgent) {
        Logger.error('queue', 'Cannot route message: no target agent found', {
          mesh,
          filename: firstFile
        });
        return;
      }

      // Route to agent inbox
      const agentInboxDir = path.join(meshDir, 'agents', targetAgent, 'msgs', 'inbox');
      fs.ensureDirSync(agentInboxDir);

      const toPath = path.join(agentInboxDir, firstFile);

      Watcher.ignoreNextOperation(toPath);
      fs.moveSync(fromPath, toPath, { overwrite: true });

      // Emit event
      EventBus.emit('task:queued', {
        mesh,
        agent: targetAgent,
        filename: firstFile
      });

      Logger.log('queue', `Message routed: inbox → ${targetAgent}/inbox`, {
        mesh,
        agent: targetAgent,
        filename: firstFile
      });

      // Recursively process if more messages in inbox
      if (inboxFiles.length > 1) {
        setImmediate(() => Queue.processInbox(mesh));
      }
    } catch (error) {
      Logger.error('queue', `Failed to process inbox: ${error.message}`, {
        mesh,
        error: error.stack
      });
    }
  }

  /**
   * Process next: move message to active (if active is empty)
   */
  static processNext(mesh) {
    try {
      const meshDir = `.ai/tx/mesh/${mesh}`;
      const nextDir = path.join(meshDir, 'msgs', 'next');
      const activeDir = path.join(meshDir, 'msgs', 'active');

      fs.ensureDirSync(nextDir);
      fs.ensureDirSync(activeDir);

      // Check if active queue is empty
      const activeFiles = fs.readdirSync(activeDir).filter(f => f.endsWith('.md'));
      if (activeFiles.length > 0) {
        // Active queue is full, can't process next
        return;
      }

      // Get first file from next (FIFO)
      const nextFiles = fs.readdirSync(nextDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      if (nextFiles.length === 0) {
        // Next queue is empty
        return;
      }

      const firstFile = nextFiles[0];

      // Move to active
      const fromPath = path.join(nextDir, firstFile);
      const toPath = path.join(activeDir, firstFile);

      Watcher.ignoreNextOperation(toPath);
      fs.moveSync(fromPath, toPath, { overwrite: true });

      // Emit event
      EventBus.emit('task:activated', {
        mesh,
        filename: firstFile
      });

      Logger.log('queue', 'Message moved: next → active', {
        mesh,
        filename: firstFile
      });

      // Update state
      AtomicState.updateSync(mesh, {
        status: 'processing'
      });

      // Try to process inbox after moving to active
      setImmediate(() => Queue.processInbox(mesh));
    } catch (error) {
      Logger.error('queue', `Failed to process next: ${error.message}`, {
        mesh,
        error: error.stack
      });
    }
  }

  /**
   * Complete a task: move from active to complete
   * If multi-agent workflow, create handoff to next agent
   */
  static complete(mesh, filename) {
    try {
      const meshDir = `.ai/tx/mesh/${mesh}`;
      const activeDir = path.join(meshDir, 'msgs', 'active');
      const completeDir = path.join(meshDir, 'msgs', 'complete');

      fs.ensureDirSync(activeDir);
      fs.ensureDirSync(completeDir);

      const fromPath = path.join(activeDir, filename);
      const toPath = path.join(completeDir, filename);

      if (!fs.existsSync(fromPath)) {
        Logger.warn('queue', `Cannot complete - file not found: ${filename}`, {
          mesh
        });
        return;
      }

      // Move to complete
      Watcher.ignoreNextOperation(toPath);
      fs.moveSync(fromPath, toPath, { overwrite: true });

      Logger.log('queue', 'Message completed: active → complete', {
        mesh,
        filename
      });

      // Update task completion count
      const state = AtomicState.read(mesh);
      AtomicState.updateSync(mesh, {
        tasks_completed: (state.tasks_completed || 0) + 1
      });

      // Check for workflow advancement
      if (state.workflow && state.workflow.length > 0) {
        Queue._advanceWorkflow(mesh, state, filename);
      }

      // Trigger processing of next items
      EventBus.emit('queue:process:next', { mesh });
    } catch (error) {
      Logger.error('queue', `Failed to complete task: ${error.message}`, {
        mesh,
        filename,
        error: error.stack
      });
    }
  }

  /**
   * Advance workflow to next agent
   */
  static _advanceWorkflow(mesh, state, completedFile) {
    const { workflow, workflow_position } = state;

    if (!workflow || workflow_position >= workflow.length - 1) {
      // Workflow complete
      AtomicState.updateSync(mesh, {
        workflow_complete: true,
        status: 'complete'
      });

      Logger.log('queue', 'Workflow completed', { mesh });
      return;
    }

    // Move to next agent in workflow
    const nextPosition = workflow_position + 1;
    const nextAgent = workflow[nextPosition];
    const currentAgent = workflow[workflow_position];

    // Parse completed message for context
    const completedPath = path.join(mesh, 'msgs', 'complete', completedFile);
    let handoffContent = `---
from: ${mesh}/${currentAgent}
to: ${mesh}/${nextAgent}
type: task
status: start
timestamp: ${new Date().toISOString()}
---

# Handoff from ${currentAgent} to ${nextAgent}

Continue work from previous agent.`;

    try {
      if (fs.existsSync(completedPath)) {
        const parsed = Message.parseMessage(completedPath);
        handoffContent = `---
from: ${mesh}/${currentAgent}
to: ${mesh}/${nextAgent}
type: task
status: start
timestamp: ${new Date().toISOString()}
---

# Handoff from ${currentAgent} to ${nextAgent}

## Previous Work

${parsed.content}`;
      }
    } catch (e) {
      Logger.warn('queue', `Failed to parse completed message: ${e.message}`);
    }

    // Create handoff message in inbox
    const inboxDir = path.join(`.ai/tx/mesh/${mesh}`, 'msgs', 'inbox');
    fs.ensureDirSync(inboxDir);

    const timestamp = new Date().getTime();
    const handoffFile = `${timestamp}-handoff.md`;
    const handoffPath = path.join(inboxDir, handoffFile);

    Watcher.ignoreNextOperation(handoffPath);
    fs.writeFileSync(handoffPath, handoffContent);

    // Update state
    AtomicState.updateSync(mesh, {
      previous_agent: currentAgent,
      current_agent: nextAgent,
      workflow_position: nextPosition,
      status: 'processing'
    });

    Logger.log('queue', 'Workflow advanced', {
      mesh,
      from: currentAgent,
      to: nextAgent,
      position: `${nextPosition}/${workflow.length}`
    });

    // Process inbox to move handoff to next
    EventBus.emit('file:inbox:new', {
      mesh,
      file: handoffFile
    });
  }

  /**
   * Process outbox: route agent response messages to destination inbox
   * Supports both same-mesh and cross-mesh routing
   * Outbox contains messages created by agents that need to be delivered to their destinations
   *
   * Routing formats:
   * - "agent" → same mesh agent
   * - "mesh/agent" → cross-mesh to specific agent
   * - "mesh" → cross-mesh to default agent (core or first available)
   *
   * @param {string} mesh - Source mesh name
   * @param {string|null} agent - Source agent name (null for mesh-level outbox)
   * @param {string} file - Filename
   * @param {string} filepath - Full file path
   */
  static processOutbox(mesh, agent, file, filepath) {
    try {
      Logger.log('queue', 'processOutbox called', {
        mesh,
        agent: agent || '(mesh-level)',
        file,
        filepath
      });

      // Defensive: Check if file exists before processing
      if (!fs.existsSync(filepath)) {
        Logger.warn('queue', `Outbox file no longer exists (may have been moved): ${filepath}`, {
          mesh,
          agent,
          file
        });
        return;
      }

      Logger.log('queue', 'File exists, parsing message', { mesh, agent, file });

      // Read and parse the outbox message
      let message;
      try {
        message = Message.parseMessage(filepath);
      } catch (parseError) {
        Logger.error('queue', `Failed to parse outbox message: ${parseError.message}`, {
          mesh,
          agent,
          file,
          filepath,
          error: parseError.stack
        });

        // Record evidence of unparseable message
        Evidence.record(
          Evidence.Types.PARSE_ERROR,
          `Failed to parse outbox message`,
          {
            mesh,
            agent,
            file,
            queue: 'outbox',
            component: 'queue',
            filepath,
            additional: { parseError: parseError.message }
          }
        );

        return;
      }

      const { to, from, type } = message.metadata;

      // Validate required metadata
      if (!to) {
        Logger.error('queue', `Outbox message missing 'to' field: ${file}`, {
          mesh,
          agent,
          file
        });

        Evidence.record(
          Evidence.Types.INVALID_MESSAGE,
          `Outbox message missing required 'to' field`,
          {
            mesh,
            agent,
            file,
            queue: 'outbox',
            component: 'queue',
            filepath
          }
        );

        return;
      }

      // Auto-complete: If this is a task-complete message, clear the agent's active queue
      if (type === 'task-complete' && from) {
        const sourceAgent = from.includes('/') ? from.split('/')[1] : from;
        const completed = Queue.completeAgentTask(mesh, sourceAgent);
        Logger.log('queue', 'Auto-completed task on task-complete outbox', {
          mesh,
          agent: sourceAgent,
          type,
          completed
        });
      }

      let destMesh = mesh; // default to current mesh
      let destAgent = to;
      let isCrossMesh = false;

      // Determine if this is cross-mesh routing
      if (to.includes('/')) {
        // Explicit format: "destMesh/destAgent"
        [destMesh, destAgent] = to.split('/');
        isCrossMesh = destMesh !== mesh;
      } else {
        // Check if 'to' is a known mesh name (implicit cross-mesh routing)
        const possibleMeshPath = path.join('.ai/tx/mesh', to);
        if (fs.existsSync(possibleMeshPath)) {
          destMesh = to;

          // Get default agent from mesh config instead of hardcoding 'core'
          destAgent = Queue.getDefaultAgent(destMesh);

          if (!destAgent) {
            // No default agent found - use 'core' as last resort fallback
            destAgent = 'core';

            Evidence.record(
              Evidence.Types.HARDCODED_FALLBACK,
              `No default agent in mesh config, falling back to 'core'`,
              {
                mesh,
                agent: destAgent,
                file,
                component: 'queue',
                additional: {
                  destMesh,
                  frontmatter: { from, to, type }
                }
              }
            );
          }

          isCrossMesh = true;
        }
      }

      // Validate destination mesh exists
      const destMeshDir = path.join('.ai/tx/mesh', destMesh);
      if (!fs.existsSync(destMeshDir)) {
        Logger.error('queue', `Destination mesh not found: ${destMesh}`, {
          mesh,
          from,
          to,
          file
        });

        // Record evidence of unroutable message
        Evidence.record(
          Evidence.Types.MESH_NOT_FOUND,
          `Message stuck in outbox - destination mesh does not exist: ${destMesh}`,
          {
            mesh,
            agent,
            file,
            queue: 'outbox',
            component: 'queue',
            frontmatter: { from, to, type },
            additional: {
              destMesh,
              destMeshDir,
              filepath
            }
          }
        );

        return;
      }

      // Create destination inbox path
      const destAgentDir = path.join(destMeshDir, 'agents', destAgent, 'msgs', 'inbox');
      fs.ensureDirSync(destAgentDir);

      // Move file from outbox to destination inbox
      const outboxPath = filepath;
      const inboxPath = path.join(destAgentDir, file);

      Watcher.ignoreNextOperation(inboxPath);
      fs.moveSync(outboxPath, inboxPath, { overwrite: true });

      Logger.log('queue', `Message routed: outbox → ${isCrossMesh ? 'cross-mesh' : 'same-mesh'} inbox`, {
        from,
        sourceMesh: mesh,
        sourceAgent: agent,
        destMesh,
        destAgent,
        crossMesh: isCrossMesh,
        file
      });

      // Trigger processing of the destination agent's inbox
      // This will notify the destination mesh to process the message
      EventBus.emit('file:agent-inbox:new', {
        mesh: destMesh,
        agent: destAgent,
        file,
        filepath: inboxPath,
        queue: 'inbox'
      });

      // After successfully processing this file, process any remaining outbox files
      // This ensures all outbox messages are delivered, not just the first one
      if (agent) {
        // For agent outbox: process remaining files in agent's outbox
        Queue.processAgentOutboxQueue(mesh, agent);
      } else {
        // For mesh outbox: process remaining files in mesh outbox
        Queue.processMeshOutboxQueue(mesh);
      }
    } catch (error) {
      Logger.error('queue', `Failed to process outbox message: ${error.message}`, {
        mesh,
        agent,
        file,
        filepath,
        error: error.stack
      });

      // Record evidence of processing error
      Evidence.record(
        Evidence.Types.PROCESSING_ERROR,
        `Failed to process outbox message: ${error.message}`,
        {
          mesh,
          agent,
          file,
          queue: 'outbox',
          component: 'queue',
          filepath,
          additional: { error: error.message }
        }
      );
    }
  }

  /**
   * Process all remaining files in an agent's outbox queue
   * Called after successfully delivering one message to process the rest
   */
  static processAgentOutboxQueue(mesh, agent) {
    try {
      Logger.log('queue', 'processAgentOutboxQueue called', { mesh, agent });

      const agentDir = `.ai/tx/mesh/${mesh}/agents/${agent}`;
      const outboxDir = path.join(agentDir, 'msgs', 'outbox');

      if (!fs.existsSync(outboxDir)) {
        Logger.log('queue', 'Agent outbox dir does not exist', { mesh, agent, outboxDir });
        return;
      }

      const outboxFiles = fs.readdirSync(outboxDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      if (outboxFiles.length === 0) {
        Logger.log('queue', 'Agent outbox queue is empty', { mesh, agent });
        return;
      }

      // Process next file in outbox
      const nextFile = outboxFiles[0];
      const nextFilepath = path.join(outboxDir, nextFile);

      Logger.log('queue', 'Processing next outbox file in queue', {
        mesh,
        agent,
        file: nextFile,
        queueSize: outboxFiles.length
      });

      // Process the next file using setImmediate to avoid deep recursion
      setImmediate(() => {
        Logger.log('queue', 'setImmediate callback for agent outbox', { mesh, agent, file: nextFile });
        Queue.processOutbox(mesh, agent, nextFile, nextFilepath);
      });
    } catch (error) {
      Logger.error('queue', `Failed to process agent outbox queue: ${error.message}`, {
        mesh,
        agent,
        error: error.stack
      });
    }
  }

  /**
   * Process all remaining files in mesh's outbox queue
   * Called after successfully delivering one message to process the rest
   */
  static processMeshOutboxQueue(mesh) {
    try {
      Logger.log('queue', 'processMeshOutboxQueue called', { mesh });

      const meshDir = `.ai/tx/mesh/${mesh}`;
      const outboxDir = path.join(meshDir, 'msgs', 'outbox');

      if (!fs.existsSync(outboxDir)) {
        Logger.log('queue', 'Mesh outbox dir does not exist', { mesh, outboxDir });
        return;
      }

      const outboxFiles = fs.readdirSync(outboxDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      if (outboxFiles.length === 0) {
        Logger.log('queue', 'Mesh outbox queue is empty', { mesh });
        return;
      }

      // Process next file in outbox
      const nextFile = outboxFiles[0];
      const nextFilepath = path.join(outboxDir, nextFile);

      Logger.log('queue', 'Processing next mesh outbox file in queue', {
        mesh,
        file: nextFile,
        queueSize: outboxFiles.length
      });

      // Process the next file using setImmediate to avoid deep recursion
      setImmediate(() => {
        Logger.log('queue', 'setImmediate callback for mesh outbox', { mesh, file: nextFile });
        Queue.processOutbox(mesh, null, nextFile, nextFilepath);
      });
    } catch (error) {
      Logger.error('queue', `Failed to process mesh outbox queue: ${error.message}`, {
        mesh,
        error: error.stack
      });
    }
  }

  /**
   * Archive old messages
   */
  static archive(mesh, daysOld = 30) {
    try {
      const meshDir = `.ai/tx/mesh/${mesh}`;
      const completeDir = path.join(meshDir, 'msgs', 'complete');
      const archiveDir = path.join(meshDir, 'msgs', 'archive');

      fs.ensureDirSync(completeDir);
      fs.ensureDirSync(archiveDir);

      let archived = 0;
      const now = Date.now();
      const cutoff = now - daysOld * 24 * 60 * 60 * 1000;

      fs.readdirSync(completeDir).forEach(file => {
        const filepath = path.join(completeDir, file);
        const stat = fs.statSync(filepath);

        if (stat.mtimeMs < cutoff) {
          const archivePath = path.join(archiveDir, file);
          Watcher.ignoreNextOperation(archivePath);
          fs.moveSync(filepath, archivePath, { overwrite: true });
          archived++;
        }
      });

      Logger.log('queue', `Archived ${archived} messages`, { mesh, daysOld });
      return archived;
    } catch (error) {
      Logger.error('queue', `Failed to archive: ${error.message}`, { mesh });
      return 0;
    }
  }

  /**
   * Get queue status
   */
  static getQueueStatus(mesh) {
    const meshDir = `.ai/tx/mesh/${mesh}`;
    const getCount = (queue) => {
      const dir = path.join(meshDir, 'msgs', queue);
      if (!fs.existsSync(dir)) return 0;
      return fs.readdirSync(dir).filter(f => f.endsWith('.md')).length;
    };

    return {
      inbox: getCount('inbox'),
      next: getCount('next'),
      active: getCount('active'),
      complete: getCount('complete'),
      archive: getCount('archive')
    };
  }

  /**
   * Process agent inbox: move first message to next (if next is empty)
   */
  // AI: This could be made generic for agent / mesh and for msg/ folders
  static processAgentInbox(mesh, agent) {
    try {
      const agentDir = `.ai/tx/mesh/${mesh}/agents/${agent}`;
      const inboxDir = path.join(agentDir, 'msgs', 'inbox');
      const nextDir = path.join(agentDir, 'msgs', 'next');

      fs.ensureDirSync(inboxDir);
      fs.ensureDirSync(nextDir);

      // Check if next queue is empty
      const nextFiles = fs.readdirSync(nextDir).filter(f => f.endsWith('.md'));
      if (nextFiles.length > 0) {
        return;
      }

      // Get first file from inbox (FIFO)
      const inboxFiles = fs.readdirSync(inboxDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      if (inboxFiles.length === 0) {
        return;
      }

      const firstFile = inboxFiles[0];

      // Move to next
      const fromPath = path.join(inboxDir, firstFile);
      const toPath = path.join(nextDir, firstFile);

      Watcher.ignoreNextOperation(toPath);
      fs.moveSync(fromPath, toPath, { overwrite: true });

      Logger.log('queue', 'Agent message moved: inbox → next', {
        mesh,
        agent,
        filename: firstFile
      });

      // Recursively process if more messages
      if (inboxFiles.length > 1) {
        setImmediate(() => Queue.processAgentInbox(mesh, agent));
      }
    } catch (error) {
      Logger.error('queue', `Failed to process agent inbox: ${error.message}`, {
        mesh,
        agent,
        error: error.stack
      });
    }
  }

  /**
   * Process agent next: move message to active (if active is empty)
   */
  static processAgentNext(mesh, agent) {
    try {
      const agentDir = `.ai/tx/mesh/${mesh}/agents/${agent}`;
      const nextDir = path.join(agentDir, 'msgs', 'next');
      const activeDir = path.join(agentDir, 'msgs', 'active');

      fs.ensureDirSync(nextDir);
      fs.ensureDirSync(activeDir);

      // Check if active queue is empty
      const activeFiles = fs.readdirSync(activeDir).filter(f => f.endsWith('.md'));
      if (activeFiles.length > 0) {
        return;
      }

      // Get first file from next (FIFO)
      const nextFiles = fs.readdirSync(nextDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      if (nextFiles.length === 0) {
        return;
      }

      const firstFile = nextFiles[0];

      // Move to active
      const fromPath = path.join(nextDir, firstFile);
      const toPath = path.join(activeDir, firstFile);

      Watcher.ignoreNextOperation(toPath);
      fs.moveSync(fromPath, toPath, { overwrite: true });

      Logger.log('queue', 'Agent message moved: next → active', {
        mesh,
        agent,
        filename: firstFile
      });

      // Try to process inbox after moving to active
      setImmediate(() => Queue.processAgentInbox(mesh, agent));
    } catch (error) {
      Logger.error('queue', `Failed to process agent next: ${error.message}`, {
        mesh,
        agent,
        error: error.stack
      });
    }
  }

  /**
   * Handle ask message: route to target agent inbox with fast-track
   * Ask messages bypass next queue and go directly to agent inbox for fast processing
   */
  static handleAskMessage(mesh, fromAgent, toAgent, msgId, question) {
    try {
      const agentDir = `.ai/tx/mesh/${mesh}/agents/${toAgent}`;
      const inboxDir = path.join(agentDir, 'msgs', 'inbox');

      fs.ensureDirSync(inboxDir);

      // Create ask message with unique ID for response tracking
      const timestamp = new Date().toISOString();
      const msgFile = `${Date.now()}-ask-${msgId}.md`;
      const msgPath = path.join(inboxDir, msgFile);

      const askMessage = `---
from: ${mesh}/${fromAgent}
to: ${mesh}/${toAgent}
type: ask
msg-id: ${msgId}
status: start
timestamp: ${timestamp}
---

# Question from ${fromAgent}

${question}`;

      Watcher.ignoreNextOperation(msgPath);
      fs.writeFileSync(msgPath, askMessage);

      Logger.log('queue', 'Ask message routed', {
        mesh,
        from: fromAgent,
        to: toAgent,
        msgId,
        filename: msgFile
      });

      // Emit event to trigger fast processing
      EventBus.emit('file:ask:new', {
        mesh,
        agent: toAgent,
        file: msgFile
      });

      return msgFile;
    } catch (error) {
      Logger.error('queue', `Failed to handle ask message: ${error.message}`, {
        mesh,
        fromAgent,
        toAgent,
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Handle ask response: route back to asking agent
   */
  static handleAskResponse(mesh, toAgent, msgId, response) {
    try {
      const agentDir = `.ai/tx/mesh/${mesh}/agents/${toAgent}`;
      const inboxDir = path.join(agentDir, 'msgs', 'inbox');

      fs.ensureDirSync(inboxDir);

      const timestamp = new Date().toISOString();
      const msgFile = `${Date.now()}-ask-response-${msgId}.md`;
      const msgPath = path.join(inboxDir, msgFile);

      const responseMessage = `---
from: [answering-agent]
to: ${mesh}/${toAgent}
type: ask-response
msg-id: ${msgId}
status: complete
timestamp: ${timestamp}
---

# Response

${response}`;

      Watcher.ignoreNextOperation(msgPath);
      fs.writeFileSync(msgPath, responseMessage);

      Logger.log('queue', 'Ask response routed', {
        mesh,
        to: toAgent,
        msgId,
        filename: msgFile
      });

      return msgFile;
    } catch (error) {
      Logger.error('queue', `Failed to handle ask response: ${error.message}`, {
        mesh,
        toAgent,
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Complete an agent task: move from agent active to agent complete
   * ALSO move from mesh active to mesh complete (synchronized cleanup)
   * If no filename provided, auto-select first active file
   */
  static completeAgentTask(mesh, agent, filename) {
    try {
      const agentDir = `.ai/tx/mesh/${mesh}/agents/${agent}`;
      const meshDir = `.ai/tx/mesh/${mesh}`;

      // Move agent active → agent complete
      const agentActiveDir = path.join(agentDir, 'msgs', 'active');
      const agentCompleteDir = path.join(agentDir, 'msgs', 'complete');

      fs.ensureDirSync(agentActiveDir);
      fs.ensureDirSync(agentCompleteDir);

      // If no filename provided, get first file from active
      let fileToComplete = filename;
      if (!fileToComplete) {
        const activeFiles = fs.readdirSync(agentActiveDir).filter(f => f.endsWith('.md'));
        if (activeFiles.length === 0) {
          return false;
        }
        fileToComplete = activeFiles[0];
      }

      const agentFromPath = path.join(agentActiveDir, fileToComplete);
      const agentToPath = path.join(agentCompleteDir, fileToComplete);

      if (fs.existsSync(agentFromPath)) {
        Watcher.ignoreNextOperation(agentToPath);
        fs.moveSync(agentFromPath, agentToPath, { overwrite: false });
      } else {
        // No active file, return false
        return false;
      }

      // ALSO move mesh active → mesh complete (synchronized cleanup)
      const meshActiveDir = path.join(meshDir, 'msgs', 'active');
      const meshCompleteDir = path.join(meshDir, 'msgs', 'complete');

      fs.ensureDirSync(meshActiveDir);
      fs.ensureDirSync(meshCompleteDir);

      const meshFromPath = path.join(meshActiveDir, fileToComplete);
      const meshToPath = path.join(meshCompleteDir, fileToComplete);

      if (fs.existsSync(meshFromPath)) {
        Watcher.ignoreNextOperation(meshToPath);
        fs.moveSync(meshFromPath, meshToPath, { overwrite: true });
      }
      // Note: It's okay if mesh active file doesn't exist

      Logger.log('queue', 'Agent task completed with mesh sync', {
        mesh,
        agent,
        filename: fileToComplete
      });

      return true;
    } catch (error) {
      Logger.error('queue', `Failed to complete agent task: ${error.message}`, {
        mesh,
        agent,
        filename,
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Notify agent that a task has been activated
   * Injects the active file directly into the tmux session for Claude to read
   */
  static notifyAgent(mesh, agent, file, filepath) {
    try {
      // Deduplicate: Check if we recently notified this exact file
      const notificationKey = `${mesh}/${agent}/${file}`;
      const now = Date.now();
      const lastNotification = Queue.recentNotifications.get(notificationKey);

      if (lastNotification && (now - lastNotification) < 1000) {
        Logger.log('queue', 'Skipping duplicate notification (within 1s)', {
          mesh,
          agent,
          file,
          timeSinceLastNotification: now - lastNotification
        });
        return false;
      }

      // Record this notification
      Queue.recentNotifications.set(notificationKey, now);

      // Clean up old entries (older than 5 seconds)
      for (const [key, timestamp] of Queue.recentNotifications.entries()) {
        if (now - timestamp > 5000) {
          Queue.recentNotifications.delete(key);
        }
      }

      const { TmuxInjector } = require('./tmux-injector');

      // Determine session name (same logic as spawn.js)
      const sessionName = mesh === agent ? mesh : `${mesh}-${agent}`;

      // Check if session exists
      if (!TmuxInjector.sessionExists(sessionName)) {
        Logger.warn('queue', `Cannot notify agent - session not found: ${sessionName}`, {
          mesh,
          agent,
          file
        });

        // Record evidence of orphaned message (Gap 1)
        Evidence.record(
          Evidence.Types.MISSING_SESSION,
          `Message stuck in active - agent session not running: ${sessionName}`,
          {
            mesh,
            agent,
            file,
            queue: 'active',
            component: 'queue',
            additional: {
              sessionName,
              filepath
            }
          }
        );

        return false;
      }

      // Inject the file directly (uses @ attachment in Claude)
      TmuxInjector.injectFile(sessionName, filepath);

      Logger.log('queue', 'Agent notified of active task via file injection', {
        mesh,
        agent,
        sessionName,
        file,
        filepath
      });

      return true;
    } catch (error) {
      Logger.error('queue', `Failed to notify agent: ${error.message}`, {
        mesh,
        agent,
        file,
        error: error.stack
      });
      return false;
    }
  }
}

module.exports = { Queue };
