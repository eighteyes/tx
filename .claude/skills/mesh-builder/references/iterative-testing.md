# Iterative Workflow Testing

This reference covers testing patterns for meshes with feedback loops and multi-iteration workflows.

## Test Agent Prompt Design for Iteration

**Iterative test agents must be SUPER LIGHTWEIGHT - only Role and Workflow sections.**

```markdown
# Example - Worker Agent
# Role
You are a test worker. You create work and revise based on feedback.

# Workflow
1. Read task from core
2. Create Version 1 and send to reviewer
3. Read feedback from reviewer
4. If rejected, create Version 2 and send again
5. When approved, send task-complete to `core/core`

# Example - Reviewer Agent
# Role
You are a test reviewer. You reject Version 1 and approve Version 2.

# Workflow
1. Read work from worker
2. If content contains "Version 1": respond with "needs revision"
3. If content contains "Version 2": respond with "approved"
4. Send task-complete to `core/core` after approval
```

**Simple conditional logic only, no complex state management!**

## Key Differences from Single-Pass Tests

1. **Longer Message Chains**: Multiple back-and-forth exchanges extend test duration
2. **Version State in Content**: Track progress via message content ("Version 1", "Version 2"), not files
3. **Conditional Logic**: Agents respond based on message content inspection
4. **Higher Timeout**: Iterative workflows need more time (180+ seconds)
5. **Session-Based Progress Tracking**: Monitor sessions to see iteration progress

## Test Pattern

```javascript
// Iterative workflows need extended timeouts
const TEST_TIMEOUT = 180000; // 3 minutes

// Step 1: Start system and wait for core
execSync('tmux start-server');
spawn('tx', ['start', '-d']);
await waitForSession('core', 30000);
await TmuxInjector.claudeReadyCheck('core', 30000);

// Step 2: High-level instruction - let Claude figure out iterations
const instruction = "spawn a test-iterative mesh and have worker and reviewer iterate";
TmuxInjector.injectText('core', instruction);
await new Promise(resolve => setTimeout(resolve, 500));
TmuxInjector.send('core', 'Enter');

// Step 3: Wait for all agent sessions to spawn
await waitForSession(`${MESH}-[uuid]-worker`, 30000);
await waitForSession(`${MESH}-[uuid]-reviewer`, 30000);

// Step 4: Monitor iterations via session output
const workerSession = `${MESH}-[uuid]-worker`;
const reviewerSession = `${MESH}-[uuid]-reviewer`;

// Wait for first iteration
await TmuxInjector.waitForIdle(workerSession, 5000, 60000);

// Check session for Version 1
const workerOutput1 = execSync(`tmux capture-pane -t ${workerSession} -p -S -100`);
const hasV1 = workerOutput1.includes('Version 1') && workerOutput1.includes('Write(');

// Wait for reviewer feedback
await TmuxInjector.waitForIdle(reviewerSession, 5000, 60000);

// Check session for feedback
const reviewerOutput1 = execSync(`tmux capture-pane -t ${reviewerSession} -p -S -100`);
const hasReview1 = reviewerOutput1.includes('needs revision') && reviewerOutput1.includes('Write(');

// Wait for second iteration
await TmuxInjector.waitForIdle(workerSession, 5000, 60000);

// Check session for Version 2
const workerOutput2 = execSync(`tmux capture-pane -t ${workerSession} -p -S -100`);
const hasV2 = workerOutput2.includes('Version 2') && workerOutput2.includes('Write(');

// Wait for approval
await TmuxInjector.waitForIdle(reviewerSession, 5000, 60000);

// Check session for approval
const reviewerOutput2 = execSync(`tmux capture-pane -t ${reviewerSession} -p -S -100`);
const hasApproval = reviewerOutput2.includes('approved') && reviewerOutput2.includes('Write(');

// Validate complete iterative flow
const success = hasV1 && hasReview1 && hasV2 && hasApproval;
```

## Real Example: test-iterative

See `test/test-e2e-iterative.js` for complete working example.

**Key implementation points:**
- Simplified instruction to "iterate" - Claude figures out the workflow
- Both agent sessions spawned before validation
- Multiple idle waits: core → worker iteration → core completion
- Session-based validation of iterations (Version 1, Version 2, approval)
- 180 second timeout sufficient for 2 iteration cycles

## Learnings from Iterative Testing

1. **Instruction Clarity**: Simple high-level instructions work better than detailed step-by-step

2. **Version Markers in Sessions**: Check sessions for "Version 1", "Version 2" to track progress

3. **Conditional Response Detection**: Monitor sessions to see agents responding to content

4. **Pseudo-Antagonistic Pattern**: Agents implement approval gates naturally when instructed

5. **Message Content as State**: Session output shows state transitions clearly

6. **Simple Feedback Signals**: Look for "approved", "needs revision", "rejected" in sessions

7. **Two Iterations Sufficient**: 2 cycles prove the pattern works

8. **Session-Based Validation**: Track progress through session output, not just files

9. **Timestamps Track Timing**: Include `yymmdd-hhmm` timestamps to trace iteration timing

## Session-Based Iteration Tracking

```javascript
// Track iterations through session output
async function trackIterations(workerSession, reviewerSession) {
  const iterations = [];

  // Capture full session history
  const workerOutput = execSync(`tmux capture-pane -t ${workerSession} -p -S -`, { encoding: 'utf-8' });
  const reviewerOutput = execSync(`tmux capture-pane -t ${reviewerSession} -p -S -`, { encoding: 'utf-8' });

  // Find version markers in worker output
  const versionPattern = /Version (\d+)/g;
  let match;
  while ((match = versionPattern.exec(workerOutput)) !== null) {
    iterations.push({
      version: parseInt(match[1]),
      workerCreated: workerOutput.includes(`Version ${match[1]}`) && workerOutput.includes('Write('),
      position: match.index
    });
  }

  // Find feedback in reviewer output
  iterations.forEach(iter => {
    // Check if reviewer responded to this version
    const feedbackPattern = new RegExp(`Version ${iter.version}[\\s\\S]*?(approved|rejected|needs revision)`, 'i');
    const feedbackMatch = feedbackPattern.exec(reviewerOutput);

    if (feedbackMatch) {
      iter.reviewerFeedback = feedbackMatch[1];
      iter.reviewed = true;
    }
  });

  return iterations;
}
```

## Validation Patterns

### Complete Iteration Cycle

```javascript
// Validate a complete submit-review-revise-approve cycle
function validateIterativeCycle(workerSession, reviewerSession) {
  const iterations = trackIterations(workerSession, reviewerSession);

  // Need at least 2 iterations for a cycle
  if (iterations.length < 2) {
    console.log('❌ Insufficient iterations:', iterations.length);
    return false;
  }

  // First iteration should be reviewed with feedback
  const firstIteration = iterations[0];
  if (!firstIteration.reviewed || firstIteration.reviewerFeedback === 'approved') {
    console.log('❌ First iteration not properly reviewed');
    return false;
  }

  // Final iteration should be approved
  const lastIteration = iterations[iterations.length - 1];
  if (!lastIteration.reviewed || lastIteration.reviewerFeedback !== 'approved') {
    console.log('❌ Final iteration not approved');
    return false;
  }

  console.log('✅ Complete iterative cycle validated');
  return true;
}
```

### Session Progress Monitoring

```javascript
// Monitor session for iteration progress
async function monitorIterationProgress(session, expectedVersions = 2, timeout = 120000) {
  const startTime = Date.now();
  const versionsFound = new Set();

  while (Date.now() - startTime < timeout) {
    const output = execSync(`tmux capture-pane -t ${session} -p -S -100`);

    // Look for version markers
    for (let v = 1; v <= expectedVersions; v++) {
      if (output.includes(`Version ${v}`) && output.includes('Write(')) {
        versionsFound.add(v);
      }
    }

    // Check if all expected versions found
    if (versionsFound.size >= expectedVersions) {
      console.log(`✅ Found all ${expectedVersions} versions in session`);
      return true;
    }

    // Show progress
    console.log(`Progress: ${versionsFound.size}/${expectedVersions} versions found`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log(`⚠️ Only found ${versionsFound.size}/${expectedVersions} versions`);
  return false;
}
```

## Tips for Iterative Testing

1. **CRITICAL: Only inject to core** - `TmuxInjector.injectText('core', ...)` is the ONLY allowed injection
2. **Session-based validation** - Track iterations by monitoring Read()/Write() operations in sessions
3. **Lightweight test prompts**: Only Role and Workflow sections with simple conditional logic
4. **High-level instructions**: Let Claude figure out the iteration details
5. **Look for state markers**: "Version X", "approved", "rejected" in session output
6. **Allow ample time**: Multiple iterations take 180+ seconds
7. **Session history matters**: Use `-S -` to capture full session history for validation
8. **Natural convergence**: Agents naturally converge to approval when instructed

## Common Patterns

### Submit-Review-Revise Pattern

The most common iterative pattern:

1. Worker creates Version 1
2. Reviewer provides feedback (usually rejection for V1)
3. Worker creates Version 2 incorporating feedback
4. Reviewer approves Version 2

### Conditional Approval Logic

Agents understand instructions like:
- "Reject Version 1, approve Version 2"
- "Approve after 2 iterations"
- "Reject if missing X, approve if includes X"

### Version Tracking in Content

Best practice: Include version directly in message content:
```markdown
# Work Product - Version 1

Content here...
```

## See Also

- [multi-agent-testing.md](multi-agent-testing.md) - Multi-agent communication patterns
- [hitl-testing.md](hitl-testing.md) - Human-in-the-loop testing
- [patterns.md](patterns.md) - General testing patterns
- **[multi-agent-patterns.md](../../building-meshes/references/multi-agent-patterns.md)** - Iterative refinement design patterns