# Code Review Ensemble

Parallel deep code review using 3 specialized reviewers + synthesis.

## Reviewers

**Logic Reviewer** (sonnet)
- Edge cases & boundary conditions
- Logic gaps & control flow errors
- Error handling completeness
- State management correctness

**Architecture Reviewer** (sonnet)
- Refactoring opportunities
- Design patterns & SOLID principles
- Code structure & modularity
- Coupling & cohesion

**Robustness Reviewer** (haiku)
- Null/undefined safety
- Type safety gaps
- Defensive programming
- Input validation

**Synthesizer** (sonnet)
- Deduplicates findings
- Prioritizes by impact
- Creates phased action plan
- Provides quality scores

## Usage

Submit code via task message:

```markdown
---
to: code-review-ensemble/entry
from: core/core
---

Review this code:

\`\`\`typescript
// Your code here
\`\`\`
```

## Output

Comprehensive review with:
- Priority issues (CRITICAL/HIGH/MEDIUM/LOW)
- Systemic patterns
- Phased action plan (Quick Wins → Core → Architectural)
- Quality scores (1-10)
- Ship/Fix/Refactor recommendation

## Focus

- **Refactoring opportunities** - Extract method, reduce complexity, eliminate duplication
- **Edge cases** - Boundary conditions, empty inputs, extreme values
- **Logic gaps** - Missing branches, unreachable code, incorrect operators
- **Design issues** - SOLID violations, tight coupling, poor abstraction
- **Safety** - Null checks, type guards, resource cleanup

## Runtime

~3 minutes (180s timeout for parallel deep analysis)
