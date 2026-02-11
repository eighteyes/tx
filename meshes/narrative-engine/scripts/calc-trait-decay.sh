#!/usr/bin/env bash
# calc-trait-decay.sh - Pure arithmetic for trait pressure decay over elapsed time
# Applies decay rates by trait type and clamps to baseline.
# Responsibilities:
#   - Read traits_evolved structure (pressure, baseline, decay_type per trait)
#   - Apply decay rate: acute (1 per 3 days), protective (1 per 7 days), core (none)
#   - Clamp adjusted pressure to baseline minimum
#   - Output clean YAML with changes and adjusted_pressures to stdout

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─────────────────────────────────────────────
# USAGE
# ─────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
Usage: calc-trait-decay.sh <days_elapsed> <traits_evolved_yaml>
  days_elapsed        integer (days since last turn)
  traits_evolved_yaml path to YAML file with traits.evolved structure:
                      {TRAIT: {pressure: N, baseline: N, decay_type: type}, ...}
EOF
  exit 1
}

# ─────────────────────────────────────────────
# ARGS
# ─────────────────────────────────────────────

[[ $# -lt 2 ]] && usage

DAYS_ELAPSED="$1"
TRAITS_FILE="$2"

if ! [[ "$DAYS_ELAPSED" =~ ^[0-9]+$ ]]; then
  echo "Error: days_elapsed must be a non-negative integer, got '$DAYS_ELAPSED'" >&2
  exit 1
fi

if [[ ! -f "$TRAITS_FILE" ]]; then
  echo "Error: traits file not found: $TRAITS_FILE" >&2
  exit 1
fi

# ─────────────────────────────────────────────
# DECAY RATES
# ─────────────────────────────────────────────

decay_rate() {
  local type=$1
  case "$type" in
    acute)      echo 3 ;;
    protective) echo 7 ;;
    core)       echo 0 ;;
    *)          echo 0 ;;  # Unknown type = no decay
  esac
}

# ─────────────────────────────────────────────
# CALCULATION
# ─────────────────────────────────────────────

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

cat > "$TMP" <<EOF
trait_decay:
  days_elapsed: ${DAYS_ELAPSED}
  changes: {}
  adjusted_pressures: {}
  any_changed: false
EOF

# Get list of trait keys
traits=$(yq -r 'keys | .[]' "$TRAITS_FILE")

any_changed=false

while IFS= read -r trait; do
  [[ -z "$trait" ]] && continue

  pressure=$(yq ".[\"$trait\"].pressure // 0" "$TRAITS_FILE")
  baseline=$(yq ".[\"$trait\"].baseline // 0" "$TRAITS_FILE")
  decay_type=$(yq -r ".[\"$trait\"].decay_type // \"core\"" "$TRAITS_FILE")

  rate=$(decay_rate "$decay_type")

  if (( rate == 0 || DAYS_ELAPSED == 0 )); then
    # No decay — core traits or no time passed
    adjusted=$pressure
  else
    decay_periods=$(( DAYS_ELAPSED / rate ))
    adjusted=$(( pressure - decay_periods ))
    (( adjusted < baseline )) && adjusted=$baseline
  fi

  # Record adjusted pressure
  yq -i ".trait_decay.adjusted_pressures.\"$trait\" = $adjusted" "$TMP"

  # Record change if pressure actually decreased
  if (( adjusted < pressure )); then
    any_changed=true
    decay_periods_actual=$(( DAYS_ELAPSED / rate ))
    yq -i ".trait_decay.changes.\"$trait\" = {
      \"from\": $pressure,
      \"to\": $adjusted,
      \"decay_type\": \"$decay_type\",
      \"decay_periods\": $decay_periods_actual,
      \"baseline\": $baseline
    }" "$TMP"
  fi
done <<< "$traits"

yq -i ".trait_decay.any_changed = $any_changed" "$TMP"

cat "$TMP"
