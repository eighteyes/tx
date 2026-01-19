# TX-Core Dependency Documentation Index

This directory contains comprehensive documentation of module dependencies, imports, and architectural relationships.

## Documents Overview

### 1. **DEPENDENCY_MAP.md** (Main Reference)
**Size**: ~15KB | **Audience**: Architects, Tech Leads
**Contents**:
- Module-by-module breakdown (14 modules)
- External dependency list with versions
- Dependency patterns and practices
- Key dependency chains
- Critical paths through the system
- Module lifecycle and event flow

**Start here if you want**: Complete understanding of how modules relate and what they depend on.

---

### 2. **MODULE_RELATIONSHIPS.md** (Visual Guide)
**Size**: ~20KB | **Audience**: Developers, Visual Learners
**Contents**:
- ASCII dependency graphs
- Data flow diagrams
- Module grouping by function
- Dependency matrix and statistics
- Circular dependency check
- Import frequency analysis
- Module independence scoring
- Critical paths visualization

**Start here if you want**: Visual understanding of module relationships and execution flow.

---

### 3. **IMPORT_REFERENCE.md** (Quick Lookup)
**Size**: ~12KB | **Audience**: Developers, New Contributors
**Contents**:
- Import statements for every major module
- Usage examples with code
- Most common imports (38 files use logger!)
- External package reference table
- Node.js built-in usage
- Testing import patterns
- Quick reference table

**Start here if you want**: To understand how to import a specific module and what to use.

---

## Document Map

```
DEPENDENCY_MAP_INDEX.md (you are here)
    │
    ├─ DEPENDENCY_MAP.md
    │  ├── Overview (event-driven architecture)
    │  ├── 14 Core Modules
    │  │   ├─ CLI, Core, Queue, Worker
    │  │   ├─ State Machine, Mesh, Quality Gates
    │  │   ├─ Workspace, Storage, Server
    │  │   ├─ Providers, Tools, Controllers, Shared
    │  │   └─ Utilities
    │  ├── Dependency Graph (simplified)
    │  ├── External Dependencies
    │  └── Critical Dependency Chains
    │
    ├─ MODULE_RELATIONSHIPS.md
    │  ├── Visual Dependency Graphs
    │  ├── Data Flow Diagrams
    │  ├── Module Groupings (6 groups)
    │  ├── Dependency Matrix
    │  ├── Import Statistics
    │  ├── Critical Paths (3 paths)
    │  └── Architectural Decisions
    │
    └─ IMPORT_REFERENCE.md
        ├── Import Guide
        ├── Critical Imports (3 core)
        ├── Execution Path Imports
        ├── Configuration Imports
        ├── State Management
        ├── Quality & Storage
        ├── HTTP Server
        ├── Tools & Search
        ├── Utilities
        ├── External Packages
        ├── Import Patterns
        └── Quick Reference Table
```

---

## How to Use These Documents

### I'm New to TX-Core
1. Start with **MODULE_RELATIONSHIPS.md** - read the overview section
2. Look at "Core Execution Layer" and "Worker Execution Pipeline" diagrams
3. Check **IMPORT_REFERENCE.md** for how to import things

### I'm Debugging a Module
1. Go to **DEPENDENCY_MAP.md** - find your module section
2. Look at "Key Dependencies" and "Key Classes"
3. Check **MODULE_RELATIONSHIPS.md** for the dependency matrix

### I'm Adding a New Feature
1. Check **DEPENDENCY_MAP.md** for which modules you'll touch
2. Review **MODULE_RELATIONSHIPS.md** critical paths to understand execution order
3. Use **IMPORT_REFERENCE.md** to get correct import syntax

### I'm Investigating Performance Issues
1. **MODULE_RELATIONSHIPS.md** → "Critical Paths" section
2. **DEPENDENCY_MAP.md** → "Message Flow" section
3. Look for bottlenecks in the execution chains

### I'm Refactoring Dependencies
1. **MODULE_RELATIONSHIPS.md** → "Dependency Matrix" and "Circular Dependency Check"
2. **IMPORT_REFERENCE.md** → "Finding Imports in Your Module"
3. **DEPENDENCY_MAP.md** → "Key Dependency Patterns"

---

## Quick Stats

### Module Count
- **Total modules**: 14 major
- **Total files**: 120+ source files (excluding tests, node_modules)
- **External dependencies**: 12 NPM packages + Node.js builtins

### Import Frequency
| Rank | Module | Imports | Type |
|------|--------|---------|------|
| 1 | `shared/logger.ts` | 38 | Critical |
| 2 | `queue/index.ts` | 18 | Critical |
| 3 | `shared/types.ts` | 16 | Critical |
| 4 | `base-provider.ts` | 16 | Internal |
| 5 | `sdk-runner.ts` | 8 | Core |

### Most Common External Imports
- `yaml` (9 imports) - Config parsing
- `better-sqlite3` (6 imports) - Database
- `chokidar` (4 imports) - File watching
- `@anthropic-ai/claude-agent-sdk` (3 imports) - Agent SDK

### Circular Dependencies
✓ **None found** - Clean dependency graph

---

## Key Architectural Concepts

### 1. Event-Driven Execution
- File writes to `.ai/tx/msgs/` trigger consumer
- Chokidar watches for changes
- Messages inserted into SQLite queue
- Events emitted (core-message, worker-message)

**Document**: DEPENDENCY_MAP.md → "Message Flow" section

### 2. Ephemeral Workers
- Each agent task = new worker process
- Process starts, executes, writes response, exits
- No long-lived state in worker
- Session resumed from queue

**Document**: MODULE_RELATIONSHIPS.md → "Worker Execution Pipeline"

### 3. Shared Database
- Single SQLite instance shared between queue and FSM
- Queue stores messages
- FSM stores state
- Both use same DB connection

**Document**: DEPENDENCY_MAP.md → "Queue" section

### 4. Pluggable Quality Gates
- Registry pattern for gate lookup
- Composable stack (multiple gates)
- Custom gates can be added
- Evaluators are self-contained

**Document**: DEPENDENCY_MAP.md → "Quality Gates" section

### 5. Workspace Injection
- Task context injected into prompt
- Not passed through worker state
- File writes trigger re-consumption
- Enables workspace streaming

**Document**: DEPENDENCY_MAP.md → "Workspace" section

---

## Module Dependency Levels

### Level 0: Foundations (No dependencies)
- `shared/logger.ts` - Logging utility
- `shared/types.ts` - Type definitions
- `shared/colors.ts` - Terminal colors
- `shared/time.ts` - Time utilities

### Level 1: Core Services
- `queue/index.ts` - Message queue (depends: logger, better-sqlite3)
- `storage/` - Storage providers (depends: logger, ioredis optional)
- `providers/` - LLM providers (depends: logger, types)

### Level 2: Execution Services
- `worker/sdk-runner.ts` (depends: queue, logger, anthropic-sdk)
- `core/consumer.ts` (depends: queue, logger, chokidar, yaml)
- `mesh/fsm.ts` (depends: queue for persistence, logger, types)

### Level 3: Orchestration
- `worker/dispatcher.ts` (depends: level 2, workspace, quality, mesh)
- `server/` (depends: storage, session manager, worker pool)

### Level 4: CLI & Controllers
- `cli/` (depends: start, server, run handlers)
- `controllers/` (depends: validator, logger)

---

## Finding Things in the Code

### By Functionality
| I want to... | Start here |
|-------------|-----------|
| Understand message flow | DEPENDENCY_MAP.md → "Message Flow" |
| See how workers execute | MODULE_RELATIONSHIPS.md → "Worker Execution Pipeline" |
| Find where logging happens | IMPORT_REFERENCE.md → "shared/logger.ts" |
| Use the message queue | IMPORT_REFERENCE.md → "Message Queue" |
| Add a quality gate | DEPENDENCY_MAP.md → "Quality Gates" |
| Create a new search provider | DEPENDENCY_MAP.md → "Tools" |
| Configure storage | DEPENDENCY_MAP.md → "Storage" |
| Start the server | DEPENDENCY_MAP.md → "Server" |

### By Module Name
See **DEPENDENCY_MAP.md** which has a section for each:
- CLI, Core, Consumer, Queue, Worker, Dispatcher, SdkRunner
- Mesh (FSM), Quality Gates, Workspace, Storage, Server
- Providers, Tools, Controllers, Shared

### By Import Pattern
See **IMPORT_REFERENCE.md**:
- Logging imports
- Type imports
- Queue imports
- Worker imports
- And 12 more categories

---

## Dependencies Visualization

### Dependency Pyramid
```
                          CLI
                          ↓
        ┌──────────────────────────────────┐
        │  Core Layer (Consumer, Agent)    │
        │        Queue, Storage            │
        └──────────────────────────────────┘
                          ↓
        ┌──────────────────────────────────┐
        │  Worker Layer (Dispatcher, SDK)  │
        │  Workspace, Quality, FSM         │
        └──────────────────────────────────┘
                          ↓
        ┌──────────────────────────────────┐
        │  Service Layer (Tools, Search)   │
        │  Providers, Utilities            │
        └──────────────────────────────────┘
                          ↓
        ┌──────────────────────────────────┐
        │  Foundation (Logger, Types)      │
        │  Utilities, Node.js, External    │
        └──────────────────────────────────┘
```

### Cross-Cutting Concerns
These modules are used across multiple layers:
- **Logger** (38 imports) - Everywhere
- **Types** (16 imports) - Everywhere
- **Time utils** (5 imports) - Logging, FSM, Timing
- **Colors** (6 imports) - CLI output

---

## Code Navigation Tips

### Finding imports
```bash
# See what a file imports
grep "^import" src/worker/dispatcher.ts

# Find all files importing a module
grep -r "from.*queue/index" src

# Count imports of a module
grep -r "from.*queue/index" src | wc -l
```

### Understanding dependencies
1. Look up module in DEPENDENCY_MAP.md
2. Check "Key Dependencies" section
3. Look at diagram in MODULE_RELATIONSHIPS.md
4. See examples in IMPORT_REFERENCE.md

### Tracing execution flow
1. Start with CLI command in DEPENDENCY_MAP.md
2. Follow the arrow diagrams in MODULE_RELATIONSHIPS.md
3. Check critical paths section
4. Review "Message Flow" diagram

---

## Document Statistics

| Document | Lines | Sections | Tables | Diagrams |
|----------|-------|----------|--------|----------|
| DEPENDENCY_MAP.md | 650+ | 20+ | 5 | 2 |
| MODULE_RELATIONSHIPS.md | 800+ | 25+ | 8 | 10+ |
| IMPORT_REFERENCE.md | 500+ | 18+ | 3 | 1 |
| **Total** | **1950+** | **63+** | **16** | **13+** |

---

## Contributing & Maintaining

### When to Update These Docs

1. **Add a new module**
   - Add section to DEPENDENCY_MAP.md (Module List)
   - Update MODULE_RELATIONSHIPS.md (dependency matrix, groupings)
   - Add import examples to IMPORT_REFERENCE.md

2. **Change module dependencies**
   - Update the "Key Dependencies" section in DEPENDENCY_MAP.md
   - Update dependency matrix in MODULE_RELATIONSHIPS.md
   - Update import examples in IMPORT_REFERENCE.md

3. **Change message flow or execution path**
   - Update "Message Flow" diagram in DEPENDENCY_MAP.md
   - Update data flow in MODULE_RELATIONSHIPS.md
   - Update critical paths

4. **Add external dependency**
   - Add to external dependencies table in DEPENDENCY_MAP.md
   - Update import frequency analysis in MODULE_RELATIONSHIPS.md

---

## Related Documentation

This documentation complements:
- **IMPLEMENTATION_PLAN.md** - Phase roadmap
- **COMPARISON.md** - How TX compares to other systems
- **README.md** - Getting started guide
- **.claude/skills/mesh-builder/** - Mesh configuration guide

---

## Questions?

### Common Questions Answered In:

| Question | Document | Section |
|----------|----------|---------|
| How does message routing work? | DEPENDENCY_MAP.md | "Message Flow" |
| What's the fastest path to production? | MODULE_RELATIONSHIPS.md | "Critical Paths" |
| Can I reorder modules? | MODULE_RELATIONSHIPS.md | "Circular Dependency Check" |
| How do I add logging? | IMPORT_REFERENCE.md | "Shared Logger" |
| Where does state get stored? | DEPENDENCY_MAP.md | "Queue & Storage" |
| How are agents executed? | MODULE_RELATIONSHIPS.md | "Worker Execution Pipeline" |
| What's the execution order? | DEPENDENCY_MAP.md | "Typical Message Flow" |
| How do I write a new gate? | IMPORT_REFERENCE.md | "Quality Gates" |

---

**Last Updated**: 2026-01-18
**Document Version**: 1.0
**TX-Core Version**: 0.2.0

