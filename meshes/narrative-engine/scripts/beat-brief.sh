#!/usr/bin/env bash
# beat-brief.sh — Assemble information-isolated Task input for a single character beat
#
# Responsibilities:
# - Extract character tier/register/collision from resolved-skeleton.yaml
# - Look up full primary collision detail from collisions.yaml
# - Extract secondary collisions (brief: id + note only)
# - Extract world results for this beat from resolved-skeleton.yaml
# - Accumulate prior_mechanics from turn-mechanics.yaml (beats before current)
# - Output compact YAML brief to stdout
#
# Usage: beat-brief.sh <workspace> <beat> <character>

set -euo pipefail

# ─────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────

show_help() {
  cat >&2 <<'USAGE'
beat-brief.sh — Assemble information-isolated beat brief for a character

Usage:
  beat-brief.sh <workspace> <beat> <character>

Arguments:
  workspace   Path to turn workspace directory
  beat        Beat number (integer, 1-based)
  character   Character ID (e.g., character_a, character_b)

Output:
  YAML document to stdout containing:
    - Beat number and character ID
    - Tier and register from resolved-skeleton
    - Full primary collision detail from collisions.yaml
    - Secondary collisions (id + note) attached to this character
    - World results for this beat
    - Prior mechanics (cumulative changes from beats before this one)

Files read:
  <workspace>/resolved-skeleton.yaml
  <workspace>/collisions.yaml
  <workspace>/turn-mechanics.yaml

USAGE
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --help|-h) show_help ;;
  esac
done

# ─────────────────────────────────────────────
# ARGS
# ─────────────────────────────────────────────

WORKSPACE="${1:?Usage: beat-brief.sh <workspace> <beat> <character>}"
BEAT="${2:?Usage: beat-brief.sh <workspace> <beat> <character>}"
CHARACTER="${3:?Usage: beat-brief.sh <workspace> <beat> <character>}"

SKELETON="$WORKSPACE/resolved-skeleton.yaml"
COLLISIONS="$WORKSPACE/collisions.yaml"
MECHANICS="$WORKSPACE/turn-mechanics.yaml"

# ─────────────────────────────────────────────
# ERROR HELPERS
# ─────────────────────────────────────────────

err_yaml() {
  local msg="$1"
  cat >&2 <<EOF
error:
  script: beat-brief.sh
  message: "$msg"
  workspace: "$WORKSPACE"
  beat: $BEAT
  character: "$CHARACTER"
EOF
  exit 1
}

# ─────────────────────────────────────────────
# VALIDATE INPUTS
# ─────────────────────────────────────────────

if [[ ! -f "$SKELETON" ]]; then
  err_yaml "resolved-skeleton.yaml not found"
fi

if [[ ! -f "$COLLISIONS" ]]; then
  err_yaml "collisions.yaml not found"
fi

BEAT_KEY="beat_${BEAT}"

# Verify character exists in this beat's skeleton
CHAR_EXISTS=$(yq -r ".skeleton.${BEAT_KEY}.${CHARACTER} // \"__missing__\"" "$SKELETON")
if [[ "$CHAR_EXISTS" == "__missing__" || "$CHAR_EXISTS" == "null" ]]; then
  err_yaml "Character '${CHARACTER}' not found in skeleton for ${BEAT_KEY}"
fi

# ─────────────────────────────────────────────
# EXTRACT FROM SKELETON
# ─────────────────────────────────────────────

TIER=$(yq -r ".skeleton.${BEAT_KEY}.${CHARACTER}.tier" "$SKELETON")
REGISTER=$(yq -r ".skeleton.${BEAT_KEY}.${CHARACTER}.register" "$SKELETON")
COLLISION_ID=$(yq -r ".skeleton.${BEAT_KEY}.${CHARACTER}.collision // \"\"" "$SKELETON")

# ─────────────────────────────────────────────
# EXTRACT PRIMARY COLLISION
# ─────────────────────────────────────────────

COLLISION_YAML=""
if [[ -n "$COLLISION_ID" && "$COLLISION_ID" != "null" ]]; then
  COLLISION_YAML=$(yq -r "
    .collisions[] | select(.id == \"${COLLISION_ID}\")
  " "$COLLISIONS" 2>/dev/null) || true

  if [[ -z "$COLLISION_YAML" || "$COLLISION_YAML" == "null" ]]; then
    echo "WARNING: Collision '${COLLISION_ID}' not found in collisions.yaml" >&2
    COLLISION_YAML=""
  fi
fi

# ─────────────────────────────────────────────
# EXTRACT SECONDARY COLLISIONS
# ─────────────────────────────────────────────

SECONDARY_YAML=$(yq -r "
  .skeleton.${BEAT_KEY}.secondary // [] |
  [ .[] | select(.attach_to == \"${CHARACTER}\") | {\"id\": .id, \"note\": (.note // \"\")} ]
" "$SKELETON" 2>/dev/null) || SECONDARY_YAML="[]"

# ─────────────────────────────────────────────
# EXTRACT WORLD RESULTS
# ─────────────────────────────────────────────

WORLD_YAML=$(yq -r ".skeleton.${BEAT_KEY}.world" "$SKELETON" 2>/dev/null) || WORLD_YAML="null"

# ─────────────────────────────────────────────
# ACCUMULATE PRIOR MECHANICS
# ─────────────────────────────────────────────

PRIOR_TRAIT_CHANGES="[]"
PRIOR_CONDITION_CHANGES="[]"
PRIOR_BOND_CHANGES="[]"

if [[ -f "$MECHANICS" && "$BEAT" -gt 1 ]]; then
  LAST_PRIOR=$((BEAT - 1))

  # Build yq expression to concatenate arrays from beat_1..beat_(N-1)
  TRAIT_EXPR="[]"
  COND_EXPR="[]"
  BOND_EXPR="[]"
  for ((b=1; b<=LAST_PRIOR; b++)); do
    BKEY="beat_${b}"
    TRAIT_EXPR="${TRAIT_EXPR} + (.running_state.${BKEY}.trait_changes // [])"
    COND_EXPR="${COND_EXPR} + (.running_state.${BKEY}.condition_changes // [])"
    BOND_EXPR="${BOND_EXPR} + (.running_state.${BKEY}.bond_changes // [])"
  done

  PRIOR_TRAIT_CHANGES=$(yq -o json "${TRAIT_EXPR}" "$MECHANICS" 2>/dev/null) || PRIOR_TRAIT_CHANGES="[]"
  PRIOR_CONDITION_CHANGES=$(yq -o json "${COND_EXPR}" "$MECHANICS" 2>/dev/null) || PRIOR_CONDITION_CHANGES="[]"
  PRIOR_BOND_CHANGES=$(yq -o json "${BOND_EXPR}" "$MECHANICS" 2>/dev/null) || PRIOR_BOND_CHANGES="[]"
fi

# ─────────────────────────────────────────────
# ENRICH SECONDARY NOTES FROM COLLISIONS
# ─────────────────────────────────────────────

# For each secondary, if note is empty, pull from collisions.yaml
ENRICHED_SECONDARY="$SECONDARY_YAML"
if [[ "$SECONDARY_YAML" != "[]" && -f "$COLLISIONS" ]]; then
  ENRICHED_SECONDARY=$(yq -r '
    . as $secs |
    [ $secs[] |
      . as $s |
      if (.note == "" or .note == null) then
        .id as $sid |
        $s * {"note": ""}
      else .
      end
    ]
  ' <<< "$SECONDARY_YAML" 2>/dev/null) || ENRICHED_SECONDARY="$SECONDARY_YAML"

  # Pull notes from collisions file for entries with empty notes
  SEC_COUNT=$(yq -r '. | length' <<< "$ENRICHED_SECONDARY" 2>/dev/null) || SEC_COUNT=0
  if [[ "$SEC_COUNT" -gt 0 ]]; then
    for ((i=0; i<SEC_COUNT; i++)); do
      NOTE=$(yq -r ".[$i].note" <<< "$ENRICHED_SECONDARY" 2>/dev/null) || NOTE=""
      if [[ -z "$NOTE" || "$NOTE" == "null" || "$NOTE" == "" ]]; then
        SID=$(yq -r ".[$i].id" <<< "$ENRICHED_SECONDARY" 2>/dev/null) || continue
        CNOTE=$(yq -r ".collisions[] | select(.id == \"${SID}\") | .note // \"\"" "$COLLISIONS" 2>/dev/null) || CNOTE=""
        if [[ -n "$CNOTE" && "$CNOTE" != "null" ]]; then
          ENRICHED_SECONDARY=$(yq -r ".[$i].note = \"${CNOTE}\"" <<< "$ENRICHED_SECONDARY" 2>/dev/null) || true
        fi
      fi
    done
  fi
fi

# ─────────────────────────────────────────────
# OUTPUT
# ─────────────────────────────────────────────

echo "# Beat brief for ${CHARACTER}, beat ${BEAT}"

# Base fields
yq -n "
  .beat = ${BEAT} |
  .character = \"${CHARACTER}\" |
  .tier = \"${TIER}\" |
  .register = \"${REGISTER}\"
"

# Primary collision
if [[ -n "$COLLISION_YAML" ]]; then
  echo ""
  echo "# Primary collision — full detail from collisions.yaml"
  echo "collision:"
  echo "$COLLISION_YAML" | yq -r '
    "  id: " + .id,
    "  elements:",
    (.elements // [] | .[] | "    - " + .),
    "  pressure: " + (.pressure // ""),
    "  valence: " + (.valence // ""),
    "  note: " + (.note // "" | @json)
  ' 2>/dev/null
else
  echo ""
  echo "collision: null"
fi

# Secondary collisions
SEC_LEN=$(yq -r '. | length' <<< "$ENRICHED_SECONDARY" 2>/dev/null) || SEC_LEN=0
if [[ "$SEC_LEN" -gt 0 ]]; then
  echo ""
  echo "# Secondary collisions attached to this character (brief — just id + note)"
  echo "secondary_collisions:"
  yq -r '.[] | "  - id: " + .id + "\n    note: " + (.note // "" | @json)' <<< "$ENRICHED_SECONDARY" 2>/dev/null
else
  echo ""
  echo "secondary_collisions: []"
fi

# World results
echo ""
echo "# World results for this beat (shared across all characters)"
if [[ "$WORLD_YAML" != "null" && -n "$WORLD_YAML" ]]; then
  echo "world:"
  echo "$WORLD_YAML" | yq -r '
    to_entries[] | "  " + .key + ": " + (.value // "null" | tostring)
  ' 2>/dev/null
else
  echo "world: null"
fi

# Prior mechanics
echo ""
echo "# Running mechanical state — changes from PRIOR beats only"
if [[ "$BEAT" -eq 1 ]]; then
  echo "# (empty for beat 1)"
fi
echo "prior_mechanics:"

# Output each array, compacting empty to []
emit_yaml_array() {
  local label="$1" json_array="$2"
  local len
  len=$(echo "$json_array" | jq 'length' 2>/dev/null) || len=0
  if [[ "$len" -eq 0 ]]; then
    echo "  ${label}: []"
  else
    echo "  ${label}:"
    echo "$json_array" | jq -r '.[] | "    - " + (. | tostring)' 2>/dev/null
  fi
}

emit_yaml_array "trait_changes" "$PRIOR_TRAIT_CHANGES"
emit_yaml_array "condition_changes" "$PRIOR_CONDITION_CHANGES"
emit_yaml_array "bond_changes" "$PRIOR_BOND_CHANGES"
