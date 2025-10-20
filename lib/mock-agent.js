const fs = require('fs-extra');
const path = require('path');
const { Message } = require('./message');
const { Queue } = require('./queue');
const { Logger } = require('./logger');

class MockAgent {
  constructor(mesh, agent = null) {
    this.mesh = mesh;
    this.agent = agent || mesh; // Default to mesh name if agent not specified
    this.running = false;
    this.timeout = null;
  }

  /**
   * Start the mock agent
   * Initializes mesh and agent structure (new architecture)
   */
  start() {
    const meshDir = `.ai/tx/mesh/${this.mesh}`;

    // Create mesh-level directories
    const meshDirs = [
      'msgs/inbox',
      'msgs/next',
      'msgs/active',
      'msgs/complete',
      'msgs/archive'
    ];

    meshDirs.forEach(dir => fs.ensureDirSync(path.join(meshDir, dir)));

    // Create agent-level directories (new architecture)
    const agentDirs = [
      `agents/${this.agent}/msgs/inbox`,
      `agents/${this.agent}/msgs/next`,
      `agents/${this.agent}/msgs/active`,
      `agents/${this.agent}/msgs/complete`,
      `agents/${this.agent}/msgs/outbox`
    ];

    agentDirs.forEach(dir => fs.ensureDirSync(path.join(meshDir, dir)));

    // Create state if not exists
    const stateFile = path.join(meshDir, 'state.json');
    if (!fs.existsSync(stateFile)) {
      fs.writeJsonSync(stateFile, {
        mesh: this.mesh,
        status: 'active',
        current_agent: this.agent,
        workflow: [],
        workflow_position: 0,
        tasks_completed: 0
      });
    }

    this.running = true;
    Logger.log('mock-agent', 'Mock agent started', {
      mesh: this.mesh,
      agent: this.agent
    });
  }

  /**
   * Stop the mock agent
   */
  stop() {
    this.running = false;
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    Logger.log('mock-agent', 'Mock agent stopped', {
      mesh: this.mesh,
      agent: this.agent
    });
  }

  /**
   * Process one step of the queue (new agent-based architecture)
   * Returns true if work was done, false if queue empty
   */
  processQueue() {
    if (!this.running) {
      return false;
    }

    const meshDir = `.ai/tx/mesh/${this.mesh}`;
    const meshInboxDir = path.join(meshDir, 'msgs', 'inbox');
    const agentInboxDir = path.join(meshDir, 'agents', this.agent, 'msgs', 'inbox');
    const agentNextDir = path.join(meshDir, 'agents', this.agent, 'msgs', 'next');
    const agentActiveDir = path.join(meshDir, 'agents', this.agent, 'msgs', 'active');

    // Step 1: Process mesh inbox → agent inbox
    const meshInboxFiles = fs.readdirSync(meshInboxDir).filter(f => f.endsWith('.md'));
    if (meshInboxFiles.length > 0) {
      Queue.processInbox(this.mesh);
      return true;
    }

    // Step 2: Process agent inbox → agent next
    const agentInboxFiles = fs.readdirSync(agentInboxDir).filter(f => f.endsWith('.md'));
    const agentNextFiles = fs.readdirSync(agentNextDir).filter(f => f.endsWith('.md'));

    if (agentInboxFiles.length > 0 && agentNextFiles.length === 0) {
      Queue.processAgentInbox(this.mesh, this.agent);
      return true;
    }

    // Step 3: Process agent next → agent active
    const agentActiveFiles = fs.readdirSync(agentActiveDir).filter(f => f.endsWith('.md'));

    if (agentNextFiles.length > 0 && agentActiveFiles.length === 0) {
      Queue.processAgentNext(this.mesh, this.agent);
      return true;
    }

    // Step 4: Process agent active → agent complete (auto-complete)
    if (agentActiveFiles.length > 0) {
      const activeFile = agentActiveFiles[0];
      this._createResponseMessage(activeFile);
      Queue.completeAgentTask(this.mesh, this.agent, activeFile);
      return true;
    }

    // No work to do
    return false;
  }

  /**
   * Create a response message (simulating agent work)
   * Routes response directly to the destination inbox
   */
  _createResponseMessage(taskFile) {
    const meshDir = `.ai/tx/mesh/${this.mesh}`;
    const agentActiveDir = path.join(meshDir, 'agents', this.agent, 'msgs', 'active');
    const taskPath = path.join(agentActiveDir, taskFile);

    try {
      const parsed = Message.parseMessage(taskPath);

      // Parse destination agent from metadata
      const toAgent = parsed.metadata.to.includes('/')
        ? parsed.metadata.to.split('/')[1]
        : parsed.metadata.to;

      // Route response to destination agent inbox instead of orphaned outbox
      const destAgentDir = path.join(meshDir, 'agents', toAgent, 'msgs', 'inbox');
      fs.ensureDirSync(destAgentDir);

      const responseFile = `${Date.now()}-response.md`;
      const responsePath = path.join(destAgentDir, responseFile);

      const response = `---
from: ${this.mesh}/${this.agent}
to: ${parsed.metadata.from}
type: task-complete
status: complete
timestamp: ${new Date().toISOString()}
---

# Response from ${this.agent}

Task processed successfully.

## Input
${parsed.content}`;

      fs.writeFileSync(responsePath, response);

      Logger.log('mock-agent', 'Response routed to destination inbox', {
        mesh: this.mesh,
        agent: this.agent,
        destination: toAgent,
        responseFile
      });
    } catch (error) {
      Logger.warn('mock-agent', `Failed to create response: ${error.message}`);
    }
  }

  /**
   * Run the agent automatically (processes entire queue)
   * Returns when queue is empty
   */
  async runUntilComplete(maxIterations = 100) {
    let iterations = 0;

    while (this.running && iterations < maxIterations) {
      const didWork = this.processQueue();

      if (!didWork) {
        // Queue is empty
        break;
      }

      iterations++;

      // Small delay between iterations
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    Logger.log('mock-agent', 'Agent processing complete', {
      mesh: this.mesh,
      iterations
    });

    return iterations;
  }
}

module.exports = { MockAgent };
