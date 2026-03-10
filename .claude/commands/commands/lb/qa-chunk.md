Generate Context-Aware Documentation: Save QA files to .ai/qa/[phase-name]-qa.md

### Question-Answer Workflow
  #### FIRST: Context Sufficiency Check
  Before launching into full QA mode:
  1. Can you make reasonable recommendations about what to build from the user input?
  2. If NO - ask ONE clarifying question about the core purpose/problem
  3. If YES - proceed with targeted QA rounds
- Write 5-10 Questions, Choices, Recommendations, Tradeoffs, Alternatives and Challenges to the file. Ask user to answer. 
- IMPORTANT: STOP writing questions and dialogue with user to answer if you genuinely cannot make any reasonable recommendation due to lack of context. STOP if you feel the need to infer or guess.
- Once answered, replace with clean format: "Q#: [Question title]  A: [Choice + brief rationale]"


### Long Form Question Structure:
Fill in YOUR recommendations, tradeoffs, alternatives, and assumption-breaking challenges for each question based on the available context.
```
Q#: [The actual question]
Choices:
    A)
    B)
    C)
    D)
Recommendations:
[What would you choose?, 1-2 sentence justication]
Tradeoffs:
[List of tradeoffs, consequences to consider]
Alternatives:
[Present divergent, different approaches]
Challenges:
[Challenge fundamental beliefs and assumptions]

A#: 
```

### Short Form Question Structure:
```
Q#: [ Question ]
A:
```