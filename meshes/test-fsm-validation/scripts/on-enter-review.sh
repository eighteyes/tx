#!/bin/bash
# on-enter-review.sh - Executed when entering review state
# Creates markers for FSM state tracking validation

echo "FSM: Entering REVIEW state"
echo "Current iteration: ${iteration:-0}"
echo "Previous checkpoints: ${checkpoints:-none}"

# Create state marker for validation
mkdir -p "${WORKSPACE:-.}/.ai/fsm-markers"
echo "review:$(date +%s)" > "${WORKSPACE:-.}/.ai/fsm-markers/current-state"

exit 0
