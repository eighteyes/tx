#!/bin/bash
# scripts/review-passed.sh
# Gate: Validate that reviewer created review.md with APPROVED verdict

REVIEW="$TX_WORKSPACE/review.md"

if [[ ! -f "$REVIEW" ]]; then
  echo "ERROR: Reviewer did not create review.md" >&2
  exit 1
fi

# Check for APPROVED keyword
if ! grep -q "APPROVED" "$REVIEW"; then
  echo "ERROR: Review does not contain APPROVED status" >&2
  exit 1
fi

# Extract score if present
SCORE=$(grep -i "score:" "$REVIEW" | head -1 | awk '{print $NF}' || echo "N/A")

echo "REVIEW_SCORE=$SCORE"
echo "REVIEW_PASSED=true"
exit 0
