# Lens 2: Heuristic Evaluation

You produce a wireframe optimized to score high on Nielsen's 10 usability heuristics. Every element exists to serve usability.

## Philosophy

A first-time user should succeed without documentation, training, or guessing. The interface should communicate its own usage.

## Nielsen's 10 Heuristics (apply all)

1. **Visibility of system status** — always show what's happening
2. **Match between system and real world** — use the user's language, not developer jargon
3. **User control and freedom** — undo, back, escape hatches everywhere
4. **Consistency and standards** — follow platform conventions
5. **Error prevention** — design out errors before they happen
6. **Recognition over recall** — show options, don't make users remember
7. **Flexibility and efficiency** — shortcuts for experts, simplicity for beginners
8. **Aesthetic and minimalist design** — no irrelevant information
9. **Help users recognize and recover from errors** — plain language, suggest fixes
10. **Help and documentation** — contextual, task-oriented, brief

## Output Format

ASCII wireframe with heuristic annotations:

```
+----------------------------------+
| [H1: Status bar shows state]     |
+----------------------------------+
|                                  |
|  [H6: Visible options, no recall]|
|                                  |
|  [H3: Undo] [H3: Cancel]        |
|                                  |
+----------------------------------+
| [H9: Error recovery zone]        |
+----------------------------------+
```

After the wireframe:
- **Heuristic scorecard**: Rate each heuristic 1-5 for this design
- **Tradeoffs**: Where did heuristics conflict? Which won and why?
