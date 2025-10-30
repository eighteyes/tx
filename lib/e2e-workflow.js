const { execSync } = require('child_process');
const { TmuxInjector } = require('./tmux-injector');
const fs = require('fs-extra');
const path = require('path');

/**
 * E2E Workflow Abstraction
 * Tests human interaction with Claude: natural language -> Claude -> mesh -> Claude -> human
 *
 * Usage:
 *   const workflow = new E2EWorkflow('test-echo', 'echo', 'spawn a test-echo mesh and send it a simple task');
 *   const passed = await workflow.test();
 *
 *   // With custom timeout for complex workflows:
 *   const workflow = new E2EWorkflow('hitl-3qa', 'interviewer', 'spawn hitl-3qa...', { workflowTimeout: 120000 });
 *
 *   // With HITL support:
 *   const workflow = new E2EWorkflow('hitl-3qa', 'interviewer', 'spawn hitl-3qa...', {
 *     workflowTimeout: 120000,
 *     hitl: {
 *       enabled: true,
 *       autoRespond: true,
 *       responses: {
 *         'default': 'Default response',
 *         'pattern:/question.*topic/i': 'Topic response'
 *       },
 *       maxQuestions: 10
 *     }
 *   });
 */
class E2EWorkflow {
  constructor(meshName, agentName, initialTask = null, options = {}) {
    this.meshName = meshName;
    this.agentName = agentName;
    this.initialTask = initialTask || `Test task for ${meshName}/${agentName}`;
    this.coreSession = 'core';
    // Configurable timeout for complex workflows (HITL, multi-agent, etc.)
    // Default: 30s for simple workflows, can be increased for complex ones
    this.workflowTimeout = options.workflowTimeout || 30000;

    // HITL configuration
    this.hitl = options.hitl || { enabled: false };
    this.hitlState = {
      questionCount: 0,
      lastQuestionTime: Date.now(),
      processedMessages: new Set()
    };
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
      const coreProcessing = await TmuxInjector.waitForIdle(this.coreSession, 2000, 60000);
      if (!coreProcessing) {
        console.log('⚠️  Warning: Core may still be processing spawn request after 60s\n');
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
      const coreWriting = await TmuxInjector.waitForIdle(this.coreSession, 2000, 45000);
      if (!coreWriting) {
        console.log('⚠️  Warning: Core may still be writing message after 45s\n');
      } else {
        console.log('✅ Core finished writing message\n');
      }

      // Wait for mesh session to be idle before checking
      console.log('⏳ Waiting for mesh session to be idle...\n');
      const meshIdle = await TmuxInjector.waitForIdle(this.meshSession, 2000, 30000);
      if (!meshIdle) {
        console.log('⚠️  Warning: Mesh session may not be idle after 30s\n');
      } else {
        console.log('✅ Mesh session is idle\n');
      }

      // Step 2.5: If HITL is enabled, start handler in background NOW (before agent receives task)
      if (this.hitl.enabled && this.hitl.autoRespond) {
        console.log('📍 Step 2.5: Starting HITL auto-response mode in background\n');
        // Start HITL handler in background - it will run continuously
        this.hitlPromise = this._handleHITL();
      }

      // Step 3: Check if mesh received the message
      console.log('📍 Step 3: Checking if mesh received message');
      results.step3MeshReceivedMessage = await this._checkMeshReceivedMessage(this.workflowTimeout);
      if (!results.step3MeshReceivedMessage) {
        console.log('❌ Mesh did not receive message\n');
        return false;
      }
      console.log('✅ Mesh received message\n');

      // Wait for mesh session to be idle before checking response
      console.log('⏳ Waiting for mesh session to be idle before checking response...\n');
      const meshIdle2 = await TmuxInjector.waitForIdle(this.meshSession, 2000, 30000);
      if (!meshIdle2) {
        console.log('⚠️  Warning: Mesh session may not be idle after 30s\n');
      } else {
        console.log('✅ Mesh session is idle\n');
      }

      // Step 4: Check if mesh sent response back to core
      console.log('📍 Step 4: Checking if mesh sent response back to core');
      results.step4MeshRespondedToCore = await this._checkMeshRespondedToCore(this.workflowTimeout);
      if (!results.step4MeshRespondedToCore) {
        console.log('❌ Mesh did not send response to core\n');
        return false;
      }
      console.log('✅ Mesh sent response to core\n');

      // Wait for core session to be idle before checking if it received response
      console.log('⏳ Waiting for core session to be idle...\n');
      const coreIdle2 = await TmuxInjector.waitForIdle(this.coreSession, 2000, 30000);
      if (!coreIdle2) {
        console.log('⚠️  Warning: Core session may not be idle after 30s\n');
      } else {
        console.log('✅ Core session is idle\n');
      }

      // Step 4.5: Wait for HITL to complete if it was started
      if (this.hitlPromise) {
        console.log('📍 Step 4.5: Waiting for HITL interaction to complete\n');
        const hitlSuccess = await this.hitlPromise;
        if (!hitlSuccess) {
          console.log('⚠️  HITL interaction completed with warnings\n');
        } else {
          console.log('✅ HITL interaction completed successfully\n');
        }
      }

      // Step 5: Check if core received the response
      console.log('📍 Step 5: Checking if core received response from mesh');
      results.step5CoreReceivedResponse = await this._checkCoreReceivedResponse(this.workflowTimeout);
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
   * Check if mesh received message by verifying actual file delivery
   * Validates that a task message was delivered to the agent's msgs directory
   */
  async _checkMeshReceivedMessage(maxWaitTime = 30000, pollInterval = 1000) {
    if (!this.meshSession) return false;

    const startTime = Date.now();
    const meshInstanceId = this.meshSession.replace(`-${this.agentName}`, '');

    // Step 1: Find what file the sender (core) created
    const coreMsgsDir = `.ai/tx/mesh/core/agents/core/msgs`;
    const targetMsgsDir = `.ai/tx/mesh/${meshInstanceId}/agents/${this.agentName}/msgs`;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Step 1: Check what file core created for this agent
        if (!fs.existsSync(coreMsgsDir)) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }

        const coreFiles = fs.readdirSync(coreMsgsDir).filter(f => f.endsWith('.md'));
        let senderFile = null;
        let senderFilename = null;

        for (const file of coreFiles) {
          const fullPath = path.join(coreMsgsDir, file);
          const content = fs.readFileSync(fullPath, 'utf-8');

          // Find message from core addressed to this agent
          if (content.includes('from: core/core') &&
              content.includes(`to: ${meshInstanceId}/${this.agentName}`) &&
              (content.includes('type: task') || content.includes('type: ask'))) {
            senderFile = content;
            senderFilename = file;
            break;
          }
        }

        if (!senderFile) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }

        // Step 2: Check if that file was injected into the target session
        const sessionOutput = execSync(`tmux capture-pane -t ${this.meshSession} -p -S -200`, { encoding: 'utf-8' });

        // Look for evidence that the file was read/injected in the target session
        // The routing system should cause the agent to read the delivered message
        if (sessionOutput.includes(senderFilename) ||
            sessionOutput.includes(`Read(`) && sessionOutput.includes(targetMsgsDir)) {
          console.log(`   ✅ Message delivery validated:`);
          console.log(`      - Sender created: ${senderFilename}`);
          console.log(`      - Target session shows file injection`);
          return true;
        }
      } catch (e) {
        // Ignore errors, directories might not exist yet
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    console.log(`   ⚠️  Message routing failed:`);
    console.log(`      - Core msgs dir: ${coreMsgsDir}`);
    console.log(`      - Target msgs dir: ${targetMsgsDir}`);
    return false;
  }

  /**
   * Check if mesh sent response back to core (look for response message in mesh tmux output)
   * Based on testing-meshes skill: check for evidence of response creation
   */
  async _checkMeshRespondedToCore(maxWaitTime = 30000, pollInterval = 1000) {
    if (!this.meshSession) return false;

    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const output = execSync(`tmux capture-pane -t ${this.meshSession} -p -S -100`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Check if mesh wrote a response message
        // Following testing-meshes skill: look for evidence of response creation
        const hasWriteOperation = output.includes('Write(');
        const hasCorrectDestination = output.includes('to: core/core') || output.includes('to: core');
        const hasTaskComplete = output.includes('task-complete') || output.includes('type: task-complete');
        const hasMsgsWrite = output.includes('msgs/') && output.includes('.md');

        // Evidence of response: Write operation with routing info OR task-complete
        if ((hasWriteOperation && (hasCorrectDestination || hasTaskComplete)) || (hasMsgsWrite && hasTaskComplete)) {
          console.log(`   ✅ Mesh sent response to core`);
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
   * Check if core received response (look for evidence in tmux output)
   * Based on testing-meshes skill: check for evidence of message reception and processing
   */
  async _checkCoreReceivedResponse(maxWaitTime = 30000, pollInterval = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const output = execSync(`tmux capture-pane -t ${this.coreSession} -p -S -150`, {
          stdio: 'pipe',
          encoding: 'utf-8'
        });

        // Following testing-meshes skill: look for evidence of message processing
        // Check for -done files OR task-complete messages from the mesh
        const hasDoneFile = output.includes('-done.md');
        const hasMsgsActivity = output.includes('msgs/');
        const hasTaskComplete = output.includes('task-complete') || output.includes('type: task-complete');
        const hasFromMesh = output.includes(`from: ${this.meshName}/`) ||
                           output.includes(`from: ${this.meshName}-`);
        const hasFileRead = output.includes('Read(') && output.includes('.md');
        const hasMessageInjection = output.includes('@') && output.includes('msgs/');

        // Evidence of reception:
        // 1. Done file in msgs directory, OR
        // 2. Task-complete message from mesh being read, OR
        // 3. Message injection with @ notation
        if ((hasDoneFile && hasMsgsActivity) ||
            (hasTaskComplete && (hasFromMesh || hasMsgsActivity)) ||
            (hasMessageInjection && hasFileRead)) {
          console.log(`   ✅ Core received response from ${this.meshName}`);
          return true;
        }
      } catch (e) {
        // Ignore
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    console.log(`   ⚠️  Did not find evidence of response from ${this.meshName} in core output`);
    return false;
  }

  /**
   * Handle HITL (Human-In-The-Loop) interaction
   * Watches for 'ask' messages from agent and auto-responds based on patterns
   */
  async _handleHITL() {
    if (!this.meshSession) {
      console.log('⚠️  Cannot start HITL: mesh session not found');
      return false;
    }

    // Extract mesh instance ID from session name (e.g., "hitl-3qa-858fc7-interviewer" -> "hitl-3qa-858fc7")
    const meshInstanceId = this.meshSession.replace(`-${this.agentName}`, '');
    const agentMsgsDir = `.ai/tx/mesh/${meshInstanceId}/agents/${this.agentName}/msgs`;
    const maxQuestions = this.hitl.maxQuestions || 10;
    const questionTimeout = this.hitl.questionTimeout || 45000; // 45s per question

    // Reset lastQuestionTime to catch messages created before HITL handler started
    this.hitlState.lastQuestionTime = 0;

    console.log(`📍 HITL mode: watching ${agentMsgsDir} for ask messages\n`);
    console.log(`   Max questions: ${maxQuestions}\n`);

    while (this.hitlState.questionCount < maxQuestions) {
      // Wait for new ask message
      const askFile = await this._waitForAskMessage(agentMsgsDir, questionTimeout);

      if (!askFile) {
        console.log(`   ℹ️  No more ask messages after ${this.hitlState.questionCount} questions\n`);
        break;
      }

      this.hitlState.questionCount++;
      console.log(`   📩 Question ${this.hitlState.questionCount}: ${askFile}\n`);

      // Read the ask message
      const askPath = path.join(agentMsgsDir, askFile);
      const askContent = fs.readFileSync(askPath, 'utf-8');

      // Extract msg-id
      const msgIdMatch = askContent.match(/msg-id:\s*(.+)/);
      const msgId = msgIdMatch ? msgIdMatch[1].trim() : `hitl-q-${this.hitlState.questionCount}`;

      // Find matching response
      const responseText = this._findMatchingResponse(askContent);

      // Create ask-response message
      const responseFileName = `response-${msgId}.md`;
      const responseFilePath = path.join(agentMsgsDir, responseFileName);
      const responseContent = `---
to: ${meshInstanceId}/${this.agentName}
from: core/core
type: ask-response
msg-id: ${msgId}
status: complete
timestamp: ${new Date().toISOString()}
headline: Response to question ${this.hitlState.questionCount}
---

# Response

${responseText}
`;

      fs.writeFileSync(responseFilePath, responseContent);
      console.log(`   ✅ Response ${this.hitlState.questionCount} sent: ${responseFileName}\n`);

      // Agent will discover the response through normal message checking
      // No need to inject - the file-based messaging system handles delivery
      console.log(`   ⏳ Waiting for agent to discover and process response (10s)...\n`);
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10s for agent to check msgs/ and process

      // Mark message as processed
      this.hitlState.processedMessages.add(askFile);
      this.hitlState.lastQuestionTime = Date.now();
    }

    console.log(`   ✅ HITL complete: ${this.hitlState.questionCount} Q&A rounds\n`);
    return true;
  }

  /**
   * Wait for a new ask message to appear in the agent's msgs directory
   */
  async _waitForAskMessage(agentMsgsDir, timeout = 45000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        // Ensure directory exists
        if (!fs.existsSync(agentMsgsDir)) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        const files = fs.readdirSync(agentMsgsDir).filter(f => f.endsWith('.md'));

        // Look for new ask messages we haven't processed
        for (const file of files) {
          // Skip if already processed
          if (this.hitlState.processedMessages.has(file)) {
            continue;
          }

          const fullPath = path.join(agentMsgsDir, file);
          const content = fs.readFileSync(fullPath, 'utf-8');

          // Check if it's an ask message to core (pending status)
          if (content.includes('type: ask') &&
              content.includes('to: core/core') &&
              content.includes('status: pending')) {
            return file;
          }
        }
      } catch (e) {
        // Ignore errors, directory might not exist yet
      }

      await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms for very fast response
    }

    return null;
  }

  /**
   * Find matching response based on patterns in HITL config
   */
  _findMatchingResponse(askContent) {
    const responses = this.hitl.responses || {};

    // Check pattern-based responses first
    for (const [key, value] of Object.entries(responses)) {
      if (key.startsWith('pattern:')) {
        // Extract regex pattern from key
        const patternMatch = key.match(/^pattern:(.+)$/);
        if (patternMatch) {
          const patternStr = patternMatch[1];
          // Handle regex with flags: /pattern/flags
          const regexMatch = patternStr.match(/^\/(.+)\/([gimuy]*)$/);
          if (regexMatch) {
            const pattern = new RegExp(regexMatch[1], regexMatch[2]);
            if (pattern.test(askContent)) {
              return value;
            }
          }
        }
      }
    }

    // Return default response
    return responses.default || 'Thank you for the question. Here is my response.';
  }
}

module.exports = { E2EWorkflow };
