# Code Review Example

Parallel code review with 4 specialized analyzers providing comprehensive feedback.

---

## What You'll Learn

- Parallel (fan-out) mesh topology
- Coordinator pattern
- Report aggregation
- Multi-perspective analysis

---

## Overview

The `code-review` mesh spawns 4 analyzers that work simultaneously:

1. **SOLID Checker** - Analyzes adherence to SOLID principles
2. **Doc/Config Checker** - Verifies documentation and configuration consistency
3. **Test Coverage Analyzer** - Measures test coverage and quality
4. **Maintainability Analyzer** - Assesses code maintainability metrics

All report back to a **Coordinator** who aggregates findings into a comprehensive report.

---

## Architecture

```
                          ┌──► solid-checker
                          │
core ──► coordinator ─────┼──► doc-config-checker
              ▲           │
              │           ├──► test-coverage-analyzer
              │           │
              └───────────┴──► maintainability-analyzer
                 (all report back)
```

**Workflow:**
1. Core sends task to coordinator
2. Coordinator distributes to 4 analyzers (parallel)
3. All 4 analyzers work simultaneously
4. Each reports findings back to coordinator
5. Coordinator aggregates into final report
6. Coordinator sends completion to core

---

## Step 1: Review Existing Config

```bash
cat meshes/mesh-configs/code-review.json
```

Key features:
- `"type": "parallel"`
- `"workflow_topology": "fan-out"`
- Routing rules for distribution and aggregation

---

## Step 2: Spawn Code Review

### Basic Usage

Inside core:
```
spawn code-review mesh for lib/auth/
```

### Detailed Request

```
spawn code-review mesh with the following requirements:

**Module:** lib/auth/
**Focus Areas:**
- Security vulnerabilities
- Test coverage (target: >80%)
- SOLID principles adherence
- API documentation completeness

**Priority:** High
**Deadline:** 2025-10-31
```

---

## Step 3: Observe Parallel Execution

### Watch Coordinator

```bash
tx attach code-review
```

You'll see coordinator:
1. Parse request
2. Distribute tasks to analyzers
3. Wait for all responses
4. Aggregate findings

### Check Status

```bash
tx status
```

Output:
```
Active Meshes (2):

  🟢 core (persistent)
     State: waiting

  🟡 code-review-abc123 (parallel)
     State: processing
     Topology: fan-out
     Active agents: 4/5
       ✅ coordinator (waiting)
       🔄 solid-checker (working)
       🔄 doc-config-checker (working)
       🔄 test-coverage-analyzer (working)
       🔄 maintainability-analyzer (working)
```

---

## Step 4: Review Output

### Final Report

Coordinator saves comprehensive report to `.ai/reports/code-review-{timestamp}.md`

**Example report structure:**

```markdown
# Code Review Report: lib/auth/

**Date:** 2025-10-30
**Module:** lib/auth/
**Reviewers:** 4 analyzers

---

## Executive Summary

- ✅ SOLID Principles: 8/10 (Good)
- ⚠️  Security: 2 medium-risk issues
- ✅ Test Coverage: 87% (Exceeds 80% target)
- ⚠️  Documentation: 3 functions missing API docs

**Recommendation:** Address security issues before merge.

---

## 1. SOLID Principles Analysis

### Score: 8/10

**Strengths:**
- Single Responsibility: Well-defined class boundaries
- Open/Closed: Good use of interfaces
- Dependency Inversion: Proper dependency injection

**Issues:**
- Interface Segregation: `AuthService` interface too large
- Liskov Substitution: `MockAuthService` violates contract

**Recommendations:**
- Split `AuthService` into `IAuthenticator` and `IAuthorizer`
- Fix `MockAuthService.verifyToken()` to match interface

---

## 2. Documentation & Configuration

### Score: 7/10

**Missing Documentation:**
- `lib/auth/jwt.js:42` - `generateToken()` lacks JSDoc
- `lib/auth/password.js:18` - `hashPassword()` parameters undocumented
- `lib/auth/session.js:67` - `validateSession()` return value unclear

**Configuration Issues:**
- `.env.example` missing `JWT_SECRET` example
- `config/auth.js` has hardcoded timeout (should be configurable)

**Recommendations:**
- Add JSDoc to all exported functions
- Move hardcoded values to config

---

## 3. Test Coverage

### Score: 87% (Exceeds Target)

**Coverage by File:**
- `lib/auth/jwt.js`: 92%
- `lib/auth/password.js`: 88%
- `lib/auth/session.js`: 79% ⚠️
- `lib/auth/middleware.js`: 90%

**Uncovered Paths:**
- Error handling in `session.js:45-52`
- Edge case in `middleware.js:78` (expired token)

**Recommendations:**
- Add tests for session error handling
- Test expired token scenario in middleware

---

## 4. Maintainability

### Score: 8.5/10

**Metrics:**
- Cyclomatic Complexity: Average 3.2 (Good)
- Lines per Function: Average 18 (Good)
- Duplicate Code: 2% (Excellent)
- Comment Ratio: 12% (Acceptable)

**Issues:**
- `jwt.js:generateToken()` has complexity of 8 (refactor threshold: 6)
- `password.js` has 3 functions with similar structure (consider DRY)

**Recommendations:**
- Refactor `generateToken()` to extract validation logic
- Create `validatePasswordRequirements()` helper to reduce duplication

---

## Action Items

### Critical (Before Merge)
1. ⚠️  Fix security issues in JWT validation
2. ⚠️  Address Liskov Substitution violation

### High Priority
3. Add missing API documentation (3 functions)
4. Increase session.js test coverage to >80%

### Medium Priority
5. Refactor `generateToken()` for reduced complexity
6. Split `AuthService` interface
7. Extract duplicate password validation logic

---

## Security Findings

### Medium Risk: JWT Algorithm Confusion
**File:** `lib/auth/jwt.js:28`
**Issue:** Accepts any algorithm, vulnerable to algorithm substitution attack
**Fix:** Explicitly specify `algorithms: ['HS256']` in jwt.verify()

### Medium Risk: Weak Password Hashing
**File:** `lib/auth/password.js:15`
**Issue:** Bcrypt cost factor of 8 is too low for 2025
**Fix:** Increase to 12 or higher

---

## Conclusion

The `lib/auth/` module demonstrates good overall quality with strong test coverage and maintainable code structure. Address the 2 security issues before merging to production.

**Estimated effort:** 2-3 hours to resolve all critical and high-priority items.
```

---

## Step 5: Address Findings

### View Specific Analyzer Reports

Each analyzer also creates detailed findings:

```bash
# SOLID analysis
cat .ai/tx/mesh/code-review-abc123/agents/solid-checker/workspace/solid-analysis.md

# Test coverage details
cat .ai/tx/mesh/code-review-abc123/agents/test-coverage-analyzer/workspace/coverage-report.md
```

---

## Customization

### Focus on Specific Aspects

```
spawn code-review mesh for lib/payment/
Focus ONLY on security and test coverage, skip SOLID and documentation analysis
```

Coordinator will distribute tasks accordingly.

### Set Custom Thresholds

```
spawn code-review mesh for lib/api/
Test coverage target: 90%
Cyclomatic complexity threshold: 5
```

---

## Integration with CI/CD

### Pre-Commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Start TX
tx start -d

# Review staged files
STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep '.js$')

# Spawn review
echo "spawn code-review mesh for: $STAGED" | tx-send-to-core

# Wait for completion
tx wait code-review --timeout 300

# Check for critical issues
if grep -q "Critical:" .ai/reports/code-review-*.md; then
  echo "❌ Critical issues found. Commit blocked."
  exit 1
fi

echo "✅ Code review passed"
exit 0
```

### GitHub Actions

```yaml
name: TX Code Review

on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup TX
        run: |
          npm install -g tx-cli
          tx repo-install
      - name: Run Code Review
        run: |
          tx start -d
          tx spawn code-review
          tx wait code-review --timeout 600
      - name: Upload Report
        uses: actions/upload-artifact@v2
        with:
          name: code-review-report
          path: .ai/reports/
```

---

## Advanced: Custom Analyzers

Add your own analyzer to the mesh:

### 1. Update Mesh Config

Add to `agents` array in `meshes/mesh-configs/code-review.json`:

```json
{
  "agents": [
    "coordinator",
    "solid-checker",
    "doc-config-checker",
    "test-coverage-analyzer",
    "maintainability-analyzer",
    "security-scanner"  // New!
  ]
}
```

### 2. Add Routing

```json
{
  "routing": {
    "coordinator": {
      "distribute": {
        "security-scanner": "Distribute security scan task"
      }
    },
    "security-scanner": {
      "complete": {
        "coordinator": "Security scan complete"
      }
    }
  }
}
```

### 3. Create Agent Prompt

`meshes/agents/code-review/security-scanner/prompt.md`

---

## Performance

**Parallel execution advantages:**
- 4 analyzers work simultaneously
- Total time ≈ slowest analyzer (not sum of all)
- Typically 2-5 minutes for 500-1000 LOC module

**Sequential would take:** 8-20 minutes

**Speedup:** 4x faster

---

## Next Steps

- **[Custom Mesh Example](../custom-mesh/)** - Build your own mesh
- **[Architecture Guide](../../new/architecture.md)** - Understand parallel topologies

---

## Troubleshooting

### Issue: One analyzer not responding

```bash
# Attach to coordinator
tx attach code-review

# Check which analyzer is stuck
# Manually route or skip

# View logs
tx logs error | grep code-review
```

### Issue: Report not generated

```bash
# Check coordinator workspace
ls .ai/tx/mesh/code-review-*/agents/coordinator/workspace/

# Check reports directory
ls .ai/reports/
```

---

**Questions?** See [Troubleshooting Guide](../../new/troubleshooting.md)
