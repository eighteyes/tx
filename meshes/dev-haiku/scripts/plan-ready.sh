#!/bin/bash
# scripts/plan-ready.sh
# Gate: Validate that coordinator created plan.md

PLAN="$TX_WORKSPACE/plan.md"

if [[ ! -f "$PLAN" ]]; then
  echo "ERROR: Coordinator did not create plan.md" >&2
  exit 1
fi

# Check minimum content (at least 3 lines)
LINE_COUNT=$(wc -l < "$PLAN" 2>/dev/null || echo 0)
if [[ $LINE_COUNT -lt 3 ]]; then
  echo "ERROR: plan.md too short ($LINE_COUNT lines, need at least 3)" >&2
  exit 1
fi

echo "PLAN_VALIDATED=true"
exit 0
