const { SystemManager } = require('../system-manager');
const { TmuxInjector } = require('../tmux-injector');
const { Logger } = require('../logger');

async function stop() {
  try {
    console.log('⏹️  Stopping TX Watch...\n');

    // Kill all tmux sessions
    const sessions = TmuxInjector.listSessions();
    console.log(`Killing ${sessions.length} tmux session(s)...`);

    sessions.forEach(session => {
      TmuxInjector.killSession(session);
      console.log(`   ✓ ${session}`);
    });

    // Stop system
    console.log('\nStopping system...');
    await SystemManager.stop();

    console.log('\n✅ TX Watch stopped\n');
    Logger.log('stop', 'System stopped', { sessionCount: sessions.length });
  } catch (error) {
    console.error('❌ Failed to stop:', error.message);
    Logger.error('stop', `Failed to stop: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { stop };
