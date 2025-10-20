# Migrating from Chokidar v3 to v4

This guide covers the migration process from chokidar v3 to v4.

## Import Changes

### V3 (CommonJS)
```javascript
const chokidar = require('chokidar');
```

### V4 (ESM Only)
```javascript
import chokidar from 'chokidar';
```

## Package.json Updates

Add `"type": "module"` to enable ESM:

```json
{
  "type": "module",
  "dependencies": {
    "chokidar": "^4.0.0"
  }
}
```

## Key Changes in v4

1. **Pure ESM**: Chokidar v4 is now ESM-only
2. **Smaller Bundle**: Reduced dependencies and size
3. **Better TypeScript Support**: Built-in types
4. **Improved Performance**: Better handling of large directories
5. **Enhanced API**: More consistent event handling

## API Changes

Most of the API remains the same, but be aware:

1. **ESM Only**: Must use `import` instead of `require`
2. **Atomic Writes**: New `atomic` option for better detection
3. **Better Stats**: Stats objects are now more consistent
4. **Improved Ready State**: Better `ready` event handling

## New Features in v4

### Atomic Write Detection

```javascript
const watcher = chokidar.watch('**/*', {
  atomic: true  // Better handling of atomic writes
});
```

### Better Ready State Management

```javascript
// V4: Wait for watcher to be ready
async function waitForReady(watcher) {
  return new Promise((resolve) => {
    if (watcher._readyEmitted) {
      resolve();
    } else {
      watcher.once('ready', resolve);
    }
  });
}

// Usage
await waitForReady(watcher);
console.log('Watcher is ready');
```

## Migration Checklist

- [ ] Update `package.json` to include `"type": "module"`
- [ ] Update chokidar dependency to `^4.0.0`
- [ ] Convert all `require()` to `import` statements
- [ ] Update file extensions to `.mjs` if not using `"type": "module"`
- [ ] Test atomic write detection with new `atomic: true` option
- [ ] Verify ready state handling in tests
- [ ] Update any custom TypeScript types (built-in types now available)

## Troubleshooting Migration Issues

### Issue: `require is not defined`

**Cause**: Trying to use CommonJS in ESM context

**Solution**: Convert all `require()` to `import` and ensure `"type": "module"` in package.json

### Issue: File extension errors

**Cause**: ESM requires explicit file extensions for relative imports

**Solution**: Add `.js` extensions to all relative imports:
```javascript
// Before
import { helper } from './utils';

// After
import { helper } from './utils.js';
```
