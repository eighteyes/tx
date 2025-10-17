const fs = require('fs-extra');
const path = require('path');
const { Message } = require('./message');
const { EventBus } = require('./event-bus');
const { AtomicState } = require('./atomic-state');
const { Logger } = require('./logger');

class Queue {
  static initialized = false;

  /**
   * Initialize queue event listeners
   * Called on system startup to register all event handlers
   */
  static init() {
    if (Queue.initialized) return;

    // Listen for new files in inbox
    EventBus.on('file:inbox:new', ({ mesh, file }) => {
      Queue.processInbox(mesh);
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

    // Listen for ask messages (fast-track to agent inbox)
    EventBus.on('file:ask:new', ({ mesh, agent, file }) => {
      // Ask messages go directly to agent for fast processing
      Logger.log('queue', 'Ask message fast-tracked', { mesh, agent, file });
    });

    // Listen for ask responses
    EventBus.on('file:ask-response:new', ({ mesh, agent, file }) => {
      // Ask responses go to agent inbox
      Logger.log('queue', 'Ask response delivered', { mesh, agent, file });
    });

    Queue.initialized = true;
    Logger.log('queue', 'Queue system initialized');
  }

  /**
   * Process inbox: move first message to next (if next is empty)
   */
  static processInbox(mesh) {
    try {
      const meshDir = `.ai/tx/mesh/${mesh}`;
      const inboxDir = path.join(meshDir, 'msgs', 'inbox');
      const nextDir = path.join(meshDir, 'msgs', 'next');

      fs.ensureDirSync(inboxDir);
      fs.ensureDirSync(nextDir);

      // Check if next queue is empty
      const nextFiles = fs.readdirSync(nextDir).filter(f => f.endsWith('.md'));
      if (nextFiles.length > 0) {
        // Next queue is full, can't process inbox
        return;
      }

      // Get first file from inbox (FIFO)
      const inboxFiles = fs.readdirSync(inboxDir)
        .filter(f => f.endsWith('.md'))
        .sort();

      if (inboxFiles.length === 0) {
        // Inbox is empty
        return;
      }

      const firstFile = inboxFiles[0];

      // Move to next
      const fromPath = path.join(inboxDir, firstFile);
      const toPath = path.join(nextDir, firstFile);

      fs.moveSync(fromPath, toPath, { overwrite: true });

      // Emit event
      EventBus.emit('task:queued', {
        mesh,
        filename: firstFile
      });

      Logger.log('queue', 'Message moved: inbox → next', {
        mesh,
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
status: handoff
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
status: handoff
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
          fs.moveSync(filepath, path.join(archiveDir, file), { overwrite: true });
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
status: pending
timestamp: ${timestamp}
---

# Question from ${fromAgent}

${question}`;

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
status: completed
timestamp: ${timestamp}
---

# Response

${response}`;

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
}

module.exports = { Queue };
