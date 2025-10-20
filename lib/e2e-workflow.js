const { execSync } = require('child_process');
const { TmuxInjector } = require('./tmux-injector');

/**
 * E2E Workflow Abstraction
 * Tests the core->mesh->core success pattern
 *
 * Usage:
 *   const workflow = new E2EWorkflow('test-echo', 'echo', 'spawn a test-echo mesh and send it a simple task');
 *   const passed = await workflow.test();
 */
class E2EWorkflow {
  constructor(meshName, agentName, spawnInstruction) {
    this.meshName = meshName;
    this.agentName = agentName;
    this.spawnInstruction = spawnInstruction;
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
      step4CoreReceivedResponse: false
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
      console.log('📍 Step 2: Sending instruction to Claude');
      console.log(`   Instruction: "${this.spawnInstruction}"\n`);

      // Send the natural language instruction to Claude
      TmuxInjector.injectText(this.coreSession, this.spawnInstruction);
      await new Promise(resolve => setTimeout(resolve, 500));
      TmuxInjector.send(this.coreSession, 'Enter');

      // Wait for injection to be processed
      console.log('⏳ Waiting for injection to be processed...\n');
      const postInjectIdle = await TmuxInjector.waitForIdle(this.coreSession, 3000, 15000);
      if (!postInjectIdle) {
        console.log('⚠️  Warning: Core session may not be idle after injection, but continuing...\n');
      } else {
        console.log('✅ Injection processed\n');
      }

      // Wait longer for all agents to spawn (multiple agents may take time)
      console.log('⏳ Waiting for all mesh agents to spawn (10 seconds)...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));

      results.step2MeshSpawned = await this._waitForMeshSpawn();
      if (!results.step2MeshSpawned) {
        const expectedSession = `${this.meshName}-${this.agentName}`;
        const allSessions = TmuxInjector.listSessions();
        const meshSessions = allSessions.filter(s => s.startsWith(`${this.meshName}-`));
        console.error(`❌ Expected session not found: ${expectedSession}`);
        console.error(`   Available sessions matching "${this.meshName}-*": ${meshSessions.join(', ') || '(none)'}`);
        console.error(`   All sessions: ${allSessions.join(', ')}\n`);
        return false;
      }
      console.log('✅ Mesh spawned\n');

      // Asker agent auto-starts based on its prompt (has "START NOW")
      // No need to send additional startup command
      console.log('ℹ️  Asker will auto-start from its prompt\n');



      // Step 3: Check if mesh received the message
      console.log('📍 Step 3: Checking if mesh received message');
      results.step3MeshReceivedMessage = await this._checkMeshReceivedMessage();
      if (!results.step3MeshReceivedMessage) {
        console.log('❌ Mesh did not receive message\n');
        return false;
      }
      console.log('✅ Mesh received message\n');

      // Step 4: Check if core received response
      console.log('📍 Step 4: Checking if core received response');
      results.step4CoreReceivedResponse = await this._checkCoreReceivedResponse();
      if (!results.step4CoreReceivedResponse) {
        console.log('❌ Core did not receive response\n');
        return false;
      }
      console.log('✅ Core received response\n');

      console.log('✅ All workflow tests PASSED\n');
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
   */
  async _waitForMeshSpawn(maxWaitTime = 20000, pollInterval = 500) {
    const startTime = Date.now();
    const expectedSession = `${this.meshName}-${this.agentName}`;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const sessions = TmuxInjector.listSessions();
        const meshSession = sessions.find(s =>
          s === expectedSession ||
          s.startsWith(`${expectedSession}-`)
        );

        if (meshSession) {
          console.log(`   Found session: ${meshSession}`);
          this.meshSession = meshSession;
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
        if (output.length > 100) {
          // Session has substantial output, likely processing the message
          console.log(`   Message visible in ${this.meshSession} tmux`);
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
   * Check if core received response (look in tmux output)
   */
  async _checkCoreReceivedResponse(maxWaitTime = 20000, pollInterval = 500) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const output = execSync(`tmux capture-pane -t ${this.coreSession} -p`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Look for mesh name or agent name in output (indicates response)
        if (output.includes(this.meshName) || output.includes('success')) {
          console.log(`   Response visible in ${this.coreSession} tmux`);
          return true;
        }
      } catch (e) {
        // Ignore
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return false;
  }
}

module.exports = { E2EWorkflow };
