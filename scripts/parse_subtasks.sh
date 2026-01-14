#!/bin/bash
# Parse SUBTASK markers from agent output
# Sets: subtask_count (can be captured by FSM context)
#
# Reads from AGENT_OUTPUT env var or stdin
# Outputs: subtask_count=N (key=value format for FSM context capture)
#
# Example usage in FSM exit config:
#   exit:
#     run: [parse_subtasks]
#     set:
#       agent_count: "$subtask_count"
#     default: parallel-execution

set -euo pipefail

# Get output from env var or stdin
if [[ -n "${AGENT_OUTPUT:-}" ]]; then
    output="$AGENT_OUTPUT"
else
    output=$(cat)
fi

# Count SUBTASK markers (SUBTASK 1:, SUBTASK 2:, etc.)
count=$(echo "$output" | grep -c "SUBTASK [0-9]\+:" || echo "0")

# Debug output
echo "Found $count subtasks" >&2

# Output in key=value format for FSM context capture
echo "subtask_count=$count"
