#!/bin/bash
# gate-check-code-exists.sh - Entry gate for review state
# Validates that code artifact exists BEFORE entering review

echo "Entry Gate: Checking if code exists before review..."

CODE_FILE="${WORKSPACE:-.}/.ai/output/code.md"

if [ -f "$CODE_FILE" ]; then
  echo "Entry Gate PASSED: Code exists, can proceed to review"
  exit 0
else
  echo "Entry Gate FAILED: Must have code before review"
  exit 1
fi
