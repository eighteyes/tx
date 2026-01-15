#!/bin/bash
# gate-code-ready.sh - Exit gate for implementation state
# Checks if the implementer has created required output

echo "Gate: Checking if code is ready..."

CODE_FILE="${WORKSPACE:-.}/.ai/output/code.md"

if [ -f "$CODE_FILE" ]; then
  echo "Gate PASSED: Code file exists at $CODE_FILE"
  exit 0
else
  echo "Gate FAILED: Code file not found at $CODE_FILE"
  exit 1
fi
