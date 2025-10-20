const fs = require('fs-extra');
const path = require('path');

console.log('=== Testing TX Stop State Cleanup ===\n');

// Check current state.json files
const meshDir = '.ai/tx/mesh';
const meshes = fs.readdirSync(meshDir);
let stateFilesBefore = 0;

console.log('Before cleanup:');
meshes.forEach(mesh => {
  const stateFile = path.join(meshDir, mesh, 'state.json');
  if (fs.existsSync(stateFile)) {
    console.log(`  ✓ Found: ${stateFile}`);
    stateFilesBefore++;
  }
});
console.log(`  Total: ${stateFilesBefore} state files\n`);

// Simulate the stop command's cleanup logic
console.log('Simulating tx stop cleanup logic...\n');
let cleaned = 0;

if (fs.existsSync(meshDir)) {
  const meshesList = fs.readdirSync(meshDir);

  meshesList.forEach(mesh => {
    const stateFile = path.join(meshDir, mesh, 'state.json');
    if (fs.existsSync(stateFile)) {
      try {
        fs.removeSync(stateFile);
        console.log(`   ✓ Removed: ${stateFile}`);
        cleaned++;
      } catch (e) {
        console.log(`   ✗ Failed: ${stateFile} - ${e.message}`);
      }
    }
  });
}

console.log(`\nCleaned: ${cleaned} state files\n`);

// Verify cleanup
console.log('After cleanup:');
const stateFilesAfter = meshes.filter(mesh => {
  const stateFile = path.join(meshDir, mesh, 'state.json');
  return fs.existsSync(stateFile);
}).length;

meshes.forEach(mesh => {
  const stateFile = path.join(meshDir, mesh, 'state.json');
  if (fs.existsSync(stateFile)) {
    console.log(`  ✗ Still exists: ${stateFile}`);
  } else {
    console.log(`  ✓ Cleaned: ${mesh}`);
  }
});

console.log(`  Total: ${stateFilesAfter} state files\n`);

if (stateFilesAfter === 0) {
  console.log('✅ All state.json files successfully cleaned!');
} else {
  console.log('⚠ Some state files remain');
}

// Restore state files for testing
console.log('\nRestoring state files for testing...');
meshes.forEach(mesh => {
  const stateFile = path.join(meshDir, mesh, 'state.json');
  const defaultState = {
    status: 'idle',
    tasks_completed: 0,
    workflow_complete: false,
    current_agent: null
  };

  if (!fs.existsSync(stateFile)) {
    fs.ensureFileSync(stateFile);
    fs.writeJsonSync(stateFile, defaultState, { spaces: 2 });
    console.log(`  ✓ Restored: ${stateFile}`);
  }
});
