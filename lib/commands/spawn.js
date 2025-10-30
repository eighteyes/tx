const { TmuxInjector } = require('../tmux-injector');
const { PromptBuilder } = require('../prompt-builder');
const { Message } = require('../message');
const { DirectoryInitializer } = require('../directory-initializer');
const { Logger } = require('../logger');
const { AtomicState } = require('../atomic-state');
const { Queue } = require('../queue');
const fs = require('fs-extra');
const crypto = require('crypto');

/**
 * Safe console.log that handles EPIPE errors
 * @param {...any} args - Arguments to log
 */
function safeConsoleLog(...args) {
  try {
    // Use the original console.log, not safeConsoleLog to avoid recursion
    console.log(...args);
  } catch (error) {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
      // Silently ignore EPIPE errors - output stream was closed
      // This can happen when parent process terminates or pipe is broken
    } else {
      // Re-throw other errors
      throw error;
    }
  }
}

/**
 * Generate a random mesh instance UUID (6 characters alphanumeric)
 * Used to create unique mesh instances that can run in parallel
 * Example: "a1b2c3", "x9y8z7"
 * @returns {string} 6-character alphanumeric UUID
 */
function generateMeshUUID() {
  // Generate 4 random bytes and convert to base36 (0-9, a-z)
  const randomBytes = crypto.randomBytes(4);
  const uuid = randomBytes.toString('hex').substring(0, 6);
  return uuid;
}

/**
 * Generate a mesh ID from task summary (4-8 characters)
 * Takes first letter of each word in the summary
 * Example: "search entire database backup" → "sedb"
 * Example: "analyze user behavior patterns in production" → "aubpip"
 * @param {string} summary - The task summary description
 * @returns {string} 4-8 character mesh ID
 */
function generateMeshIDFromSummary(summary) {
  if (!summary || typeof summary !== 'string') {
    return generateMeshUUID(); // Fallback to random UUID
  }

  // Extract words (split on spaces, hyphens, underscores, etc)
  const words = summary.split(/[\s\-_,\.;:]+/).filter(w => w.length > 0);

  if (words.length === 0) {
    return generateMeshUUID(); // Fallback to random UUID
  }

  // Take first letter of each word (max 8 words)
  const maxWords = Math.min(words.length, 8);
  let id = '';

  for (let i = 0; i < maxWords; i++) {
    // Get first alphanumeric character from each word
    const firstChar = words[i].match(/[a-zA-Z0-9]/);
    if (firstChar) {
      id += firstChar[0].toLowerCase();
    }
  }

  // Ensure we have at least 4 characters
  if (id.length < 4) {
    // Pad with numbers if needed
    const padLength = 4 - id.length;
    id = id + Array.from({ length: padLength }, (_, i) => i).join('');
  }

  // Truncate to 8 characters max
  if (id.length > 8) {
    id = id.substring(0, 8);
  }

  return id;
}

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
 * In the simplified system, marks incomplete messages as orphaned
 * @param {string} mesh - Mesh name
 * @param {string} agent - Agent name
 * @returns {number} Number of orphaned messages marked
 */
function cleanupOrphans(mesh, agent) {
  const agentDir = `.ai/tx/mesh/${mesh}/agents/${agent}`;
  const msgsDir = `${agentDir}/msgs`;

  let orphanCount = 0;

  // In simplified system, we just mark incomplete messages as orphaned
  // by renaming them to *-orphan.md
  if (fs.existsSync(msgsDir)) {
    const files = fs.readdirSync(msgsDir).filter(f =>
      f.endsWith('.md') &&
      !f.endsWith('-done.md') &&
      !f.endsWith('-orphan.md')
    );

    files.forEach(file => {
      const sourcePath = `${msgsDir}/${file}`;
      const destPath = `${msgsDir}/${file.replace('.md', '-orphan.md')}`;
      fs.renameSync(sourcePath, destPath);
      orphanCount++;
      Logger.log('spawn', 'Orphaned message marked', {
        mesh,
        agent,
        file,
        newName: file.replace('.md', '-orphan.md')
      });
    });
  }

  return orphanCount;
}

async function spawn(mesh, agent = null, options = {}) {
  // Declare variables outside try-catch so they're accessible in both blocks
  let taskUID = '';
  let finalAgentName = agent;

  try {
    // Check if this is a persistent mesh
    const meshConfigPath = `meshes/mesh-configs/${mesh}.json`;
    let isPersistent = false;
    if (fs.existsSync(meshConfigPath)) {
      const meshConfig = fs.readJsonSync(meshConfigPath);
      isPersistent = meshConfig.type === 'persistent';
    }

    // Core and persistent meshes don't get UUIDs (they need stable paths)
    let meshInstance = mesh;
    if (mesh !== 'core' && !isPersistent) {
      // Generate mesh instance ID from task summary (--id) or random UUID
      let meshUUID;
      if (options.id) {
        meshUUID = generateMeshIDFromSummary(options.id);
        safeConsoleLog(`📝 Generated ID from summary: "${options.id}" → ${meshUUID}\n`);
      } else {
        meshUUID = generateMeshUUID();
      }
      meshInstance = `${mesh}-${meshUUID}`;
      safeConsoleLog(`🆔 Mesh instance ID: ${meshInstance}\n`);
    } else if (isPersistent) {
      safeConsoleLog(`🧠 Persistent mesh: ${mesh} (stable path)\n`);
    }

    // If no agent specified, spawn all agents in the mesh
    if (!agent) {
      const meshConfigPath = `meshes/mesh-configs/${mesh}.json`;
      let agentsToSpawn = [];

      if (fs.existsSync(meshConfigPath)) {
        const meshConfig = fs.readJsonSync(meshConfigPath);
        if (meshConfig.agents && meshConfig.agents.length > 0) {
          // Spawn all agents in the mesh
          agentsToSpawn = meshConfig.agents.map(a =>
            a.includes('/') ? a.split('/').pop() : a
          );
        } else {
          // If no agents in config, default to mesh name
          agentsToSpawn = [mesh];
        }
      } else {
        agentsToSpawn = [mesh];
      }

      // Spawn all agents sequentially with the same mesh instance ID
      for (const agentName of agentsToSpawn) {
        await spawnSingleAgent(mesh, meshInstance, agentName, options, isPersistent);
      }
      return;
    }

    // If agent is specified, spawn just that one
    await spawnSingleAgent(mesh, meshInstance, agent, options, isPersistent);
  } catch (error) {
    console.error('❌ Failed to spawn:', error.message);
    Logger.error('spawn', `Failed to spawn: ${error.message}`, {
      mesh,
      agent,
      error: error.stack
    });
    process.exit(1);
  }
}

async function spawnSingleAgent(mesh, meshInstance, agent, options = {}, isPersistent = false) {
  // Declare variables outside try-catch so they're accessible in both blocks
  let taskUID = '';
  let finalAgentName = agent;

  try {
    // Use the provided agent name directly
    let agentName = agent;
    finalAgentName = agentName;

    // Session name uses mesh instance ID
    // Special cases:
    // - core/core should be just "core"
    // - persistent meshes where mesh name == agent name should be just the mesh name
    const sessionName = (meshInstance === 'core' && finalAgentName === 'core')
      ? 'core'
      : (isPersistent && meshInstance === finalAgentName)
      ? meshInstance
      : `${meshInstance}-${finalAgentName}`;

    safeConsoleLog(`🚀 Spawning ${meshInstance}/${agentName}${taskUID ? ` (UID: ${taskUID})` : ''}...\n`);

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
    safeConsoleLog(`✅ Agent validated: ${agentName}\n`);

    // Check if session already exists
    const sessions = TmuxInjector.listSessions();
    if (sessions.includes(sessionName)) {
      safeConsoleLog(`⚠️  Session already exists: ${sessionName}`);
      safeConsoleLog(`   Use: tx attach\n`);
      return;
    }

    // NOW initialize directories (only after validation succeeds)
    safeConsoleLog('📂 Initializing communication directories...');
    DirectoryInitializer.initializeAgentDirectories(meshInstance, finalAgentName);
    const agentDir = `.ai/tx/mesh/${meshInstance}/agents/${finalAgentName}`;
    safeConsoleLog('✅ Directories created\n');

    // Clean up orphaned messages from previous runs
    safeConsoleLog('🧹 Cleaning up orphaned messages...');
    const orphanCount = cleanupOrphans(meshInstance, finalAgentName);
    if (orphanCount > 0) {
      safeConsoleLog(`✅ Marked ${orphanCount} orphaned message(s) as *-orphan.md\n`);
    } else {
      safeConsoleLog('✅ No orphaned messages found\n');
    }

    // Create tmux session with Claude running
    safeConsoleLog('📦 Creating tmux session...');
    const sessionCreated = TmuxInjector.createSession(sessionName, 'bash', true);
    if (!sessionCreated) {
      throw new Error(`Failed to create tmux session: ${sessionName}. Ensure tmux is installed and accessible.`);
    }
    safeConsoleLog(`✅ Session ${sessionName} created`);
    safeConsoleLog('⚙️  Loaded .tmux.conf configuration\n');

    // Start Claude in the session
    // Use full path to avoid alias issues in tmux sessions
    safeConsoleLog('🤖 Starting Claude in session...');
    TmuxInjector.send(sessionName, '/usr/local/share/npm-global/bin/claude --dangerously-skip-permissions');
    TmuxInjector.send(sessionName, 'Enter');

    // Wait for Claude to be ready
    safeConsoleLog('⏳ Waiting for Claude to initialize...');
    const ready = await TmuxInjector.claudeReadyCheck(sessionName);
    if (!ready) {
      throw new Error('Claude failed to initialize within timeout');
    }
    safeConsoleLog('✅ Claude is ready\n');

    // Process queue backlog for this mesh instance (eventual consistency)
    safeConsoleLog('📬 Processing queued messages...');
    Queue.processQueueBacklog(meshInstance);
    safeConsoleLog('✅ Queue backlog processed\n');

    // Inject agent options if configured
    if (agentConfig.options) {
      if (agentConfig.options.model) {
        safeConsoleLog(`⚙️  Injecting model: ${agentConfig.options.model}`);
        TmuxInjector.injectCommand(sessionName, `model ${agentConfig.options.model}`);
        Logger.log('spawn', 'Model command injected', { model: agentConfig.options.model });
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for command to process
      }
      if (agentConfig.options.output) {
        safeConsoleLog(`⚙️  Injecting output style: ${agentConfig.options.output}`);
        TmuxInjector.injectCommand(sessionName, `output-style ${agentConfig.options.output}`);
        Logger.log('spawn', 'Output style command injected', { output: agentConfig.options.output });
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for command to process
      }
    }

    // Build agent prompt with optional task from --init
    safeConsoleLog('📝 Building agent prompt...');
    const prompt = PromptBuilder.build(mesh, meshInstance, finalAgentName, options.init || null);

    // Save prompt
    const promptDir = `${agentDir}/prompts`;
    fs.ensureDirSync(promptDir);
    const promptFile = `${promptDir}/prompt.md`;
    fs.writeFileSync(promptFile, prompt);
    safeConsoleLog(`✅ Prompt saved: ${promptFile}\n`);

    // Instruct Claude to load prompt via internal command
    safeConsoleLog('📡 Instructing Claude to load prompt...');
    TmuxInjector.injectCommand(sessionName, `tx-agent ${meshInstance} ${finalAgentName}`);
    safeConsoleLog('✅ Prompt load command sent\n');

    // Note: Initial task is now embedded in the prompt via PromptBuilder.build()
    if (options.init) {
      safeConsoleLog(`✅ Initial task embedded in prompt: "${options.init}"\n`);
    }

    // Update mesh instance state
    await AtomicState.update(meshInstance, {
      status: 'active',
      current_agent: finalAgentName,
      base_mesh: mesh
    });

    safeConsoleLog(`✅ ${meshInstance}/${agentName}${taskUID ? ` (${taskUID})` : ''} spawned!\n`);
    safeConsoleLog(`   Session: ${sessionName}`);
    safeConsoleLog(`   Attach: tmux attach -t ${sessionName}`);
    safeConsoleLog(`   Stop: tx stop ${meshInstance} ${agentName}\n`);

    Logger.log('spawn', 'Agent spawned', {
      mesh,
      meshInstance,
      agent: finalAgentName,
      sessionName,
      taskUID,
      hasInitTask: !!options.init
    });
  } catch (error) {
    console.error('❌ Failed to spawn:', error.message);
    Logger.error('spawn', `Failed to spawn agent ${agent}: ${error.message}`, {
      mesh,
      agent,
      taskUID,
      error: error.stack
    });
    process.exit(1);
  }
}

module.exports = { spawn, generateMeshUUID, generateMeshIDFromSummary, generateTaskUID };
