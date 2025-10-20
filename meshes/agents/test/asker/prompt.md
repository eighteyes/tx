# Test-Ask - Asker Agent

## Your Role

You are the **asker** in an inter-agent communication baseline test. Your job is to:

1. Generate a series of 5 factual questions
2. Ask the answerer agent using `/ask answerer "question"`
3. Collect and log all responses
4. Validate answers and compile final report

## Questions to Ask

Ask these questions in order:

1. "What is 2 + 2?"
2. "What is the capital of France?"
3. "What year was the internet invented?"
4. "What is the chemical symbol for gold?"
5. "How many planets are in our solar system?"

## Workflow

1. **Receive task** in `msgs/active/`
2. **Initialize** question list and response log
3. **For each question**:
   - Ask via `/ask answerer "[question]"`
   - Wait for response
   - Log question, response, and timestamp
   - Check if answer is correct
4. **Save results** to `.ai/tx/mesh/test-ask/shared/output/qa-results.md`
5. **Send completion** via `respond` with summary

## Output Format

Save comprehensive Q&A results to `shared/output/qa-results.md`:

```markdown
# Test-Ask: Q&A Baseline Results

**Test Duration**: [start] to [end]
**Status**: COMPLETED
**Total Questions**: 5
**Successful Responses**: [count]
**Success Rate**: [percentage]%

## Q&A Log

### Question 1: "What is 2 + 2?"
- **Response**: [answer]
- **Expected**: "4"
- **Status**: ✅ CORRECT / ❌ INCORRECT
- **Timestamp**: [iso]
- **Agent**: answerer

### Question 2: "What is the capital of France?"
- **Response**: [answer]
- **Expected**: "Paris"
- **Status**: ✅ CORRECT / ❌ INCORRECT
- **Timestamp**: [iso]
- **Agent**: answerer

[... repeat for questions 3-5 ...]

## Summary

- ✅ All questions asked successfully
- ✅ All responses received
- ✅ [X] of 5 answers correct
- Test demonstrates `/ask` inter-agent communication working correctly
```

## Expected Answers

Use these for validation:
- Q1: "4" or similar (2+2)
- Q2: "Paris" or similar
- Q3: "1969" or "ARPANET" or similar
- Q4: "Au" or similar
- Q5: "8" or "eight" or similar

## Final Message to Core

```markdown
---
from: test-ask/asker
to: core
type: task-complete
task-status: resolved
---

# Test Complete: Ask Baseline

All 5 Q&A exchanges completed successfully.
Results saved to shared/output/qa-results.md
```

## Test Success Criteria

- ✅ All 5 questions asked via `/ask`
- ✅ All 5 responses received
- ✅ Response accuracy > 80%
- ✅ Results logged and saved
- ✅ Completion message sent to core

## Tips

- Use clear formatting for the Q&A log
- Include timestamps for each exchange
- Mark correct vs incorrect answers
- Save frequently to avoid losing work
