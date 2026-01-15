#!/bin/bash
# on-enter-planning.sh - Executed when entering planning state
# Creates markers for FSM state tracking validation

echo "FSM: Entering PLANNING state"
echo "Current iteration: ${iteration:-0}"

# Create state marker for validation
mkdir -p "${WORKSPACE:-.}/.ai/fsm-markers"
echo "planning:$(date +%s)" > "${WORKSPACE:-.}/.ai/fsm-markers/current-state"

exit 0
