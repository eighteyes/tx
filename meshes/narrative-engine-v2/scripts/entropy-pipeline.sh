#!/usr/bin/env bash
# entropy-pipeline.sh — Consolidated pre-entropy computation pipeline
# Replaces calc-distribution.sh, calc-trajectory-status.sh, merge-entropy-tables.sh
#
# Responsibilities:
#   - distribution: Compute weighted outcome distribution from arc pressure + traits
#   - trajectories: Bucket trajectories into firing/approaching/still_active
#   - merge-tables: Assemble entropy_tables/ fragments into entropy-tables.yaml
#
# Usage:
#   entropy-pipeline.sh distribution <arc_pressure> [traits_yaml]
#   entropy-pipeline.sh trajectories <current_turn> <trajectories_yaml>
#   entropy-pipeline.sh merge-tables <workspace>

set -euo pipefail

COMMAND="${1:?Usage: entropy-pipeline.sh <distribution|trajectories|merge-tables> [args...]}"
shift

# ═════════════════════════════════════════════
# DISTRIBUTION
# ═════════════════════════════════════════════

do_distribution() {
  local ARC_PRESSURE="${1:?Usage: entropy-pipeline.sh distribution <arc_pressure> [traits_yaml]}"
  local TRAITS_FILE="${2:-}"

  if ! [[ "$ARC_PRESSURE" =~ ^[0-9]+$ ]]; then
    echo "Error: arc_pressure must be a non-negative integer, got '$ARC_PRESSURE'" >&2
    exit 1
  fi

  # Shape selection (6 bands)
  select_shape() {
    local p=$1
    if   (( p <= 25  )); then echo "hook"
    elif (( p <= 60  )); then echo "normal"
    elif (( p <= 85  )); then echo "right_skew"
    elif (( p <= 120 )); then echo "bimodal"
    elif (( p <= 160 )); then echo "fat_tails"
    else                       echo "explosive"
    fi
  }

  # Base percentages (6×5 matrix)
  declare -A BASE
  BASE[hook,catastrophic]=12;  BASE[hook,failure]=18;  BASE[hook,mixed]=35;  BASE[hook,success]=23;  BASE[hook,breakthrough]=12
  BASE[normal,catastrophic]=8;  BASE[normal,failure]=22;  BASE[normal,mixed]=40;  BASE[normal,success]=22;  BASE[normal,breakthrough]=8
  BASE[right_skew,catastrophic]=10;  BASE[right_skew,failure]=15;  BASE[right_skew,mixed]=30;  BASE[right_skew,success]=30;  BASE[right_skew,breakthrough]=15
  BASE[bimodal,catastrophic]=18;  BASE[bimodal,failure]=12;  BASE[bimodal,mixed]=15;  BASE[bimodal,success]=25;  BASE[bimodal,breakthrough]=30
  BASE[fat_tails,catastrophic]=25;  BASE[fat_tails,failure]=8;  BASE[fat_tails,mixed]=9;  BASE[fat_tails,success]=18;  BASE[fat_tails,breakthrough]=40
  BASE[explosive,catastrophic]=30;  BASE[explosive,failure]=5;  BASE[explosive,mixed]=5;  BASE[explosive,success]=15;  BASE[explosive,breakthrough]=45

  # Trait modifier table
  declare -A TRAIT_MOD
  TRAIT_MOD[DESPERATE,catastrophic]=2;  TRAIT_MOD[DESPERATE,failure]=-4;  TRAIT_MOD[DESPERATE,mixed]=-2;  TRAIT_MOD[DESPERATE,success]=2;  TRAIT_MOD[DESPERATE,breakthrough]=2
  TRAIT_MOD[INTELLIGENT,catastrophic]=-2;  TRAIT_MOD[INTELLIGENT,failure]=1;  TRAIT_MOD[INTELLIGENT,mixed]=0;  TRAIT_MOD[INTELLIGENT,success]=0;  TRAIT_MOD[INTELLIGENT,breakthrough]=1
  TRAIT_MOD[SMUG,catastrophic]=2;  TRAIT_MOD[SMUG,failure]=-2;  TRAIT_MOD[SMUG,mixed]=-2;  TRAIT_MOD[SMUG,success]=1;  TRAIT_MOD[SMUG,breakthrough]=1
  TRAIT_MOD[ANGRY,catastrophic]=2;  TRAIT_MOD[ANGRY,failure]=-2;  TRAIT_MOD[ANGRY,mixed]=-2;  TRAIT_MOD[ANGRY,success]=1;  TRAIT_MOD[ANGRY,breakthrough]=1
  TRAIT_MOD[MERCILESS_CLARITY,catastrophic]=1;  TRAIT_MOD[MERCILESS_CLARITY,failure]=-2;  TRAIT_MOD[MERCILESS_CLARITY,mixed]=-3;  TRAIT_MOD[MERCILESS_CLARITY,success]=2;  TRAIT_MOD[MERCILESS_CLARITY,breakthrough]=2

  CATEGORIES=(catastrophic failure mixed success breakthrough)
  SHAPE=$(select_shape "$ARC_PRESSURE")

  declare -A current
  for cat in "${CATEGORIES[@]}"; do
    current[$cat]=${BASE[$SHAPE,$cat]}
  done

  declare -A base_values
  for cat in "${CATEGORIES[@]}"; do
    base_values[$cat]=${current[$cat]}
  done

  # Apply trait modifiers
  declare -A trait_pressures
  if [[ -n "$TRAITS_FILE" ]]; then
    if [[ ! -f "$TRAITS_FILE" ]]; then
      echo "Error: traits file not found: $TRAITS_FILE" >&2
      exit 1
    fi

    while IFS= read -r trait; do
      [[ -z "$trait" ]] && continue
      pressure=$(yq ".\"$trait\"" "$TRAITS_FILE")
      [[ "$pressure" =~ ^[0-9]+$ ]] || continue
      (( pressure == 0 )) && continue

      if [[ -n "${TRAIT_MOD[$trait,catastrophic]+_}" ]]; then
        trait_pressures[$trait]=$pressure
        for cat in "${CATEGORIES[@]}"; do
          modifier=${TRAIT_MOD[$trait,$cat]}
          adjustment=$(( pressure * modifier ))
          current[$cat]=$(( current[$cat] + adjustment ))
        done
      fi
    done < <(yq -r 'keys | .[]' "$TRAITS_FILE")
  fi

  # Clamp [3, 60]
  for cat in "${CATEGORIES[@]}"; do
    val=${current[$cat]}
    (( val < 3 )) && val=3
    (( val > 60 )) && val=60
    current[$cat]=$val
  done

  # Normalize to 100%
  sum=0
  for cat in "${CATEGORIES[@]}"; do
    sum=$(( sum + current[$cat] ))
  done

  declare -A final
  remainder_total=0
  for cat in "${CATEGORIES[@]}"; do
    final[$cat]=$(( current[$cat] * 100 / sum ))
    remainder_total=$(( remainder_total + final[$cat] ))
  done

  remainder=$(( 100 - remainder_total ))
  if (( remainder != 0 )); then
    largest_cat=""
    largest_val=0
    for cat in "${CATEGORIES[@]}"; do
      if (( final[$cat] > largest_val )); then
        largest_val=${final[$cat]}
        largest_cat=$cat
      fi
    done
    final[$largest_cat]=$(( final[$largest_cat] + remainder ))
  fi

  # Output
  TMP=$(mktemp)
  trap 'rm -f "$TMP"' EXIT

  cat > "$TMP" <<EOF
distribution:
  arc_pressure: ${ARC_PRESSURE}
  shape: ${SHAPE}
  base:
    catastrophic: ${base_values[catastrophic]}
    failure: ${base_values[failure]}
    mixed: ${base_values[mixed]}
    success: ${base_values[success]}
    breakthrough: ${base_values[breakthrough]}
EOF

  has_traits=false
  for trait in "${!trait_pressures[@]}"; do
    has_traits=true
    break
  done 2>/dev/null || true

  if $has_traits; then
    echo "  trait_modifiers:" >> "$TMP"
    for trait in "${!trait_pressures[@]}"; do
      echo "    ${trait}: ${trait_pressures[$trait]}" >> "$TMP"
    done
  else
    echo "  trait_modifiers: {}" >> "$TMP"
  fi

  cat >> "$TMP" <<EOF
  final:
    catastrophic: ${final[catastrophic]}
    failure: ${final[failure]}
    mixed: ${final[mixed]}
    success: ${final[success]}
    breakthrough: ${final[breakthrough]}
EOF

  cat "$TMP"
}

# ═════════════════════════════════════════════
# TRAJECTORIES
# ═════════════════════════════════════════════

do_trajectories() {
  local CURRENT_TURN="${1:?Usage: entropy-pipeline.sh trajectories <current_turn> <trajectories_yaml>}"
  local TRAJ_FILE="${2:?Usage: entropy-pipeline.sh trajectories <current_turn> <trajectories_yaml>}"

  if ! [[ "$CURRENT_TURN" =~ ^[0-9]+$ ]]; then
    echo "Error: current_turn must be a non-negative integer, got '$CURRENT_TURN'" >&2
    exit 1
  fi

  if [[ ! -f "$TRAJ_FILE" ]]; then
    echo "Error: trajectories file not found: $TRAJ_FILE" >&2
    exit 2
  fi

  traj_count=$(yq '.trajectories | length' "$TRAJ_FILE")

  TMP=$(mktemp)
  trap 'rm -f "$TMP"' EXIT

  cat > "$TMP" <<'EOF'
trajectory_status:
  firing: []
  approaching: []
  still_active: []
  count: 0
EOF

  if (( traj_count == 0 )); then
    cat "$TMP"
    return
  fi

  yq -i ".trajectory_status.count = $traj_count" "$TMP"

  for (( i=0; i<traj_count; i++ )); do
    fires_at=$(yq ".trajectories[$i].fires_at_turn" "$TRAJ_FILE")
    traj_id=$(yq -r ".trajectories[$i].id" "$TRAJ_FILE")
    turns_remaining=$(( fires_at - CURRENT_TURN ))

    if (( turns_remaining <= 0 )); then
      outcome=$(yq -r ".trajectories[$i].outcome_when_fires" "$TRAJ_FILE")
      weight=$(yq ".trajectories[$i].weight_when_firing // 50" "$TRAJ_FILE")
      category=$(yq -r ".trajectories[$i].category // \"consequence\"" "$TRAJ_FILE")
      setup_turn=$(yq ".trajectories[$i].setup_turn" "$TRAJ_FILE")

      yq -i ".trajectory_status.firing += [{
        \"id\": \"$traj_id\",
        \"outcome_when_fires\": \"$outcome\",
        \"suggested_weight\": $weight,
        \"category\": \"$category\",
        \"setup_turn\": $setup_turn
      }]" "$TMP"

    elif (( turns_remaining <= 2 )); then
      outcome=$(yq -r ".trajectories[$i].outcome_when_fires" "$TRAJ_FILE")

      yq -i ".trajectory_status.approaching += [{
        \"id\": \"$traj_id\",
        \"fires_at_turn\": $fires_at,
        \"turns_remaining\": $turns_remaining,
        \"outcome_when_fires\": \"$outcome\"
      }]" "$TMP"

    else
      yq -i ".trajectory_status.still_active += [{
        \"id\": \"$traj_id\",
        \"fires_at_turn\": $fires_at,
        \"turns_remaining\": $turns_remaining
      }]" "$TMP"
    fi
  done

  cat "$TMP"
}

# ═════════════════════════════════════════════
# MERGE TABLES
# ═════════════════════════════════════════════

do_merge_tables() {
  local WORKSPACE="${1:?Usage: entropy-pipeline.sh merge-tables <workspace>}"
  local TABLES_DIR="${WORKSPACE}/entropy_tables"
  local OUTPUT="${WORKSPACE}/entropy-tables.yaml"

  if [ ! -d "$TABLES_DIR" ]; then
    echo "ERROR: entropy_tables/ directory not found at $TABLES_DIR" >&2
    exit 1
  fi

  # Header
  if [ -f "$TABLES_DIR/header.yaml" ]; then
    cat "$TABLES_DIR/header.yaml"
  else
    echo "# WARNING: No header.yaml found — synthesis_context missing"
  fi

  echo ""
  echo "character_tables:"

  for f in "$TABLES_DIR"/char-*.yaml; do
    [ -f "$f" ] || continue
    case "$f" in
      *-directions.yaml) continue ;;
      *-emergent-beat-*.yaml) continue ;;
    esac
    char_name=$(basename "$f" .yaml | sed 's/^char-//')
    echo "  ${char_name}:"
    sed 's/^/    /' "$f"
    echo ""
  done

  echo "direction_tables:"

  has_directions=false
  for f in "$TABLES_DIR"/char-*-directions.yaml; do
    [ -f "$f" ] || continue
    has_directions=true
    char_name=$(basename "$f" .yaml | sed 's/^char-//' | sed 's/-directions$//')
    echo "  ${char_name}:"
    sed 's/^/    /' "$f"
    echo ""
  done
  if [ "$has_directions" = false ]; then
    echo "  # No direction tables generated (action_weight > 0.7 or no threads available)"
  fi

  echo "world_event_table:"

  for f in "$TABLES_DIR"/world-*.yaml; do
    [ -f "$f" ] || continue
    sed 's/^/  /' "$f"
    echo ""
  done

  echo "ambient_texture:"

  if [ -f "$TABLES_DIR/texture.yaml" ]; then
    sed 's/^/  /' "$TABLES_DIR/texture.yaml"
  else
    echo "  # WARNING: No texture.yaml found"
  fi
}

# ═════════════════════════════════════════════
# DISPATCH
# ═════════════════════════════════════════════

case "$COMMAND" in
  distribution)  do_distribution "$@" ;;
  trajectories)  do_trajectories "$@" ;;
  merge-tables)  do_merge_tables "$@" ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    echo "Usage: entropy-pipeline.sh <distribution|trajectories|merge-tables> [args...]" >&2
    exit 1
    ;;
esac
