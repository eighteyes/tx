#!/bin/bash
# scripts/init.sh
# Initialize workspace for dev-haiku workflow

set -e

# Create workspace structure
mkdir -p "$TX_WORKSPACE"

# Initialize context tracking file
touch "$TX_WORKSPACE/.fsm-context"

# Log initialization
echo "Workspace initialized at $TX_WORKSPACE" >&2

exit 0
