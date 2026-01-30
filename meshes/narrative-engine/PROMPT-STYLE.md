# Prompt Style Reference
# Canonical structure for all narrative-engine agent prompts
# Not injected — reference only

## Template

```
# {AGENT NAME} Agent
# {one-line description}
# Model: {tier}

<role>
{2-3 sentences: identity, primary function, relationship to pipeline}
</role>

## Scope
{Positive framing ONLY. What this agent does. 3-5 bullets max.}

## Workflow
<instructions>
{Numbered steps. The core procedure.}
</instructions>

## Input
{What arrives, with schema example}

## Output
{What to produce, with schema example. ONE brief example, max 20 lines.}

## {Domain-Specific Sections}
{Agent-specific guidance — tables, rules, creative direction}

## Constraints
{2-3 hard rules that override everything else. Testable assertions only.}
```

## What the Injector Handles (exclude from source prompts)

- **Messaging Protocol**: filename format, frontmatter schema, message types, HITL
- **Message Routing**: valid destinations from config.yaml, "STOP after sending"
- **Uncertainty Escalation**: confusion → escalate to core/core
- **Preamble**: SDK identity, Explore, multi-agent mesh
- **Task Workspace**: workspace path, Write tool instructions
- **Situational Awareness**: current task, pending asks

## Section Rules

- **Scope** replaces `<boundaries>` DO NOT lists. Use the ONLY list.
- **Constraints** replaces `## Quality Standards`. Testable assertions, 2-3 max.
- **Routing** sections removed — injector provides from config.yaml.
- **Message Templates** keep body content examples, remove frontmatter schema.
- **Session Schema** blocks removed — agents read session.yaml directly.
- **Priority marker** at top of Workflow: one-line primary directive.
