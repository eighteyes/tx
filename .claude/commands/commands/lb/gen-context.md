---
allowed-tools:
- Write(*)
- Read(*)
- LS(*)
- Bash(find *)
description: Generate ai-context.sh script for any project - detects tech stack and
  extracts commands
permalink: commands/lb/gen-context
---

## Context

**Current directory**: !`pwd`

**Project files**: !`find . -maxdepth 2 -name "package.json" -o -name "requirements.txt" -o -name "pyproject.toml" -o -name "setup.py" -o -name "Cargo.toml" -o -name "go.mod" -o -name "pom.xml" -o -name "Makefile" -o -name "docker-compose.yml" -o -name "Dockerfile" -o -name "*.sh"`

## Your task

Generate a generic `ai-context.sh` script that dynamically detects the current project's tech stack and extracts actionable commands. Extract information that would be useful for an LLM building this system. Favor dynamic information lookups, use static information as a fallback. Arguments: $ARGUMENTS

### Script Features

The generated script must:
1. **Detect tech stack** from project files (package.json, requirements.txt, etc.)
2. **Extract npm scripts** from package.json
3. **Detect Python tools** and common commands
4. **Parse Makefile targets** 
5. **Show Docker commands** if present
6. **Extract shell script commands** from case statements
7. **Show git configuration** and recent activity
8. **Validate project structure**

### Template Script

Create `scripts/ai-context.sh` with the following structure:

```bash
#!/bin/bash
# AI Context Generator - Generic project context detection

set -e

# Helper functions for different project types
detect_tech_stack() {
    # Check for project files and infer tech stack
}

extract_npm_scripts() {
    # Parse package.json scripts section
}

extract_python_tools() {
    # Detect Python tools and common commands
}

extract_makefile_targets() {
    # Parse Makefile targets
}

extract_docker_commands() {
    # Show Docker/compose commands
}

extract_commands_from_script() {
    # Parse shell script case statements
}

# Main output sections:
# 1. Tech Stack (detected)
# 2. Available Commands (extracted from files)
# 3. Git Configuration
# 4. Project Structure
# 5. Recent Activity
# 6. Validation
```

### Implementation Notes

- **Make it executable**: `chmod +x ai-context.sh`
- **Error handling**: Use `set -e` and proper error checks
- **Generic**: Should work on any project type
- **Actionable**: Focus on commands, not descriptions
- **Dynamic**: Actually parse files, don't hardcode

### Success Criteria

The script should:
- Run without errors on any project
- Show relevant commands for the detected tech stack
- Adapt output based on what files are present
- Provide actionable information for AI agents

Generate the complete script now.

Add a loader pointing to this script in the early section of 'CLAUDE.md', refer to the loader format in that file as an example.