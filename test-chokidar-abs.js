const chokidar = require('chokidar');
const path = require('path');

console.log('Starting chokidar test with absolute path...');
const watchPath = path.resolve('.ai/tx/mesh/core/agents/core/msgs/');
console.log('Watching:', watchPath);

const watcher = chokidar.watch(watchPath + '/*.md', {
  ignoreInitial: true,
  persistent: true,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 50
  }
});

watcher.on('add', (path) => {
  console.log(`File added: ${path}`);
});

watcher.on('ready', () => {
  console.log('Watcher is ready!');
  console.log(`Create a .md file in ${watchPath} to test`);
});

watcher.on('error', (error) => {
  console.error('Watcher error:', error);
});

// Keep the process alive
process.stdin.resume();