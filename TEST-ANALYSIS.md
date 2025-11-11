# TX CLI Test Suite Analysis

**Date:** 2025-11-10
**Test Status:** 335 tests total, 201 passing (60%), 134 failing (40%)

## Executive Summary

The test suite has 4 categories of issues:
1. **API Mismatches** - Tests expect different APIs than implementations provide
2. **TDD Red Phase Tests** - Tests written before implementation (state-machine.test.js)
3. **Git Feature Tests** - May not be relevant to current workflow
4. **Passing Tests** - Core functionality tests are passing

## Test Suite Status

### ✅ Passing & Relevant (9 suites, 201 tests)

| Test Suite | Status | Implementation | Notes |
|------------|--------|----------------|-------|
| agent-path.test.js | ✅ All passing | lib/utils/agent-path.js | Core path parsing |
| capability-injection.test.js | ✅ All passing | lib/capability-loader.js | Capability system |
| config-loader.test.js | ✅ All passing | lib/config-loader.js | Configuration |
| message-writer-rearmatter.test.js | ✅ All passing | lib/message-writer.js | Message metadata |
| validator-rearmatter.test.js | ✅ All passing | lib/validator.js | Message validation |
| routing.test.js | ✅ All passing | lib/routing.js | Message routing |
| rearmatter-schema.test.js | ✅ All passing | lib/rearmatter-schema.js | Schema validation |
| utils.test.js | ✅ All passing | lib/utils.js | Utility functions |

### ⚠️ Failing Due to API Mismatch (2 suites, ~80 tests)

#### 1. health-monitor.test.js (100% failing)
**Implementation:** `lib/health-monitor.js` (EXISTS)

**Root Cause:** Property name mismatch
```javascript
// Tests expect:
agentState.status === 'error'

// Implementation provides:
agentState.state === 'error'
```

**Additional Issues:**
- Tests use jest spy functions but project uses node:test
- StateManager API confusion (static vs instance)

**Fix Difficulty:** 🟡 Medium - Find & replace + remove jest dependencies

**Recommendation:** Update tests to match implementation
```bash
# Quick fix commands:
sed -i 's/agentState\.status/agentState.state/g' test/unit/health-monitor.test.js
sed -i 's/jest\.spyOn/# TODO: Replace with node:test/g' test/unit/health-monitor.test.js
```

#### 2. delivery-monitor.test.js (33% failing)
**Implementation:** `lib/delivery-monitor.js` (EXISTS)

**Root Cause:** StateManager API confusion
```javascript
// Tests try to instantiate:
const stateManager = new StateManager({ stateDir: ... });

// But implementation is static class:
StateManager.initializeAgent(agentId, sessionName);
StateManager.getState(agentId);
```

**Fix Difficulty:** 🟢 Easy - Update test setup

**Recommendation:** Use static StateManager API in tests

### ❌ Not Implemented (1 suite, ~50 tests)

#### state-machine.test.js (100% failing)
**Implementation:** lib/state-machine.js exists but is INCOMPLETE

**Root Cause:** TDD "Red Phase" tests written before implementation

**Expected Features:**
- 10 lifecycle states with emojis (spawned, initializing, ready, working, blocked, distracted, completing, error, suspended, killed)
- Atomic compare-and-swap transitions
- Lock management for concurrent operations
- Transition validation
- File-based state persistence
- Metadata tracking

**Actual Implementation:** Different approach using StateManager class with SQLite backend

**Fix Difficulty:** 🔴 High - Major implementation work required

**Recommendations:**
1. **Option A (Quick):** Remove test file - feature implemented differently via StateManager
2. **Option B (Medium):** Refactor tests to match StateManager's actual API
3. **Option C (Long-term):** Implement StateMachine as separate abstraction layer

### ❓ Unclear Relevance (3 suites, Git features)

#### git-worktree.test.js (100% failing)
**Implementation:** lib/git/worktree.js (EXISTS)
**Status:** Git integration tests may not be critical to core workflow

#### git-merge.test.js (100% failing)
**Implementation:** lib/git/merge.js (EXISTS)
**Status:** Git merge features may not be used

#### git-conflict-resolver.test.js (100% failing)
**Implementation:** lib/git/conflict-resolver.js (EXISTS)
**Status:** Conflict resolution may not be part of current workflow

**Fix Difficulty:** 🔴 High - Integration tests require Git setup

**Recommendations:**
1. **Assess Feature Usage:** Check if Git features are actually used in production
2. **Remove if Unused:** Delete tests and implementations if features aren't needed
3. **Skip if Future:** Mark as `.skip` if keeping for future development
4. **Fix if Critical:** Properly mock Git environment if features are critical

## Priority Action Plan

### 🚀 Quick Wins (Est: 30 minutes)

1. **Fix health-monitor.test.js property names**
   ```bash
   # Replace status with state
   sed -i 's/agentState\.status/agentState.state/g' test/unit/health-monitor.test.js
   ```

2. **Update delivery-monitor.test.js StateManager usage**
   - Remove StateManager instantiation
   - Use static methods directly

Expected gain: +80 tests passing (~24% improvement)

### 🎯 Medium Term (Est: 2-4 hours)

3. **Address jest dependencies in health-monitor tests**
   - Replace `jest.spyOn` with node:test equivalents
   - Update mock patterns

4. **Decide on Git feature tests**
   - Audit codebase for git/* usage
   - Either remove, skip, or fix based on usage

Expected gain: Cleaner test suite, clearer coverage

### 📋 Long Term (Est: 1-2 days)

5. **Resolve state-machine.test.js**
   - Decision required: Keep, refactor, or remove?
   - If keeping: Implement missing StateMachine features
   - If removing: Document why StateManager is sufficient

Expected gain: +50 tests removed or passing

## Detailed Analysis

### StateManager vs StateMachine

The codebase has **two different concepts** that tests confuse:

| Feature | StateManager (Current) | StateMachine (Tests Expect) |
|---------|----------------------|---------------------------|
| Location | lib/state-manager.js | lib/state-machine.js (incomplete) |
| Architecture | Static class | Instance-based class |
| Storage | SQLite (state-db.js) | File-based JSON |
| States | 10 states (same names) | 10 states with emojis |
| Transitions | Basic validation | Full compare-and-swap |
| Locking | None | Lock management |
| Current Status | ✅ Implemented & Used | ❌ Tests only |

**Key Question:** Do we need StateMachine as a separate abstraction, or is StateManager sufficient?

### Test Dependencies Issue

**Problem:** Tests mix two testing frameworks:
- Project uses: `node:test` (built-in Node.js testing)
- Tests use: `jest` spy functions (`jest.spyOn`, `jest.mock`)

**Files Affected:**
- test/unit/health-monitor.test.js (lines 468-509, 536-545, etc.)

**Solution:** Remove jest dependencies, use pure node:test assertions

### Property Name Conventions

**Inconsistency Found:**

```javascript
// lib/state-manager.js returns:
{
  agentId: "brain/brain",
  state: "working",        // ← Uses "state"
  sessionName: "...",
  ...
}

// But health-monitor.js checks:
if (agentState.status === 'error') {  // ← Checks "status"
```

**Impact:** 100% of health-monitor tests fail due to undefined checks

**Fix:** Standardize on `state` property (matches StateManager API)

## Testing Best Practices

### Current Issues

1. **Mixing test frameworks** - node:test and jest
2. **TDD tests without implementation** - state-machine.test.js
3. **Inconsistent mocking** - Some tests mock, others don't
4. **Git integration tests** - Require full Git environment

### Recommendations

1. **Standardize on node:test** - Remove all jest dependencies
2. **Match test APIs to implementations** - Keep tests synchronized
3. **Document TDD approach** - If writing tests first, mark them clearly
4. **Mock external dependencies** - Git, filesystem, etc.

## Files to Review

### Implementation Files
- ✅ lib/state-manager.js - Working, used by system
- ⚠️ lib/health-monitor.js - Working but uses wrong property name
- ⚠️ lib/delivery-monitor.js - Working, tests need update
- ❌ lib/state-machine.js - Incomplete, tests expect more
- ❓ lib/git/*.js - Unclear if used in production

### Test Files Priority
1. 🔥 **High:** test/unit/health-monitor.test.js - Fix property names
2. 🔥 **High:** test/unit/delivery-monitor.test.js - Fix StateManager usage
3. 🟡 **Medium:** test/unit/state-machine.test.js - Decision needed
4. 🟢 **Low:** test/unit/git-*.test.js - Assess relevance

## Recommended Next Steps

1. **Immediate (Today)**
   - [ ] Fix health-monitor.test.js property references (status → state)
   - [ ] Run tests again to validate ~80 test improvement

2. **This Week**
   - [ ] Update delivery-monitor.test.js to use static StateManager
   - [ ] Remove jest dependencies from health-monitor.test.js
   - [ ] Audit Git feature usage in codebase

3. **This Sprint**
   - [ ] Decide: Keep, refactor, or remove state-machine.test.js
   - [ ] Document testing conventions in TESTING.md
   - [ ] Set up pre-commit hook to run tests

## Coverage Goals

**Current Coverage:** 60% passing (201/335 tests)

**Realistic Target (Quick Fixes):** 85% passing (~285/335 tests)
- Fix health-monitor: +60 tests
- Fix delivery-monitor: +24 tests

**Stretch Target (All Fixes):** 95% passing (~318/335 tests)
- Resolve state-machine: +50 tests or remove
- Fix/remove Git tests: Variable

**Maintain:** 100% passing for core features
- Message routing: ✅
- Agent path parsing: ✅
- Config loading: ✅
- Validation: ✅

---

**Analysis Completed By:** Claude Code
**Last Updated:** 2025-11-10
