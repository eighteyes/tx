# TDD Cycle Mesh Usage

## Quick Start

```bash
# Spawn the TDD cycle mesh with a feature description
tx spawn tdd-cycle "Implement a function that validates email addresses"
```

## How It Works

The mesh cycles through three phases:

### 🔴 Red Phase
- **Input**: Feature description
- **Output**: Failing test file
- **Agent**: `development/red-phase`
- Writes a test that will fail because the implementation doesn't exist

### 🟢 Green Phase
- **Input**: Failing test from red phase
- **Output**: Minimal implementation code
- **Agent**: `development/green-phase`
- Writes just enough code to make the test pass

### 🔵 Refactor Phase
- **Input**: Implementation code + passing tests
- **Output**: Refactored code or loop back to red
- **Agent**: `development/refactor-phase`
- Improves code quality while keeping tests green
- Decides whether to loop back to red or complete the cycle

## Message Flow

```
Your Feature Idea
       ↓
Red Phase (writes failing test)
       ↓ [test-ready message]
Green Phase (implements code)
       ↓ [implementation-ready message]
Refactor Phase (improves code)
       ↓ [refactor-complete or task-complete]
   Loop Back OR Complete
```

## Example

```bash
# Start a simple feature
tx spawn tdd-cycle "Create a calculator function that adds two numbers"

# The mesh will:
# 1. Red Phase: Write tests like:
#    - add(2, 3) should return 5
#    - add(-1, 1) should return 0
#    - These tests will FAIL (no implementation)

# 2. Green Phase: Write minimal implementation:
#    function add(a, b) { return a + b; }
#    Tests now PASS

# 3. Refactor Phase: Improve code quality
#    - Add error handling
#    - Add JSDoc comments
#    - Validate inputs
#    Decide: Complete or loop for more features

```

## Monitoring the Cycle

Check messages in progress:
```bash
# Watch messages as they flow through the mesh
watch -n 1 'find .ai/tx/mesh -path "*tdd-cycle*" -name "*.md" | sort'

# Check a specific agent's messages
ls -la .ai/tx/mesh/tdd-cycle-*/agents/*/msgs/
```

## Stay-In-Place Messaging

Messages stay in their creation location:
- Red phase messages stay in `red-phase/msgs/`
- Green phase messages stay in `green-phase/msgs/`
- Refactor phase messages stay in `refactor-phase/msgs/`

The system injects `@filepath` references to route messages between agents.

## Iteration Control

The refactor phase decides:
- **LOOP BACK** (continue): If more features/edge cases needed → goes back to red phase with iteration count incremented
- **COMPLETE** (finish): If feature is complete and well-refactored → sends task-complete to core

## Testing

Run the E2E tests:
```bash
node test/e2e/test-e2e-tdd-cycle.js
```

This validates:
- ✓ Red phase creates failing tests
- ✓ Green phase implements code
- ✓ Refactor phase improves code
- ✓ Iteration loops work correctly
- ✓ Final completion message sent to core
