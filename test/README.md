# TX Test Suite

Comprehensive testing suite for the TX system.

## Test Structure

```
test/
├── unit/           # Unit tests (fast, isolated)
├── integration/    # Integration tests (medium speed)
└── e2e/           # End-to-end tests (slow, full system)
    └── run-all.js # E2E test suite runner
```

## Running Tests

### Unit Tests (Fast)

```bash
npm test
```

Runs all unit tests using Node's built-in test runner. These tests are fast and isolated.

### Integration Tests

```bash
npm run test:integration
```

Tests component interactions and workflows.

### E2E Tests (Slow)

```bash
npm run test:e2e
```

Runs all E2E tests sequentially using the comprehensive test runner. Each test:
- Spawns full TX system
- Tests complete workflows
- Cleans up thoroughly
- Reports detailed results

**Individual E2E Tests:**
```bash
node test/e2e/test-e2e-echo.js
node test/e2e/test-e2e-pingpong.js
# etc...
```

### All Tests

```bash
npm run test:all
```

Runs unit → integration → E2E tests in sequence. Takes several minutes.

## E2E Test Suite Features

The `test/e2e/run-all.js` runner provides:

✅ **Sequential Execution** - Prevents session conflicts
✅ **Automatic Cleanup** - Between tests and on completion
✅ **Detailed Reporting** - Per-test and summary statistics
✅ **Timeout Protection** - 3 minutes per test
✅ **Color-coded Output** - Easy to scan results
✅ **Duration Tracking** - Performance monitoring

### Example Output

```
╔════════════════════════════════════════════════════════════════════════════╗
║                         TX E2E Test Suite Runner                           ║
╚════════════════════════════════════════════════════════════════════════════╝

Found 12 E2E tests

Tests to run:
  1. test-e2e-ask
  2. test-e2e-deep-research
  3. test-e2e-echo
  ...

================================================================================
Test 1/12: test-e2e-echo
================================================================================

✅ test-e2e-echo PASSED (15.3s)

🧹 Cleaning up between tests...
✅ Cleanup complete

... (continues for all tests)

================================================================================
E2E Test Suite Summary
================================================================================

✅ Passed: 10/12
❌ Failed: 2/12
⏱️  Total Duration: 3m 45s

Passed Tests:
  ✅ test-e2e-echo (15.3s)
  ✅ test-e2e-pingpong (22.1s)
  ...

Failed Tests:
  ❌ test-e2e-deep-research (45.2s)
  ❌ test-e2e-planner (38.7s)

================================================================================

🎉 ALL TESTS PASSED! 🎉
```

## Test Categories

### Unit Tests
- `test-clear-before.js` - Clear-before feature validation
- `config-loader.test.js` - Configuration loading
- `routing.test.js` - Message routing logic
- `validator-rearmatter.test.js` - Rearmatter validation
- And more...

### Integration Tests
- `test-queue-sequential.js` - Queue processing
- `test-watcher.js` - File watching
- `test-routing-validation.js` - Routing validation
- `test-clear-before-reset.js` - Clear-before integration

### E2E Tests
- `test-e2e-echo.js` - Simple echo workflow
- `test-e2e-pingpong.js` - Ping-pong messaging
- `test-e2e-ask.js` - Ask-response pattern
- `test-e2e-iterative.js` - Iterative refinement
- `test-e2e-recursive.js` - Self-improving agents
- `test-e2e-evolver.js` - Self-modifying workflow
- `test-e2e-queue.js` - Queue processing
- `test-e2e-tdd-cycle.js` - TDD workflow
- `test-e2e-planner.js` - Multi-agent planning
- `test-e2e-deep-research.js` - Research workflow
- `test-e2e-hitl-3qa.js` - Human-in-the-loop
- `test-e2e-ping-pong.js` - Agent communication

## Writing New Tests

### Unit Test Template

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('MyFeature', () => {
  it('should do something', () => {
    // Test implementation
    assert.strictEqual(result, expected);
  });
});
```

### E2E Test Template

See `test/e2e/test-e2e-echo.js` for a complete example.

Key components:
1. Start TX system in detached mode
2. Wait for core session + Claude ready
3. Inject spawn command
4. Monitor workflow completion
5. Cleanup

## Continuous Integration

The test suite is designed for CI/CD:
- Unit tests run in < 1 second
- Integration tests run in < 10 seconds
- E2E tests run in 2-5 minutes total
- All tests clean up properly
- Exit codes indicate pass/fail

## Troubleshooting

**Tests hang:**
- Check for orphaned tmux sessions: `tmux ls`
- Kill all sessions: `tmux kill-server`
- Restart test suite

**Random failures:**
- E2E tests are sequential to prevent conflicts
- Ensure no other TX instances running
- Check system resources (CPU, memory)

**Cleanup issues:**
- Run: `tx stop && tmux kill-server`
- Delete: `.ai/tx/state/` if needed
- Restart tests

## Coverage

Run tests with coverage:

```bash
NODE_ENV=test node --experimental-test-coverage --test test/unit
```

Note: Coverage is most meaningful for unit tests. E2E tests validate behavior, not line coverage.
