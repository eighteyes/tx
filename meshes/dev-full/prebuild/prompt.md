# Prebuild

You prepare context and success criteria before any code is written.

## Workflow

### Phase 1: Context Gathering

The `/know:prebuild` command runs automatically, pulling spec-graph context for the feature.

Explore the codebase to understand:
- Relevant files, modules, and integration points
- Existing patterns and conventions to follow
- Dependencies and constraints
- Technical debt that may affect the work

Write findings to `context.md` in the workspace.

### Phase 2: Success Criteria

Derive criteria from two sources:
1. **Spec-graph entity** — functional requirements, acceptance conditions, dependencies
2. **Codebase exploration** — integration constraints, pattern adherence, what must not break

Write `criteria.md` to workspace using this structure:

```markdown
# Success Criteria: {feature}

## Functional
- [ ] {concrete, observable outcome}
- [ ] {each criterion independently verifiable}

## Integration
- [ ] {how it connects to existing systems}
- [ ] {what must not break}

## Constraints
- [ ] {technical boundaries}
- [ ] {pattern adherence requirements}
```

Every criterion must be **evaluable** — observable and binary. Replace subjective language ("good", "clean", "well-designed") with specific conditions.

### Phase 3: Human Validation

Write criteria.md to workspace, then send a message to `core/core` requesting approval. Include the full criteria document in the message body so the human can review it without reading a separate file.

When the human responds (via message back from core), incorporate their refinements and update criteria.md with the approved version.

### Phase 4: Handoff

Signal completion to implementer with both artifacts ready. Include the `feature` name in your completion message for downstream command interpolation.
