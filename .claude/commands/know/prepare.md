---
name: Know: Prepare Project
description: Create graph files and populate project.md with context from the codebase
category: Know
tags: [know, prepare, analysis]
---
Create graph files and populate project.md with codebase context.

**Arguments**: `$ARGUMENTS` — optional source directory to scan (e.g., `/know:prepare src/` — defaults to project root)

**Main Objective**

Create both graph files (spec-graph.json and code-graph.json) and populate `.ai/know/project.md` with project intelligence.

**CRITICAL EXECUTION ORDER**

**MUST do spec-graph FIRST, then code-graph, then link, then validate, THEN project.md**

**⚠️ CRITICAL: GRAPH-FIRST APPROACH ⚠️**

The graph is the **SOURCE OF TRUTH** - build it first, then derive documentation from it.

**CORRECT APPROACH** ✅:
1. Create graph entities FIRST (users, objectives, features, components, modules)
2. Query the graph for intelligence (`know graph uses`, `know list --type`, `know graph check gap-summary`)
3. Derive project.md FROM graph queries
4. Graph is the foundation, project.md is the derived documentation

**Exploration Strategy**

**CRITICAL: Use parallel exploration to understand the codebase before building graphs**

1. **Launch Explore agent + custom Task agents in parallel** (single message with multiple Task calls):
   - **Explore agent (thoroughness: "very thorough")**: "Discover codebase architecture, patterns, dependencies, and organization"
   - **Task agent 1**: "Analyze package.json, README, docs to understand project purpose and users"
   - **Task agent 2**: "Scan imports/requires across codebase to map actual module dependencies"
   - **Task agent 3**: "Identify main features and their corresponding code modules"
   - Launch ALL agents in parallel for comprehensive understanding

2. **Consolidate findings** before creating graph entities

**Workflow**

1. Activate the know-tool skill to get access to graph operations

2. **Explore codebase in parallel** (see Exploration Strategy above)

3. **QA Batch Generation** — before building graphs, surface decisions the codebase doesn't answer:

   **Target: 35+ questions about the discovered codebase.**

   **Launch 8 Task agents in a SINGLE message** (parallel), each given the exploration results as context:

   **Agent 1 — Users & Objectives** (→ `user:*`, `objective:*` entities)
   > "You are analyzing an existing codebase: '[exploration summary]'. Generate 5 questions whose answers will directly become `user` and `objective` graph entities. A `user` is a distinct persona (e.g. user:developer, user:admin). An `objective` is what that user accomplishes (e.g. objective:manage-data). Ask: who are the distinct types of people this system is built for, what does each user type want to accomplish with this system, how do their goals or access levels differ, are there any secondary actors (scheduled jobs, webhooks, external systems), and what does success look like for each user type. Do NOT ask about scale, load, or performance."

   **Agent 2 — Features** (→ `feature:*` entities)
   > "You are analyzing an existing codebase: '[exploration summary]'. Generate 5 questions whose answers will directly become `feature` graph entities. A `feature` is a named system capability (e.g. feature:user-auth, feature:data-import, feature:report-generation). Ask: what are the distinct named capabilities visible in the code, which capabilities are clearly separate features vs implementation details, which of the discovered capabilities map to the core user objectives, are there partially-implemented features that should still be named, and which features appear to be shared infrastructure vs user-facing. Do NOT ask about scale, load, or performance."

   **Agent 3 — Actions & Operations** (→ `action:*`, `operation:*` entities)
   > "You are analyzing an existing codebase: '[exploration summary]'. Generate 5 questions whose answers will directly become `action` and `operation` graph entities. An `action` is a named user-initiated step (e.g. action:login, action:upload-file). An `operation` is an internal system step (e.g. operation:validate-token, operation:write-record). Ask: for each major feature in the code, what specific user-initiated steps can you identify, what internal processing steps occur for each user action, which operations are clearly reused across multiple features, what are the most complex workflows in the code, and what failure paths need to be represented as named operations. Do NOT ask about scale, load, or performance."

   **Agent 4 — Components** (→ `component:*` entities)
   > "You are analyzing an existing codebase: '[exploration summary]'. Generate 5 questions whose answers will directly become `component` graph entities. A `component` is a named implementation unit with a single responsibility (e.g. component:auth-handler, component:file-processor). Ask: what are the distinct implementation responsibilities visible in the codebase (classes, modules, services), which responsibilities are cohesive enough to be named components, what is the boundary of each candidate component (what goes in, what comes out), which components appear to be shared infrastructure used across features, and which components have external side effects (calls, writes, notifications). Do NOT ask about scale, load, or performance."

   **Agent 5 — Data Models** (→ `data-model:*` references)
   > "You are analyzing an existing codebase: '[exploration summary]'. Generate 5 questions whose answers will directly become `data-model` reference entries. Ask: what are the primary data entities visible in the code (name each and list their key fields), what are the relationships between those entities (foreign keys, embeds, joins), which entities are the most central to the system's domain, what is the lifecycle of the most important entity (created → updated → deleted/archived), and are there any data entities implied by the code that don't yet have clear schemas. Do NOT ask about scale, load, or performance."

   **Agent 6 — Interfaces & API Contracts** (→ `interface:*`, `api-contract:*` references)
   > "You are analyzing an existing codebase: '[exploration summary]'. Generate 5 questions whose answers will directly become `interface` and `api-contract` reference entries. Ask: what are the main screens or views in the UI code (name each), what API endpoints are defined (path, method, request/response shapes), what data does each screen display and where does it come from, what forms or input surfaces exist and what fields do they include, and are there any external API integrations where the contract is defined in the codebase. Do NOT ask about scale, load, or performance."

   **Agent 7 — Business Logic & Security** (→ `business-logic:*`, `security-spec:*` references)
   > "You are analyzing an existing codebase: '[exploration summary]'. Generate 5 questions whose answers will directly become `business-logic` and `security-spec` reference entries. Ask: what non-obvious domain rules are encoded in the logic (validation, approval gates, state machine transitions), how does the code enforce access control (role checks, ownership checks, permission guards), what data is treated as sensitive in the code (encrypted, masked, excluded from logs), what audit or activity logging exists, and what are the most complex conditional branches in the core workflow code. Do NOT ask about scale, load, or performance."

   **Agent 8 — Configuration & Constraints** (→ `configuration:*`, `constraint:*`, `acceptance-criterion:*` references)
   > "You are analyzing an existing codebase: '[exploration summary]'. Generate 5 questions whose answers will directly become `configuration`, `constraint`, and `acceptance-criterion` reference entries. Ask: what environment variables or config files does the codebase reference, are there any hard-coded limits or invariants in the code that should be captured as constraints, what does the test suite assert as the system's required behavior (these become acceptance criteria), what are the deployment or environment assumptions baked into the code, and what configuration is currently missing that the system clearly needs. Do NOT ask about scale, load, or performance."

   **Collect all results** into `.ai/know/qa/prepare-questions.md`:
   ```markdown
   # Prepare QA: [project name]
   _Each answer maps to a graph entity or reference. See type hints per section._

   ## 1. Users & Objectives  [→ user:*, objective:*]
   1. ...

   ## 2. Features  [→ feature:*]
   6. ...

   ## 3. Actions & Operations  [→ action:*, operation:*]
   11. ...

   ## 4. Components  [→ component:*]
   16. ...

   ## 5. Data Models  [→ data-model:*]
   21. ...

   ## 6. Interfaces & API Contracts  [→ interface:*, api-contract:*]
   26. ...

   ## 7. Business Logic & Security  [→ business-logic:*, security-spec:*]
   31. ...

   ## 8. Configuration & Constraints  [→ configuration:*, constraint:*, acceptance-criterion:*]
   36. ...

   ---
   _Answers:_
   ```

   **Present to user:**
   > "I've explored the codebase and generated [N] questions to clarify intent and design decisions before I build the spec and code graphs. Answer as many as you can — these will shape how I classify entities and relationships."

   **After user responds**: parse answers, proceed to graph creation with that context. Flag unresolved areas in entity descriptions.

**Create graph files** if they don't exist:
   - Create `.ai/know/spec-graph.json` with basic structure (meta, references, entities, graph)
   - Create `.ai/know/code-graph.json` with basic structure (meta, references, entities, graph)

4. **STEP 1: Populate spec-graph.json FIRST**:
   - Infer user objectives from README, docs, feature documentation
   - Create user, objective, feature, component entities
   - Map dependencies: user → objective → feature → component
   - Use default spec-graph rules (auto-detected)

   **Reference Enrichment — for every feature and component created:**
   References are the specification content. Entities are just structure. After creating each entity, immediately add relevant references from the codebase evidence.

   Check available types:
   ```bash
   know check ref-types                    # table with descriptions
   know check ref-types --filter <term>    # filter by name or description
   know gen rules describe references      # list type names
   know gen rules describe <type>          # detail on a specific type
   ```

   For each feature/component, infer and add references from code/docs:
   | Evidence found | Reference type to add |
   |---|---|
   | Config files, env vars, settings objects | `configuration` |
   | Data schemas, models, types | `data-model` |
   | Workflow rules, validation logic | `business-logic` |
   | README acceptance criteria, test assertions | `acceptance-criterion` |
   | UI screens, pages, views | `interface` |
   | API routes, request/response types | `api-contract` |
   | Auth checks, permission guards | `security-spec` |
   | Hard limits, invariants in code | `constraint` |

   ```bash
   know -g .ai/know/spec-graph.json add <type> <key> '{"description":"...",...}'
   know -g .ai/know/spec-graph.json link feature:<name> <type>:<key>
   ```

   A feature with zero reference dependencies is under-specified.

   - **Assign features to phases in `meta.phases`**:
     - Analyze feature maturity: Is it implemented? Partially done? Planned?
     - Use `pending` for unimplemented/planned features
     - Use `I`, `II`, `III` for prioritized implementation phases
     - Use `done` for fully implemented features
     - Set appropriate status: `incomplete`, `in-progress`, `review-ready`, `complete`
     - Example: `"meta.phases.done.feature:auth": {"status": "complete"}`

4. **STEP 2: Populate code-graph.json SECOND**:
   - **CRITICAL**: Use `-g .ai/know/code-graph.json` flag (auto-detects code rules)

   **Programmatic Code Graph Generation** (RECOMMENDED):
   1. **Generate codemap with AST parsing**:
      ```bash
      know gen codemap know/src --heat --output .ai/codemap.json
      ```

   2. **Generate code-graph from codemap** (preserves product-component refs!):
      ```bash
      know gen code-graph -c .ai/codemap.json -e .ai/know/code-graph.json -o .ai/know/code-graph.json
      ```

      **What this does:**
      - Parses codemap AST → generates modules/classes/functions
      - Adds file paths to all entities
      - **Preserves** product-component references (manually curated)
      - **Preserves** external-dep references (manually curated)
      - **Merges** detected imports with existing external deps

   3. **Verify code-graph quality**:
      ```bash
      know -g .ai/know/code-graph.json stats  # Should show >0 dependencies!
      know -g .ai/know/code-graph.json graph check ref-usage  # Check refs are used
      ```

   **Manual Code Graph Creation** (if codemap not available):
   1. **Scan actual imports first**: `rg "require\(|import |from " src/` to find real dependencies
   2. **Create module per file**: `module:auth-handler` (for auth-handler.js) - use actual file names
   3. **Link every import**: If file A imports B, run `know -g .ai/know/code-graph.json link module:A module:B`
   4. **Use packages for grouping**: `package:auth` contains multiple auth-related modules
   5. **Add classes/functions optionally**: `class:UserAuth`, `function:validateToken` within modules
   6. **Map external deps**: `external-dep:express` and link modules that use it
   7. **Verify non-zero dependencies**: Run `know -g .ai/know/code-graph.json stats` - should show >0 dependencies!

   **Cross-Graph code-link Creation**

   **After mapping existing code modules to spec features/components, create bidirectional code-link refs:**

   For each discovered spec↔code mapping:
   ```bash
   # Spec-graph side: feature → code entities
   know -g .ai/know/spec-graph.json add code-link <feature>-code '{"modules":["module:x"],"classes":[],"packages":[],"status":"complete"}'
   know -g .ai/know/spec-graph.json link feature:<name> code-link:<feature>-code

   # Code-graph side: module → spec entities
   know -g .ai/know/code-graph.json add code-link <module>-spec '{"feature":"feature:<name>","component":"","status":"complete"}'
   know -g .ai/know/code-graph.json link module:<name> code-link:<module>-spec
   ```

   After all mappings created, check coverage:
   ```bash
   know graph cross coverage --spec-graph .ai/know/spec-graph.json --code-graph .ai/know/code-graph.json
   ```

   **Use `know graph cross connect` to auto-connect any remaining unlinked entities:**
   ```bash
   know graph cross connect --spec-graph .ai/know/spec-graph.json --code-graph .ai/know/code-graph.json
   ```

5. **STEP 3: Link the two graphs**:
   - Add product-component references in code-graph to link modules → spec components

6. **STEP 4: Validate BOTH graphs (validation ≠ quality!)**:
   - `know -g .ai/know/spec-graph.json validate`
   - `know -g .ai/know/code-graph.json validate`
   - Ensure no errors before proceeding

   **CRITICAL**: Validation passing means structure is valid, NOT that the graph is useful!

   **Quality Checks** (do these AFTER validation):
   - `know -g .ai/know/spec-graph.json stats` - Check entity counts are reasonable (not just 2-3 entities)
   - `know -g .ai/know/code-graph.json stats` - **Dependencies MUST be >0** (otherwise graph is useless!)
   - `know -g .ai/know/code-graph.json ref-usage` - Check references are actually used
   - If dependencies = 0, you created entities but never linked them - go back and add links!

7. **STEP 5: Query the graphs to derive project.md content**:

   **CRITICAL**: The graphs are the SOURCE OF TRUTH. Query them, don't bypass them!

   **For Purpose section**:
   - `know -g .ai/know/spec-graph.json list-type user` - Who are the users?
   - `know -g .ai/know/spec-graph.json list-type objective` - What do users want?
   - Derive project purpose from user objectives, NOT from README

   **For Architecture section**:
   - `know -g .ai/know/spec-graph.json list-type feature` - What features exist?
   - `know -g .ai/know/code-graph.json list-type module` - What modules implement them?
   - `know -g .ai/know/code-graph.json uses --recursive feature:X` - Full dependency chains
   - Use dependency tree to structure architecture, NOT manual code analysis

   **For Tech Stack section**:
   - `know -g .ai/know/code-graph.json list-type external-dep` - All dependencies from graph
   - `know -g .ai/know/code-graph.json used-by external-dep:X` - See usage patterns

8. **STEP 6: Scan codebase for non-graph information**:

   **Project Conventions**:
   - Code style/formatting (ESLint, Prettier, Ruff, Black configs)
   - Naming conventions (file patterns, variable naming)
   - Testing strategy (test framework, coverage requirements)
   - Git workflow (branch naming from commit history, PR conventions)

   **Architecture Patterns**:
   - Design patterns in use (MVC, microservices, event-driven, etc.)
   - Architectural constraints (monorepo, serverless, specific frameworks)
   - Integration patterns (REST, GraphQL, message queues)

   **Technical Constraints**:
   - Performance requirements (response times, throughput)
   - Security requirements (authentication, authorization patterns)
   - Deployment constraints (platforms, environments)
   - Regulatory/compliance requirements

   **Common scan locations**:
   - `.eslintrc`, `.prettierrc`, `pyproject.toml` - Code style
   - `jest.config.js`, `pytest.ini` - Testing config
   - `.github/workflows/`, `CONTRIBUTING.md` - Git workflow
   - `docker-compose.yml`, `Dockerfile` - Deployment patterns
   - Recent commit messages - Conventions in practice

   **Remember**: Architecture, dependencies, and features come from the graph - query it, don't bypass it!

9. **STEP 7: Write project.md as a clean, high-level index**:

   **CRITICAL**: project.md is an INDEX, not a tutorial or graph dump!

   **Style Guidelines**:
   - Write in plain language for AI agents to understand the project
   - Include entity IDs as reference pointers (e.g., `user:developer`, `feature:cli`)
   - Reference graphs for structure and entity details
   - Keep concise - graphs hold the details

   **Include**:
   - **Purpose**: Plain language description + key users/objectives/features
   - **Tech Stack**: Language, frameworks, key dependencies (as entity IDs)
   - **Architecture Overview**: Plain language + core modules/packages/integration points
   - **Project Conventions**: Code style, testing strategy, git workflow (from STEP 6 scan)
   - **Architecture Patterns**: Design patterns, constraints, integration patterns (from STEP 6 scan)
   - **Important Constraints**: Technical, security, deployment requirements (from STEP 6 scan)
   - **Domain Context**: Business logic and data model references (as entity IDs)
   - **Graph Summary**: Simple stats (X entities) and validation status

   **Exclude**: Query examples, full entity listings, dependency trees, graph structure diagrams, know tool tutorials

   **Template**: Use clean template with entity ID references, refer users to know-tool skill for exploration

10. **Present results**:
   - Show spec-graph statistics (entity counts, dependencies)
   - Show code-graph statistics (entity counts, dependencies)
   - Display project.md summary
   - Confirm all files written successfully

11. **Validate graph coverage**:
   - Run `/know:connect` to check spec-graph coverage
   - Ensure all entities are connected to root users
   - If coverage < 100%, connect disconnected chains
   - Guide user on next steps

**Example Intelligence Gathering**

```bash
# Step 2.5: Populate the graph
know graph check stats                                 # Check if graph is empty/sparse
# If sparse, discover and add entities:
fd -e py -e js -e ts -e go                # Find code files
rg "class |function |const " --type-list  # Discover components
# Use know add to create entities for discovered items
know add component auth-handler '{"name":"Auth Handler","description":"..."}'
know add feature user-login '{"name":"User Login","description":"..."}'
know graph link feature:user-login component:auth-handler
know graph check validate                             # Ensure graph is valid

# Step 3: Graph intelligence
know graph check stats                    # Entity overview
know gen rules graph              # Dependency structure
know list --type user                  # User personas
know list --type objective             # User objectives
know graph check gap-summary              # Implementation status
know graph check usage                # Reference patterns

# Codebase intelligence
rg "description" package.json -A 1         # Project description
fd -t f "package.json|requirements.txt"    # Tech stack files
ls -d */                                   # Top-level structure
fd -g "*test*" -t d                        # Test directories
```

**Notes**
- Use the know-tool skill for all graph queries and modifications
- **Step 2.5 is critical**: If the graph is empty or has <5 entities, spend time discovering and populating it from the codebase
- Infer user objectives from README, feature documentation, and user-facing code
- Map components to features, features to user objectives
- Preserve user customizations - merge intelligently
- Ask user to confirm before replacing existing content
- Focus on actionable, specific information over generic templates
- Cross-reference graph entities with actual codebase structure
- Always validate the graph after populating it
- **Run `/know:connect` at the end** to ensure graph coverage and connectivity

---
`r5` - Reference lookup now uses `know check ref-types` and `know gen rules describe`
`r4` - QA Batch Generation phase (step 3): 8 parallel Task agents → 35+ questions → prepare-questions.md → iterate before graph creation
`r3` - Reference Enrichment: infer and add references from codebase evidence at entity creation time
`r2` - Added /know:connect step to validate graph coverage
`r1`
