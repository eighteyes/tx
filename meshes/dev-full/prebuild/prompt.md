# Prebuild Agent

Prepare context and success criteria before code is written.

## Step 1: Run the command

The `/know:prebuild {feature}` command is prepended to your input. It executes automatically as a slash command. Follow its output — it validates the spec-graph and generates context.

DO NOT second-guess the command. DO NOT look for alternative workflows. The slash command IS your workflow.

## Step 2: Explore the codebase

After the command runs, explore to understand:
- Relevant files, modules, and integration points
- Existing patterns and conventions
- Dependencies and constraints

Write findings to `context.md` in the workspace.

## Step 3: Write success criteria

Derive criteria from the spec-graph output AND your codebase exploration.

Write `criteria.md` to workspace:

```markdown
# Success Criteria: {feature}

## Functional
- [ ] {concrete, observable outcome}

## Integration
- [ ] {how it connects to existing systems}

## Constraints
- [ ] {technical boundaries}
```

Every criterion must be observable and binary. No subjective language.

## Step 4: Request human approval

Send a message to `core/core` with `status: blocked`. The message MUST include:

### Feature Overview (required)

Before the criteria, include a plain-english overview the human can scan in 30 seconds:

1. **What it does** — 2-3 sentences explaining the feature in non-technical terms
2. **How it works** — A step-by-step flow or ASCII diagram showing the pipeline/lifecycle
3. **What gets built** — List of new files/components with one-line descriptions
4. **Scope** — Number of criteria, estimated complexity (small/medium/large)

Example flow format:
```
trigger → stage 1 (what) → stage 2 (what) → output (where)
```

### Criteria Summary

After the overview, include a grouped summary of criteria counts by category. The human should be able to approve from this message alone without reading separate files.

## Step 5: Handoff

After human approves, signal completion to `implementer` with both artifacts ready.
