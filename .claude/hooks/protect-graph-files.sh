#!/bin/bash
# protect-graph-files.sh
# Prevents direct mutation of graph files (Edit/Write, jq/sed/awk, output redirection)
# Allows read-only operations (Read tool, cat, grep, head, tail)
# Enforces use of know CLI for all graph modifications

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Function to check if path matches graph file pattern
is_graph_file() {
    local path="$1"
    [[ "$path" == *"-graph.json" ]] || \
    [[ "$path" == */spec-graph.json ]] || \
    [[ "$path" == */code-graph.json ]]
}

# Function to show error message
show_graph_protection_error() {
    local target="$1"
    cat >&2 <<EOF
❌ Direct mutation of graph files is not allowed

Target: $target

⚠️  Use the know CLI for modifications:
   • Add/update: know add <type> <key> <data>
   • Link: know link <from> <to> [<to2>...]
   • Unlink: know unlink <from> <to> [<to2>...]
   • Delete: know nodes delete <id>
   • Rename: know nodes rename <id> <new-key>
   • Validate: know check validate

ℹ️  Read-only operations are allowed:
   • Read tool, cat, grep, head, tail

📚 See: /know-tool skill or CLAUDE.md for graph operations

This hook prevents accidental corruption of the graph structure.
Use the know CLI commands which ensure graph integrity.
EOF
}

# Check Edit/Write file_path (Read is allowed for inspection)
if is_graph_file "$FILE_PATH" && [[ "$TOOL_NAME" =~ ^(Edit|Write)$ ]]; then
    show_graph_protection_error "$FILE_PATH"
    exit 2  # Exit 2 = block the action
fi

# Check Bash commands for mutation operations on graph files
if [[ "$TOOL_NAME" == "Bash" && -n "$COMMAND" ]]; then
    # Block mutation commands: jq (can mutate), sed, awk
    if echo "$COMMAND" | grep -qE '\b(jq|sed|awk)\b.*(-graph\.json|/spec-graph\.json|/code-graph\.json)'; then
        show_graph_protection_error "bash: $COMMAND"
        exit 2
    fi

    # Block output redirection to graph files
    if echo "$COMMAND" | grep -qE '>\s*[^>]*(-graph\.json|/spec-graph\.json|/code-graph\.json)'; then
        show_graph_protection_error "bash: $COMMAND (output redirection blocked)"
        exit 2
    fi
fi

# Allow all other file operations
exit 0
