---
name: Know: Prebuild Validation
description: Validate graph completeness before build by round-trip spec generation
category: Know
tags: [know, prebuild, validation, spec-generation]
---
Validate graph completeness by round-trip spec generation before building.

**Main Objective**

Validate that spec-graph contains all information needed for build by generating specs from graph and comparing with HITL baseline (.md files). Ensures `/know:build` can work purely from `know gen spec --format xml` without reading .md files.

**Prerequisites**
- Feature exists in spec-graph with full dependency chain
- Feature directory exists at `.ai/know/features/<feature>/` (from `/know:add`)
- Activate know-tool skill for graph operations

**Workflow**

## Phase 0: Cross-Graph Link Check

**Before generating specs, verify cross-graph code-link placeholders exist:**

```bash
know graph cross coverage \
  --spec-graph .ai/know/spec-graph.json \
  --code-graph .ai/know/code-graph.json \
  --spec-only
```

**If feature has no code-link ref (0% spec coverage):**
- Warn: "No code-link placeholder found for feature:<name>. Creating placeholder..."
- Create it:
  ```bash
  know -g .ai/know/spec-graph.json add code-link <feature>-code '{"modules":[],"classes":[],"packages":[],"status":"planned"}'
  know -g .ai/know/spec-graph.json link feature:<name> code-link:<feature>-code
  ```
- Note: Placeholder with `status: "planned"` is acceptable. Empty modules/classes list means AI will fill during build.

## Phase 1: Generate Specs from Graph

**Steps:**
1. Generate .md files from current graph state:
   ```bash
   know gen docs feature:<name>
   ```
2. This creates files in `.ai/know/features/<name>/.generated/`:
   - `overview.md` - Feature description, users, objectives, components
   - `spec.md` - Component details and operations
   - `plan.md` - Architecture and implementation approach
   - `todo.md` - Requirements (if exist in meta)
   - `adrs.md` - Architecture decisions (if exist in meta)
   - `exploration.md` - QA sessions (if exist in meta)

## Phase 2: Compare with HITL Baseline

**Steps:**
1. Compare generated files with original HITL files:
   ```bash
   know gen docs feature:<name> --compare
   ```
2. Review differences:
   ```
   ✓ overview.md: Identical
   △ spec.md: Differs (150 vs 200 lines)
   △ plan.md: Differs (80 vs 120 lines)
   ○ adrs.md: No existing file to compare
   ```
3. For each difference, identify missing content in graph

## Phase 3: Update Graph (Iterative)

**For each missing piece of content:**

### Missing Users/Objectives/Components
```bash
# Add missing entities
know -g .ai/know/spec-graph.json add user <key> '{"name":"...","description":"..."}'
know -g .ai/know/spec-graph.json add component <key> '{"name":"...","description":"..."}'

# Link to feature
know -g .ai/know/spec-graph.json link feature:<name> component:<component-name>
```

### Missing Architecture Decisions
```bash
# Add to meta.architecture
know -g .ai/know/spec-graph.json meta set architecture <feature-name> '{
  "approach": "JWT-based authentication",
  "rationale": "Stateless, scalable, industry standard",
  "alternatives": ["Session-based auth", "OAuth only"],
  "tradeoffs": "Requires secure token storage on client"
}'
```

### Missing QA/Exploration Notes
```bash
# Add to meta.qa_sessions
know -g .ai/know/spec-graph.json meta set qa_sessions <session-key> '{
  "feature": "feature:<name>",
  "question": "How should password reset work?",
  "answer": "Email-based token with 1-hour expiry",
  "timestamp": "2026-02-13T10:30:00Z"
}'
```

### Missing Requirements
```bash
# Add to meta.requirements
know -g .ai/know/spec-graph.json meta set requirements auth-login '{
  "feature": "feature:<name>",
  "description": "Users can log in with email/password",
  "status": "pending",
  "acceptance_criteria": ["Email validation", "Rate limiting", "Session creation"]
}'
```

### Missing Implementation Details
```bash
# Add detailed descriptions to operations
know -g .ai/know/spec-graph.json nodes update operation:validate-credentials '{
  "name": "Validate Credentials",
  "description": "Check email/password against database, return user object or error"
}'
```

## Phase 4: Regenerate and Validate

**Steps:**
1. Regenerate docs after graph updates:
   ```bash
   know gen docs feature:<name> --compare
   ```
2. Check if differences resolved:
   ```
   ✓ overview.md: Identical
   ✓ spec.md: Identical
   △ plan.md: Differs (95 vs 120 lines)
   ```
3. Repeat Phase 3 & 4 until all files identical or acceptable

## Phase 5: Generate Final XML Spec

**Steps:**
1. Once validated, generate XML spec for build:
   ```bash
   know gen spec feature:<name> --format xml > .ai/know/features/<name>/.prebuild/spec.xml
   ```
2. Verify XML contains all necessary sections:
   - Feature metadata (name, description, phase, status)
   - User stories (auto-generated from graph)
   - Dependency chain (user → objective → feature → component → operation)
   - Requirements with status
   - Architecture decisions
   - Data models, business logic, sequences (from references)

## Phase 6: Mark Ready for Build

**Steps:**
1. Create prebuild completion marker:
   ```bash
   echo "validated: $(date -Iseconds)" > .ai/know/features/<name>/.prebuild/validated
   echo "graph_hash: $(git hash-object .ai/know/spec-graph.json)" >> .ai/know/features/<name>/.prebuild/validated
   ```
2. Update feature phase status:
   ```bash
   know -g .ai/know/spec-graph.json phases status feature:<name> review-ready
   ```
3. Report validation success:
   ```
   ✓ Prebuild validation complete
   ✓ Graph contains all HITL baseline content
   ✓ XML spec generated: .ai/know/features/<name>/.prebuild/spec.xml
   ✓ Ready for /know:build
   ```

## Validation Criteria

**Graph is complete when:**
- ✅ Generated overview.md matches HITL baseline (or is more complete)
- ✅ Generated spec.md includes all components and operations from baseline
- ✅ Generated plan.md includes architecture approach and decisions
- ✅ All requirements from todo.md exist in meta.requirements
- ✅ All QA insights captured in meta.qa_sessions or meta.architecture
- ✅ XML spec contains enough detail for implementation

**Acceptable differences:**
- Generated files may have MORE content (graph enriched during planning)
- Generated files may have different formatting (that's fine)
- Missing exploration.md is OK if insights moved to meta
- Missing adrs.md is OK if decisions in meta.architecture

**Unacceptable differences:**
- Generated files missing sections that exist in baseline
- Generated files missing entities (users, components, operations)
- Generated files missing requirements or acceptance criteria
- XML spec lacks implementation details

## Common Issues

**Issue:** Generated spec.md missing components
- **Fix:** Components not linked to feature in graph
- **Command:** `know -g .ai/know/spec-graph.json link feature:<name> component:<comp>`

**Issue:** Generated plan.md missing architecture approach
- **Fix:** Architecture decisions not in meta.architecture
- **Command:** `know -g .ai/know/spec-graph.json meta set architecture <name> '{...}'`

**Issue:** Generated overview.md missing users/objectives
- **Fix:** Feature not linked to users/objectives in dependency chain
- **Command:** `know -g .ai/know/spec-graph.json link objective:<obj> feature:<name>`

**Issue:** Generated files completely empty
- **Fix:** Feature doesn't exist in graph or has no dependencies
- **Command:** `know -g .ai/know/spec-graph.json get feature:<name>`

## Integration with Build

**Before prebuild:**
```
/know:add → creates .md files + basic graph
Graph may be incomplete (just feature entity + phase)
```

**After prebuild:**
```
Graph enriched with all HITL content
XML spec ready for build consumption
/know:build reads ONLY spec.xml (clean context)
```

**Build workflow:**
```bash
# Validate first
/know:prebuild <feature-name>

# If validation passes, build
/know:build <feature-name>
# → Reads .ai/know/features/<name>/.prebuild/spec.xml
# → Clean context, deterministic input
# → No .md parsing needed
```

## Example Session

```
User: /know:prebuild authentication

Assistant: Generates docs from graph
  know gen docs feature:authentication
  
  Output:
  ✓ .ai/know/features/authentication/.generated/overview.md
  ✓ .ai/know/features/authentication/.generated/spec.md
  ✓ .ai/know/features/authentication/.generated/plan.md

Assistant: Compares with baseline
  know gen docs feature:authentication --compare
  
  Output:
  ✓ overview.md: Identical
  △ spec.md: Differs (150 vs 200 lines)
  △ plan.md: Differs (missing architecture section)
  
Assistant: Found missing content in graph:
  - Architecture approach not in meta.architecture
  - Some components missing from graph
  
Assistant: Updating graph
  know -g .ai/know/spec-graph.json meta set architecture authentication '{
    "approach": "JWT with refresh tokens",
    "rationale": "Stateless, secure, mobile-friendly"
  }'
  
  know -g .ai/know/spec-graph.json add component session-manager ...
  know -g .ai/know/spec-graph.json link feature:authentication component:session-manager
  
Assistant: Regenerating
  know gen docs feature:authentication --compare
  
  Output:
  ✓ overview.md: Identical
  ✓ spec.md: Identical  
  ✓ plan.md: Identical
  
✓ Graph validation complete\!

Assistant: Generating XML spec
  know gen spec feature:authentication --format xml > .ai/know/features/authentication/.prebuild/spec.xml
  
✓ Prebuild complete - ready for /know:build
```

## Notes

- **Run prebuild before build** - Ensures graph is complete
- **HITL baseline is source of truth** - Generated specs must match or exceed
- **Graph enrichment OK** - Generated files can have MORE content than baseline
- **Iterative process** - May take 2-3 rounds to get graph complete
- **XML is ephemeral** - Regenerated for each build, not checked into git
- **Clean build context** - Build reads only XML, not .md files

---
r1 - Initial version with round-trip validation workflow
