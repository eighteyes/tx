#!/usr/bin/env bash
# compile-resolution.sh — Compile resolution.yaml from v2 pipeline artifacts
#
# Responsibilities:
#   - Read resolved-skeleton.yaml, turn-mechanics.yaml, dramaturg-guidance.yaml
#   - Compile a resolution summary consumed by narrator (via assemble-narrator.sh) and scribe
#   - Deterministic — no LLM judgment, pure data compilation
#
# Usage: compile-resolution.sh <workspace>
# Output: {workspace}/resolution.yaml

set -euo pipefail

WORKSPACE="${1:?Usage: compile-resolution.sh <workspace>}"

SKELETON="$WORKSPACE/resolved-skeleton.yaml"
MECHANICS="$WORKSPACE/turn-mechanics.yaml"
GUIDANCE="$WORKSPACE/dramaturg-guidance.yaml"
OUTPUT="$WORKSPACE/resolution.yaml"

log() { echo -e "\033[2m[compile-resolution]\033[0m $*" >&2; }

# Require skeleton and mechanics
if [[ ! -f "$SKELETON" ]]; then
  log "ERROR: resolved-skeleton.yaml not found at $SKELETON"
  exit 1
fi
if [[ ! -f "$MECHANICS" ]]; then
  log "ERROR: turn-mechanics.yaml not found at $SKELETON"
  exit 1
fi

log "Compiling resolution.yaml..."

# Extract turn number and seed from skeleton
TURN=$(yq -r '.turn // 0' "$SKELETON")
SEED=$(yq -r '.seed // 0' "$SKELETON")

# Extract trajectory status from guidance (if present)
TRAJECTORY_FIRED="null"
if [[ -f "$GUIDANCE" ]]; then
  # Check for firing trajectories — first one is the primary fired trajectory
  TRAJECTORY_FIRED=$(yq -r '
    .trajectory_status.firing[0].id // "null"
  ' "$GUIDANCE" 2>/dev/null || echo "null")
fi

# Determine if world acted — check if any world domain fired in any beat
WORLD_ACTED=$(yq -r '
  [.skeleton | to_entries[].value.world // {} | to_entries[].value]
  | map(select(. != null and . != ""))
  | length > 0
' "$SKELETON" 2>/dev/null || echo "false")

# Determine overall outcome type from character tier distribution
# Count tiers across all characters and beats, pick the most common
OUTCOME_TYPE=$(yq -r '
  [.skeleton | to_entries[].value | to_entries[]
   | select(.key != "secondary" and .key != "world")
   | .value.tier // empty]
  | group_by(.) | sort_by(-length) | .[0][0] // "mixed"
' "$SKELETON" 2>/dev/null || echo "mixed")

# Build per-beat summary combining skeleton + mechanics
# Uses jq for the complex merge
BEATS_JSON=$(yq -o json '.' "$SKELETON" | jq --argjson mechanics "$(yq -o json '.' "$MECHANICS")" '
  .skeleton | to_entries | map(
    .key as $beat_key |
    (.key | ltrimstr("beat_") | tonumber) as $beat_num |
    .value | to_entries | reduce .[] as $entry (
      {
        beat: $beat_num,
        function: null,
        world: {},
        trait_changes: [],
        condition_changes: [],
        bond_changes: []
      };
      if $entry.key == "world" then
        .world = $entry.value
      elif $entry.key == "secondary" then
        .
      else
        . + {
          ($entry.key): {
            tier: $entry.value.tier,
            register: $entry.value.register,
            collision: $entry.value.collision
          }
        }
      end
    ) |
    # Merge in mechanics for this beat
    . + {
      trait_changes: ($mechanics.running_state[$beat_key].trait_changes // []),
      condition_changes: ($mechanics.running_state[$beat_key].condition_changes // []),
      bond_changes: ($mechanics.running_state[$beat_key].bond_changes // [])
    }
  ) | map({("beat_\(.beat)"): del(.beat)}) | add // {}
')

# Build synthesis from outcome distribution
SYNTHESIS=$(yq -o json '.' "$SKELETON" | jq -r '
  .skeleton | to_entries | map(
    .key as $beat |
    .value | to_entries
    | map(select(.key != "secondary" and .key != "world"))
    | map("\(.key): \(.value.tier)/\(.value.register)")
    | join(", ")
    | "\($beat): \(.)"
  ) | join(". ")
')

# Assemble resolution.yaml
{
  echo "turn: $TURN"
  echo "seed: $SEED"
  echo "outcome_type: $OUTCOME_TYPE"
  echo "world_acted: $WORLD_ACTED"
  if [[ "$TRAJECTORY_FIRED" != "null" ]]; then
    echo "trajectory_fired: $TRAJECTORY_FIRED"
  else
    echo "trajectory_fired: null"
  fi
  echo ""
  echo "synthesis: >"
  echo "  $SYNTHESIS"
  echo ""
  echo "beats:"
  echo "$BEATS_JSON" | yq -P '.' | sed 's/^/  /'
} > "$OUTPUT"

log "Written $OUTPUT"
