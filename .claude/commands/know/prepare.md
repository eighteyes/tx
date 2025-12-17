---
name: Know: Prepare Project
description: Create graph files and populate project.md with context from the codebase
category: Know
tags: [know, prepare, analysis]
---

**Main Objective**

Create both graph files (spec-graph.json and code-graph.json) and populate `.ai/know/project.md` with project intelligence.

**CRITICAL EXECUTION ORDER**

**MUST do spec-graph FIRST, then code-graph, then link, then validate, THEN project.md**

**⚠️ CRITICAL: GRAPH-FIRST APPROACH ⚠️**

The graph is the **SOURCE OF TRUTH** - build it first, then derive documentation from it.

**CORRECT APPROACH** ✅:
1. Create graph entities FIRST (users, objectives, features, components, modules)
2. Query the graph for intelligence (`know uses`, `know list-type`, `know gap-summary`)
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

3. **Create graph files** if they don't exist:
   - Create `.ai/spec-graph.json` with basic structure (meta, references, entities, graph)
   - Create `.ai/code-graph.json` with basic structure (meta, references, entities, graph)

3. **STEP 1: Populate spec-graph.json FIRST**:
   - Infer user objectives from README, docs, feature documentation
   - Create user, objective, feature, component entities
   - Map dependencies: user → objective → feature → component
   - Use default spec-graph rules (auto-detected)

4. **STEP 2: Populate code-graph.json SECOND**:
   - **CRITICAL**: Use `-g .ai/code-graph.json` flag (auto-detects code rules)

   **Code Graph Common Mistakes to Avoid**:
   - ❌ Creating high-level "system" modules instead of actual files
   - ❌ Creating entities but never linking them (0 dependencies = useless graph!)
   - ❌ Using vague names like `module:auth-system` instead of `module:auth-handler` (actual file)
   - ❌ Skipping import/dependency scanning
   - ❌ Leaving references unused/unconnected

   **Correct Approach**:
   1. **Scan actual imports first**: `rg "require\(|import |from " src/` to find real dependencies
   2. **Create module per file**: `module:auth-handler` (for auth-handler.js), NOT `module:auth-system`
   3. **Link every import**: If file A imports B, run `know -g .ai/code-graph.json link module:A module:B`
   4. **Use packages for grouping**: `package:auth` contains multiple auth-related modules
   5. **Add classes/functions optionally**: `class:UserAuth`, `function:validateToken` within modules
   6. **Map external deps**: `external-dep:express` and link modules that use it
   7. **Verify non-zero dependencies**: Run `know -g .ai/code-graph.json stats` - should show >0 dependencies!

5. **STEP 3: Link the two graphs**:
   - Add product-component references in code-graph to link modules → spec components

6. **STEP 4: Validate BOTH graphs (validation ≠ quality!)**:
   - `know -g .ai/spec-graph.json validate`
   - `know -g .ai/code-graph.json validate`
   - Ensure no errors before proceeding

   **CRITICAL**: Validation passing means structure is valid, NOT that the graph is useful!

   **Quality Checks** (do these AFTER validation):
   - `know -g .ai/spec-graph.json stats` - Check entity counts are reasonable (not just 2-3 entities)
   - `know -g .ai/code-graph.json stats` - **Dependencies MUST be >0** (otherwise graph is useless!)
   - `know -g .ai/code-graph.json ref-usage` - Check references are actually used
   - If dependencies = 0, you created entities but never linked them - go back and add links!

7. **STEP 5: Query the graphs to derive project.md content**:

   **CRITICAL**: The graphs are the SOURCE OF TRUTH. Query them, don't bypass them!

   **For Purpose section**:
   - `know -g .ai/spec-graph.json list-type user` - Who are the users?
   - `know -g .ai/spec-graph.json list-type objective` - What do users want?
   - Derive project purpose from user objectives, NOT from README

   **For Architecture section**:
   - `know -g .ai/spec-graph.json list-type feature` - What features exist?
   - `know -g .ai/code-graph.json list-type module` - What modules implement them?
   - `know -g .ai/code-graph.json uses --recursive feature:X` - Full dependency chains
   - Use dependency tree to structure architecture, NOT manual code analysis

   **For Tech Stack section**:
   - `know -g .ai/code-graph.json list-type external-dep` - All dependencies from graph
   - `know -g .ai/code-graph.json used-by external-dep:X` - See usage patterns

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
   - Avoid duplicating graph structure or listing all entities
   - Don't include query examples or know command tutorials
   - Keep it concise - details are in the graphs, not here

   **What to include**:
   - **Purpose**: Plain language description + list key users/objectives/features
   - **Tech Stack**: Language, frameworks, key dependencies (as entity IDs)
   - **Architecture Overview**: Plain language + core modules/packages/integration points
   - **Project Conventions**: Code style, testing strategy, git workflow (from STEP 6 scan)
   - **Architecture Patterns**: Design patterns, constraints, integration patterns (from STEP 6 scan)
   - **Important Constraints**: Technical, security, deployment requirements (from STEP 6 scan)
   - **Domain Context**: Business logic and data model references (as entity IDs)
   - **Graph Summary**: Simple stats (X entities) and validation status

   **What NOT to include**:
   - Query examples or know command usage
   - Full entity listings or dependency trees
   - Duplicated objectives/features for multiple users
   - Graph structure diagrams or chains
   - Tutorial content about the know tool

   **Template**: Use clean template with entity ID references, refer users to know-tool skill for exploration

10. **Present results**:
   - Show spec-graph statistics (entity counts, dependencies)
   - Show code-graph statistics (entity counts, dependencies)
   - Display project.md summary
   - Confirm all files written successfully

**Example Intelligence Gathering**

```bash
# Step 2.5: Populate the graph
know stats                                 # Check if graph is empty/sparse
# If sparse, discover and add entities:
fd -e py -e js -e ts -e go                # Find code files
rg "class |function |const " --type-list  # Discover components
# Use know add to create entities for discovered items
know add component:auth-handler '{"name":"Auth Handler","description":"..."}'
know add feature:user-login '{"name":"User Login","description":"..."}'
know link feature:user-login component:auth-handler
know validate                             # Ensure graph is valid

# Step 3: Graph intelligence
know stats                    # Entity overview
know rules graph              # Dependency structure
know list-type user           # User personas
know list-type objective      # User objectives
know gap-summary              # Implementation status
know ref-usage                # Reference patterns

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
- Don't overwrite user customizations - merge intelligently
- Ask user to confirm before replacing existing content
- Focus on actionable, specific information over generic templates
- Cross-reference graph entities with actual codebase structure
- Always validate the graph after populating it
