const { Queue } = require('../queue');
const { TmuxInjector } = require('../tmux-injector');
const { AtomicState } = require('../atomic-state');
const fs = require('fs-extra');
const path = require('path');

function status() {
  try {
    console.log('📊 TX Watch Status\n');

    // Get active tmux sessions
    const sessions = TmuxInjector.listSessions();
    console.log(`Tmux Sessions (${sessions.length}):`);
    if (sessions.length === 0) {
      console.log('   None');
    } else {
      sessions.forEach(s => console.log(`   ✓ ${s}`));
    }
    console.log();

    // Get all meshes
    const meshDir = '.ai/tx/mesh';
    if (!fs.existsSync(meshDir)) {
      console.log('No meshes active');
      return;
    }

    const meshes = fs.readdirSync(meshDir).filter(f => {
      return fs.statSync(path.join(meshDir, f)).isDirectory();
    });

    console.log(`Active Meshes (${meshes.length}):`);
    console.log();

    meshes.forEach(mesh => {
      const state = AtomicState.read(mesh);
      const status = Queue.getQueueStatus(mesh);

      console.log(`  📦 ${mesh}`);
      if (state) {
        console.log(`     Status: ${state.status}`);
        console.log(`     Agent: ${state.current_agent || 'N/A'}`);
        if (state.workflow && state.workflow.length > 0) {
          console.log(
            `     Workflow: [${state.workflow.join(' → ')}] (${state.workflow_position + 1}/${state.workflow.length})`
          );
        }
      }

      console.log(`     Queue:`);
      console.log(`       Inbox: ${status.inbox}`);
      console.log(`       Next: ${status.next}`);
      console.log(`       Active: ${status.active}`);
      console.log(`       Complete: ${status.complete}`);
      console.log();
    });

    // Summary
    const totalInbox = meshes.reduce(
      (sum, m) => sum + Queue.getQueueStatus(m).inbox,
      0
    );
    const totalActive = meshes.reduce(
      (sum, m) => sum + Queue.getQueueStatus(m).active,
      0
    );

    console.log(`Summary:`);
    console.log(`  Total meshes: ${meshes.length}`);
    console.log(`  Total inbox: ${totalInbox}`);
    console.log(`  Total active: ${totalActive}`);
    console.log();
  } catch (error) {
    console.error('❌ Failed to get status:', error.message);
    process.exit(1);
  }
}

module.exports = { status };
