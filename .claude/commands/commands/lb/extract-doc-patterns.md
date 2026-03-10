---
allowed-tools:
- Task(*)
- Write(.ai/lib-docs/*)
- Bash(mkdir:*)
- Read(.ai/lib-docs/*)
description: Extract documentation patterns into AI-friendly YAML rules with versioning
permalink: commands/lb/extract-doc-patterns
---

## Context

**Library/Framework to document**: $ARGUMENTS

**Existing lib docs**: !`ls -la .ai/lib-docs/ 2>/dev/null || echo "Directory does not exist yet"`

## Your task

Fetch documentation for the specified library and create comprehensive YAML event rules to help AI assistants work effectively with that library. Save the rules in `.ai/lib-docs/`.

### Process

1. **Setup directory if needed**:
   - Create `.ai/lib-docs/` if it doesn't exist

2. **Fetch library documentation**:
   - Use context7 MCP server to resolve library ID
   - Fetch comprehensive documentation with 8000+ tokens
   - Focus on practical usage patterns, common patterns, and best practices

3. **Generate YAML event rules**:
   - Create trigger-response patterns with optional conditions
   - Cover all major use cases and patterns from the documentation
   - Include common pitfalls and solutions
   - Organize by categories (basic usage, advanced patterns, troubleshooting, etc.)

4. **Save the output**:
   - Create versioned directory structure: `.ai/lib-docs/{library-name}/`
   - Save as `.ai/lib-docs/{library-name}/patterns-v{version}.yaml`
   - Create symlink `patterns-latest.yaml` pointing to newest version
   - Use kebab-case for directory and filenames

### YAML Rule Structure

The generated file should start with metadata:
```yaml
# Library Pattern Rules for {library-name}
# Version: {version if available}
# Generated: {ISO date}
# Source: {library ID from context7}
# Trust Score: {if available}
```

Each rule should follow this enhanced pattern:
```yaml
- trigger: "descriptive_trigger_name"
  condition: "optional condition when this applies"
  priority: 10  # Higher numbers = higher precedence (1-100)
  combines: ["other_trigger_1", "other_trigger_2"]  # Optional: rules that work together
  conflicts: ["conflicting_trigger"]  # Optional: mutually exclusive rules
  version: ">=2.0.0"  # Optional: version constraint
  response: |
    Clear actionable guidance
    Can be multiline with examples
```

### Categories to Include

Based on the library type, include relevant categories with clear priority levels:

**Core Patterns (Priority 80-100)**
- **Setup & Installation**: Initial configuration steps
- **Basic Usage**: Common patterns and simple examples
- **Components/API**: Main features and their usage

**Advanced Patterns (Priority 40-79)**
- **State Management**: If applicable
- **Data Handling**: Props, data flow, fetching
- **Styling/Theming**: Visual customization
- **Performance**: Optimization tips
- **Integration**: Working with other tools/libraries

**Support Patterns (Priority 1-39)**
- **Testing**: Test patterns specific to the library
- **Common Issues**: Troubleshooting and solutions
- **Best Practices**: Recommended patterns
- **Migration**: Version upgrade paths

### Rule Composition Examples

Show how rules work together:
```yaml
# Complex pattern composed of simpler ones
- trigger: "full_stack_form"
  combines: ["form_validation", "api_submission", "error_handling"]
  response: "See individual patterns and combine in sequence"

# Conflicting patterns
- trigger: "use_class_component"
  conflicts: ["use_functional_component"]
  version: "<=16.7.0"
  response: "Use class components for React versions before hooks"
```

### Output Requirements

1. **Comprehensive coverage**: Extract key patterns from documentation
2. **Practical focus**: Emphasize real-world usage over theory
3. **AI-friendly**: Rules should be clear triggers an AI can recognize
4. **Code examples**: Include inline code snippets where helpful
5. **Version aware**: Note any version-specific features

### Success Criteria

The generated rules should enable an AI to:
- Quickly identify the right approach for common tasks
- Avoid common pitfalls and anti-patterns
- Generate idiomatic code for the library
- Troubleshoot typical issues
- Understand the library's conventions and best practices

Generate the rules file now for: $ARGUMENTS