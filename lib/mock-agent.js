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
   * Initializes mesh structure
   */
  start() {
    const meshDir = `.ai/tx/mesh/${this.mesh}`;

    // Create mesh directories
    const dirs = [
      'msgs/inbox',
      'msgs/next',
      'msgs/active',
      'msgs/complete',
      'msgs/archive'
    ];

    dirs.forEach(dir => fs.ensureDirSync(path.join(meshDir, dir)));

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
   * Process one step of the queue
   * Returns true if work was done, false if queue empty
   */
  processQueue() {
    if (!this.running) {
      return false;
    }

    const meshDir = `.ai/tx/mesh/${this.mesh}`;
    const inboxDir = path.join(meshDir, 'msgs', 'inbox');
    const nextDir = path.join(meshDir, 'msgs', 'next');
    const activeDir = path.join(meshDir, 'msgs', 'active');

    // Step 1: Process inbox → next
    const inboxFiles = fs.readdirSync(inboxDir).filter(f => f.endsWith('.md'));
    const nextFiles = fs.readdirSync(nextDir).filter(f => f.endsWith('.md'));

    if (inboxFiles.length > 0 && nextFiles.length === 0) {
      Queue.processInbox(this.mesh);
      return true;
    }

    // Step 2: Process next → active
    const activeFiles = fs.readdirSync(activeDir).filter(f => f.endsWith('.md'));

    if (nextFiles.length > 0 && activeFiles.length === 0) {
      Queue.processNext(this.mesh);
      return true;
    }

    // Step 3: Process active → complete (auto-complete)
    if (activeFiles.length > 0) {
      const activeFile = activeFiles[0];
      this._createResponseMessage(activeFile);
      Queue.complete(this.mesh, activeFile);
      return true;
    }

    // No work to do
    return false;
  }

  /**
   * Create a response message (simulating agent work)
   */
  _createResponseMessage(taskFile) {
    const meshDir = `.ai/tx/mesh/${this.mesh}`;
    const activeDir = path.join(meshDir, 'msgs', 'active');
    const taskPath = path.join(activeDir, taskFile);

    try {
      const parsed = Message.parseMessage(taskPath);

      // Create outbox message
      const outboxDir = path.join(meshDir, 'msgs', 'outbox');
      fs.ensureDirSync(outboxDir);

      const outboxFile = `${Date.now()}-response.md`;
      const outboxPath = path.join(outboxDir, outboxFile);

      const response = `---
from: ${this.mesh}/${this.agent}
to: ${parsed.metadata.from}
type: task-complete
status: completed
timestamp: ${new Date().toISOString()}
---

# Response from ${this.agent}

Task processed successfully.

## Input
${parsed.content}`;

      fs.writeFileSync(outboxPath, response);

      Logger.log('mock-agent', 'Response created', {
        mesh: this.mesh,
        agent: this.agent,
        outboxFile
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
