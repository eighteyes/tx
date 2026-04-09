#!/usr/bin/env bash
# stamp-decomposition.sh - Write init-turn's decomposition into intent.yaml (includes lock fields)
# Takes structured JSON args, writes via yq. LLM provides values, script writes files.
# This ensures raw_input is never overwritten and all fields are properly escaped.
#
# Usage:
#   stamp-decomposition.sh <workspace> <turn> \
#     --interpreted-action "..." \
#     --actor "..." --actor-source "stated" \
#     --action "..." --action-source "stated" \
#     --target "..." --target-source "stated" \
#     --method "..." --method-source "stated" \
#     --scope "..." --scope-source "stated" \
#     --goal "..." --goal-source "stated" \
#     --tempo "scene" --tempo-source "inferred" \
#     --action-weight 0.7 \
#     --player-hopes "hope1" --player-hopes "hope2" \
#     --off-table "item1" \
#     --clarification "..." \
#     --lock-description "..." \
#     --physical-fact "fact1" --physical-fact "fact2" \
#     --subject-to-entropy "item1" --subject-to-entropy "item2" \
#     --not-subject-to-entropy "item1" --not-subject-to-entropy "item2" \
#     [--ambiguous-method "opt1" --ambiguous-method "opt2"] \
#     [--ambiguous-target "opt1" --ambiguous-target "opt2"]

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
RESET='\033[0m'

log()  { echo -e "${DIM}[stamp-decomposition]${RESET} $*" >&2; }
err()  { echo -e "${RED}[stamp-decomposition]${RESET} $*" >&2; }

# ─────────────────────────────────────────────
# PARSE ARGS
# ─────────────────────────────────────────────

WORKSPACE="${1:?Usage: stamp-decomposition.sh <workspace> <turn> [options]}"
TURN="${2:?Usage: stamp-decomposition.sh <workspace> <turn> [options]}"
shift 2

INTERPRETED_ACTION=""
ACTOR="" ; ACTOR_SOURCE="stated"
ACTION="" ; ACTION_SOURCE="stated"
TARGET="" ; TARGET_SOURCE="stated"
METHOD="" ; METHOD_SOURCE="stated"
SCOPE="" ; SCOPE_SOURCE="stated"
GOAL="" ; GOAL_SOURCE="stated"
TEMPO="scene" ; TEMPO_SOURCE="inferred"
ACTION_WEIGHT="0.5"
ENTROPY_MODE="random"
CLARIFICATION=""
LOCK_DESCRIPTION=""

declare -a PLAYER_HOPES=()
declare -a OFF_TABLE=()
declare -a PHYSICAL_FACTS=()
declare -a SUBJECT_TO_ENTROPY=()
declare -a NOT_SUBJECT_TO_ENTROPY=()
declare -a AMBIGUOUS_METHOD=()
declare -a AMBIGUOUS_TARGET=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interpreted-action) INTERPRETED_ACTION="$2"; shift 2 ;;
    --actor) ACTOR="$2"; shift 2 ;;
    --actor-source) ACTOR_SOURCE="$2"; shift 2 ;;
    --action) ACTION="$2"; shift 2 ;;
    --action-source) ACTION_SOURCE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --target-source) TARGET_SOURCE="$2"; shift 2 ;;
    --method) METHOD="$2"; shift 2 ;;
    --method-source) METHOD_SOURCE="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --scope-source) SCOPE_SOURCE="$2"; shift 2 ;;
    --goal) GOAL="$2"; shift 2 ;;
    --goal-source) GOAL_SOURCE="$2"; shift 2 ;;
    --tempo) TEMPO="$2"; shift 2 ;;
    --tempo-source) TEMPO_SOURCE="$2"; shift 2 ;;
    --action-weight) ACTION_WEIGHT="$2"; shift 2 ;;
    --entropy-mode) ENTROPY_MODE="$2"; shift 2 ;;
    --clarification) CLARIFICATION="$2"; shift 2 ;;
    --lock-description) LOCK_DESCRIPTION="$2"; shift 2 ;;
    --player-hopes) PLAYER_HOPES+=("$2"); shift 2 ;;
    --off-table) OFF_TABLE+=("$2"); shift 2 ;;
    --physical-fact) PHYSICAL_FACTS+=("$2"); shift 2 ;;
    --subject-to-entropy) SUBJECT_TO_ENTROPY+=("$2"); shift 2 ;;
    --not-subject-to-entropy) NOT_SUBJECT_TO_ENTROPY+=("$2"); shift 2 ;;
    --ambiguous-method) AMBIGUOUS_METHOD+=("$2"); shift 2 ;;
    --ambiguous-target) AMBIGUOUS_TARGET+=("$2"); shift 2 ;;
    *) shift ;;
  esac
done

INTENT_FILE="$WORKSPACE/intent.yaml"

# ─────────────────────────────────────────────
# VALIDATE: raw_input must already exist
# ─────────────────────────────────────────────

if [[ ! -f "$INTENT_FILE" ]]; then
  err "intent.yaml not found at $INTENT_FILE — run init-workspace.sh --stamp-action first"
  exit 1
fi

existing_raw=$(yq -r '.raw_input // ""' "$INTENT_FILE")
if [[ -z "$existing_raw" ]]; then
  err "raw_input is empty in $INTENT_FILE — stamp-action failed?"
  exit 1
fi

log "raw_input preserved (${#existing_raw} chars)"

# ─────────────────────────────────────────────
# WRITE intent.yaml (append to stamped file)
# ─────────────────────────────────────────────

export _INTERP="$INTERPRETED_ACTION"
export _CLARIFICATION="$CLARIFICATION"

yq -i '
  .interpreted_action = strenv(_INTERP) |
  .action_weight = '"$ACTION_WEIGHT"' |
  .entropy_mode = "'"$ENTROPY_MODE"'"
' "$INTENT_FILE"

# Decomposition block — all via env() for safe escaping
export _D_ACTOR="$ACTOR"
export _D_ACTOR_SRC="$ACTOR_SOURCE"
export _D_ACTION="$ACTION"
export _D_ACTION_SRC="$ACTION_SOURCE"
export _D_TARGET="$TARGET"
export _D_TARGET_SRC="$TARGET_SOURCE"
export _D_METHOD="$METHOD"
export _D_METHOD_SRC="$METHOD_SOURCE"
export _D_SCOPE="$SCOPE"
export _D_SCOPE_SRC="$SCOPE_SOURCE"
export _D_GOAL="$GOAL"
export _D_GOAL_SRC="$GOAL_SOURCE"
export _D_TEMPO="$TEMPO"
export _D_TEMPO_SRC="$TEMPO_SOURCE"

yq -i '
  .decomposition.actor = strenv(_D_ACTOR) |
  .decomposition.actor_source = strenv(_D_ACTOR_SRC) |
  .decomposition.action = strenv(_D_ACTION) |
  .decomposition.action_source = strenv(_D_ACTION_SRC) |
  .decomposition.target = strenv(_D_TARGET) |
  .decomposition.target_source = strenv(_D_TARGET_SRC) |
  .decomposition.method = strenv(_D_METHOD) |
  .decomposition.method_source = strenv(_D_METHOD_SRC) |
  .decomposition.scope = strenv(_D_SCOPE) |
  .decomposition.scope_source = strenv(_D_SCOPE_SRC) |
  .decomposition.goal = strenv(_D_GOAL) |
  .decomposition.goal_source = strenv(_D_GOAL_SRC) |
  .decomposition.tempo = strenv(_D_TEMPO) |
  .decomposition.tempo_source = strenv(_D_TEMPO_SRC)
' "$INTENT_FILE"

# Array fields
yq -i '.player_hopes = []' "$INTENT_FILE"
for h in "${PLAYER_HOPES[@]}"; do
  export _H="$h"
  yq -i '.player_hopes += [strenv(_H)]' "$INTENT_FILE"
done

yq -i '.off_table = []' "$INTENT_FILE"
for o in "${OFF_TABLE[@]}"; do
  export _O="$o"
  yq -i '.off_table += [strenv(_O)]' "$INTENT_FILE"
done

if [[ -n "$CLARIFICATION" ]]; then
  yq -i '.clarification = strenv(_CLARIFICATION)' "$INTENT_FILE"
fi

# Ambiguous fields
if [[ ${#AMBIGUOUS_METHOD[@]} -gt 0 ]]; then
  yq -i '.decomposition.method = "ambiguous" | .decomposition.method_source = "ambiguous"' "$INTENT_FILE"
  yq -i '.decomposition.method_options = []' "$INTENT_FILE"
  for m in "${AMBIGUOUS_METHOD[@]}"; do
    export _M="$m"
    yq -i '.decomposition.method_options += [strenv(_M)]' "$INTENT_FILE"
  done
fi

if [[ ${#AMBIGUOUS_TARGET[@]} -gt 0 ]]; then
  yq -i '.decomposition.target = "ambiguous" | .decomposition.target_source = "ambiguous"' "$INTENT_FILE"
  yq -i '.decomposition.target_options = []' "$INTENT_FILE"
  for t in "${AMBIGUOUS_TARGET[@]}"; do
    export _T="$t"
    yq -i '.decomposition.target_options += [strenv(_T)]' "$INTENT_FILE"
  done
fi

log "intent.yaml updated (decomposition appended, raw_input untouched)"

# ─────────────────────────────────────────────
# WRITE lock fields INTO intent.yaml
# ─────────────────────────────────────────────

export _LOCK_DESC="${LOCK_DESCRIPTION:-$INTERPRETED_ACTION}"

yq -i '
  .locked = true |
  .action = strenv(_LOCK_DESC) |
  .sequence.actor = strenv(_D_ACTOR) |
  .sequence.action = strenv(_D_ACTION) |
  .sequence.target = strenv(_D_TARGET) |
  .sequence.method = strenv(_D_METHOD) |
  .sequence.scope = strenv(_D_SCOPE)
' "$INTENT_FILE"

# Physical state
yq -i '.physical_state.facts = []' "$INTENT_FILE"
for f in "${PHYSICAL_FACTS[@]}"; do
  export _F="$f"
  yq -i '.physical_state.facts += [strenv(_F)]' "$INTENT_FILE"
done

# Ambiguous fields in lock
if [[ ${#AMBIGUOUS_METHOD[@]} -gt 0 ]]; then
  yq -i '.sequence.method = null | .sequence.method_options = []' "$INTENT_FILE"
  for m in "${AMBIGUOUS_METHOD[@]}"; do
    export _M="$m"
    yq -i '.sequence.method_options += [strenv(_M)]' "$INTENT_FILE"
  done
fi
if [[ ${#AMBIGUOUS_TARGET[@]} -gt 0 ]]; then
  yq -i '.sequence.target = null | .sequence.target_options = []' "$INTENT_FILE"
  for t in "${AMBIGUOUS_TARGET[@]}"; do
    export _T="$t"
    yq -i '.sequence.target_options += [strenv(_T)]' "$INTENT_FILE"
  done
fi

# Entropy boundaries
yq -i '.subject_to_entropy = []' "$INTENT_FILE"
for s in "${SUBJECT_TO_ENTROPY[@]}"; do
  export _S="$s"
  yq -i '.subject_to_entropy += [strenv(_S)]' "$INTENT_FILE"
done

yq -i '.not_subject_to_entropy = []' "$INTENT_FILE"
for n in "${NOT_SUBJECT_TO_ENTROPY[@]}"; do
  export _N="$n"
  yq -i '.not_subject_to_entropy += [strenv(_N)]' "$INTENT_FILE"
done

log "intent.yaml updated (lock fields merged)"

# ─────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────

echo -e "${GREEN}[stamp-decomposition]${RESET} Written:" >&2
echo -e "  ${DIM}intent.yaml${RESET} — raw_input + decomposition + lock + entropy boundaries" >&2
