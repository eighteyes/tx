# Testing Chokidar Watchers

This guide provides patterns for testing file watchers.

## Basic Test Setup

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import chokidar from 'chokidar';
import fs from 'fs-extra';

describe('FileWatcher', () => {
  let watcher;
  const testDir = './test-watch';

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.close();
    }
    await fs.remove(testDir);
  });

  it('should detect new files', async () => {
    const events = [];

    watcher = chokidar.watch(`${testDir}/**/*`, {
      ignoreInitial: true
    });

    watcher.on('add', (path) => events.push({ type: 'add', path }));

    await new Promise(resolve => watcher.once('ready', resolve));

    await fs.writeFile(`${testDir}/test.txt`, 'content');

    await new Promise(resolve => setTimeout(resolve, 200));

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'add');
  });
});
```

## Testing File Changes

```javascript
it('should detect file changes', async () => {
  const testFile = `${testDir}/test.txt`;
  await fs.writeFile(testFile, 'initial');

  const changes = [];

  watcher = chokidar.watch(`${testDir}/**/*`, {
    ignoreInitial: true
  });

  watcher.on('change', (path) => changes.push(path));

  await new Promise(resolve => watcher.once('ready', resolve));

  await fs.writeFile(testFile, 'updated');

  await new Promise(resolve => setTimeout(resolve, 200));

  assert.equal(changes.length, 1);
  assert(changes[0].includes('test.txt'));
});
```

## Testing File Deletion

```javascript
it('should detect file deletion', async () => {
  const testFile = `${testDir}/test.txt`;
  await fs.writeFile(testFile, 'content');

  const deletions = [];

  watcher = chokidar.watch(`${testDir}/**/*`, {
    ignoreInitial: false
  });

  watcher.on('unlink', (path) => deletions.push(path));

  await new Promise(resolve => watcher.once('ready', resolve));

  await fs.remove(testFile);

  await new Promise(resolve => setTimeout(resolve, 200));

  assert.equal(deletions.length, 1);
  assert(deletions[0].includes('test.txt'));
});
```

## Testing Directory Operations

```javascript
it('should detect new directories', async () => {
  const events = [];

  watcher = chokidar.watch(`${testDir}/**/*`, {
    ignoreInitial: true
  });

  watcher.on('addDir', (path) => events.push({ type: 'addDir', path }));

  await new Promise(resolve => watcher.once('ready', resolve));

  await fs.ensureDir(`${testDir}/subdir`);

  await new Promise(resolve => setTimeout(resolve, 200));

  assert.equal(events.length, 1);
  assert(events[0].path.includes('subdir'));
});
```

## Testing with awaitWriteFinish

```javascript
it('should wait for write to finish', async () => {
  const events = [];

  watcher = chokidar.watch(`${testDir}/**/*`, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50
    }
  });

  watcher.on('add', (path) => events.push(Date.now()));

  await new Promise(resolve => watcher.once('ready', resolve));

  const testFile = `${testDir}/test.txt`;

  // Multiple rapid writes
  await fs.writeFile(testFile, 'v1');
  await new Promise(resolve => setTimeout(resolve, 20));
  await fs.appendFile(testFile, 'v2');
  await new Promise(resolve => setTimeout(resolve, 20));
  await fs.appendFile(testFile, 'v3');

  await new Promise(resolve => setTimeout(resolve, 300));

  // Should only get one event after writes stabilize
  assert.equal(events.length, 1);
});
```

## Testing Pattern Matching

```javascript
it('should only watch matching patterns', async () => {
  const events = [];

  watcher = chokidar.watch(`${testDir}/**/*.txt`, {
    ignoreInitial: true
  });

  watcher.on('add', (path) => events.push(path));

  await new Promise(resolve => watcher.once('ready', resolve));

  await fs.writeFile(`${testDir}/match.txt`, 'content');
  await fs.writeFile(`${testDir}/ignore.md`, 'content');

  await new Promise(resolve => setTimeout(resolve, 200));

  assert.equal(events.length, 1);
  assert(events[0].includes('match.txt'));
});
```

## Testing Ignored Paths

```javascript
it('should ignore specified paths', async () => {
  const events = [];

  watcher = chokidar.watch(`${testDir}/**/*`, {
    ignoreInitial: true,
    ignored: /(^|[\/\\])\../  // Ignore dotfiles
  });

  watcher.on('add', (path) => events.push(path));

  await new Promise(resolve => watcher.once('ready', resolve));

  await fs.writeFile(`${testDir}/visible.txt`, 'content');
  await fs.writeFile(`${testDir}/.hidden`, 'content');

  await new Promise(resolve => setTimeout(resolve, 200));

  assert.equal(events.length, 1);
  assert(events[0].includes('visible.txt'));
});
```

## Testing Watcher Cleanup

```javascript
it('should clean up properly', async () => {
  watcher = chokidar.watch(`${testDir}/**/*`);

  await new Promise(resolve => watcher.once('ready', resolve));

  const watched = watcher.getWatched();
  assert(Object.keys(watched).length > 0);

  await watcher.close();

  // Verify watcher is closed
  assert.equal(watcher.closed, true);
});
```

## Testing Multiple Events

```javascript
it('should handle multiple event types', async () => {
  const events = [];
  const testFile = `${testDir}/test.txt`;

  watcher = chokidar.watch(`${testDir}/**/*`, {
    ignoreInitial: true
  });

  watcher
    .on('add', (path) => events.push({ type: 'add', path }))
    .on('change', (path) => events.push({ type: 'change', path }))
    .on('unlink', (path) => events.push({ type: 'unlink', path }));

  await new Promise(resolve => watcher.once('ready', resolve));

  await fs.writeFile(testFile, 'initial');
  await new Promise(resolve => setTimeout(resolve, 100));

  await fs.writeFile(testFile, 'updated');
  await new Promise(resolve => setTimeout(resolve, 100));

  await fs.remove(testFile);
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'add');
  assert.equal(events[1].type, 'change');
  assert.equal(events[2].type, 'unlink');
});
```

## Testing Ready State

```javascript
it('should emit ready event', async () => {
  let readyEmitted = false;

  watcher = chokidar.watch(`${testDir}/**/*`);

  watcher.on('ready', () => {
    readyEmitted = true;
  });

  await new Promise(resolve => watcher.once('ready', resolve));

  assert.equal(readyEmitted, true);
});
```

## Testing Error Handling

```javascript
it('should handle errors gracefully', async () => {
  const errors = [];

  watcher = chokidar.watch('/nonexistent/path/**/*', {
    ignoreInitial: true
  });

  watcher.on('error', (error) => errors.push(error));

  await new Promise(resolve => setTimeout(resolve, 200));

  // May or may not emit errors depending on platform
  // This test verifies the error handler works
  watcher.emit('error', new Error('Test error'));

  assert.equal(errors.length, 1);
});
```

## Test Helpers

### Wait for Event

```javascript
function waitForEvent(watcher, eventName, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${eventName}`));
    }, timeout);

    watcher.once(eventName, (...args) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

// Usage
const [path] = await waitForEvent(watcher, 'add');
assert(path.includes('test.txt'));
```

### Collect Events

```javascript
function collectEvents(watcher, duration = 1000) {
  const events = [];

  const handler = (event, path) => {
    events.push({ event, path, time: Date.now() });
  };

  watcher.on('all', handler);

  return new Promise(resolve => {
    setTimeout(() => {
      watcher.off('all', handler);
      resolve(events);
    }, duration);
  });
}

// Usage
const events = await collectEvents(watcher, 500);
assert(events.length > 0);
```

## Integration Test Example

```javascript
describe('Watcher Integration', () => {
  it('should handle complete workflow', async () => {
    const testDir = './test-integration';
    await fs.ensureDir(testDir);

    const events = [];
    const watcher = chokidar.watch(`${testDir}/**/*`, {
      ignoreInitial: true
    });

    watcher.on('all', (event, path) => {
      events.push({ event, path });
    });

    await new Promise(resolve => watcher.once('ready', resolve));

    // Create directory structure
    await fs.ensureDir(`${testDir}/subdir`);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Add files
    await fs.writeFile(`${testDir}/file1.txt`, 'content1');
    await fs.writeFile(`${testDir}/subdir/file2.txt`, 'content2');
    await new Promise(resolve => setTimeout(resolve, 100));

    // Modify file
    await fs.writeFile(`${testDir}/file1.txt`, 'updated');
    await new Promise(resolve => setTimeout(resolve, 100));

    // Delete file
    await fs.remove(`${testDir}/file1.txt`);
    await new Promise(resolve => setTimeout(resolve, 100));

    await watcher.close();
    await fs.remove(testDir);

    // Verify events
    const eventTypes = events.map(e => e.event);
    assert(eventTypes.includes('addDir'));
    assert(eventTypes.includes('add'));
    assert(eventTypes.includes('change'));
    assert(eventTypes.includes('unlink'));
  });
});
```
