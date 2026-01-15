#!/bin/bash
# gate-plan-ready.sh - Exit gate for planning state
# Checks if the planner has created required output

echo "Gate: Checking if plan is ready..."

PLAN_FILE="${WORKSPACE:-.}/.ai/output/plan.md"

if [ -f "$PLAN_FILE" ]; then
  echo "Gate PASSED: Plan file exists at $PLAN_FILE"
  exit 0
else
  echo "Gate FAILED: Plan file not found at $PLAN_FILE"
  exit 1
fi
