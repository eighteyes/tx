---
allowed-tools:
- Glob(*)
- Read(*)
- Write(*)
- Bash(rg *)
- Bash(wc *)
- TodoWrite(*)
description: Audit prompt files for unenforced imperatives and rewrite constraints as runtime config or positive instructions
permalink: commands/z8/prompt-logicator
---

## Context
Target: `$ARGUMENTS` (defaults to current directory if not specified)

## Your task

Audit prompt files for language that pretends to enforce behavior the LLM cannot guarantee. Classify each imperative as **enforceable by runtime** or **advisory guidance**, then produce a rewrite plan.

### Classification Rules

Every imperative line falls into one of two categories:

1. **Enforceable** — the runtime can mechanically guarantee compliance. Move to config, delete from prompt.
2. **Advisory** — requires LLM judgment (domain knowledge, heuristics, workflow logic). Rewrite as positive instruction.

### Banned Patterns to Detect

Scan for these anti-patterns and flag every instance:

| Pattern | Signal Words | Fix |
|---------|-------------|-----|
| STOP commands | "STOP", "exit immediately", "wait for response" | `max_messages` in config |
| Absolute quantifiers | "NEVER", "ALWAYS", "ONLY", "MUST" | Runtime constraint or positive rewrite |
| Role negation | "do NOT write", "you are NOT a", "is not your job" | State what the agent IS |
| Self-verification | "verify exists", "check that", "confirm" | Runtime post-hook or content-reading tool |
| Counting/tracking | "max 3", "one at a time", "exactly N" | `max_turns`, `max_messages` in config |
| Temporal prose | "BEFORE", "AFTER", "FIRST...THEN" | Numbered steps (partial) or runtime ordering |
| Emphasis-as-enforcement | **CRITICAL**, CAPS, emoji warnings | Plain statement or runtime validation |
| Routing duplication | Destination names restated in prose | Remove — routing injection is source of truth |

### Audit Process

1. Use Glob to find all prompt files (*.md) in target directory
2. Read each file
3. Use rg to scan for signal words: `MUST|NEVER|STOP|ALWAYS|ONLY|DO NOT|CRITICAL|IMPORTANT|BEFORE|AFTER|FIRST`
4. For each match, classify as enforceable or advisory
5. Generate the audit report

### Output: `prompt-audit.md`

```markdown
# Prompt Audit Report

## Summary
- Files scanned: [N]
- Total imperatives found: [N]
- Enforceable (move to config): [N]
- Advisory (rewrite): [N]
- Clean (no action): [N]

## By File

### [filename]

| Line | Original | Category | Action |
|------|----------|----------|--------|
| 12 | "STOP HERE — wait for response" | Enforceable | `max_messages: 1` in config |
| 34 | "NEVER read game content" | Advisory | Rewrite: "Your scope is routing messages." |

#### Suggested Rewrites
[For each advisory line, provide the positive-instruction rewrite]

#### Config Extractions
[For each enforceable line, provide the config.yaml field and value]

## Recommended Config Additions
[Aggregate all enforceable constraints as a config.yaml snippet]

## Token Impact Estimate
- Lines removable: [N]
- Approximate tokens saved: [N]
```

### Rewrite Principles

When rewriting advisory lines:
- State what the agent IS, not what it ISN'T
- Use positive instructions: "Route messages between agents" not "Do NOT write prose"
- Numbered workflow steps create implicit ordering without temporal prose
- Remove lines that duplicate runtime-injected information (routing tables, file lists)
- Plain language over emphasis. If a statement needs CAPS to work, it needs runtime enforcement instead.

### What Stays in Prompts

Keep these categories untouched:
- Domain knowledge (word lists, analysis techniques, output formats)
- Workflow logic (numbered steps describing what to do)
- Role framing (positive: "You analyze rhythm patterns")
- Output schemas (YAML/JSON structure definitions)
- Context about WHY (helps LLM make judgment calls)
- Heuristics requiring fuzzy judgment
