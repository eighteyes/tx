const { SystemManager } = require('../system-manager');
const { Message } = require('../message');
const { TmuxInjector } = require('../tmux-injector');
const { PromptBuilder } = require('../prompt-builder');
const { Logger } = require('../logger');
const fs = require('fs-extra');
const path = require('path');

async function start(options = {}) {
  try {
    console.log('🚀 Starting TX Watch system...\n');

    // Start system (queue + watcher)
    await SystemManager.start();
    console.log('✅ System started\n');

    // Check if tmux available
    const sessions = TmuxInjector.listSessions();
    const hasCore = sessions.includes('core');

    if (!hasCore) {
      // Create core session
      console.log('📦 Creating core tmux session...');
      TmuxInjector.createSession('core', 'bash');
      console.log('✅ Core session created\n');

      // Start Claude in core session
      console.log('🤖 Starting Claude in core session...');
      TmuxInjector.send('core', 'claude');
      TmuxInjector.send('core', 'Enter');
      // Wait for Claude to initialize
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log('✅ Claude started\n');

      // Inject prompt into core
      console.log('📝 Injecting core prompt...');
      const prompt = PromptBuilder.build('core', 'core');
      const promptFile = `.ai/tx/mesh/core/agents/core/prompts/core-prompt.md`;
      fs.ensureDirSync(path.dirname(promptFile));
      fs.writeFileSync(promptFile, prompt);

      TmuxInjector.injectFile('core', promptFile);
      console.log('✅ Prompt injected\n');
    }

    // Attach to core unless detached mode specified
    if (!options.detach) {
      console.log('🔗 Attaching to core session...\n');
      try {
        require('child_process').execSync('tmux attach -t core', {
          stdio: 'inherit'
        });
      } catch (e) {
        // User detached or session ended
        console.log('\n✅ Detached from core session');
      }
    } else {
      console.log('✅ System running in detached mode');
      console.log('📌 Attach to core with: tx attach\n');
    }
  } catch (error) {
    console.error('❌ Failed to start:', error.message);
    process.exit(1);
  }
}

module.exports = { start };
