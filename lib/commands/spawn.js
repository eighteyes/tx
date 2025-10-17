const { TmuxInjector } = require('../tmux-injector');
const { PromptBuilder } = require('../prompt-builder');
const { Message } = require('../message');
const { Logger } = require('../logger');
const { AtomicState } = require('../atomic-state');
const fs = require('fs-extra');

async function spawn(mesh, agent = null, options = {}) {
  try {
    const agentName = agent || mesh;
    const sessionName = `${mesh}-${agentName}`;

    console.log(`🚀 Spawning ${mesh}/${agentName}...\n`);

    // Check if session already exists
    const sessions = TmuxInjector.listSessions();
    if (sessions.includes(sessionName)) {
      console.log(`⚠️  Session already exists: ${sessionName}`);
      console.log(`   Use: tx attach\n`);
      return;
    }

    // Create tmux session with Claude running
    console.log('📦 Creating tmux session...');
    TmuxInjector.createSession(sessionName, 'bash');
    console.log(`✅ Session ${sessionName} created\n`);

    // Load agent config for options
    const configPath = `.ai/tx/mesh/${mesh}/agents/${agentName}/config.json`;
    let agentConfig = {};
    if (fs.existsSync(configPath)) {
      agentConfig = fs.readJsonSync(configPath);
    }

    // Start Claude in the session
    console.log('🤖 Starting Claude in session...');
    TmuxInjector.send(sessionName, 'claude');
    TmuxInjector.send(sessionName, 'Enter');
    // Wait for Claude to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Inject agent options if configured
    if (agentConfig.options) {
      if (agentConfig.options.model) {
        console.log(`⚙️  Injecting model: ${agentConfig.options.model}`);
        TmuxInjector.injectCommand(sessionName, `model ${agentConfig.options.model}`);
      }
      if (agentConfig.options.output) {
        console.log(`⚙️  Injecting output style: ${agentConfig.options.output}`);
        TmuxInjector.injectCommand(sessionName, `output-style ${agentConfig.options.output}`);
      }
    }

    // Build agent prompt
    console.log('📝 Building agent prompt...');
    const prompt = PromptBuilder.build(mesh, agentName);

    // Save prompt
    const promptDir = `.ai/tx/mesh/${mesh}/agents/${agentName}/prompts`;
    fs.ensureDirSync(promptDir);
    const timestamp = Date.now();
    const promptFile = `${promptDir}/${timestamp}-prompt.md`;
    fs.writeFileSync(promptFile, prompt);
    console.log(`✅ Prompt saved: ${promptFile}\n`);

    // Inject prompt via @ file attachment
    console.log('💉 Injecting prompt into Claude...');
    TmuxInjector.injectFile(sessionName, promptFile);
    console.log('✅ Prompt injected\n');

    // Send initial task if provided
    if (options.init) {
      console.log(`📬 Sending initial task: "${options.init}"\n`);
      Message.send(mesh, options.init, 'Initial task from tx spawn');
    }

    // Update mesh state
    await AtomicState.update(mesh, {
      status: 'active',
      current_agent: agentName
    });

    console.log(`✅ ${mesh}/${agentName} spawned!\n`);
    console.log(`   Session: ${sessionName}`);
    console.log(`   Attach: tmux attach -t ${sessionName}`);
    console.log(`   Kill: tx kill ${mesh} ${agentName}\n`);

    Logger.log('spawn', 'Agent spawned', {
      mesh,
      agent: agentName,
      sessionName,
      hasInitTask: !!options.init
    });
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

module.exports = { spawn };
