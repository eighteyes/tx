const fs = require('fs-extra');
const path = require('path');
const { Logger } = require('./logger');
const { EventBus } = require('./event-bus');
const { Message } = require('./message');
const { RearmatterSchema } = require('./rearmatter-schema');
const { MessageWriter } = require('./message-writer');
const { AtomicState } = require('./atomic-state');
const { spawn: spawnMesh, generateMeshIDFromSummary } = require('./commands/spawn');

/**
 * SpawnHandler - Detects spawn requests in rearmatter and creates child meshes
 *
 * Listens for messages with spawn fields in rearmatter and:
 * 1. Creates child mesh instance
 * 2. Saves parent_agent to child state
 * 3. Writes notification task to parent
 * 4. Records spawn event to evidence log
 */
class SpawnHandler {
  static initialized = false;

  /**
   * Initialize spawn handler
   */
  static initialize() {
    if (SpawnHandler.initialized) {
      return;
    }

    Logger.log('spawn-handler', 'Initializing spawn handler');

    // Listen for new message files (same event Queue listens to)
    EventBus.on('file:msgs:new', SpawnHandler.handleNewMessage, { priority: 5 });

    SpawnHandler.initialized = true;
    Logger.log('spawn-handler', 'Spawn handler initialized');
  }

  /**
   * Handle new message file detected
   */
  static async handleNewMessage({ mesh, agent, file, filepath }) {
    try {
      // Check if file still exists
      if (!fs.existsSync(filepath)) {
        return;
      }

      // Parse message
      const message = Message.parseMessage(filepath);
      if (!message) {
        return;
      }

      // Extract and validate rearmatter
      const { content, rearmatter: rearmatterYaml } = RearmatterSchema.extractFromMessage(message.content);
      if (!rearmatterYaml) {
        return; // No rearmatter, nothing to do
      }

      // Parse rearmatter
      const validation = RearmatterSchema.parse(rearmatterYaml, { strict: false });
      if (!validation.valid || !validation.data || !validation.data.spawn) {
        return; // No spawn field or invalid rearmatter
      }

      const spawn = validation.data.spawn;
      Logger.log('spawn-handler', 'Spawn detected in message', {
        from: message.metadata.from,
        to: message.metadata.to,
        msgId: message.metadata['msg-id'],
        mesh: spawn.mesh,
        reason: spawn.reason
      });

      // Process spawn
      await SpawnHandler.processSpawn(message, spawn);

    } catch (error) {
      Logger.error('spawn-handler', `Error handling message ${filepath}: ${error.message}`, {
        error: error.stack
      });
    }
  }

  /**
   * Process spawn request
   */
  static async processSpawn(message, spawnConfig) {
    try {
      const parentAgent = message.metadata.from; // Format: mesh/agent
      const parentMsgId = message.metadata['msg-id'];

      // Generate child mesh instance ID from reason
      const childMeshId = `${spawnConfig.mesh}-${generateMeshIDFromSummary(spawnConfig.reason)}`;

      Logger.log('spawn-handler', 'Creating child mesh', {
        parent: parentAgent,
        childMeshId,
        mesh: spawnConfig.mesh,
        reason: spawnConfig.reason
      });

      // Create child mesh using spawn command
      // Note: spawn() is async but handles its own errors
      await spawnMesh(spawnConfig.mesh, null, {
        id: spawnConfig.reason,
        init: `# Spawned Task\n\n**Parent**: ${parentAgent}\n**Reason**: ${spawnConfig.reason}\n\n**Context**: ${spawnConfig.context}\n\n${spawnConfig.entity_refs ? `**Entity References**: ${spawnConfig.entity_refs.join(', ')}\n\n` : ''}Please work on this task.`
      });

      // Wait a moment for mesh to be created
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Save parent_agent to child state
      await SpawnHandler.saveParentToChildState(childMeshId, spawnConfig.mesh, {
        parent_agent: parentAgent,
        parent_msg_id: parentMsgId,
        spawned_at: new Date().toISOString(),
        spawn_reason: spawnConfig.reason,
        spawn_context: spawnConfig.context,
        lenses: spawnConfig.lens || []
      });

      // Notify parent about child spawn
      await SpawnHandler.notifyParent(parentAgent, childMeshId, spawnConfig, parentMsgId);

      // Record spawn event to evidence log
      SpawnHandler.recordSpawnEvent(parentAgent, childMeshId, spawnConfig);

      Logger.log('spawn-handler', 'Spawn completed successfully', {
        parent: parentAgent,
        child: childMeshId
      });

    } catch (error) {
      Logger.error('spawn-handler', `Failed to process spawn: ${error.message}`, {
        error: error.stack
      });
    }
  }

  /**
   * Save parent_agent to child's state
   */
  static async saveParentToChildState(childMeshId, baseMesh, parentInfo) {
    try {
      // Determine the agent name to use
      // For now, use the base mesh name as the default agent
      const defaultAgent = baseMesh;

      // Update child mesh state with parent info
      await AtomicState.update(childMeshId, {
        parent_agent: parentInfo.parent_agent,
        parent_msg_id: parentInfo.parent_msg_id,
        spawned_at: parentInfo.spawned_at,
        spawn_reason: parentInfo.spawn_reason,
        spawn_context: parentInfo.spawn_context,
        lenses: parentInfo.lenses
      });

      Logger.log('spawn-handler', 'Parent info saved to child state', {
        child: childMeshId,
        parent: parentInfo.parent_agent
      });

    } catch (error) {
      Logger.error('spawn-handler', `Failed to save parent to child state: ${error.message}`, {
        childMeshId,
        error: error.stack
      });
    }
  }

  /**
   * Notify parent about child spawn
   */
  static async notifyParent(parentAgent, childMeshId, spawnConfig, parentMsgId) {
    try {
      const msgId = Math.random().toString(36).slice(2, 8);

      const content = `# Child Mesh Spawned

**Child Mesh**: ${childMeshId}
**Reason**: ${spawnConfig.reason}
**Context**: ${spawnConfig.context}
${spawnConfig.lens && spawnConfig.lens.length > 0 ? `**Lenses**: ${spawnConfig.lens.join(', ')}\n` : ''}
**Priority**: ${spawnConfig.priority || 'normal'}
**Parent Message**: ${parentMsgId}

The child mesh has been created and is working on the task. You will receive a task-complete message when it finishes.`;

      const frontmatter = {
        status: 'spawned',
        'parent-msg-id': parentMsgId,
        'child-mesh': childMeshId,
        priority: spawnConfig.priority || 'normal'
      };

      await MessageWriter.write(
        'system',
        parentAgent,
        'update',
        msgId,
        content,
        frontmatter
      );

      Logger.log('spawn-handler', 'Parent notified of spawn', {
        parent: parentAgent,
        child: childMeshId
      });

    } catch (error) {
      Logger.error('spawn-handler', `Failed to notify parent: ${error.message}`, {
        error: error.stack
      });
    }
  }

  /**
   * Record spawn event to evidence log
   */
  static recordSpawnEvent(parentAgent, childMeshId, spawnConfig) {
    try {
      const evidenceFile = '.ai/tx/logs/evidence.jsonl';
      fs.ensureDirSync(path.dirname(evidenceFile));

      const event = {
        type: 'spawn',
        timestamp: new Date().toISOString(),
        parent_agent: parentAgent,
        child_mesh: childMeshId,
        mesh_type: spawnConfig.mesh,
        lenses: spawnConfig.lens || [],
        reason: spawnConfig.reason,
        context: spawnConfig.context,
        priority: spawnConfig.priority || 'normal'
      };

      fs.appendFileSync(evidenceFile, JSON.stringify(event) + '\n');

      Logger.log('spawn-handler', 'Spawn event recorded to evidence log', {
        parent: parentAgent,
        child: childMeshId
      });

    } catch (error) {
      Logger.error('spawn-handler', `Failed to record spawn event: ${error.message}`);
    }
  }

  /**
   * Shutdown spawn handler
   */
  static shutdown() {
    if (!SpawnHandler.initialized) {
      return;
    }

    Logger.log('spawn-handler', 'Shutting down spawn handler');
    EventBus.off('file:msgs:new', SpawnHandler.handleNewMessage);

    SpawnHandler.initialized = false;
  }
}

module.exports = { SpawnHandler };
