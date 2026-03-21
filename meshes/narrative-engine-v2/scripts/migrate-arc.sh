#!/usr/bin/env bash
set -euo pipefail

ARC_FILE="${1:?Usage: migrate-arc.sh <arc.yaml>}"

[[ -f "$ARC_FILE" ]] || { echo "File not found: $ARC_FILE" >&2; exit 1; }

# Read, transform, write back
yq -o json "$ARC_FILE" | jq '
  # Collect seeds_turn_X entries into seed_history array
  [to_entries[] | select(.key | startswith("seeds_turn_")) |
   {turn: (.key | ltrimstr("seeds_turn_") | tonumber), data: .value}
  ] as $seed_hist |

  # Collect questions_turn_X entries into question_history array
  [to_entries[] | select(.key | startswith("questions_turn_")) |
   {turn: (.key | ltrimstr("questions_turn_") | tonumber), questions: .value}
  ] as $question_hist |

  # Remove old dynamic keys, add new arrays
  with_entries(select(.key | (startswith("seeds_turn_") or startswith("questions_turn_")) | not)) |
  (if ($seed_hist | length) > 0 then .seed_history = $seed_hist else . end) |
  (if ($question_hist | length) > 0 then .question_history = $question_hist else . end)
' | yq -P > "${ARC_FILE}.migrated"

mv "${ARC_FILE}.migrated" "$ARC_FILE"
echo "Migrated: $ARC_FILE" >&2
