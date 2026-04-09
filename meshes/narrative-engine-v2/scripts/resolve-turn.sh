#!/usr/bin/env bash
# resolve-turn.sh — Cold resolution pipeline
# Rolls NPC tables, computes distance-weighted synthesis, writes resolution.yaml
# POV already resolved via entropy-resolver.sh primary in Step 3a
#
# Responsibilities:
# - Roll NPC character outcome tables (structural: type only, no subtables)
# - Compute distance-weighted overall outcome
# - Roll ambient texture 1-3x
# - Assemble resolution.yaml with cold fields
# - Leave warm fields (state_changes, trajectory_created, description) for architect
#
# Usage: resolve-turn.sh <workspace> <pov_character_id>

set -euo pipefail

WORKSPACE="${1:?Usage: resolve-turn.sh <workspace> <pov_character_id>}"
POV_ID="${2:?Usage: resolve-turn.sh <workspace> <pov_character_id>}"

TABLES="$WORKSPACE/entropy-tables.yaml"
SELECTION="$WORKSPACE/entropy-selection.yaml"
INTENT="$WORKSPACE/intent.yaml"
SCRIPTS_DIR="$(dirname "$0")"
OUTPUT="$WORKSPACE/resolution.yaml"

# --- Validate inputs ---
for f in "$TABLES" "$SELECTION" "$INTENT"; do
    if [[ ! -f "$f" ]]; then
        echo "ERROR: Missing required file: $f" >&2
        exit 1
    fi
done

# --- Check entropy mode ---
ENTROPY_MODE=$(yq -r '.entropy_mode // "random"' "$INTENT")
if [[ "$ENTROPY_MODE" != "random" ]]; then
    echo "SKIP: entropy_mode=$ENTROPY_MODE — architect resolves inline"
    exit 0
fi

# --- Check for prologue ---
if [[ -f "$WORKSPACE/context.yaml" ]]; then
    CONTEXT_TYPE=$(yq -r '.context_type // "normal"' "$WORKSPACE/context.yaml")
    if [[ "$CONTEXT_TYPE" == "prologue" ]]; then
        cat > "$OUTPUT" <<'EOF'
context_type: prologue
outcome: null
state_changes: null
note: "Atmospheric setup — no mechanical resolution"
EOF
        echo "Prologue — minimal resolution written"
        exit 0
    fi
fi

# --- Read POV outcome from entropy-selection.yaml ---
POV_TYPE=$(yq -r '.player_type' "$SELECTION")
POV_ENTROPY=$(yq -r '.player_entropy' "$SELECTION")
POV_MECHANICAL=$(yq -r '.player_mechanical' "$SELECTION")
ENTROPY_POOL=$(yq -r '.entropy_pool' "$SELECTION")
WORLD_EVENT_ID=$(yq -r '.world_event_id // ""' "$SELECTION")
WORLD_OUTCOME=$(yq -r '.world_outcome // ""' "$SELECTION")
WORLD_MECHANICAL=$(yq -r '.world_mechanical // ""' "$SELECTION")
WORLD_ENTROPY=$(yq -r '.world_entropy' "$SELECTION")

# --- Map outcome type to distance weight ---
type_to_weight() {
    case "$1" in
        catastrophic) echo "-2" ;;
        failure)      echo "-1" ;;
        mixed)        echo "0" ;;
        success)      echo "1" ;;
        breakthrough) echo "2" ;;
        *)            echo "0" ;;
    esac
}

# --- Roll against a character's outcome table ---
# Returns: type shape mechanical_note (tab-separated)
roll_character() {
    local char_id="$1"
    local roll="$2"

    yq -r "
        .character_tables.\"${char_id}\".outcomes[] |
        select(
            (.range | split(\"-\") | (.[0] | tonumber)) <= ${roll} and
            (.range | split(\"-\") | (.[1] | tonumber)) >= ${roll}
        ) |
        [.type, .shape, .mechanical_note] | @tsv
    " "$TABLES" 2>/dev/null || echo "mixed	unknown	roll-mismatch"
}

# --- Roll ambient texture ---
roll_texture() {
    local roll="$1"

    local result
    result=$(yq -r "
        .ambient_texture[] |
        select(
            (.range | split(\"-\") | (.[0] | tonumber)) <= ${roll} and
            (.range | split(\"-\") | (.[1] | tonumber)) >= ${roll}
        ) |
        .result
    " "$TABLES" 2>/dev/null || echo "no_texture")

    echo "$result"
}

# --- Get all character IDs, exclude POV ---
NPC_IDS=()
while IFS= read -r cid; do
    [[ -n "$cid" && "$cid" != "$POV_ID" ]] && NPC_IDS+=("$cid")
done < <(yq -r '.character_tables | keys | .[]' "$TABLES" 2>/dev/null)

# --- Roll NPC tables ---
POV_WEIGHT=$(type_to_weight "$POV_TYPE")
NPC_WEIGHT_SUM=0
NPC_COUNT=0

# Build character_outcomes YAML
CHAR_OUTCOMES="  ${POV_ID}:
    outcome_type: ${POV_TYPE}
    roll: ${POV_ENTROPY}
    mechanical_note: \"${POV_MECHANICAL}\""

RESOLVED_SUBS="  - character: ${POV_ID}
    table: player_outcome_table
    roll: ${POV_ENTROPY}
    result: ${POV_TYPE}"

MECHANICAL_LOG="POV (${POV_ID}): rolled ${POV_ENTROPY} → ${POV_TYPE}"

for npc_id in "${NPC_IDS[@]}"; do
    NPC_ROLL=$((RANDOM % 100 + 1))

    IFS=$'\t' read -r npc_type npc_shape npc_mech <<< "$(roll_character "$npc_id" "$NPC_ROLL")"

    npc_weight=$(type_to_weight "$npc_type")
    NPC_WEIGHT_SUM=$((NPC_WEIGHT_SUM + npc_weight))
    NPC_COUNT=$((NPC_COUNT + 1))

    CHAR_OUTCOMES+="
  ${npc_id}:
    outcome_type: ${npc_type}
    shape: ${npc_shape}
    roll: ${NPC_ROLL}
    mechanical_note: \"${npc_mech}\""

    RESOLVED_SUBS+="
  - character: ${npc_id}
    table: char-${npc_id}
    roll: ${NPC_ROLL}
    result: ${npc_type}"

    MECHANICAL_LOG+="
  NPC (${npc_id}): rolled ${NPC_ROLL} → ${npc_type} (${npc_shape})"
done

# --- Distance-weighted synthesis ---
if [[ $NPC_COUNT -gt 0 ]]; then
    OVERALL_TYPE=$(awk -v pov="$POV_WEIGHT" -v npc_sum="$NPC_WEIGHT_SUM" -v npc_count="$NPC_COUNT" '
        BEGIN {
            score = (pov * 0.6) + ((npc_sum / npc_count) * 0.4)
            if (score <= -1.5)       print "catastrophic"
            else if (score <= -0.5)  print "failure"
            else if (score <= 0.5)   print "mixed"
            else if (score <= 1.5)   print "success"
            else                     print "breakthrough"
        }
    ')
    OVERALL_SCORE=$(awk -v pov="$POV_WEIGHT" -v npc_sum="$NPC_WEIGHT_SUM" -v npc_count="$NPC_COUNT" '
        BEGIN { printf "%.2f", (pov * 0.6) + ((npc_sum / npc_count) * 0.4) }
    ')
    SYNTHESIS="${POV_TYPE} (×0.6) + avg_npc (×0.4) = ${OVERALL_SCORE} → ${OVERALL_TYPE}"
else
    OVERALL_TYPE="$POV_TYPE"
    OVERALL_SCORE="$POV_WEIGHT"
    SYNTHESIS="${POV_TYPE} only (no NPCs)"
fi

MECHANICAL_LOG+="
  Synthesis: ${SYNTHESIS}"

# --- Roll ambient texture 1-3x ---
TEXTURE_COUNT=$((RANDOM % 3 + 1))
TEXTURE_RESULTS=""
TEXTURE_RESOLVED=""

for ((i=1; i<=TEXTURE_COUNT; i++)); do
    tex_roll=$((RANDOM % 100 + 1))
    tex_result=$(roll_texture "$tex_roll")

    TEXTURE_RESULTS+="
  - ${tex_result}"

    TEXTURE_RESOLVED+="
  - table: ambient_texture_${i}
    roll: ${tex_roll}
    result: ${tex_result}"

    MECHANICAL_LOG+="
  Texture ${i}: rolled ${tex_roll} → ${tex_result}"
done

# --- Arc pressure delta ---
arc_delta() {
    case "$1" in
        breakthrough) echo "8" ;;
        success)      echo "5" ;;
        mixed)        echo "2" ;;
        failure)      echo "3" ;;
        catastrophic) echo "6" ;;
        *)            echo "2" ;;
    esac
}
ARC_DELTA=$(arc_delta "$OVERALL_TYPE")

# --- Intent locks (for architect to verify) ---
INTENT_LOCKS=$(yq -r '.not_subject_to_entropy // [] | .[]' "$INTENT" 2>/dev/null || true)
LOCKS_YAML=""
if [[ -n "$INTENT_LOCKS" ]]; then
    while IFS= read -r lock; do
        LOCKS_YAML+="
  - \"${lock}\""
    done <<< "$INTENT_LOCKS"
fi

MECHANICAL_LOG+="
  World: rolled ${WORLD_ENTROPY} → ${WORLD_EVENT_ID:-none}
  Texture: ${TEXTURE_COUNT} rolls
  Arc delta: +${ARC_DELTA} (${OVERALL_TYPE})"

# --- Write resolution.yaml ---
cat > "$OUTPUT" << EOF
# Resolution — generated by resolve-turn.sh
# Architect: verify intent locks, fill TODO fields

entropy_source: random
entropy_pool: ${ENTROPY_POOL}

outcome:
  type: ${OVERALL_TYPE}
  initiator: ${POV_ID}
  synthesis: "${SYNTHESIS}"
  description: TODO

character_outcomes:
${CHAR_OUTCOMES}

world_event:
  event_id: ${WORLD_EVENT_ID:-null}
  roll: ${WORLD_ENTROPY}
  result: $(echo "$WORLD_OUTCOME" | head -1 | sed 's/^[[:space:]]*//')
  mechanical_note: "${WORLD_MECHANICAL}"

ambient_texture:${TEXTURE_RESULTS}

resolved_subtables:
${RESOLVED_SUBS}
  - table: world_event
    roll: ${WORLD_ENTROPY}
    result: ${WORLD_EVENT_ID:-none}${TEXTURE_RESOLVED}

arc_update:
  pressure_delta: ${ARC_DELTA}
  new_pressure: TODO
  phase: TODO

# === WARM FIELDS — Architect fills these ===
state_changes:
  momentum: TODO
  traits_tested: []
  traits_evolved: []
  traits_pressure_changed: []
  bonds_changed: []

trajectory_created: null

intent_locks:${LOCKS_YAML:-"  []"}

mechanical_notes: |
  ${MECHANICAL_LOG}
EOF

echo "Resolution written to: $OUTPUT"
echo "Overall: ${OVERALL_TYPE} (score: ${OVERALL_SCORE})"
echo "POV: ${POV_TYPE} | NPCs: ${NPC_IDS[*]:-none}"
echo "VERIFY: Intent locks require architect semantic check"
