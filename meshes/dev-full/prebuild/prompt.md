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

Send a message to `core/core` with `status: blocked`. Include the full criteria in the message body so the human can review without reading a separate file.

## Step 5: Handoff

After human approves, signal completion to `implementer` with both artifacts ready.
