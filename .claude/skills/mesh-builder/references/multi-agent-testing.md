# Multi-Agent Mesh Testing

This reference covers testing patterns for meshes with 2+ agents communicating with each other.

## Test Agent Prompt Design

**Multi-agent test prompts must be SUPER LIGHTWEIGHT - only Role and Workflow sections.**

```markdown
# Example - Pinger Agent
# Role
You are a ping test agent. You send a ping message to ponger and wait for response.

# Workflow
1. Read incoming task from core
2. Send ping message with `to: test-ping-pong-[uuid]/ponger`
3. Read pong response
4. Send task-complete to `core/core`

# Example - Ponger Agent
# Role
You are a pong test agent. You respond to ping messages.

# Workflow
1. Read incoming ping message
2. Send pong response back to sender
3. Report completion to core
```

**No examples, no complex logic, no detailed instructions!**

## Key Differences from Single-Agent Tests

1. **Multiple Sessions Spawned**: Need to wait for all agent sessions, not just entry point
2. **Sequencing Critical**: Must validate proper idle sequencing
3. **Longer Timeouts**: Multi-agent exchanges take longer
4. **Session-Based Validation**: Check sessions first, then verify files

## Test Pattern

```javascript
// Step 1: Start system
execSync('tmux start-server');
spawn('tx', ['start', '-d']);

// Step 2: Wait for core and Claude ready
await waitForSession('core', 30000);
await TmuxInjector.claudeReadyCheck('core', 30000);

// Step 3: Inject instruction to core (human simulation)
TmuxInjector.injectText('core', 'spawn a test-ping-pong mesh and have agents exchange messages');
await new Promise(resolve => setTimeout(resolve, 500));
TmuxInjector.send('core', 'Enter');

// Step 4: Wait for ALL agent sessions to spawn
const agents = ['pinger', 'ponger'];
for (const agent of agents) {
  await waitForSession(`${MESH}-[uuid]-${agent}`, 30000);
}

// Step 5: Idle sequencing - validate proper flow
const coreIdle1 = await TmuxInjector.waitForIdle('core', 5000, 60000);
const agentIdle = await TmuxInjector.waitForIdle(`${MESH}-[uuid]-pinger`, 5000, 60000);
const coreIdle2 = await TmuxInjector.waitForIdle('core', 5000, 60000);

// Step 6: Session-based validation - check session FIRST
const coreOutput = execSync('tmux capture-pane -t core -p -S -100');
const pingerOutput = execSync(`tmux capture-pane -t ${MESH}-[uuid]-pinger -p -S -100`);
const pongerOutput = execSync(`tmux capture-pane -t ${MESH}-[uuid]-ponger -p -S -100`);

// Look for file operations in sessions
const coreWroteMessages = coreOutput.includes('Write(') && coreOutput.includes('/msgs/');
const pingerReadMessages = pingerOutput.includes('Read(') && pingerOutput.includes('/msgs/');
const pongerReadMessages = pongerOutput.includes('Read(') && pongerOutput.includes('/msgs/');

// THEN check actual message files in both agents
const pingerMsgs = fs.readdirSync(`.ai/tx/mesh/${MESH}-[uuid]/agents/pinger/msgs`).filter(f => f.endsWith('.md'));
const pongerMsgs = fs.readdirSync(`.ai/tx/mesh/${MESH}-[uuid]/agents/ponger/msgs`).filter(f => f.endsWith('.md'));
const hasMessaging = pingerMsgs.length > 0 && pongerMsgs.length > 0;
```

## Real Example: test-ping-pong

See `test/test-e2e-ping-pong.js` for complete working example.

**Key implementation points:**
- 180 second timeout (agents exchanging messages take time)
- Polling for both agent sessions with 30 second wait
- Pattern matching for UUID-based session names (e.g., `test-ping-pong-a1b2c3-pinger`)
- Tmux idle detection between sequential steps
- Session-based validation before checking files

## Learnings from Ping-Pong Testing

1. **Agent Prompts Matter**: Simple, step-by-step prompts lead to successful exchanges
2. **Message Routing is Automatic**: System handles routing if frontmatter is correct
3. **Session-Based Validation**: Check what Claude does in sessions before checking files
4. **Idle Detection Reliable**: Use it to sequence handoffs between agents
5. **No Hardcoded Patterns**: Don't look for inbox/complete - check what's actually there
6. **Timestamps Essential**: All messages must include `yymmdd-hhmm` timestamp after frontmatter
7. **UUID Session Names**: Sessions include 6-character UUID for parallel mesh instances

## Common Patterns

### Waiting for Multiple Agent Sessions

```javascript
// With UUID support
async function waitForMeshAgents(meshName, agentNames, timeout = 30000) {
  const sessions = [];
  for (const agent of agentNames) {
    // Look for pattern: meshName-[uuid]-agentName
    const pattern = new RegExp(`^${meshName}-[0-9a-f]{6}-${agent}$`);
    const session = await waitForSessionPattern(pattern, timeout);
    if (!session) throw new Error(`Agent ${agent} session not found`);
    sessions.push(session);
  }
  return sessions;
}
```

### Sequential Idle Validation

```javascript
// Ensure proper message flow between agents
async function validateMessageFlow(sessions) {
  for (const session of sessions) {
    console.log(`Waiting for ${session} to process...`);
    await TmuxInjector.waitForIdle(session, 5000, 60000);

    // Check session for file operations
    const output = execSync(`tmux capture-pane -t ${session} -p -S -100`);
    const hasOperations = output.includes('Read(') || output.includes('Write(');

    if (!hasOperations) {
      console.log(`Warning: ${session} shows no file operations`);
    }
  }
}
```

### Message Exchange Validation

```javascript
// Validate complete exchange between agents
function validateExchange(agent1Session, agent2Session) {
  const agent1Output = execSync(`tmux capture-pane -t ${agent1Session} -p -S -100`);
  const agent2Output = execSync(`tmux capture-pane -t ${agent2Session} -p -S -100`);

  // Check sessions for evidence of exchange
  const agent1Sent = agent1Output.includes('Write(') && agent1Output.includes('to:');
  const agent2Received = agent2Output.includes('Read(') && agent2Output.includes('from:');
  const agent2Replied = agent2Output.includes('Write(') && agent2Output.includes('to:');
  const agent1GotReply = agent1Output.includes('Read(') && agent1Output.includes('from:');

  return {
    exchangeComplete: agent1Sent && agent2Received && agent2Replied && agent1GotReply,
    details: {
      agent1Sent,
      agent2Received,
      agent2Replied,
      agent1GotReply
    }
  };
}
```

## Tips for Multi-Agent Testing

1. **CRITICAL: Only inject to core** - `TmuxInjector.injectText('core', ...)` is the ONLY allowed injection
2. **Session-based validation first** - Check for Read()/Write() operations in sessions before checking files
3. **Use pattern matching for UUIDs** - Sessions include random 6-char identifiers (e.g., `test-ping-pong-a1b2c3-pinger`)
4. **Lightweight test prompts** - Only Role and Workflow sections, no examples or complex logic
5. **Allow ample timeouts** - Multi-agent coordination takes time (180+ seconds)
6. **Validate incrementally** - Check each step rather than waiting for everything
7. **Log session states** - Capture tmux output for debugging failed tests

## See Also

- [patterns.md](patterns.md) - General testing patterns
- [helpers.md](helpers.md) - Utility functions for session management
- [debugging.md](debugging.md) - Troubleshooting multi-agent issues
- **[multi-agent-patterns.md](../../building-meshes/references/multi-agent-patterns.md)** - Design patterns for multi-agent meshes