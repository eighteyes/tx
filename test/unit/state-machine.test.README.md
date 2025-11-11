# StateMachine TDD Red Phase Tests

## Overview

This test suite contains **75 comprehensive tests** for the StateMachine class that manages agent lifecycle across 10 states. These tests are designed to **FAIL initially** (RED phase of TDD) and serve as executable specifications for the implementation.

## Current Status

- **Total Tests**: 75
- **Passing**: 4 (constants only)
- **Failing**: 71 (all business logic)
- **Test File**: `/workspace/tx-cli/test/unit/state-machine.test.js`
- **Stub Implementation**: `/workspace/tx-cli/lib/state-machine.js`

## State Machine Specification

### 10 Lifecycle States

1. **spawned** 🥚 - Just created
2. **initializing** 🔄 - Loading prompts
3. **ready** ✅ - Idle, available
4. **working** 🔨 - Processing task
5. **blocked** 🚧 - Waiting for input
6. **distracted** 🐿️ - Inactive >10s
7. **completing** 📝 - Writing outputs
8. **error** ❌ - Crashed
9. **suspended** ⏸️ - Manually paused
10. **killed** 💀 - Terminated

### Valid Transition Rules

```
spawned → initializing
initializing → ready, error
ready → working, blocked, distracted, suspended, killed
working → completing, blocked, error
blocked → ready, working, error, killed
distracted → ready, suspended, killed
completing → ready, error
error → killed (only escape from error)
suspended → ready, working, killed
killed → (terminal state, no transitions)
```

## Test Coverage

### 1. State Constants (2 tests)
- ✅ All 10 lifecycle states defined
- ✅ All 10 state emojis defined

### 2. Initialization (5 tests)
- ❌ Initialize agent in spawned state
- ❌ Store metadata on initialization
- ❌ Prevent double initialization
- ❌ Validate agent ID format
- ❌ Create state file on disk

### 3. Valid State Transitions (24 tests)
Tests for each valid transition in the state machine:
- ❌ spawned → initializing
- ❌ initializing → ready
- ❌ initializing → error
- ❌ ready → working, blocked, distracted, suspended, killed
- ❌ working → completing, blocked, error
- ❌ blocked → ready, working, error, killed
- ❌ distracted → ready, suspended, killed
- ❌ completing → ready, error
- ❌ error → killed
- ❌ suspended → ready, working, killed

### 4. Invalid State Transitions (10 tests)
Tests that transitions are properly rejected:
- ❌ spawned → ready (must go through initializing)
- ❌ spawned → working
- ❌ ready → completing (must be working first)
- ❌ working → suspended
- ❌ error → ready (must be killed)
- ❌ killed → any state (terminal)
- ❌ distracted → working (must go through ready)
- ❌ blocked → distracted
- ❌ completing → working
- ❌ Invalid state names

### 5. Atomic Operations - Compare and Swap (4 tests)
- ❌ Compare-and-swap with correct expected state
- ❌ Fail compare-and-swap with wrong expected state
- ❌ Handle concurrent compare-and-swap operations
- ❌ Handle race conditions between getState and transition

### 6. State Queries (4 tests)
- ❌ Get current state for agent
- ❌ Return null for non-existent agent
- ❌ Get all agent states
- ❌ Filter states by current state
- ❌ Check if agent is in specific state

### 7. Activity Tracking (5 tests)
- ❌ Update lastActivity timestamp on transition
- ❌ Track transition history
- ❌ Include metadata in transition history
- ❌ Update state since timestamp on transition
- ❌ Allow concurrent metadata updates

### 8. Lock Management (5 tests)
- ❌ Acquire lock before state transition
- ❌ Queue concurrent transitions for same agent
- ❌ Timeout if lock held too long
- ❌ Release lock on error
- ❌ Allow independent locks for different agents

### 9. Error Handling (5 tests)
- ❌ Handle missing agent gracefully
- ❌ Handle corrupted state file
- ❌ Validate state names
- ❌ Handle filesystem errors gracefully
- ❌ Rollback on failed transition

### 10. Edge Cases (7 tests)
- ❌ Handle rapid state changes
- ❌ Handle empty metadata
- ❌ Handle large metadata objects
- ❌ Handle agent ID with special characters
- ❌ Maintain consistency after crash recovery
- ❌ Handle concurrent initialization attempts
- ❌ Preserve state order in transition history

### 11. Performance (3 tests)
- ❌ Handle many agents efficiently (100 agents < 5s)
- ❌ Query all states efficiently (50 agents < 1s)
- ❌ Handle concurrent transitions across different agents (20 agents < 2s)

## Running the Tests

```bash
# Run all StateMachine tests
npm test -- test/unit/state-machine.test.js

# Run with verbose output
NODE_ENV=test node --test test/unit/state-machine.test.js

# Watch mode (if configured)
npm test -- --watch test/unit/state-machine.test.js
```

## Expected Test Failures

All tests are designed to fail with clear, descriptive errors:

1. **Import/Initialization Errors**: Tests should NOT fail on import - a stub class exists
2. **Business Logic Errors**: Tests fail with "Not implemented" or assertion failures
3. **Clear Failure Messages**: Each failure indicates exactly what functionality is missing

## Implementation Guidance

### Core Requirements

1. **State Persistence**: States must be persisted to disk in JSON format
2. **Atomic Transitions**: Use compare-and-swap pattern to prevent race conditions
3. **Lock Management**: Implement lock-free or timeout-based locking
4. **Transition Validation**: Strictly enforce valid transition rules
5. **Activity Tracking**: Track timestamps and transition history
6. **Concurrent Safety**: Support multiple agents with independent state
7. **Error Recovery**: Graceful handling of corrupted files and missing agents

### Key Data Structures

```javascript
// State object structure
{
  agentId: 'mesh/agent',
  currentState: 'ready',
  since: '2025-11-10T12:00:00.000Z',
  lastActivity: '2025-11-10T12:05:00.000Z',
  metadata: { sessionName: 'tx-mesh', ... },
  transitions: [
    { from: null, to: 'spawned', at: '2025-11-10T12:00:00.000Z' },
    { from: 'spawned', to: 'initializing', at: '2025-11-10T12:00:01.000Z', metadata: {} },
    ...
  ]
}
```

### Implementation Strategy

1. **Start with Constants**: Already implemented (tests passing)
2. **Implement Initialization**: Basic state creation and file writing
3. **Add State Queries**: getState, getAllStates, isInState
4. **Implement Simple Transitions**: Basic transition logic without locking
5. **Add Transition Validation**: Enforce valid transition rules
6. **Implement Locking**: Add lock-free compare-and-swap
7. **Add Metadata Tracking**: Activity timestamps and transition history
8. **Error Handling**: Graceful degradation and recovery
9. **Performance Optimization**: Efficient concurrent operations

## Success Criteria

When the implementation is complete:
- All 75 tests should pass
- No test modifications should be needed
- Code should handle all edge cases
- Performance requirements should be met

## Notes

- Tests use `node:test` (built-in Node.js test runner)
- Tests are isolated with beforeEach/afterEach cleanup
- Each test creates a fresh StateMachine instance
- Test state directory: `.ai/tx/state/state-machine-test`
- Tests run in `NODE_ENV=test`

## Next Steps

1. Review test file: `/workspace/tx-cli/test/unit/state-machine.test.js`
2. Review stub implementation: `/workspace/tx-cli/lib/state-machine.js`
3. Implement features one test at a time
4. Run tests frequently to verify progress
5. Move to GREEN phase when all tests pass
6. REFACTOR phase after all tests pass
