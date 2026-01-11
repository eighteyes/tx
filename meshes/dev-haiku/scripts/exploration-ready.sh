#!/bin/bash
# scripts/exploration-ready.sh
# Gate: Validate that worker completed exploration and created findings.md

FINDINGS="$TX_WORKSPACE/findings.md"

if [[ ! -f "$FINDINGS" ]]; then
  echo "ERROR: Worker did not create findings.md" >&2
  exit 1
fi

# Check minimum content (at least 5 lines)
LINE_COUNT=$(wc -l < "$FINDINGS" 2>/dev/null || echo 0)
if [[ $LINE_COUNT -lt 5 ]]; then
  echo "ERROR: findings.md too short ($LINE_COUNT lines, need at least 5)" >&2
  exit 1
fi

echo "EXPLORATION_VALIDATED=true"
exit 0
