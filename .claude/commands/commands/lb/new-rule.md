---
allowed-tools: Read(*), Write(.claude/rules), Edit(.claude/settings.json), Bash(chmod:*)
description: Create enforced rule with script and hook configuration
permalink: commands/lb/new-rule
---

Create an enforced or guidance rule from context or arguments: $ARGUMENTS

## Rule Creation Process

1. **Analyze the rule need** - What behavior needs to be enforced?
2. **Determine enforcement method** - Can this be enforced programmatically?
3. **Create enforcement script** - Write executable rule validation
4. **Configure hook** - Add to .claude/settings.json
5. **Test the rule** - Verify enforcement works

## Rule Types

**Enforceable Rules** (preferred):
- Tool usage patterns (python must use venv)
- File operations (naming, structure, permissions)
- Command execution (security, environment)
- Code patterns (imports, functions, style)

**Guidance Rules** (fallback):
- Complex decision-making guidance
- Context-specific advice
- Non-deterministic behaviors

## Enforcement Script Template

```bash
#!/bin/bash
# Rule enforcement: [RULE_NAME]
# Triggered on: [TOOL_NAME] tool executing [PATTERN]

COMMAND="$1"

# Check if rule applies
if [[ "$COMMAND" == *"[PATTERN]"* ]]; then
    # Validation logic
    if [[ VIOLATION_CONDITION ]]; then
        echo "ERROR: [RULE_NAME] violation"
        echo "Command: $COMMAND"
        echo "RULE: [RULE_DESCRIPTION]"
        echo "Solutions:"
        echo "1. [SOLUTION_1]"
        echo "2. [SOLUTION_2]"
        exit 1
    fi
    echo "✓ [RULE_NAME] compliance verified"
fi

exit 0
```

## Hook Configuration Template

```json
{
  "matcher": "[TOOL_NAME]([PATTERN]:*)",
  "hooks": [
    {
      "type": "command",
      "command": "./.claude/rule-scripts/[RULE_SCRIPT].sh"
    }
  ]
}
```

## Process
1. Create enforcement script at `.claude/rule-scripts/[rule-name].sh`
2. Make script executable
3. Add hook configuration to `.claude/settings.json`
4. Test rule enforcement
1. If needed, Create fallback guidance rule at `.cdlaude/rules/[rule-name}.md`

ALWAYS prefer enforcement over guidance.