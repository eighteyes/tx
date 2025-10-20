# Troubleshooting Chokidar Issues

This guide covers common issues and their solutions.

## Issue: Watcher Not Detecting New Directories

### Symptoms
Files in newly created directories are not being detected.

### Cause
Native file system events may not propagate to newly created directories depending on the platform.

### Solution
Enable polling mode:

```javascript
const watcher = chokidar.watch('**/*', {
  usePolling: true,
  interval: 100
});
```

### Trade-offs
- Polling uses more CPU but is more reliable
- Increase `interval` to reduce CPU usage if needed

## Issue: Multiple Events for Single Change

### Symptoms
Getting duplicate `add` or `change` events for the same file.

### Cause
Editors and applications often write files in multiple steps (save, rename temp file, etc.).

### Solution
Use `awaitWriteFinish` to wait for write operations to complete:

```javascript
const watcher = chokidar.watch('**/*', {
  awaitWriteFinish: {
    stabilityThreshold: 200,  // Wait 200ms after last change
    pollInterval: 100         // Check every 100ms
  }
});
```

### Alternative Solution
Use the `atomic: true` option (v4 feature):

```javascript
const watcher = chokidar.watch('**/*', {
  atomic: true  // Better atomic write detection
});
```

## Issue: Watcher Not Cleaning Up

### Symptoms
Process hangs or memory leaks when trying to stop the watcher.

### Cause
Watcher not properly closed or events still being processed.

### Solution
Proper async cleanup:

```javascript
async function cleanup() {
  if (watcher) {
    // Remove all listeners first
    watcher.removeAllListeners();

    // Close the watcher
    await watcher.close();

    // Clear reference
    watcher = null;
  }
}

// Call cleanup
await cleanup();
```

### Graceful Shutdown Pattern

```javascript
let watcher = null;

async function shutdown() {
  console.log('Shutting down...');

  if (watcher) {
    try {
      await watcher.close();
      watcher = null;
      console.log('Watcher closed');
    } catch (error) {
      console.error('Error closing watcher:', error);
      // Force cleanup
      watcher = null;
    }
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

## Issue: Files Not Being Watched

### Symptoms
Expected files are not triggering events.

### Cause
Files may be excluded by ignore patterns or not matched by watch patterns.

### Solution
Debug which paths are being watched:

```javascript
watcher.on('ready', () => {
  const watched = watcher.getWatched();
  console.log('Watched directories:', Object.keys(watched));

  // Check if specific path is watched
  const targetDir = path.dirname('/path/to/file.txt');
  const targetFile = path.basename('/path/to/file.txt');

  if (watched[targetDir]) {
    if (watched[targetDir].includes(targetFile)) {
      console.log('✓ File IS being watched');
    } else {
      console.log('✗ File NOT in watched list');
      console.log('Files in directory:', watched[targetDir]);
    }
  } else {
    console.log('✗ Directory NOT being watched');
  }
});
```

### Check Ignore Patterns

```javascript
// Verify your ignore patterns aren't too broad
const watcher = chokidar.watch('**/*', {
  ignored: /(^|[\/\\])\../,  // This ignores dotfiles
  // Try temporarily removing ignore to debug
});
```

## Issue: Performance Problems

### Symptoms
High CPU usage or slow event processing.

### Solutions

#### 1. Reduce Watch Scope

```javascript
// Instead of watching everything
const watcher = chokidar.watch('**/*');

// Watch only what you need
const watcher = chokidar.watch([
  'src/**/*.js',
  'config/**/*.json'
]);
```

#### 2. Use Native FSEvents

```javascript
const watcher = chokidar.watch('**/*', {
  usePolling: false,  // Use native events (default)
  useFsEvents: true   // Use FSEvents on macOS
});
```

#### 3. Limit Depth

```javascript
const watcher = chokidar.watch('**/*', {
  depth: 5  // Only watch up to 5 levels deep
});
```

#### 4. Avoid Unnecessary Stats

```javascript
const watcher = chokidar.watch('**/*', {
  alwaysStat: false  // Don't fetch stats unless needed
});
```

#### 5. Optimize Ignore Patterns

```javascript
const watcher = chokidar.watch('**/*', {
  ignored: [
    'node_modules/**',
    '.git/**',
    '**/*.log',
    '**/dist/**'
  ]
});
```

## Issue: Events Not Firing on Initial Scan

### Symptoms
No events triggered for existing files when watcher starts.

### Cause
`ignoreInitial: true` is set.

### Solution
Set `ignoreInitial: false`:

```javascript
const watcher = chokidar.watch('**/*', {
  ignoreInitial: false  // Emit events for existing files
});
```

## Issue: Watcher Crashes with EMFILE Error

### Symptoms
Error: `EMFILE: too many open files`.

### Cause
Watching too many files exceeds system file descriptor limit.

### Solutions

#### 1. Increase System Limits (macOS/Linux)

```bash
# Check current limit
ulimit -n

# Increase temporarily
ulimit -n 10000

# Permanent (add to ~/.bashrc or ~/.zshrc)
ulimit -n 10000
```

#### 2. Reduce Watch Scope

```javascript
// Watch specific patterns instead of everything
const watcher = chokidar.watch([
  'src/**/*.js',
  'test/**/*.js'
], {
  ignored: ['node_modules/**', '.git/**']
});
```

#### 3. Use Polling (Less File Descriptors)

```javascript
const watcher = chokidar.watch('**/*', {
  usePolling: true  // Uses fewer file descriptors
});
```

## Issue: Symlinks Not Being Followed

### Symptoms
Files in symlinked directories are not being watched.

### Cause
`followSymlinks: false` is set (default).

### Solution
Enable symlink following:

```javascript
const watcher = chokidar.watch('**/*', {
  followSymlinks: true
});
```

### Warning
Be careful of circular symlinks - they can cause infinite loops.

## Issue: Events Delayed or Batched

### Symptoms
Events arrive late or in batches.

### Cause
Various OS-level buffering or `awaitWriteFinish` delays.

### Solutions

#### 1. Reduce Stability Threshold

```javascript
const watcher = chokidar.watch('**/*', {
  awaitWriteFinish: {
    stabilityThreshold: 50,  // Reduce from default
    pollInterval: 50
  }
});
```

#### 2. Disable awaitWriteFinish

```javascript
const watcher = chokidar.watch('**/*', {
  // Don't use awaitWriteFinish if immediate events needed
});
```

#### 3. Use Polling for Faster Detection

```javascript
const watcher = chokidar.watch('**/*', {
  usePolling: true,
  interval: 50  // Check every 50ms
});
```

## Issue: Watcher State Gets Out of Sync

### Symptoms
Watcher reports incorrect file states or misses events.

### Solutions

#### 1. Restart Watcher

```javascript
async function restartWatcher() {
  if (watcher) {
    await watcher.close();
  }

  watcher = chokidar.watch('**/*', options);

  await new Promise(resolve => watcher.once('ready', resolve));
  console.log('Watcher restarted');
}
```

#### 2. Use Polling for Reliability

```javascript
const watcher = chokidar.watch('**/*', {
  usePolling: true  // More reliable but slower
});
```

## Platform-Specific Issues

### macOS: FSEvents Delay

#### Issue
Events delayed by up to 1 second on macOS.

#### Solution
Use polling for faster detection:

```javascript
const watcher = chokidar.watch('**/*', {
  usePolling: true,
  interval: 100
});
```

### Windows: Long Path Issues

#### Issue
Paths longer than 260 characters fail.

#### Solution
Enable long paths in Windows 10+:
1. Run `gpedit.msc`
2. Navigate to: Computer Configuration > Administrative Templates > System > Filesystem
3. Enable "Enable Win32 long paths"

### Linux: Inotify Limits

#### Issue
Error: `ENOSPC: System limit for number of file watchers reached`.

#### Solution
Increase inotify limits:

```bash
# Check current limit
cat /proc/sys/fs/inotify/max_user_watches

# Increase temporarily
sudo sysctl fs.inotify.max_user_watches=524288

# Increase permanently
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```
