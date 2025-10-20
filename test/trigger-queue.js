const { Queue } = require('../lib/queue');

console.log('Triggering queue processing for test-echo/echo...');
Queue.init();
Queue.processAgentInbox('test-echo', 'echo');

setTimeout(() => {
  console.log('Checking file locations...');
  const fs = require('fs');

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
}, 1000);
