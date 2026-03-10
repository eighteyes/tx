# Mesh Prompting Guide

How to describe what you want mesh-builder to build.

## The Formula

```
[Goal sentence]
[Pipeline as verb chain with branch/loop conditions]
[Only the mechanics that deviate from defaults]
```

The pipeline verb chain does 80% of the work. Get that right and mesh-builder infers everything else.

## 1. State the Goal in One Sentence

What does the mesh **deliver**? Not what it does — what it produces.

- "Research a topic and produce a confidence-rated report"
- "Find bugs by generating tests from a spec-graph"
- "Implement a feature with test and review cycles"

## 2. Describe the Pipeline as a Verb Chain

Who does what, in what order, and what decisions change the flow.

> "interviewer gathers requirements -> sourcer finds sources -> analyst formulates hypotheses -> researcher synthesizes -> if confidence < 95%, disprover critiques and loops back to analyst -> writer produces final report"

This tells mesh-builder:
- How many agents
- The routing topology (linear, branching, looping)
- Where decisions happen and what drives them

## 3. Call Out Non-Obvious Mechanics (Only If Needed)

| If you need... | Say... |
|---|---|
| Parallel agents | "X, Y, Z run in parallel, then synthesizer combines" |
| Human-in-the-loop | "blocks and asks human when [condition]" |
| Loops | "loops between A and B until [condition]" |
| MCP tools | "agent X needs playwright/browser access" |
| Specific models | "use opus for [agent] because [judgment reason]" |
| File preloading | "preload [files] before starting" |
| Workspace | "write outputs to [path pattern]" |

If a mechanic uses the default behavior, omit it.

## 4. What NOT to Include

- Agent prompt content (mesh-builder generates prompts separately)
- Message format details (system auto-injects these)
- Routing syntax (inferred from the pipeline description)
- FSM unless you specifically need computed-state routing
- Guardrails unless you need custom limits
- TX system internals (see Anti-Pattern below)

## Example — Optimal Prompt

> **Build a mesh called `code-audit` that audits a codebase for security issues and produces a prioritized report.**
>
> **Pipeline:** scanner reads the codebase and identifies files of interest -> three reviewers run in parallel (auth-reviewer, injection-reviewer, crypto-reviewer) each checking their domain -> synthesizer waits for all three, deduplicates findings, and produces a ranked report.
>
> **Notes:**
> - Reviewers need file preloading of `src/**/*.ts`
> - Synthesizer should be opus (complex judgment to rank severity)
> - Write report to `.ai/output/audit/`

~60 words that fully specify:
- 5 agents with roles
- Fan-out/fan-in topology
- Model preferences with rationale
- Workspace
- File loading needs

## The Anti-Pattern

Describing **TX system internals** back to mesh-builder. Things like:

- "agents communicate via markdown files with frontmatter"
- "use `to: mesh/agent` routing headers"
- "write messages to `.ai/tx/msgs/`"
- "the completion agent should signal `outcome: complete`"

Mesh-builder already knows all of that. Including it risks **conflicting** with what gets auto-injected into agent prompts.

The line is: **describe what your agents do, not how TX works.**

Examples of agent behavior and pipeline flow are fine — that's the useful part. System plumbing is not.
