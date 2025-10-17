const { TmuxInjector } = require('../tmux-injector');
const { execSync } = require('child_process');

function attach() {
  try {
    const sessions = TmuxInjector.listSessions();

    if (sessions.length === 0) {
      console.log('❌ No active sessions');
      console.log('   Use: tx start\n');
      return;
    }

    if (sessions.length === 1) {
      // Only one session, attach directly
      console.log(`🔗 Attaching to ${sessions[0]}...\n`);
      try {
        execSync(`tmux attach -t ${sessions[0]}`, { stdio: 'inherit' });
      } catch (e) {
        // User detached
      }
      return;
    }

    // Multiple sessions, let user choose
    console.log('Select session:\n');
    sessions.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s}`);
    });

    // Read from stdin (for now, just attach to first)
    console.log(`\n🔗 Attaching to first session: ${sessions[0]}...\n`);
    try {
      execSync(`tmux attach -t ${sessions[0]}`, { stdio: 'inherit' });
    } catch (e) {
      // User detached
    }
  } catch (error) {
    console.error('❌ Failed to attach:', error.message);
    process.exit(1);
  }
}

module.exports = { attach };
