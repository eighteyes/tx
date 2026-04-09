#!/usr/bin/env bash
# calc-trajectory-status.sh - Pure arithmetic for trajectory status bucketing
# Computes turns_remaining and buckets each trajectory into firing/approaching/still_active.
# Responsibilities:
#   - Read trajectories from trajectories.yaml
#   - Calculate turns_remaining for each trajectory
#   - Bucket into firing (<=0), approaching (1-2), still_active (3+)
#   - Output clean YAML to stdout

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─────────────────────────────────────────────
# USAGE
# ─────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
Usage: calc-trajectory-status.sh <current_turn> <trajectories_yaml>
  current_turn       integer
  trajectories_yaml  path to trajectories.yaml
EOF
  exit 1
}

# ─────────────────────────────────────────────
# ARGS
# ─────────────────────────────────────────────

[[ $# -lt 2 ]] && usage

CURRENT_TURN="$1"
TRAJ_FILE="$2"

if ! [[ "$CURRENT_TURN" =~ ^[0-9]+$ ]]; then
  echo "Error: current_turn must be a non-negative integer, got '$CURRENT_TURN'" >&2
  exit 1
fi

if [[ ! -f "$TRAJ_FILE" ]]; then
  echo "Error: trajectories file not found: $TRAJ_FILE" >&2
  exit 2
fi

# ─────────────────────────────────────────────
# READ TRAJECTORIES
# ─────────────────────────────────────────────

traj_count=$(yq '.trajectories | length' "$TRAJ_FILE")

# ─────────────────────────────────────────────
# BUCKET TRAJECTORIES
# ─────────────────────────────────────────────

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# Initialize output structure
cat > "$TMP" <<'EOF'
trajectory_status:
  firing: []
  approaching: []
  still_active: []
  count: 0
EOF

if (( traj_count == 0 )); then
  cat "$TMP"
  exit 0
fi

yq -i ".trajectory_status.count = $traj_count" "$TMP"

for (( i=0; i<traj_count; i++ )); do
  fires_at=$(yq ".trajectories[$i].fires_at_turn" "$TRAJ_FILE")
  traj_id=$(yq -r ".trajectories[$i].id" "$TRAJ_FILE")
  turns_remaining=$(( fires_at - CURRENT_TURN ))

  if (( turns_remaining <= 0 )); then
    # Firing — include full detail for priority handling
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
    # Approaching
    outcome=$(yq -r ".trajectories[$i].outcome_when_fires" "$TRAJ_FILE")

    yq -i ".trajectory_status.approaching += [{
      \"id\": \"$traj_id\",
      \"fires_at_turn\": $fires_at,
      \"turns_remaining\": $turns_remaining,
      \"outcome_when_fires\": \"$outcome\"
    }]" "$TMP"

  else
    # Still active
    yq -i ".trajectory_status.still_active += [{
      \"id\": \"$traj_id\",
      \"fires_at_turn\": $fires_at,
      \"turns_remaining\": $turns_remaining
    }]" "$TMP"
  fi
done

cat "$TMP"
