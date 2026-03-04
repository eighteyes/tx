#!/usr/bin/env bash
# calc-distribution.sh - Pure arithmetic for outcome distribution shaping
# Computes weighted distribution from arc pressure and protagonist trait pressures.
# Responsibilities:
#   - Select distribution shape from arc pressure band
#   - Load base percentages for selected shape
#   - Apply trait modifier arithmetic (pressure × per_level)
#   - Clamp each category to [3, 60]
#   - Normalize to sum to 100% (integer math, remainder to largest)
#   - Output clean YAML to stdout

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─────────────────────────────────────────────
# USAGE
# ─────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
Usage: calc-distribution.sh <arc_pressure> [traits_yaml_file]
  arc_pressure    integer (0-200+)
  traits_yaml     flat map file: {TRAIT: pressure, ...}
                  if omitted, no trait modifiers applied
EOF
  exit 1
}

# ─────────────────────────────────────────────
# ARGS
# ─────────────────────────────────────────────

[[ $# -lt 1 ]] && usage

ARC_PRESSURE="$1"
TRAITS_FILE="${2:-}"

# Validate arc_pressure is a non-negative integer
if ! [[ "$ARC_PRESSURE" =~ ^[0-9]+$ ]]; then
  echo "Error: arc_pressure must be a non-negative integer, got '$ARC_PRESSURE'" >&2
  exit 1
fi

# ─────────────────────────────────────────────
# SHAPE SELECTION (6 bands)
# ─────────────────────────────────────────────

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

# ─────────────────────────────────────────────
# BASE PERCENTAGES (6×5 matrix)
# Categories: catastrophic failure mixed success breakthrough
# ─────────────────────────────────────────────

declare -A BASE
# hook (0-25)
BASE[hook,catastrophic]=12;  BASE[hook,failure]=18;  BASE[hook,mixed]=35;  BASE[hook,success]=23;  BASE[hook,breakthrough]=12
# normal (26-60)
BASE[normal,catastrophic]=8;  BASE[normal,failure]=22;  BASE[normal,mixed]=40;  BASE[normal,success]=22;  BASE[normal,breakthrough]=8
# right_skew (61-85)
BASE[right_skew,catastrophic]=10;  BASE[right_skew,failure]=15;  BASE[right_skew,mixed]=30;  BASE[right_skew,success]=30;  BASE[right_skew,breakthrough]=15
# bimodal (86-120)
BASE[bimodal,catastrophic]=18;  BASE[bimodal,failure]=12;  BASE[bimodal,mixed]=15;  BASE[bimodal,success]=25;  BASE[bimodal,breakthrough]=30
# fat_tails (121-160)
BASE[fat_tails,catastrophic]=25;  BASE[fat_tails,failure]=8;  BASE[fat_tails,mixed]=9;  BASE[fat_tails,success]=18;  BASE[fat_tails,breakthrough]=40
# explosive (161+)
BASE[explosive,catastrophic]=30;  BASE[explosive,failure]=5;  BASE[explosive,mixed]=5;  BASE[explosive,success]=15;  BASE[explosive,breakthrough]=45

# ─────────────────────────────────────────────
# TRAIT MODIFIER TABLE (5 traits × 5 per_level)
# Unknown traits get 0 modifier (safe passthrough)
# ─────────────────────────────────────────────

declare -A TRAIT_MOD
# DESPERATE: compresses middle, expands extremes
TRAIT_MOD[DESPERATE,catastrophic]=2;  TRAIT_MOD[DESPERATE,failure]=-4;  TRAIT_MOD[DESPERATE,mixed]=-2;  TRAIT_MOD[DESPERATE,success]=2;  TRAIT_MOD[DESPERATE,breakthrough]=2
# INTELLIGENT: avoids disasters, doesn't sabotage success — net near-zero, slight catastrophe shield
TRAIT_MOD[INTELLIGENT,catastrophic]=-2;  TRAIT_MOD[INTELLIGENT,failure]=1;  TRAIT_MOD[INTELLIGENT,mixed]=0;  TRAIT_MOD[INTELLIGENT,success]=0;  TRAIT_MOD[INTELLIGENT,breakthrough]=1
# SMUG: confidence amplifies — spectacular success or spectacular fall, no middle
TRAIT_MOD[SMUG,catastrophic]=2;  TRAIT_MOD[SMUG,failure]=-2;  TRAIT_MOD[SMUG,mixed]=-2;  TRAIT_MOD[SMUG,success]=1;  TRAIT_MOD[SMUG,breakthrough]=1
# ANGRY: volatile extremes — rage produces breakthroughs or catastrophe, never tepid outcomes
TRAIT_MOD[ANGRY,catastrophic]=2;  TRAIT_MOD[ANGRY,failure]=-2;  TRAIT_MOD[ANGRY,mixed]=-2;  TRAIT_MOD[ANGRY,success]=1;  TRAIT_MOD[ANGRY,breakthrough]=1
# MERCILESS_CLARITY: eliminates ambiguity
TRAIT_MOD[MERCILESS_CLARITY,catastrophic]=1;  TRAIT_MOD[MERCILESS_CLARITY,failure]=-2;  TRAIT_MOD[MERCILESS_CLARITY,mixed]=-3;  TRAIT_MOD[MERCILESS_CLARITY,success]=2;  TRAIT_MOD[MERCILESS_CLARITY,breakthrough]=2

CATEGORIES=(catastrophic failure mixed success breakthrough)

# ─────────────────────────────────────────────
# CALCULATION
# ─────────────────────────────────────────────

SHAPE=$(select_shape "$ARC_PRESSURE")

# Load base percentages for shape
declare -A current
for cat in "${CATEGORIES[@]}"; do
  current[$cat]=${BASE[$SHAPE,$cat]}
done

# Store base values for output
declare -A base_values
for cat in "${CATEGORIES[@]}"; do
  base_values[$cat]=${current[$cat]}
done

# Apply trait modifiers if traits file provided
declare -A trait_pressures
if [[ -n "$TRAITS_FILE" ]]; then
  if [[ ! -f "$TRAITS_FILE" ]]; then
    echo "Error: traits file not found: $TRAITS_FILE" >&2
    exit 1
  fi

  # Read trait keys and pressures from flat YAML map
  while IFS= read -r trait; do
    [[ -z "$trait" ]] && continue
    pressure=$(yq ".\"$trait\"" "$TRAITS_FILE")

    # Skip if pressure is not a positive integer
    [[ "$pressure" =~ ^[0-9]+$ ]] || continue
    (( pressure == 0 )) && continue

    # Check if this trait has modifiers defined
    if [[ -n "${TRAIT_MOD[$trait,catastrophic]+_}" ]]; then
      trait_pressures[$trait]=$pressure
      for cat in "${CATEGORIES[@]}"; do
        modifier=${TRAIT_MOD[$trait,$cat]}
        adjustment=$(( pressure * modifier ))
        current[$cat]=$(( current[$cat] + adjustment ))
      done
    fi
    # Unknown traits silently ignored (0 modifier)
  done < <(yq -r 'keys | .[]' "$TRAITS_FILE")
fi

# Clamp each category to [3, 60]
for cat in "${CATEGORIES[@]}"; do
  val=${current[$cat]}
  (( val < 3 )) && val=3
  (( val > 60 )) && val=60
  current[$cat]=$val
done

# Normalize to sum to 100% (integer math)
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

# Assign remainder to the largest category
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

# ─────────────────────────────────────────────
# OUTPUT YAML
# ─────────────────────────────────────────────

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

# Add trait_modifiers section
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
