# Testing Checklist

Use before, during, and after writing tests.

## Before Writing Test

- [ ] **Understand the workflow**
  - What's the core flow? (core → agents → core?)
  - How many agents are involved?
  - Which agents spawn on-demand vs upfront?

- [ ] **Plan idle wait points**
  - When does core finish sending task?
  - When does agent finish working?
  - When does core finish processing response?

- [ ] **Define success criteria**
  - What evidence validates success?
  - What should appear in tmux?
  - What's the error case?

## During Test Implementation

- [ ] **Test starts tmux server before anything else**
  ```javascript
  try {
    execSync('tmux start-server', { stdio: 'pipe' });
  } catch (e) {}
  ```

- [ ] **Test injects ONLY natural language instruction to core**
  - Single `injectText()` call
  - No orchestration of individual steps
  - Let Claude interpret and decide

- [ ] **Test uses E2EWorkflow helper class**
  - Simplifies workflow testing
  - Handles common patterns
  - Better error messages

- [ ] **Test captures txProcess stdout/stderr**
  ```javascript
  txProcess.stdout.on('data', (data) => {
    console.log(`   [tx stdout] ${data}`);
  });
  ```

## Waiting and Validation

- [ ] **Test waits for proper idle sequence**
  - Core idle → Agent idle → Core idle
  - Not: all at once
  - Not: no waits at all

- [ ] **Test validates using tmux output, not files**
  - Check session content
  - Not file system state
  - More reliable and observable

- [ ] **Test uses polling for on-demand sessions**
  - With timeout (not infinite)
  - With sleep between polls
  - Handles both exact name and suffix variants

- [ ] **Test handles both exact name and UID-suffix variants**
  ```javascript
  const found = allSessions.find(s =>
    s === `${MESH}-${AGENT}` ||
    s.startsWith(`${MESH}-${AGENT}-`)
  );
  ```

## Debugging and Error Handling

- [ ] **Test has clear error messages on failure**
  - What was expected?
  - What actually happened?
  - Help user understand the gap

- [ ] **Test displays last N lines of session on failure**
  ```javascript
  console.log('Last 30 lines of core:\n');
  console.log(captureSessionOutput('core', 30));
  ```

- [ ] **Test checks return values**
  - `createSession()`
  - `claudeReadyCheck()`
  - `waitForIdle()`

- [ ] **Test uses try/catch with error context**
  ```javascript
  try {
    // operation
  } catch (e) {
    console.error('Context: what was being done');
    console.error('Error:', e.message);
    throw e;
  }
  ```

## Cleanup and Exit

- [ ] **Test has proper cleanup**
  - Stop tx system
  - Kill sessions by prefix
  - Try/catch around each kill

- [ ] **Cleanup is in finally block**
  ```javascript
  try {
    await runTest();
  } finally {
    await cleanup();
  }
  ```

- [ ] **Test exits with appropriate code**
  ```javascript
  process.exit(testPassed ? 0 : 1);
  ```

- [ ] **Test timeout is reasonable**
  - 2 minutes for full E2E
  - 30 seconds for session operations
  - Prevents hanging CI/CD

## Agent Configuration

- [ ] **Agent prompts wait for messages** (not "START NOW")
  - Agents are reactive
  - Receive task via message
  - Not proactive

- [ ] **Agent prompts include success criteria**
  - Clear definition of done
  - What outputs to produce
  - How to report completion

- [ ] **Test expectations match agent capabilities**
  - What the agent can actually do
  - Realistic timeouts
  - Proper error handling

## Final Review

- [ ] Test is reproducible (same result each run)
- [ ] Test is readable (easy to understand flow)
- [ ] Test is debuggable (helpful output on failure)
- [ ] Test is maintainable (clear patterns, reusable helpers)

## Running Tests

```bash
# Single test
node test/test-e2e-ask.js

# Exit code 0 = pass, 1 = fail
# Useful for CI/CD integration
```

## Interpreting Results

**✅ TEST PASSED**: Workflow completed, both agents spawned, core received response

**❌ TEST FAILED**: Check error message and session dumps for:
- EPIPE errors (tmux server issue)
- "Core not ready" (Claude initialization)
- Sessions not found (timing or naming)
- Timeouts (waiting too long)
- No response (workflow didn't complete)
