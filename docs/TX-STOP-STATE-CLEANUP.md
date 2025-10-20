# TX Stop Command - State Cleanup

## Overview

The `tx stop` command now automatically cleans up all mesh `state.json` files when stopping the system. This ensures a clean slate for the next startup.

## What Changed

**File:** `lib/commands/stop.js`

The stop command now:
1. Kills all tmux sessions (existing behavior)
2. **NEW**: Scans `.ai/tx/mesh/` directory for all meshes
3. **NEW**: Removes `state.json` file from each mesh
4. Stops the system (existing behavior)

## State Files Cleaned

The following state files are removed when running `tx stop`:

```
.ai/tx/mesh/brain/state.json
.ai/tx/mesh/core/state.json
.ai/tx/mesh/test/state.json
.ai/tx/mesh/test-echo/state.json
.ai/tx/mesh/test-queue/state.json
(or any other mesh that has a state.json file)
```

## Example Output

```
⏹️  Stopping TX...

Killing 2 tmux session(s)...
   ✓ tx-main
   ✓ tx-worker

Cleaning up state files...
   ✓ Removed: .ai/tx/mesh/brain/state.json
   ✓ Removed: .ai/tx/mesh/core/state.json
   ✓ Removed: .ai/tx/mesh/test/state.json
   ✓ Removed: .ai/tx/mesh/test-echo/state.json
   ✓ Removed: .ai/tx/mesh/test-queue/state.json

Cleaned 5 state file(s)

Stopping system...

✅ TX stopped
```

## Implementation Details

### Code Flow

```javascript
// Scan mesh directory
const meshDir = '.ai/tx/mesh';
const meshes = fs.readdirSync(meshDir);

// For each mesh, check if state.json exists
meshes.forEach(mesh => {
  const stateFile = path.join(meshDir, mesh, 'state.json');
  if (fs.existsSync(stateFile)) {
    // Remove the state file
    fs.removeSync(stateFile);
  }
});
```

### Error Handling

- **Missing mesh directory**: Gracefully handled, no state files cleaned
- **Unreadable state file**: Error logged but continues cleanup of other files
- **Permission denied**: Error logged but continues cleanup of other files

All errors are logged via the Logger system but do not stop the shutdown process.

## Benefits

✓ **Clean State**: New startup begins with fresh mesh states
✓ **No Stale Data**: Previous workflow states don't interfere with new runs
✓ **Consistent Behavior**: Each `tx start` gets the same initial conditions
✓ **Debugging**: Failed meshes can be inspected by keeping state files in specific folders

## When State is NOT Cleaned

If a mesh's `state.json` file is moved/copied to a backup location before stopping, it won't be cleaned. This allows preserving state history if needed.

## Testing

Run the cleanup test:
```bash
node test/test-stop-state-cleanup.js
```

This test:
1. Lists all current state files
2. Runs the cleanup simulation
3. Verifies all files were removed
4. Restores state files for system operation

## Related Commands

- `tx start` - Initializes fresh system (now with clean state)
- `tx status` - Shows current mesh states
- `tx logs` - View system logs

## State Management

When `tx start` is run after a `tx stop`:
- Each mesh initializes with default state
- Workflows restart from beginning
- Task counters reset to 0
- All agent queues are empty

This creates a true "fresh start" for the system.
