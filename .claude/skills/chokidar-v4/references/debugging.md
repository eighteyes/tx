# Debugging Chokidar Watchers

This guide provides patterns for debugging file watcher issues.

## Log All Events

Use the `all` event to capture every watcher event:

```javascript
const watcher = chokidar.watch('**/*');

watcher
  .on('all', (event, path, stats) => {
    console.log(`[${event}] ${path}`, stats);
  })
  .on('error', (error) => {
    console.error('Watcher error:', error);
  })
  .on('ready', () => {
    const watched = watcher.getWatched();
    console.log('Watched directories:', Object.keys(watched));
    console.log('Watched files:', Object.values(watched).flat());
  });
```

## Detect Watcher State

### Check if Watcher is Running

```javascript
function isWatcherRunning(watcher) {
  return watcher !== null && !watcher.closed;
}
```

### Get Watched Paths

```javascript
function getWatchedPaths(watcher) {
  if (!watcher) return {};

  const watched = watcher.getWatched();
  return {
    directories: Object.keys(watched),
    totalFiles: Object.values(watched).flat().length
  };
}
```

### Complete Status Check

```javascript
function getWatcherStatus(watcher) {
  return {
    running: isWatcherRunning(watcher),
    ...getWatchedPaths(watcher)
  };
}

// Usage
const status = getWatcherStatus(watcher);
console.log(`Watcher running: ${status.running}`);
console.log(`Watching ${status.directories.length} directories`);
console.log(`Watching ${status.totalFiles} files`);
```

## Parse Paths for Context

Extract context from file paths for better debugging:

```javascript
class WatcherDebug {
  static parsePathInfo(filepath) {
    // Example: .ai/tx/mesh/test/msgs/inbox/file.md
    const meshMatch = filepath.match(/\.ai\/tx\/mesh\/([^/]+)\//);
    const queueMatch = filepath.match(/\/msgs\/([^/]+)\//);
    const agentMatch = filepath.match(/\/agents\/([^/]+)\/msgs\//);

    return {
      mesh: meshMatch ? meshMatch[1] : null,
      queue: queueMatch ? queueMatch[1] : null,
      agent: agentMatch ? agentMatch[1] : null,
      filename: path.basename(filepath)
    };
  }

  static handleAdd(filepath) {
    const info = this.parsePathInfo(filepath);
    console.log(`New file: ${info.filename}`);
    console.log(`  Queue: ${info.queue}`);
    console.log(`  Mesh: ${info.mesh}`);
    console.log(`  Agent: ${info.agent}`);
  }
}
```

## Event Tracking

Track event counts and timing:

```javascript
class EventTracker {
  constructor() {
    this.events = {};
    this.startTime = Date.now();
  }

  track(event, path) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push({
      path,
      timestamp: Date.now() - this.startTime
    });
  }

  report() {
    console.log('\n=== Event Report ===');
    for (const [event, entries] of Object.entries(this.events)) {
      console.log(`\n${event}: ${entries.length} events`);
      entries.forEach(({ path, timestamp }) => {
        console.log(`  [${timestamp}ms] ${path}`);
      });
    }
  }
}

// Usage
const tracker = new EventTracker();
watcher.on('all', (event, path) => tracker.track(event, path));

// Report after some time
setTimeout(() => tracker.report(), 5000);
```

## Verbose Logging

Enable detailed logging for development:

```javascript
class VerboseWatcher {
  static start(patterns, options = {}) {
    console.log('Starting watcher with patterns:', patterns);
    console.log('Options:', JSON.stringify(options, null, 2));

    const watcher = chokidar.watch(patterns, options);

    watcher
      .on('add', (path, stats) => {
        console.log(`[ADD] ${path}`);
        if (stats) {
          console.log(`  Size: ${stats.size} bytes`);
          console.log(`  Modified: ${stats.mtime}`);
        }
      })
      .on('change', (path, stats) => {
        console.log(`[CHANGE] ${path}`);
        if (stats) {
          console.log(`  Size: ${stats.size} bytes`);
          console.log(`  Modified: ${stats.mtime}`);
        }
      })
      .on('unlink', (path) => {
        console.log(`[UNLINK] ${path}`);
      })
      .on('addDir', (path) => {
        console.log(`[ADD DIR] ${path}`);
      })
      .on('unlinkDir', (path) => {
        console.log(`[UNLINK DIR] ${path}`);
      })
      .on('error', (error) => {
        console.error(`[ERROR] ${error.message}`);
        console.error(error.stack);
      })
      .on('ready', () => {
        console.log('[READY] Initial scan complete');
        const watched = watcher.getWatched();
        console.log(`Watching ${Object.keys(watched).length} directories`);
      });

    return watcher;
  }
}
```

## Debugging Specific Issues

### Why is my file not being watched?

```javascript
function debugWatchedPaths(watcher, targetPath) {
  const watched = watcher.getWatched();

  console.log('\n=== Watched Path Debug ===');
  console.log(`Looking for: ${targetPath}`);

  const dir = path.dirname(targetPath);
  const filename = path.basename(targetPath);

  if (watched[dir]) {
    if (watched[dir].includes(filename)) {
      console.log(`✓ File IS being watched in ${dir}`);
    } else {
      console.log(`✗ Directory is watched but file is NOT in list`);
      console.log(`Files in ${dir}:`, watched[dir]);
    }
  } else {
    console.log(`✗ Directory ${dir} is NOT being watched`);
    console.log('Watched directories:', Object.keys(watched));
  }
}

// Usage
debugWatchedPaths(watcher, '/path/to/my/file.txt');
```

### Why am I getting multiple events?

Add event deduplication logging:

```javascript
class EventDeduplicator {
  constructor(windowMs = 100) {
    this.recent = new Map();
    this.windowMs = windowMs;
  }

  isDuplicate(event, path) {
    const key = `${event}:${path}`;
    const now = Date.now();
    const last = this.recent.get(key);

    if (last && (now - last) < this.windowMs) {
      console.log(`[DUPLICATE] ${event} ${path} (${now - last}ms since last)`);
      return true;
    }

    this.recent.set(key, now);
    return false;
  }
}

// Usage
const dedup = new EventDeduplicator();
watcher.on('all', (event, path) => {
  if (!dedup.isDuplicate(event, path)) {
    console.log(`[UNIQUE] ${event} ${path}`);
  }
});
```
