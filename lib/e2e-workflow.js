const { execSync } = require('child_process');
const { TmuxInjector } = require('./tmux-injector');
const fs = require('fs-extra');

/**
 * E2E Workflow Abstraction
 * Tests human interaction with Claude: natural language -> Claude -> mesh -> Claude -> human
 *
 * Usage:
 *   const workflow = new E2EWorkflow('test-echo', 'echo', 'spawn a test-echo mesh and send it a simple task');
 *   const passed = await workflow.test();
 */
class E2EWorkflow {
  constructor(meshName, agentName, initialTask = null) {
    this.meshName = meshName;
    this.agentName = agentName;
    this.initialTask = initialTask || `Test task for ${meshName}/${agentName}`;
    this.coreSession = 'core';
  }

  /**
   * Test the complete workflow
   * Returns true if all stages pass
   */
  async test() {
    console.log(`\n🧪 Testing workflow: ${this.meshName}/${this.agentName}\n`);

    const results = {
      step1CoreReady: false,
      step2MeshSpawned: false,
      step3MeshReceivedMessage: false,
      step4MeshRespondedToCore: false,
      step5CoreReceivedResponse: false
    };

    try {
      // Step 1: Verify core is ready
      console.log('📍 Step 1: Checking core is ready');
      results.step1CoreReady = await this._checkCoreReady();
      if (!results.step1CoreReady) {
        console.log('❌ Core not ready\n');
        return false;
      }
      console.log('✅ Core is ready\n');

      // Wait for core to be idle before injecting
      console.log('⏳ Waiting for core session to be idle...\n');
      const coreIdle = await TmuxInjector.waitForIdle(this.coreSession, 3000, 15000);
      if (!coreIdle) {
        console.log('⚠️  Warning: Core session may not be idle, but continuing...\n');
      } else {
        console.log('✅ Core session is idle\n');
      }

      // Step 2: Send natural language instruction to Claude
      console.log('📍 Step 2: Sending natural language instruction to Claude');
      console.log(`   Instruction: "${this.initialTask}"\n`);

      // Send the natural language instruction to Claude to test human interaction
      TmuxInjector.injectText(this.coreSession, this.initialTask);
      await new Promise(resolve => setTimeout(resolve, 500));
      TmuxInjector.send(this.coreSession, 'Enter');

      // Wait for core to process the spawn request
      console.log('⏳ Waiting for core to process spawn request...\n');
      const coreProcessing = await TmuxInjector.waitForIdle(this.coreSession, 3000, 30000);
      if (!coreProcessing) {
        console.log('⚠️  Warning: Core may still be processing, but continuing...\n');
      } else {
        console.log('✅ Core finished processing spawn request\n');
      }

      // Send Enter to continue after Claude processes the request
      console.log('⏳ Sending Enter to continue...\n');
      TmuxInjector.send(this.coreSession, 'Enter');

      results.step2MeshSpawned = await this._waitForMeshSpawn();
      if (!results.step2MeshSpawned) {
        const expectedPattern = `${this.meshName}-[uuid]-${this.agentName}`;
        const allSessions = TmuxInjector.listSessions();
        const meshSessions = allSessions.filter(s => s.startsWith(`${this.meshName}-`));
        console.error(`❌ Expected session pattern not found: ${expectedPattern}`);
        console.error(`   Available sessions matching "${this.meshName}-*": ${meshSessions.join(', ') || '(none)'}`);
        console.error(`   All sessions: ${allSessions.join(', ')}\n`);
        return false;
      }
      console.log('✅ Mesh spawned\n');

      // Send another Enter for Claude to continue
      console.log('⏳ Sending Enter to continue...\n');
      TmuxInjector.send(this.coreSession, 'Enter');

      // Wait for core to write the message
      console.log('⏳ Waiting for core to write message to mesh...\n');
      const coreWriting = await TmuxInjector.waitForIdle(this.coreSession, 3000, 20000);
      if (!coreWriting) {
        console.log('⚠️  Warning: Core may still be writing, but continuing...\n');
      } else {
        console.log('✅ Core finished writing message\n');
      }

      // Wait for mesh session to be idle before checking
      console.log('⏳ Waiting for mesh session to be idle...\n');
      const meshIdle = await TmuxInjector.waitForIdle(this.meshSession, 3000, 15000);
      if (!meshIdle) {
        console.log('⚠️  Warning: Mesh session may not be idle, but continuing...\n');
      } else {
        console.log('✅ Mesh session is idle\n');
      }

      // Step 3: Check if mesh received the message
      console.log('📍 Step 3: Checking if mesh received message');
      results.step3MeshReceivedMessage = await this._checkMeshReceivedMessage();
      if (!results.step3MeshReceivedMessage) {
        console.log('❌ Mesh did not receive message\n');
        return false;
      }
      console.log('✅ Mesh received message\n');

      // Wait for mesh session to be idle before checking response
      console.log('⏳ Waiting for mesh session to be idle before checking response...\n');
      const meshIdle2 = await TmuxInjector.waitForIdle(this.meshSession, 3000, 15000);
      if (!meshIdle2) {
        console.log('⚠️  Warning: Mesh session may not be idle, but continuing...\n');
      } else {
        console.log('✅ Mesh session is idle\n');
      }

      // Step 4: Check if mesh sent response back to core
      console.log('📍 Step 4: Checking if mesh sent response back to core');
      results.step4MeshRespondedToCore = await this._checkMeshRespondedToCore();
      if (!results.step4MeshRespondedToCore) {
        console.log('❌ Mesh did not send response to core\n');
        return false;
      }
      console.log('✅ Mesh sent response to core\n');

      // Wait for core session to be idle before checking if it received response
      console.log('⏳ Waiting for core session to be idle...\n');
      const coreIdle2 = await TmuxInjector.waitForIdle(this.coreSession, 3000, 15000);
      if (!coreIdle2) {
        console.log('⚠️  Warning: Core session may not be idle, but continuing...\n');
      } else {
        console.log('✅ Core session is idle\n');
      }

      // Step 5: Check if core received the response
      console.log('📍 Step 5: Checking if core received response from mesh');
      results.step5CoreReceivedResponse = await this._checkCoreReceivedResponse();
      if (!results.step5CoreReceivedResponse) {
        console.log('❌ Core did not receive response from mesh\n');
        return false;
      }
      console.log('✅ Core received response from mesh\n');

      console.log('✅ All workflow tests PASSED\n');

      // Wait 5 seconds before cleanup to allow for observation
      console.log('⏳ Waiting 5 seconds before cleanup...\n');
      await new Promise(resolve => setTimeout(resolve, 5000));

      return true;
    } catch (error) {
      console.error('❌ Workflow error:', error.message);
      return false;
    }
  }

  /**
   * Check if core session is ready (session exists and Claude is running)
   */
  async _checkCoreReady() {
    try {
      // Check if session exists
      const sessions = TmuxInjector.listSessions();
      if (!sessions.includes(this.coreSession)) {
        return false;
      }

      // Check if Claude is ready in the session
      return await TmuxInjector.claudeReadyCheck(this.coreSession, 5000);
    } catch (e) {
      return false;
    }
  }

  /**
   * Wait for mesh session to be created
   * With UUID support, sessions are named: {mesh}-{uuid}-{agent}
   */
  async _waitForMeshSpawn(maxWaitTime = 20000, pollInterval = 500) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const sessions = TmuxInjector.listSessions();

        // With UUID: look for pattern {mesh}-{uuid}-{agent}
        // UUID is 6 hex characters: [0-9a-f]{6}
        const meshSession = sessions.find(s => {
          // Match pattern: meshName-UUID-agentName
          const pattern = new RegExp(`^${this.meshName}-[0-9a-f]{6}-${this.agentName}$`);
          return pattern.test(s);
        });

        if (meshSession) {
          console.log(`   Found session: ${meshSession}`);
          this.meshSession = meshSession;
          return true;
        }

        // Fallback: also check legacy format (without UUID)
        const legacySession = `${this.meshName}-${this.agentName}`;
        if (sessions.includes(legacySession)) {
          console.log(`   Found session: ${legacySession}`);
          this.meshSession = legacySession;
          return true;
        }
      } catch (e) {
        // Ignore
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return false;
  }

  /**
   * Check if mesh received message (look in tmux output for message indicators)
   */
  async _checkMeshReceivedMessage(maxWaitTime = 20000, pollInterval = 500) {
    if (!this.meshSession) return false;

    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const output = execSync(`tmux capture-pane -t ${this.meshSession} -p`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Look for signs the message was received/processed
        // Check for file operations or message content
        const hasFileRead = output.includes('Read(') && output.includes('.md');
        const hasMessageContent = output.includes('from: core/core') ||
                                 output.includes('type: task') ||
                                 output.includes(this.initialTask);

        // Check if Claude is actively processing (not just sitting idle)
        const isProcessing = output.includes('Write(') ||
                           output.includes('to: core/core') ||
                           output.includes('task-complete');

        // Session must have substantial content (not just startup)
        const hasSubstantialContent = output.length > 200;

        if ((hasFileRead || hasMessageContent) && hasSubstantialContent) {
          console.log(`   Message received by ${this.meshSession}`);
          if (hasFileRead) {
            console.log(`      - File read operation detected`);
          }
          if (hasMessageContent) {
            console.log(`      - Message content detected`);
          }
          if (isProcessing) {
            console.log(`      - Active processing detected`);
          }
          return true;
        }
      } catch (e) {
        // Ignore
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    console.log(`   ⚠️  No evidence of message reception in ${this.meshSession}`);
    return false;
  }

  /**
   * Check if mesh sent response back to core (look for response message in mesh tmux output)
   */
  async _checkMeshRespondedToCore(maxWaitTime = 20000, pollInterval = 500) {
    if (!this.meshSession) return false;

    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const output = execSync(`tmux capture-pane -t ${this.meshSession} -p`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Check if mesh wrote a response message
        // Look for evidence of writing a response/done message
        const responseIndicators = [
          'Write(',           // Claude using Write tool
          'to: core/core',    // Message destination
          'task-complete',    // Message type
          'msgs/',           // Writing to msgs directory
          '.md'              // Creating markdown file
        ];

        // Check for Write operation with proper context
        const hasWriteOperation = output.includes('Write(');
        const hasCorrectDestination = output.includes('to: core/core');
        const hasTaskComplete = output.includes('task-complete');

        // Must have Write operation AND at least one other indicator
        if (hasWriteOperation && (hasCorrectDestination || hasTaskComplete)) {
          console.log(`   ✅ Mesh sent response`);
          if (hasWriteOperation) console.log(`      - Write operation detected`);
          if (hasCorrectDestination) console.log(`      - Routing to core/core`);
          if (hasTaskComplete) console.log(`      - Task complete message`);
          return true;
        }
      } catch (e) {
        // Ignore
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    console.log(`   ⚠️  No evidence of response from ${this.meshSession} to core`);
    return false;
  }

  /**
   * Check if core received response (look for -done message files in tmux output)
   */
  async _checkCoreReceivedResponse(maxWaitTime = 20000, pollInterval = 500) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const output = execSync(`tmux capture-pane -t ${this.coreSession} -p -S -100`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Check for actual evidence that core received and processed a message from the mesh
        // The key indicator is a -done.md file in the msgs/ directory
        // This shows the message was completed and routed back to core

        const responseIndicators = [
          // Check for -done files (the primary indicator)
          `-done.md`,
          `${this.meshName}-done.md`,
          `${this.agentName}-done.md`,

          // Check for reading messages from the specific mesh
          `from: ${this.meshName}/${this.agentName}`,
          `from: ${this.meshName}-`,

          // Check for task completion patterns
          `type: task-complete`,
          `status: complete`,

          // Check for actual file reads from msgs directory
          `msgs/.*-done\\.md`,
          `.ai/tx/mesh/core/agents/core/msgs/.*-done`,

          // Check for routing evidence
          `Processing complete:`,
          `Task complete from ${this.meshName}`,
          `Received response from ${this.meshName}`
        ];

        // More specific check: look for evidence of reading a -done message file
        const hasDoneFile = output.includes('-done.md') || output.includes('-done');
        const hasMsgsRead = output.includes('/msgs/') || output.includes('msgs/');
        const fromCorrectMesh = output.includes(`from: ${this.meshName}/`) ||
                                output.includes(`from: ${this.meshName}-`);

        // We need evidence of a -done file OR task-complete being read from the msgs directory
        const hasTaskComplete = output.includes('task-complete') || output.includes('type: task-complete');

        if ((hasDoneFile || hasTaskComplete) && hasMsgsRead) {
          console.log(`   ✅ Core received response from ${this.meshName}`);

          // Log what we found for debugging
          if (hasDoneFile) {
            console.log(`      - Found -done message file`);
          }
          if (hasTaskComplete) {
            console.log(`      - Found task-complete message`);
          }
          if (fromCorrectMesh) {
            console.log(`      - Message is from ${this.meshName}`);
          }
          if (hasMsgsRead) {
            console.log(`      - Core read message from msgs folder`);
          }

          return true;
        }

        // Also check if any of the specific indicators are present
        for (const indicator of responseIndicators) {
          if (output.includes(indicator)) {
            console.log(`   ✅ Core received response (found: "${indicator}")`);
            return true;
          }
        }
      } catch (e) {
        // Ignore
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // If we timeout, show what we were looking for
    console.log(`   ⚠️  Did not find evidence of response from ${this.meshName} in core output`);
    console.log(`      Looking for: -done.md files in msgs/, task-complete messages, or messages from ${this.meshName}`);

    return false;
  }
}

module.exports = { E2EWorkflow };
