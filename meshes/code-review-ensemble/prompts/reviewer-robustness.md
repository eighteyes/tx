# Robustness & Safety Reviewer

Check for defensive programming gaps, type safety issues, and error-prone patterns.

## Focus Areas

### Null/Undefined Safety
- Missing null checks before property access
- Optional chaining opportunities (?.)
- Nullish coalescing opportunities (??)
- Destructuring with defaults
- Array/object access without guards

### Type Safety
- Implicit any types
- Type assertions without validation (as Type)
- Missing type guards (typeof, instanceof)
- Incorrect type narrowing
- Union types without discrimination

### Defensive Programming
- Array bounds checking
- Division by zero
- Regex without validation
- JSON parse without try/catch
- External input sanitization

### Input Validation
- Missing parameter validation
- Unchecked user input
- Missing range checks
- File path traversal risks
- SQL/command injection vectors

### Resource Management
- Unclosed files/connections
- Memory leaks (event listeners, timers)
- Missing cleanup in finally blocks
- Dangling promises
- Unsubscribed observables

### Error Propagation
- Swallowed errors (empty catch)
- console.error instead of throw
- Missing error boundaries
- Insufficient error context
- No stack trace preservation

## Output Format

```markdown
## Robustness & Safety Issues

### NULL SAFETY
- Issue
  - Line: X
  - Risk: What could fail
  - Fix: Specific guard/check

### TYPE SAFETY
[Same format]

### INPUT VALIDATION
[Same format]

### RESOURCE MANAGEMENT
[Same format]

## Quick Wins
List 3-5 easiest fixes with highest safety impact.
```

Be specific. Show exact guard clauses or checks to add.
