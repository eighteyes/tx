#!/usr/bin/env bash
# roll-tree.sh — Probability tree resolver for roll-first entropy pipeline
# Consumes turn-tree.yaml, rolls dice at every node, outputs resolved-skeleton.yaml
#
# Responsibilities:
#   - Read turn-tree.yaml from workspace
#   - Roll character tiers and registers per beat (weighted random, cumulative ranges)
#   - Roll world domains per beat (chance gate + weighted option selection)
#   - Evaluate cross-beat branch triggers and apply weight shifts before rolling target beats
#   - Roll collision surfacing (affinity-gated per character)
#   - Assign collisions to characters by highest affinity
#   - Write resolved-skeleton.yaml with full roll audit trail
#
# Usage:
#   roll-tree.sh <workspace> [--seed=N]

set -euo pipefail

# ─────────────────────────────────────────────
# ARGS
# ─────────────────────────────────────────────

WORKSPACE=""
SEED=""

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      cat >&2 <<'USAGE'
roll-tree.sh — Resolve a probability tree into a skeleton via dice rolls

Usage:
  roll-tree.sh <workspace> [--seed=N]

Arguments:
  workspace   Path to the turn directory containing turn-tree.yaml

Options:
  --seed=N    RNG seed for reproducible runs (integer)
  --help      Show this message

Input:   <workspace>/turn-tree.yaml
Output:  <workspace>/resolved-skeleton.yaml
USAGE
      exit 0
      ;;
    --seed=*)
      SEED="${arg#--seed=}"
      ;;
    *)
      if [[ -z "$WORKSPACE" ]]; then
        WORKSPACE="$arg"
      else
        echo "ERROR: unexpected argument '$arg'" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$WORKSPACE" ]]; then
  echo "ERROR: workspace path required" >&2
  echo "Usage: roll-tree.sh <workspace> [--seed=N]" >&2
  exit 1
fi

TREE="$WORKSPACE/turn-tree.yaml"
OUTPUT="$WORKSPACE/resolved-skeleton.yaml"

if [[ ! -f "$TREE" ]]; then
  echo "ERROR: turn-tree.yaml not found at $TREE" >&2
  exit 1
fi

# ─────────────────────────────────────────────
# RNG
# ─────────────────────────────────────────────

if [[ -z "$SEED" ]]; then
  SEED=$(od -An -tu4 -N4 /dev/urandom | tr -d ' ')
fi

# awk-based seeded RNG — all rolls go through this
# Global roll counter incremented per call for deterministic sequencing
ROLL_COUNTER=0

# roll — deterministic 1-100 from seed + counter
# Subshell-safe: caller increments ROLL_COUNTER before calling,
# then captures output via $().
_roll() {
  awk -v seed="$SEED" -v counter="$ROLL_COUNTER" '
    BEGIN {
      srand(seed * 31 + counter * 7919)
      rand()
      print int(rand() * 100) + 1
    }
  '
}

# Convenience: increment counter then roll. Use as:
#   ROLL_COUNTER=$((ROLL_COUNTER + 1)); val=$(_roll)
# NOT as $(roll_1_100) — that loses the counter increment.

# ─────────────────────────────────────────────
# WEIGHTED SELECTION
# ─────────────────────────────────────────────

# weighted_select <roll_value> <key1> <weight1> <key2> <weight2> ...
# Converts weights to cumulative ranges and returns the matching key.
weighted_select() {
  local roll="$1"
  shift
  local cumulative=0
  local key=""
  while [[ $# -ge 2 ]]; do
    key="$1"
    local weight="$2"
    shift 2
    cumulative=$((cumulative + weight))
    if [[ $roll -le $cumulative ]]; then
      echo "$key"
      return 0
    fi
  done
  # Fallback: return last key (rounding safety)
  echo "$key"
}

# ─────────────────────────────────────────────
# TIER NUMERIC MAPPING
# ─────────────────────────────────────────────

tier_to_num() {
  case "$1" in
    catastrophic) echo 0 ;;
    failure)      echo 1 ;;
    mixed)        echo 2 ;;
    success)      echo 3 ;;
    breakthrough) echo 4 ;;
    *)            echo 2 ;;
  esac
}

# ─────────────────────────────────────────────
# FLOAT COMPARISON (via awk)
# ─────────────────────────────────────────────

float_gt() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a > b)}'; }
float_eq() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a == b)}'; }
float_le() { awk -v a="$1" 'BEGIN{exit !(a <= 0)}'; }
float_to_pct() { awk -v a="$1" 'BEGIN{printf "%d", a * 100}'; }

# ─────────────────────────────────────────────
# READ TREE METADATA
# ─────────────────────────────────────────────

TURN=$(yq -r '.turn' "$TREE")
BEAT_COUNT=$(yq -r '.beat_count' "$TREE")

# Character list (sorted for deterministic ordering)
CHARACTERS=()
while IFS= read -r c; do
  [[ -n "$c" ]] && CHARACTERS+=("$c")
done < <(yq -r '.characters | keys | .[]' "$TREE")

WORLD_DOMAINS=(texture atmosphere complication prop micro)

# ─────────────────────────────────────────────
# PARSE BRANCHES
# ─────────────────────────────────────────────

BRANCH_COUNT=$(yq -r '.branches | length // 0' "$TREE")

declare -a BRANCH_TRIGGER BRANCH_TARGET_CHAR BRANCH_TARGET_BEAT BRANCH_SHIFTS
for ((b=0; b<BRANCH_COUNT; b++)); do
  BRANCH_TRIGGER[$b]=$(yq -r ".branches[$b].trigger" "$TREE")
  target=$(yq -r ".branches[$b].target" "$TREE")
  BRANCH_TARGET_CHAR[$b]="${target%%.*}"
  BRANCH_TARGET_BEAT[$b]="${target#*.}"
  BRANCH_SHIFTS[$b]=$(yq -r ".branches[$b].shift | to_entries | .[] | \"\(.key):\(.value)\"" "$TREE" 2>/dev/null || echo "")
done

# ─────────────────────────────────────────────
# RESULT ACCUMULATORS
# ─────────────────────────────────────────────

# Associative arrays for roll results
declare -A RESOLVED_TIER       # "char.beat_N" → tier
declare -A RESOLVED_REGISTER   # "char.beat_N" → register
declare -A TIER_ROLL           # "char.beat_N" → roll value
declare -A REG_ROLL            # "char.beat_N" → roll value
declare -A WEIGHT_DELTAS       # "char.beat_N.tier" → delta

# World domain results
declare -A WORLD_FIRED         # "beat_N.domain" → true/false
declare -A WORLD_ROLL          # "beat_N.domain" → roll value
declare -A WORLD_RESULT        # "beat_N.domain" → selected option

# Collision tracking
declare -A SURFACED_CHAR       # collision_id → best character
declare -A SURFACED_AFF        # collision_id → best affinity (float string)
declare -A SURFACED_ROLL       # collision_id → roll value
SURFACED_ORDER=()              # ordered list of all surfaced IDs
GUARANTEED_IDS=()
ROLLED_OUT_IDS=()

# ─────────────────────────────────────────────
# ROLL BEATS (sequential — branches can modify future beats)
# ─────────────────────────────────────────────

for ((beat=1; beat<=BEAT_COUNT; beat++)); do
  bk="beat_${beat}"

  # --- Characters ---
  for char in "${CHARACTERS[@]}"; do

    # Build tier weights with branch deltas applied
    tier_args=()
    for tier in catastrophic failure mixed success breakthrough; do
      base_w=$(yq -r ".characters.\"${char}\".${bk}.tier_weights.${tier} // 0" "$TREE")
      delta="${WEIGHT_DELTAS[${char}.${bk}.${tier}]:-0}"
      w=$((base_w + delta))
      (( w < 0 )) && w=0
      tier_args+=("$tier" "$w")
    done

    # Renormalize to 100
    tier_sum=0
    for ((i=1; i<${#tier_args[@]}; i+=2)); do
      tier_sum=$((tier_sum + tier_args[i]))
    done

    if [[ $tier_sum -ne 100 && $tier_sum -gt 0 ]]; then
      norm=()
      running=0
      idx=0
      total=$(( ${#tier_args[@]} / 2 ))
      for ((i=0; i<${#tier_args[@]}; i+=2)); do
        idx=$((idx + 1))
        name="${tier_args[i]}"
        val="${tier_args[i+1]}"
        if [[ $idx -eq $total ]]; then
          nv=$((100 - running))
        else
          nv=$(( val * 100 / tier_sum ))
          running=$((running + nv))
        fi
        norm+=("$name" "$nv")
      done
      tier_args=("${norm[@]}")
    fi

    ROLL_COUNTER=$((ROLL_COUNTER + 1)); tr=$(_roll)
    resolved=$(weighted_select "$tr" "${tier_args[@]}")
    TIER_ROLL["${char}.${bk}"]=$tr
    RESOLVED_TIER["${char}.${bk}"]="$resolved"

    # Register weights
    reg_args=()
    while IFS= read -r rk; do
      [[ -n "$rk" ]] || continue
      rw=$(yq -r ".characters.\"${char}\".${bk}.register_weights.\"${rk}\"" "$TREE")
      reg_args+=("$rk" "$rw")
    done < <(yq -r ".characters.\"${char}\".${bk}.register_weights | keys | .[]" "$TREE" 2>/dev/null)

    ROLL_COUNTER=$((ROLL_COUNTER + 1)); rr=$(_roll)
    if [[ ${#reg_args[@]} -gt 0 ]]; then
      reg=$(weighted_select "$rr" "${reg_args[@]}")
    else
      reg="default"
    fi
    REG_ROLL["${char}.${bk}"]=$rr
    RESOLVED_REGISTER["${char}.${bk}"]="$reg"
  done

  # --- World domains ---
  for domain in "${WORLD_DOMAINS[@]}"; do
    exists=$(yq -r ".world.${bk}.${domain} // \"null\"" "$TREE")
    [[ "$exists" == "null" ]] && continue

    chance=$(yq -r ".world.${bk}.${domain}.chance // 0" "$TREE")
    ROLL_COUNTER=$((ROLL_COUNTER + 1)); fr=$(_roll)
    WORLD_ROLL["${bk}.${domain}"]=$fr

    if [[ $fr -le $chance ]]; then
      WORLD_FIRED["${bk}.${domain}"]=true

      opt_args=()
      while IFS= read -r ok; do
        [[ -n "$ok" ]] || continue
        ow=$(yq -r ".world.${bk}.${domain}.options.\"${ok}\"" "$TREE")
        opt_args+=("$ok" "$ow")
      done < <(yq -r ".world.${bk}.${domain}.options | keys | .[]" "$TREE" 2>/dev/null)

      if [[ ${#opt_args[@]} -gt 0 ]]; then
        ROLL_COUNTER=$((ROLL_COUNTER + 1)); or=$(_roll)
        WORLD_RESULT["${bk}.${domain}"]=$(weighted_select "$or" "${opt_args[@]}")
      else
        WORLD_RESULT["${bk}.${domain}"]="none"
      fi
    else
      WORLD_FIRED["${bk}.${domain}"]=false
    fi
  done

  # --- Evaluate branches for future beats ---
  for ((b=0; b<BRANCH_COUNT; b++)); do
    trigger="${BRANCH_TRIGGER[$b]}"
    # Format: "character.beat_N.tier >= tier_name"
    trig_char=$(echo "$trigger" | cut -d'.' -f1)
    trig_beat=$(echo "$trigger" | cut -d'.' -f2)
    trig_op=$(echo "$trigger" | awk '{print $2}')
    trig_val=$(echo "$trigger" | awk '{print $3}')

    trig_beat_num="${trig_beat#beat_}"
    [[ $trig_beat_num -gt $beat ]] && continue

    rv="${RESOLVED_TIER[${trig_char}.${trig_beat}]:-}"
    [[ -z "$rv" ]] && continue

    rn=$(tier_to_num "$rv")
    tn=$(tier_to_num "$trig_val")

    match=false
    case "$trig_op" in
      ">=")    [[ $rn -ge $tn ]] && match=true ;;
      ">")     [[ $rn -gt $tn ]] && match=true ;;
      "<=")    [[ $rn -le $tn ]] && match=true ;;
      "<")     [[ $rn -lt $tn ]] && match=true ;;
      "=="|"=") [[ $rn -eq $tn ]] && match=true ;;
    esac

    if [[ "$match" == "true" ]]; then
      tc="${BRANCH_TARGET_CHAR[$b]}"
      tb="${BRANCH_TARGET_BEAT[$b]}"
      while IFS=: read -r st sd; do
        [[ -z "$st" ]] && continue
        dk="${tc}.${tb}.${st}"
        ex="${WEIGHT_DELTAS[$dk]:-0}"
        sd=$(echo "$sd" | tr -d ' +')
        WEIGHT_DELTAS[$dk]=$((ex + sd))
      done <<< "${BRANCH_SHIFTS[$b]}"
    fi
  done
done

# ─────────────────────────────────────────────
# COLLISION SURFACING
# ─────────────────────────────────────────────

for ((beat=1; beat<=BEAT_COUNT; beat++)); do
  bk="beat_${beat}"

  # Guaranteed
  g_count=$(yq -r ".collision_assignments.${bk}.guaranteed | length // 0" "$TREE")
  for ((g=0; g<g_count; g++)); do
    gid=$(yq -r ".collision_assignments.${bk}.guaranteed[$g]" "$TREE")
    GUARANTEED_IDS+=("$gid")

    best_char=""
    best_aff="0"
    for char in "${CHARACTERS[@]}"; do
      aff=$(yq -r ".characters.\"${char}\".${bk}.collision_affinity.\"${gid}\" // 0" "$TREE")
      if float_gt "$aff" "$best_aff"; then
        best_aff="$aff"
        best_char="$char"
      elif float_eq "$aff" "$best_aff" && [[ "$char" < "${best_char:-zzz}" ]]; then
        best_char="$char"
      fi
    done
    [[ -z "$best_char" ]] && best_char="${CHARACTERS[0]}"

    SURFACED_CHAR["$gid"]="$best_char"
    SURFACED_AFF["$gid"]="$best_aff"
    SURFACED_ORDER+=("$gid")
  done

  # Pool
  p_count=$(yq -r ".collision_assignments.${bk}.pool | length // 0" "$TREE")
  for ((p=0; p<p_count; p++)); do
    pid=$(yq -r ".collision_assignments.${bk}.pool[$p].id" "$TREE")
    surfaced=false
    best_char=""
    best_aff="0"
    best_roll=""

    for char in "${CHARACTERS[@]}"; do
      aff=$(yq -r ".characters.\"${char}\".${bk}.collision_affinity.\"${pid}\" // 0" "$TREE")
      if float_le "$aff"; then
        continue
      fi

      threshold=$(float_to_pct "$aff")
      ROLL_COUNTER=$((ROLL_COUNTER + 1)); cr=$(_roll)

      if [[ $cr -le $threshold ]]; then
        surfaced=true
        if float_gt "$aff" "$best_aff"; then
          best_aff="$aff"
          best_char="$char"
          best_roll="$cr"
        elif float_eq "$aff" "$best_aff" && [[ "$char" < "${best_char:-zzz}" ]]; then
          best_char="$char"
          best_roll="$cr"
        fi
      fi
    done

    if [[ "$surfaced" == "true" ]]; then
      SURFACED_CHAR["$pid"]="$best_char"
      SURFACED_AFF["$pid"]="$best_aff"
      SURFACED_ROLL["$pid"]="$best_roll"
      SURFACED_ORDER+=("$pid")
    else
      ROLLED_OUT_IDS+=("$pid")
    fi
  done
done

# ─────────────────────────────────────────────
# SKELETON: assign primary + secondary collisions
# ─────────────────────────────────────────────

# Primary collision per character: surfaced collision with highest affinity for that character
declare -A CHAR_PRIMARY  # char → collision_id

for char in "${CHARACTERS[@]}"; do
  best_id=""
  best_aff="0"
  for sid in "${SURFACED_ORDER[@]}"; do
    attached="${SURFACED_CHAR[$sid]}"
    [[ "$attached" != "$char" ]] && continue
    aff="${SURFACED_AFF[$sid]}"
    if float_gt "$aff" "$best_aff"; then
      best_aff="$aff"
      best_id="$sid"
    fi
  done
  [[ -n "$best_id" ]] && CHAR_PRIMARY["$char"]="$best_id"
done

# Secondary = surfaced but not anyone's primary
PRIMARY_SET=()
for char in "${CHARACTERS[@]}"; do
  [[ -n "${CHAR_PRIMARY[$char]:-}" ]] && PRIMARY_SET+=("${CHAR_PRIMARY[$char]}")
done

SECONDARY_IDS=()
for sid in "${SURFACED_ORDER[@]}"; do
  is_primary=false
  for pid in "${PRIMARY_SET[@]}"; do
    [[ "$sid" == "$pid" ]] && is_primary=true && break
  done
  [[ "$is_primary" == "false" ]] && SECONDARY_IDS+=("$sid")
done

# ─────────────────────────────────────────────
# WRITE OUTPUT
# ─────────────────────────────────────────────

{
  echo "# resolved-skeleton.yaml — generated by roll-tree.sh"
  echo "# Seed: ${SEED} | Turn: ${TURN} | Beats: ${BEAT_COUNT}"
  echo ""
  echo "turn: ${TURN}"
  echo "seed: ${SEED}"

  # --- rolls ---
  echo ""
  echo "rolls:"
  for ((beat=1; beat<=BEAT_COUNT; beat++)); do
    bk="beat_${beat}"
    echo "  ${bk}:"
    for char in "${CHARACTERS[@]}"; do
      echo "    ${char}:"
      echo "      tier_roll: ${TIER_ROLL[${char}.${bk}]}"
      echo "      tier: ${RESOLVED_TIER[${char}.${bk}]}"
      echo "      register_roll: ${REG_ROLL[${char}.${bk}]}"
      echo "      register: ${RESOLVED_REGISTER[${char}.${bk}]}"
    done
  done

  # --- world_rolls ---
  echo ""
  echo "world_rolls:"
  for ((beat=1; beat<=BEAT_COUNT; beat++)); do
    bk="beat_${beat}"
    echo "  ${bk}:"
    for domain in "${WORLD_DOMAINS[@]}"; do
      [[ -z "${WORLD_ROLL[${bk}.${domain}]:-}" ]] && continue
      echo "    ${domain}:"
      echo "      roll: ${WORLD_ROLL[${bk}.${domain}]}"
      if [[ "${WORLD_FIRED[${bk}.${domain}]}" == "true" ]]; then
        echo "      fired: true"
        echo "      result: ${WORLD_RESULT[${bk}.${domain}]}"
      else
        echo "      fired: false"
      fi
    done
  done

  # --- surfaced ---
  echo ""
  echo "surfaced:"
  echo "  guaranteed:"
  if [[ ${#GUARANTEED_IDS[@]} -eq 0 ]]; then
    echo "    []"
  else
    for gid in "${GUARANTEED_IDS[@]}"; do
      echo "    - ${gid}"
    done
  fi

  echo "  rolled_in:"
  rolled_in_count=0
  for sid in "${SURFACED_ORDER[@]}"; do
    # Skip guaranteed
    is_g=false
    for gid in "${GUARANTEED_IDS[@]}"; do
      [[ "$sid" == "$gid" ]] && is_g=true && break
    done
    [[ "$is_g" == "true" ]] && continue
    rolled_in_count=$((rolled_in_count + 1))
    echo "    - id: ${sid}"
    echo "      attach_to: ${SURFACED_CHAR[$sid]}"
    echo "      affinity: ${SURFACED_AFF[$sid]}"
    echo "      roll: ${SURFACED_ROLL[$sid]:-0}"
  done
  [[ $rolled_in_count -eq 0 ]] && echo "    []"

  echo "  rolled_out:"
  if [[ ${#ROLLED_OUT_IDS[@]} -eq 0 ]]; then
    echo "    []"
  else
    for rid in "${ROLLED_OUT_IDS[@]}"; do
      echo "    - ${rid}"
    done
  fi

  # --- skeleton ---
  echo ""
  echo "skeleton:"
  for ((beat=1; beat<=BEAT_COUNT; beat++)); do
    bk="beat_${beat}"
    echo "  ${bk}:"

    for char in "${CHARACTERS[@]}"; do
      echo "    ${char}:"
      echo "      tier: ${RESOLVED_TIER[${char}.${bk}]}"
      echo "      register: ${RESOLVED_REGISTER[${char}.${bk}]}"
      pc="${CHAR_PRIMARY[$char]:-}"
      if [[ -n "$pc" ]]; then
        echo "      collision: ${pc}"
      else
        echo "      collision: null"
      fi
      echo "      label: \"\""
    done

    # Secondary collisions
    if [[ ${#SECONDARY_IDS[@]} -gt 0 ]]; then
      echo "    secondary:"
      for sec in "${SECONDARY_IDS[@]}"; do
        echo "      - id: ${sec}"
        echo "        attach_to: ${SURFACED_CHAR[$sec]}"
      done
    fi

    # World
    echo "    world:"
    for domain in "${WORLD_DOMAINS[@]}"; do
      if [[ "${WORLD_FIRED[${bk}.${domain}]:-}" == "true" ]]; then
        echo "      ${domain}: ${WORLD_RESULT[${bk}.${domain}]}"
      else
        echo "      ${domain}: null"
      fi
    done
  done
} > "$OUTPUT"

echo "Resolved skeleton written to: $OUTPUT" >&2
echo "Seed: ${SEED} | Beats: ${BEAT_COUNT} | Characters: ${CHARACTERS[*]}" >&2
echo "Surfaced: ${#GUARANTEED_IDS[@]} guaranteed + ${rolled_in_count:-0} rolled in" >&2
