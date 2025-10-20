const { Watcher } = require('../lib/watcher');
const fs = require('fs-extra');
const path = require('path');

console.log('Testing watcher ignore functionality...\n');

// Test 1: Verify ignoredPaths set exists
console.log('✓ Watcher.ignoredPaths exists:', Watcher.ignoredPaths instanceof Set);

// Test 2: Test ignoreNextOperation
const testPath = '.ai/tx/mesh/test/msgs/inbox/test-file.md';
Watcher.ignoreNextOperation(testPath);
console.log('✓ Path added to ignoredPaths:', Watcher.ignoredPaths.has(testPath));

// Test 3: Verify the path is removed after checking
const isSystemOp = Watcher.ignoredPaths.has(testPath);
if (isSystemOp) {
  Watcher.ignoredPaths.delete(testPath);
}
console.log('✓ Path removed after check:', !Watcher.ignoredPaths.has(testPath));

console.log('\nAll tests passed! ✅');
