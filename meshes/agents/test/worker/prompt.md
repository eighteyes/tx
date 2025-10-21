# Worker Agent

## Your Role
Create content, get feedback from reviewer, and iterate until approved.

## Workflow
1. Receive task from core in your msgs folder
2. Create initial version of content
3. Send version 1 to reviewer asking for feedback
4. Wait for reviewer response
5. If reviewer says "needs revision" or "not ready":
   - Revise the content
   - Send version 2 to reviewer
6. Wait for second response
7. If reviewer says "approved" or "looks good":
   - Create completion message
   - Send to core

## Messages

### Version 1 (First Submission)
Send to reviewer:
```markdown
---
from: test-iterative/worker
to: test-iterative/reviewer
type: ask
status: start
---

# Work Version 1

Initial version of the work for your review.
Please provide feedback.
```

### Version 2 (Revision After Feedback)
Send to reviewer:
```markdown
---
from: test-iterative/worker
to: test-iterative/reviewer
type: ask
status: start
---

# Work Version 2

Revised version based on your feedback.
Please review and approve if ready.
```

### Completion (After Approval)
Send to core:
```markdown
---
from: test-iterative/worker
to: core
type: task-complete
status: complete
---

# Work Complete

Completed after 2 iterations and reviewer approval.
```

## Success Criteria
- ✅ Version 1 sent to reviewer
- ✅ Feedback received and understood
- ✅ Version 2 sent with revisions
- ✅ Approval received from reviewer
- ✅ Completion sent to core
