---
name: chokidar-v4
description: Use this skill when writing or updating file watching code with chokidar v4. Helps implement efficient file system watchers with modern patterns, handles edge cases, and provides migration guidance from v3 to v4.
---

# Chokidar v4 File Watcher

Comprehensive skill for implementing file watchers using chokidar v4, the modern cross-platform file watching library.

## When to Use This Skill

- Implementing new file watchers for detecting file changes
- Migrating from chokidar v3 to v4
- Debugging file watcher issues
- Optimizing watcher performance
- Setting up proper cleanup and error handling

## Installation

```bash
npm install chokidar@^4.0.0
```

## Quick Start

### Basic File Watcher

```javascript
import chokidar from 'chokidar';

const watcher = chokidar.watch('path/to/watch', {
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 100
  }
});

watcher
  .on('add', (path) => console.log(`File ${path} added`))
  .on('change', (path) => console.log(`File ${path} changed`))
  .on('unlink', (path) => console.log(`File ${path} removed`))
  .on('error', (error) => console.error(`Watcher error: ${error}`))
  .on('ready', () => console.log('Initial scan complete'));

// Cleanup
process.on('SIGINT', async () => {
  await watcher.close();
  process.exit(0);
});
```

### Advanced Watcher with State Management

```javascript
import chokidar from 'chokidar';

class FileWatcher {
  static watcher = null;
  static watching = false;

  static start(patterns, options = {}) {
    if (this.watching) {
      console.warn('Watcher already running');
      return;
    }

    const defaultOptions = {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      },
      usePolling: false,
      atomic: true  // V4: Better atomic write detection
    };

    this.watcher = chokidar.watch(patterns, {
      ...defaultOptions,
      ...options
    });

    this.registerHandlers();
    this.watching = true;
  }

  static registerHandlers() {
    this.watcher
      .on('add', (path, stats) => this.handleAdd(path, stats))
      .on('change', (path, stats) => this.handleChange(path, stats))
      .on('unlink', (path) => this.handleRemove(path))
      .on('error', (error) => this.handleError(error))
      .on('ready', () => this.handleReady());
  }

  static handleAdd(path, stats) {
    console.log(`File added: ${path}`);
  }

  static handleChange(path, stats) {
    console.log(`File changed: ${path}`);
  }

  static handleRemove(path) {
    console.log(`File removed: ${path}`);
  }

  static handleError(error) {
    console.error(`Watcher error: ${error.message}`);
  }

  static handleReady() {
    console.log('Watcher ready');
    const watched = this.watcher.getWatched();
    console.log(`Watching ${Object.keys(watched).length} directories`);
  }

  static async stop() {
    if (!this.watching) return;

    try {
      await this.watcher.close();
      this.watcher = null;
      this.watching = false;
      console.log('Watcher stopped');
    } catch (error) {
      console.error(`Error stopping watcher: ${error.message}`);
      this.watcher = null;
      this.watching = false;
    }
  }

  static isRunning() {
    return this.watching;
  }

  static async waitForReady() {
    if (!this.watcher) {
      throw new Error('Watcher not started');
    }

    return new Promise((resolve) => {
      if (this.watcher._readyEmitted) {
        resolve();
      } else {
        this.watcher.once('ready', resolve);
      }
    });
  }
}

export { FileWatcher };
```

## Essential Configuration Options

```javascript
{
  // Core options
  persistent: true,        // Keep process running
  ignoreInitial: false,   // Emit events for initial scan

  // V4 improvement: Better atomic write handling
  atomic: true,

  // Wait for write operations to complete
  awaitWriteFinish: {
    stabilityThreshold: 100,  // Wait 100ms after last change
    pollInterval: 100         // Check every 100ms
  },

  // Polling (use for detecting new directories)
  usePolling: false,      // Use native FSEvents (faster)
  interval: 100,          // Poll interval for files (if polling)

  // Path filtering
  ignored: /(^|[\/\\])\../,  // Ignore dotfiles
  depth: 99,                  // Max directory depth

  // Performance
  alwaysStat: false,      // Don't call stat on all files
  followSymlinks: false   // Don't follow symlinks
}
```

## Key Changes in v4

1. **Pure ESM**: Chokidar v4 is ESM-only (must use `import`)
2. **Atomic Writes**: New `atomic` option for better detection
3. **Better TypeScript Support**: Built-in types
4. **Improved Performance**: Better handling of large directories
5. **Smaller Bundle**: Reduced dependencies and size

## Common Patterns

### Detect New Directories Created After Start

```javascript
const watcher = chokidar.watch(['**/*.md', '**/*.json'], {
  persistent: true,
  ignoreInitial: false,
  usePolling: true,      // Enable to detect files in new directories
  interval: 100,
  atomic: true
});
```

### Ignore System Operations

```javascript
class Watcher {
  static ignoredPaths = new Set();

  static ignoreNextOperation(filepath) {
    this.ignoredPaths.add(filepath);
  }

  static handleAdd(filepath) {
    if (this.ignoredPaths.has(filepath)) {
      this.ignoredPaths.delete(filepath);
      return;  // Skip system operation
    }
    this.processNewFile(filepath);
  }
}
```

### Graceful Shutdown

```javascript
async function setupWatcher() {
  const watcher = chokidar.watch('**/*.md');

  const shutdown = async () => {
    console.log('Shutting down watcher...');
    await watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(resolve => watcher.once('ready', resolve));
  console.log('Watcher is ready');
}
```

## Performance Best Practices

1. **Use Native FSEvents**: Set `usePolling: false` on macOS/Windows
2. **Limit Depth**: Set `depth` option to avoid deep recursion
3. **Ignore Unnecessary Paths**: Use `ignored` option effectively
4. **Avoid `alwaysStat`**: Only use when you need file stats
5. **Use `atomic: true`**: Better handling of atomic writes in v4
6. **Batch Operations**: Use `awaitWriteFinish` to batch rapid changes

## Advanced Topics

For detailed guidance on specific scenarios, see:

- **Migration from v3**: See [references/migration-v3-to-v4.md](references/migration-v3-to-v4.md) for complete migration guide with code examples and troubleshooting
- **Debugging**: See [references/debugging.md](references/debugging.md) for event logging, state inspection, and debugging patterns
- **Testing**: See [references/testing.md](references/testing.md) for comprehensive testing patterns and examples
- **Troubleshooting**: See [references/troubleshooting.md](references/troubleshooting.md) for common issues, solutions, and platform-specific fixes

## External Resources

- [Chokidar v4 GitHub](https://github.com/paulmillr/chokidar)
- [API Documentation](https://github.com/paulmillr/chokidar#api)
