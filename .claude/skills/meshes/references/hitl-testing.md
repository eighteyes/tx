# Human-In-The-Loop (HITL) Testing

This reference covers testing patterns for meshes that require human interaction via ask/ask-response message exchanges.

## Test Agent Prompt Design for HITL

**HITL test agents must be SUPER LIGHTWEIGHT - only Role and Workflow sections.**

```markdown
# Example - HITL Interviewer Agent
# Role
You are a HITL test interviewer. You ask 3 questions then summarize responses.

# Workflow
1. Read task from core
2. Send ask message to `core/core` with `type: ask` and `msg-id: hitl-qa-1`
3. Read ask-response from core
4. Repeat for questions 2 and 3
5. Write summary and send task-complete to `core/core`
```

**No examples, no detailed formatting, just the minimal flow!**

## Key Differences from Standard Tests

1. **Message-Based Communication**: All communication happens through message files, never direct injection to agents
2. **Only Core Gets Injected**: TmuxInjector.injectText is ONLY used on the 'core' session (the user)
3. **Session-Based Validation**: Check sessions for Read/Write operations first
4. **Response Format Matters**: Responses must be proper ask-response messages with correct frontmatter
5. **Extended Timeouts**: HITL workflows need 180+ seconds (3+ minutes) for multiple Q&A rounds

## Test Pattern

```javascript
const TEST_TIMEOUT = 180000; // 3 minutes for HITL workflow

// Step 1: Have core spawn the mesh and send task via natural language
// ✅ CORRECT: Inject ONLY to core session
TmuxInjector.injectText('core', `spawn a ${MESH} mesh and process the HITL task`);
await new Promise(resolve => setTimeout(resolve, 500));
TmuxInjector.send('core', 'Enter');

// Step 2: Wait for mesh to spawn and process
await waitForSession(`${MESH}-[uuid]-${AGENT}`, 30000);
await TmuxInjector.waitForIdle(`${MESH}-[uuid]-${AGENT}`, 5000, 60000);

// Step 3: Monitor core session for questions and simulate human responses
for (let i = 1; i <= 3; i++) {
  // Check core session for evidence of receiving questions
  const coreOutput = execSync(`tmux capture-pane -t core -p -S -100`);
  const questionReceived = coreOutput.includes('Read(') &&
                           coreOutput.includes(`hitl-qa-${i}`) &&
                           coreOutput.includes('/msgs/');

  if (questionReceived) {
    // ✅ CORRECT: Simulate human response by injecting natural language to core
    // Claude in core will handle creating proper ask-response messages
    const response = `respond to question ${i} with: ${humanResponses[i - 1]}`;
    TmuxInjector.injectText('core', response);
    await new Promise(resolve => setTimeout(resolve, 500));
    TmuxInjector.send('core', 'Enter');

    // Wait for response to be processed
    await TmuxInjector.waitForIdle('core', 5000, 30000);
    await TmuxInjector.waitForIdle(`${MESH}-[uuid]-${AGENT}`, 5000, 60000);
  }
}

// ❌ WRONG: Never inject directly to agent sessions
// TmuxInjector.injectText(agentSession, 'Read your messages');  // DON'T DO THIS!

// ❌ WRONG: Never create files directly
// fs.writeFileSync('.ai/tx/mesh/core/agents/core/msgs/response.md', responseContent);  // DON'T DO THIS!
```

## Real Example: hitl-3qa

**⚠️ Important Note**: Tests should simulate human interaction through core, not create files directly.

**Correct approach:**
- Only inject spawn instruction to core session
- Monitor core session for questions appearing
- Inject responses as natural language to core
- Let Claude handle all message creation and routing
- Never inject text directly to agent sessions
- Use session-based validation to verify message flow

## Critical Rules for HITL Testing

### 1. The 0.5s Injection Pause

**MUST wait 500ms between `injectText()` and `send('Enter')` for text to register:**

```javascript
// ✅ CORRECT: Pause between inject and Enter
TmuxInjector.injectText('core', 'your instruction here');
await new Promise(resolve => setTimeout(resolve, 500));  // CRITICAL!
TmuxInjector.send('core', 'Enter');

// ❌ WRONG: No pause
TmuxInjector.injectText('core', 'your instruction here');
TmuxInjector.send('core', 'Enter');  // Text may not register!
```

### 2. NEVER Inject to Agents

TmuxInjector.injectText is ONLY for the core session:

```javascript
// ✅ CORRECT: Only inject to core
TmuxInjector.injectText('core', 'spawn mesh and do work');

// ❌ WRONG: Never inject to agent sessions
TmuxInjector.injectText('hitl-3qa-interviewer', 'process message');  // FORBIDDEN!
TmuxInjector.injectText(agentSession, 'any text');  // FORBIDDEN!
```

### 3. Session-Based Question Detection

Monitor the core session to know when questions arrive:

```javascript
// Check core session for evidence of questions
async function waitForQuestion(questionId, timeout = 30000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const coreOutput = execSync(`tmux capture-pane -t core -p -S -100`);

    // Look for Claude reading a question file
    if (coreOutput.includes('Read(') &&
        coreOutput.includes(`msg-id: ${questionId}`) &&
        coreOutput.includes('/msgs/')) {
      console.log(`✅ Question ${questionId} detected in core session`);
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`⚠️ Question ${questionId} not detected within timeout`);
  return false;
}
```

### 4. Natural Language Response Simulation

Simulate human responses through natural language to core:

```javascript
// Simulate human providing an answer
function simulateHumanResponse(questionNumber, answer) {
  // Inject natural language that Claude will understand
  const instruction = `answer question ${questionNumber} with: ${answer}`;

  TmuxInjector.injectText('core', instruction);
  await new Promise(resolve => setTimeout(resolve, 500));
  TmuxInjector.send('core', 'Enter');

  // Claude in core will create the proper ask-response message
}
```

## Validation Pattern

```javascript
// Session-based validation for HITL workflows
async function validateHITLWorkflow(meshName, agentName, qaCount) {
  const results = {
    questionsReceived: 0,
    responsesProvided: 0,
    summaryCreated: false,
    taskComplete: false
  };

  // Check core session for Q&A evidence
  const coreOutput = execSync(`tmux capture-pane -t core -p -S -500`);

  // Count questions received
  for (let i = 1; i <= qaCount; i++) {
    if (coreOutput.includes(`hitl-qa-${i}`) && coreOutput.includes('Read(')) {
      results.questionsReceived++;
    }
  }

  // Count responses sent
  for (let i = 1; i <= qaCount; i++) {
    if (coreOutput.includes(`response to question ${i}`) && coreOutput.includes('Write(')) {
      results.responsesProvided++;
    }
  }

  // Check for summary creation
  const agentOutput = execSync(`tmux capture-pane -t ${meshName}-[uuid]-${agentName} -p -S -200`);
  results.summaryCreated = agentOutput.includes('summary.md') && agentOutput.includes('Write(');

  // Check for task completion
  results.taskComplete = coreOutput.includes('task-complete') && coreOutput.includes('Read(');

  return results;
}
```

## HITL Testing Checklist

### Before Test

- [ ] Prepare task description for natural language instruction
- [ ] Increase timeout to 180+ seconds
- [ ] Prepare human response content array
- [ ] Ensure core session is ready to receive Claude commands

### During Test

- [ ] Inject spawn instruction ONLY to core session
- [ ] Use 0.5s pause between inject and Enter
- [ ] Monitor core session for question arrival (via Read operations)
- [ ] Simulate responses through natural language to core
- [ ] Let Claude handle all message creation and routing
- [ ] NO direct file creation or agent injection

### Validation

- [ ] Verify questions appeared in core session output
- [ ] Verify responses were written by core (Write operations)
- [ ] Check agent session for summary creation
- [ ] Verify task-complete appeared in core session
- [ ] Validate entire flow through session outputs, not just files

## Common Pitfalls and Solutions

### Pitfall 1: Direct File Creation

❌ **Wrong**: Creating message files directly
```javascript
fs.writeFileSync('.ai/tx/mesh/core/agents/core/msgs/response.md', responseContent);
```

✅ **Right**: Let Claude create messages
```javascript
TmuxInjector.injectText('core', 'respond to the question with: [answer]');
```

### Pitfall 2: Agent Injection

❌ **Wrong**: Injecting to agent sessions
```javascript
TmuxInjector.injectText(agentSession, 'check your messages');
```

✅ **Right**: All interaction through core
```javascript
TmuxInjector.injectText('core', 'send message to agent');
```

### Pitfall 3: Fixed Filename Expectations

❌ **Wrong**: Looking for exact filenames
```javascript
const hasQuestion = fs.existsSync('msgs/hitl-qa-1.md');
```

✅ **Right**: Check session for file operations
```javascript
const hasQuestion = sessionOutput.includes('Read(') && sessionOutput.includes('hitl-qa-1');
```

## Tips for HITL Testing

1. **CRITICAL: Only inject to core** - `TmuxInjector.injectText('core', ...)` is the ONLY allowed injection
2. **Session-based validation** - Check for Read()/Write() operations in sessions to verify Q&A flow
3. **Think like a user**: Inject only natural language a human would type
4. **Trust Claude**: Let Claude handle all message creation and routing
5. **Never create files directly**: No `fs.writeFileSync()` - let Claude create all messages
6. **Lightweight test prompts**: Only Role and Workflow sections in agent prompts
7. **Be patient**: HITL workflows involve multiple round-trips (180+ seconds)
8. **Natural language works**: Claude understands "answer question 1 with..."

## See Also

- [patterns.md](patterns.md) - General testing patterns
- [multi-agent-testing.md](multi-agent-testing.md) - Multi-agent communication patterns
- [debugging.md](debugging.md) - Troubleshooting HITL workflows
- **[multi-agent-patterns.md](../../building-meshes/references/multi-agent-patterns.md)** - HITL design patterns