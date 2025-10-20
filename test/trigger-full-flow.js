const { Queue } = require('../lib/queue');

console.log('Triggering full message flow...\n');
Queue.init();

// Process inbox → next
console.log('Step 1: Processing inbox → next');
Queue.processAgentInbox('test-echo', 'echo');

setTimeout(() => {
  // Process next → active
  console.log('Step 2: Processing next → active');
  Queue.processAgentNext('test-echo', 'echo');

  setTimeout(() => {
    const fs = require('fs');
    console.log('\nFinal locations:');
    const dirs = ['inbox', 'next', 'active', 'complete'];
    dirs.forEach(dir => {
      const dirPath = `.ai/tx/mesh/test-echo/agents/echo/msgs/${dir}`;
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
        if (files.length > 0) {
          console.log(`  ${dir}: ${files.join(', ')}`);
        }
      }
    });
  }, 500);
}, 500);
