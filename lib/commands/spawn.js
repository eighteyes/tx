const { TmuxInjector } = require('../tmux-injector');
const { PromptBuilder } = require('../prompt-builder');
const { Message } = require('../message');
const { DirectoryInitializer } = require('../directory-initializer');
const { Logger } = require('../logger');
const { AtomicState } = require('../atomic-state');
const { Queue } = require('../queue');
const fs = require('fs-extra');

/**
 * Generate a 4-character alphanumeric UID from task words
 * Takes first letters of each word, pads to 4 chars if needed
 * Example: "analyze codebase" → "ac"
 * @param {string} task - The task description
 * @returns {string} 4-character alphanumeric UID
 */
function generateTaskUID(task) {
  if (!task || typeof task !== 'string') {
    return '';
  }

  // Extract words (split on spaces, hyphens, underscores)
  const words = task.split(/[\s\-_]+/).filter(w => w.length > 0);

  if (words.length === 0) {
    return '';
  }

  // Get first letter of each word, lowercase
  let uid = words.map(w => w[0].toLowerCase()).join('');

  // Ensure exactly 4 alphanumeric characters
  if (uid.length < 4) {
    // Pad with incrementing digits
    const padLength = 4 - uid.length;
    uid = uid + Array.from({ length: padLength }, (_, i) => i).join('');
  } else if (uid.length > 4) {
    // Truncate to 4 characters
    uid = uid.substring(0, 4);
  }

  return uid;
}

/**
 * Clean up orphaned messages from previous agent runs
 * Moves messages from inbox/next/active/outbox to orphans folder
 * @param {string} mesh - Mesh name
 * @param {string} agent - Agent name
 * @returns {number} Number of orphaned messages moved
 */
function cleanupOrphans(mesh, agent) {
  const agentDir = `.ai/tx/mesh/${mesh}/agents/${agent}`;
  const orphansDir = `${agentDir}/msgs/orphans`;
  const queues = ['inbox', 'next', 'active', 'outbox'];

  let orphanCount = 0;

  // Create orphans directory if it doesn't exist
  fs.ensureDirSync(orphansDir);

  // Move all .md files from each queue to orphans
  queues.forEach(queue => {
    const queueDir = `${agentDir}/msgs/${queue}`;
    if (fs.existsSync(queueDir)) {
      const files = fs.readdirSync(queueDir).filter(f => f.endsWith('.md'));
      files.forEach(file => {
        const sourcePath = `${queueDir}/${file}`;
        const destPath = `${orphansDir}/${queue}-${file}`;
        fs.moveSync(sourcePath, destPath, { overwrite: true });
        orphanCount++;
        Logger.log('spawn', 'Orphaned message moved', {
          mesh,
          agent,
          queue,
          file,
          destination: destPath
        });
      });
    }
  });

  return orphanCount;
}

async function spawn(mesh, agent = null, options = {}) {
  // Declare variables outside try-catch so they're accessible in both blocks
  let taskUID = '';
  let finalAgentName = agent;

  try {
    // If no agent specified, try to determine from mesh config
    let agentName = agent;
    if (!agentName) {
      const meshConfigPath = `meshes/mesh-configs/${mesh}.json`;
      if (fs.existsSync(meshConfigPath)) {
        const meshConfig = fs.readJsonSync(meshConfigPath);

        // Try entry_point first, then first agent in array, then default to mesh name
        if (meshConfig.entry_point) {
          agentName = meshConfig.entry_point;
        } else if (meshConfig.agents && meshConfig.agents.length > 0) {
          // Extract agent name from "category/agent" format
          const firstAgent = meshConfig.agents[0];
          agentName = firstAgent.includes('/') ? firstAgent.split('/').pop() : firstAgent;
        } else {
          agentName = mesh;
        }
      } else {
        agentName = mesh;
      }
    }

    // Generate UID suffix from task if provided
    finalAgentName = agentName;
    if (options.init) {
      taskUID = generateTaskUID(options.init);
      if (taskUID) {
        finalAgentName = `${agentName}-${taskUID}`;
      }
    }

    // If mesh and agent are the same, just use one name
    const sessionName = mesh === finalAgentName ? mesh : `${mesh}-${finalAgentName}`;

    console.log(`🚀 Spawning ${mesh}/${agentName}${taskUID ? ` (UID: ${taskUID})` : ''}...\n`);

    // VALIDATE: Find and check agent config exists BEFORE creating directories
    const meshConfigPath = `meshes/mesh-configs/${mesh}.json`;
    let configPath = `meshes/agents/${mesh}/${agentName}/config.json`;

    if (fs.existsSync(meshConfigPath)) {
      const meshConfig = fs.readJsonSync(meshConfigPath);
      // Find the full agent path (category/agent format)
      if (meshConfig.agents) {
        const fullAgentPath = meshConfig.agents.find(a => {
          const agentPart = a.includes('/') ? a.split('/').pop() : a;
          return agentPart === agentName;
        });
        if (fullAgentPath) {
          configPath = `meshes/agents/${fullAgentPath}/config.json`;
        }
      }
    }

    // Check if agent config exists
    if (!fs.existsSync(configPath)) {
      console.error(`❌ Agent not found: ${agentName}`);
      console.error(`   Expected config at: ${configPath}`);
      console.error(`\n   Available agents for mesh "${mesh}":`);

      if (fs.existsSync(meshConfigPath)) {
        const meshConfig = fs.readJsonSync(meshConfigPath);
        if (meshConfig.agents && meshConfig.agents.length > 0) {
          meshConfig.agents.forEach(a => {
            const name = a.includes('/') ? a.split('/').pop() : a;
            console.error(`   - ${name}`);
          });
        } else {
          console.error(`   (No agents configured in mesh config)`);
        }
      }
      console.error('');
      Logger.error('spawn', 'Agent config not found', { mesh, agent: agentName, configPath });
      process.exit(1);
    }

    // Load agent config
    const agentConfig = fs.readJsonSync(configPath);
    Logger.log('spawn', 'Agent config loaded', { configPath, options: agentConfig.options });
    console.log(`✅ Agent validated: ${agentName}\n`);

    // Check if session already exists
    const sessions = TmuxInjector.listSessions();
    if (sessions.includes(sessionName)) {
      console.log(`⚠️  Session already exists: ${sessionName}`);
      console.log(`   Use: tx attach\n`);
      return;
    }

    // NOW initialize directories (only after validation succeeds)
    console.log('📂 Initializing communication directories...');
    DirectoryInitializer.initializeAll(mesh, finalAgentName);
    const agentDir = `.ai/tx/mesh/${mesh}/agents/${finalAgentName}`;
    console.log('✅ Directories created\n');

    // Clean up orphaned messages from previous runs
    console.log('🧹 Cleaning up orphaned messages...');
    const orphanCount = cleanupOrphans(mesh, finalAgentName);
    if (orphanCount > 0) {
      console.log(`✅ Moved ${orphanCount} orphaned message(s) to orphans folder\n`);
    } else {
      console.log('✅ No orphaned messages found\n');
    }

    // Create tmux session with Claude running
    console.log('📦 Creating tmux session...');
    TmuxInjector.createSession(sessionName, 'bash', true, mesh, finalAgentName);
    console.log(`✅ Session ${sessionName} created`);
    console.log(`   TX_MESH=${mesh}, TX_AGENT=${finalAgentName}`);
    console.log('⚙️  Loaded .tmux.conf configuration\n');

    // Start Claude in the session
    console.log('🤖 Starting Claude in session...');
    TmuxInjector.send(sessionName, 'claude --dangerously-skip-permissions');
    TmuxInjector.send(sessionName, 'Enter');

    // Wait for Claude to be ready
    console.log('⏳ Waiting for Claude to initialize...');
    const ready = await TmuxInjector.claudeReadyCheck(sessionName);
    if (!ready) {
      throw new Error('Claude failed to initialize within timeout');
    }
    console.log('✅ Claude is ready\n');

    // Process queue backlog for this mesh (eventual consistency)
    console.log('📬 Processing queued messages...');
    Queue.processQueueBacklog(mesh);
    console.log('✅ Queue backlog processed\n');

    // Inject agent options if configured
    if (agentConfig.options) {
      if (agentConfig.options.model) {
        console.log(`⚙️  Injecting model: ${agentConfig.options.model}`);
        TmuxInjector.injectCommand(sessionName, `model ${agentConfig.options.model}`);
        Logger.log('spawn', 'Model command injected', { model: agentConfig.options.model });
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for command to process
      }
      if (agentConfig.options.output) {
        console.log(`⚙️  Injecting output style: ${agentConfig.options.output}`);
        TmuxInjector.injectCommand(sessionName, `output-style ${agentConfig.options.output}`);
        Logger.log('spawn', 'Output style command injected', { output: agentConfig.options.output });
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for command to process
      }
    }

    // Build agent prompt with optional task from --init
    console.log('📝 Building agent prompt...');
    const prompt = PromptBuilder.build(mesh, finalAgentName, options.init || null);

    // Save prompt
    const promptDir = `${agentDir}/prompts`;
    fs.ensureDirSync(promptDir);
    const promptFile = `${promptDir}/prompt.md`;
    fs.writeFileSync(promptFile, prompt);
    console.log(`✅ Prompt saved: ${promptFile}\n`);

    // Instruct Claude to load prompt via internal command
    console.log('📡 Instructing Claude to load prompt...');
    TmuxInjector.injectCommand(sessionName, `tx-agent ${mesh} ${finalAgentName}`);
    console.log('✅ Prompt load command sent\n');

    // Note: Initial task is now embedded in the prompt via PromptBuilder.build()
    if (options.init) {
      console.log(`✅ Initial task embedded in prompt: "${options.init}"\n`);
    }

    // Update mesh state
    await AtomicState.update(mesh, {
      status: 'active',
      current_agent: finalAgentName
    });

    console.log(`✅ ${mesh}/${agentName}${taskUID ? ` (${taskUID})` : ''} spawned!\n`);
    console.log(`   Session: ${sessionName}`);
    console.log(`   Attach: tmux attach -t ${sessionName}`);
    console.log(`   Kill: tx kill ${mesh} ${agentName}\n`);

    Logger.log('spawn', 'Agent spawned', {
      mesh,
      agent: finalAgentName,
      sessionName,
      taskUID,
      hasInitTask: !!options.init
    });
  } catch (error) {
    console.error('❌ Failed to spawn:', error.message);
    Logger.error('spawn', `Failed to spawn: ${error.message}`, {
      mesh,
      agent,
      taskUID,
      error: error.stack
    });
    process.exit(1);
  }
}

module.exports = { spawn, generateTaskUID };
