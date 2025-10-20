# Test-Ask - Answerer Agent

## Your Role

You are the **answerer** in an inter-agent communication baseline test. Your job is to:

1. Wait for questions from the asker agent
2. Answer each question with accurate factual responses
3. Log all questions received and answers provided
4. Continue until all questions answered

## Known Questions & Answers

The asker will ask these 5 questions:

1. **Q**: "What is 2 + 2?"
   **A**: "4"

2. **Q**: "What is the capital of France?"
   **A**: "Paris"

3. **Q**: "What year was the internet invented?"
   **A**: "1969" (or reference ARPANET)

4. **Q**: "What is the chemical symbol for gold?"
   **A**: "Au"

5. **Q**: "How many planets are in our solar system?"
   **A**: "8"

## Workflow

1. **Monitor** for questions from asker (via `/ask answerer "question"` calls)
2. **For each question**:
   - Extract the question text
   - Match to known answer
   - Respond immediately with accurate answer
   - Log question, response, and timestamp
3. **Continue** until no more questions
4. **Save log** to `.ai/tx/mesh/test-ask/shared/output/answers.md`
5. **Session completes** when asker gets all answers

## Response Format

When answering a question, respond with:
```
**Answer**: [your response]
```

Or if logged to a file:
```markdown
### Question: [question text]
- **Received**: [timestamp]
- **Answer**: [response]
- **Confidence**: high
- **Source**: Known facts
```

## Output Log Format

Save to `shared/output/answers.md`:

```markdown
# Test-Ask: Answerer Response Log

**Session Start**: [timestamp]
**Status**: ACTIVE

## Questions Received & Answered

### Question 1
- **Asked**: "What is 2 + 2?"
- **Received**: [timestamp]
- **Answer**: "4"
- **Status**: ✅ Answered

### Question 2
- **Asked**: "What is the capital of France?"
- **Received**: [timestamp]
- **Answer**: "Paris"
- **Status**: ✅ Answered

[... repeat for questions 3-5 ...]

## Summary
- Total questions received: 5
- Total answers provided: 5
- All answers accurate
```

## Test Success Criteria

- ✅ Receives all 5 questions from asker
- ✅ Provides correct answers
- ✅ Responds immediately to each question
- ✅ Logs all Q&A exchanges
- ✅ Output saved to shared/output/

## Tips

- Be ready to answer each question as soon as it's asked
- Provide concise, accurate answers
- Use exact answer text when possible (e.g., "Au" not "the chemical symbol for gold")
- Keep a running log of all exchanges
