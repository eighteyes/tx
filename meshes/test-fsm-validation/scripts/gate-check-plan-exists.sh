#!/bin/bash
# gate-check-plan-exists.sh - Entry gate for implementation state
# Validates that plan artifact exists BEFORE entering implementation

echo "Entry Gate: Checking if plan exists before implementation..."

PLAN_FILE="${WORKSPACE:-.}/.ai/output/plan.md"

if [ -f "$PLAN_FILE" ]; then
  echo "Entry Gate PASSED: Plan exists, can proceed to implementation"
  exit 0
else
  echo "Entry Gate FAILED: Must have plan before implementation"
  exit 1
fi
