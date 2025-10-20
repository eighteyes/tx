const chokidar = require('chokidar');
const fs = require('fs-extra');

console.log('Testing chokidar directly...\n');

const watchPattern = '.ai/tx/mesh/**/msgs/**/*.md';
console.log(`Pattern: ${watchPattern}\n`);

const watcher = chokidar.watch(watchPattern, {
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 100
  }
});

watcher.on('add', (path) => {
  console.log(`✓ File added: ${path}`);
});

watcher.on('change', (path) => {
  console.log(`✓ File changed: ${path}`);
});

watcher.on('unlink', (path) => {
  console.log(`✓ File removed: ${path}`);
});

watcher.on('error', (error) => {
  console.error(`✗ Error: ${error.message}`);
});

watcher.on('ready', () => {
  console.log('✓ Watcher ready\n');
  console.log('Creating test file...');
  const testFile = `.ai/tx/mesh/test-echo/agents/echo/msgs/inbox/watcher-test-${Date.now()}.md`;
  fs.writeFileSync(testFile, '---\ntest: true\n---\n\n# Test');
  console.log(`Created: ${testFile}\n`);

  setTimeout(() => {
    console.log('\nCleaning up...');
    try {
      fs.unlinkSync(testFile);
    } catch (e) {}
    watcher.close();
    process.exit(0);
  }, 3000);
});
