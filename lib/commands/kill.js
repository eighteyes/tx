const { TmuxInjector } = require('../tmux-injector');
const { Logger } = require('../logger');

function kill(mesh, agent = null) {
  try {
    const agentName = agent || mesh;
    const sessionName = `${mesh}-${agentName}`;

    console.log(`🔪 Killing ${sessionName}...\n`);

    const result = TmuxInjector.killSession(sessionName);

    if (result) {
      console.log(`✅ Session killed: ${sessionName}\n`);
      Logger.log('kill', 'Session killed', { mesh, agent: agentName, sessionName });
    } else {
      console.log(`⚠️  Session not found: ${sessionName}\n`);
    }
  } catch (error) {
    console.error('❌ Failed to kill session:', error.message);
    Logger.error('kill', `Failed to kill session: ${error.message}`, {
      mesh,
      agent
    });
    process.exit(1);
  }
}

module.exports = { kill };
