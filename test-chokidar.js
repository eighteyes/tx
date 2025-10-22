const chokidar = require('chokidar');

console.log('Starting chokidar test...');

const watcher = chokidar.watch('.ai/tx/mesh/**/msgs/*.md', {
  ignored: [
    '**/node_modules/**',
    '**/.git/**',
    '**/prompts/**',
    '**/*-done.md'
  ],
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
  console.log('Create a file matching .ai/tx/mesh/**/msgs/*.md to test');
});

watcher.on('error', (error) => {
  console.error('Watcher error:', error);
});

// Keep the process alive
process.stdin.resume();