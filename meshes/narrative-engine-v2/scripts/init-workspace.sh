#!/usr/bin/env bash
# init-workspace.sh - Deterministic workspace setup for init-turn
# Reads session (already incremented by entry), loads state, outputs YAML blob to stdout.
# Responsibilities:
#   - Read session.yaml (turn/workspace already set by entry's increment-turn.sh)
#   - Detect and archive polluted workspaces
#   - Bootstrap new campaigns (--new-campaign)
#   - Load protagonist entity (campaign > game, with game-level fallback for starting traits/foundation)
#   - Load state.yaml and timeline.yaml
#   - Run snapshot-campaign.sh
#   - Output state blob YAML to stdout
#
# NOTE: Turn increment happens in entry agent via increment-turn.sh BEFORE init-turn spawns.
# This ensures the manifest resolves to the correct workspace paths.

set -euo pipefail

# ─────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${TX_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SESSION="$ROOT/.ai/tx/narrative-engine-v2/session.yaml"

# ─────────────────────────────────────────────
# COLORS (stderr only — stdout is the blob)
# ─────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

log()  { echo -e "${DIM}[init-workspace]${RESET} $*" >&2; }
warn() { echo -e "${YELLOW}[init-workspace]${RESET} $*" >&2; }
err()  { echo -e "${RED}[init-workspace]${RESET} $*" >&2; }

# ─────────────────────────────────────────────
# ARGS
# ─────────────────────────────────────────────

NEW_CAMPAIGN=""
VERBOSE=false
STAMP_ACTION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --new-campaign)
      if [[ -n "${2:-}" && "${2:0:1}" != "-" ]]; then
        NEW_CAMPAIGN="$2"; shift 2
      else
        NEW_CAMPAIGN="auto"; shift
      fi
      ;;
    --stamp-action)
      # Next arg is the raw player action text to stamp into intent.yaml
      if [[ -n "${2:-}" && "${2:0:1}" != "-" ]]; then
        STAMP_ACTION="$2"; shift 2
      else
        # Read from stdin if no inline arg
        STAMP_ACTION="$(cat)"; shift
      fi
      ;;
    --verbose) VERBOSE=true; shift ;;
    *) shift ;;
  esac
done

vlog() { $VERBOSE && log "$@" || true; }

# ─────────────────────────────────────────────
# 1. READ SESSION
# ─────────────────────────────────────────────

if [[ ! -f "$SESSION" ]]; then
  err "No session.yaml at $SESSION"
  exit 1
fi

game_id=$(yq -r '.game_id // "null"' "$SESSION")
campaign_id=$(yq -r '.campaign_id // "null"' "$SESSION")
current_turn=$(yq -r '.turn // 0' "$SESSION")
game_path=$(yq -r '.game_path // "null"' "$SESSION")
pov_character=$(yq -r '.pov_character // "null"' "$SESSION")
workspace=$(yq -r '.workspace // "null"' "$SESSION")
workspace="${workspace%/}"

if [[ "$game_id" == "null" || "$game_path" == "null" ]]; then
  err "session.yaml missing game_id or game_path"
  exit 1
fi

# Normalize game_path: absolute + strip trailing slash
[[ "$game_path" != /* ]] && game_path="$ROOT/$game_path"
game_path="${game_path%/}"

campaign_dir="$game_path/campaigns/$campaign_id"

vlog "Session: game=$game_id campaign=$campaign_id turn=$current_turn"

# ─────────────────────────────────────────────
# 2. USE CURRENT TURN (entry already incremented)
# ─────────────────────────────────────────────

# Entry agent runs increment-turn.sh BEFORE spawning init-turn.
# Session.yaml already has the correct turn number and workspace.
new_turn=$current_turn
vlog "Turn: $new_turn (set by entry)"

# ─────────────────────────────────────────────
# 3. CAMPAIGN CHECK
# ─────────────────────────────────────────────

campaign_status="exists"

if [[ ! -d "$campaign_dir" ]]; then
  if [[ -z "$NEW_CAMPAIGN" ]]; then
    err "Campaign directory missing: $campaign_dir"
    err "Rerun with --new-campaign to bootstrap"
    exit 3
  fi

  # Auto-generate campaign ID if requested
  if [[ "$NEW_CAMPAIGN" == "auto" ]]; then
    last_num=$(ls "$game_path/campaigns/" 2>/dev/null | grep -oP 'campaign-\K[0-9]+' | sort -n | tail -1)
    if [[ -z "$last_num" ]]; then
      campaign_id="campaign-1"
    else
      campaign_id="campaign-$((last_num + 1))"
    fi
    campaign_dir="$game_path/campaigns/$campaign_id"
  else
    campaign_id="$NEW_CAMPAIGN"
    campaign_dir="$game_path/campaigns/$campaign_id"
  fi

  campaign_status="just_created"
fi

# ─────────────────────────────────────────────
# 4. BOOTSTRAP NEW CAMPAIGN
# ─────────────────────────────────────────────

if [[ "$campaign_status" == "just_created" ]]; then
  vlog "Bootstrapping campaign: $campaign_id"

  mkdir -p "$campaign_dir/entities/characters"
  mkdir -p "$campaign_dir/entities/bonds"
  mkdir -p "$campaign_dir/turns"

  cat > "$campaign_dir/state.yaml" << 'SCENE_EOF'
turn: 0
arc:
  pressure: 0
  phase: setup
  momentum: null
location: null
present: []
closing: null
suspended: null
prose_anchor: null
SCENE_EOF

  cat > "$campaign_dir/trajectories.yaml" << 'TRAJ_EOF'
active: []
fired: []
interrupted: []
TRAJ_EOF

  cat > "$campaign_dir/timeline.yaml" << 'TIME_EOF'
campaign_start: null
entries: []
TIME_EOF

  template_dir="$SCRIPT_DIR/../templates"
  if [[ -f "$template_dir/continuity.template.yaml" ]]; then
    cp "$template_dir/continuity.template.yaml" "$campaign_dir/continuity.yaml"
  fi

  # New campaign starts at turn 0
  new_turn=0

  log "${GREEN}Campaign $campaign_id bootstrapped${RESET}"
fi

# ─────────────────────────────────────────────
# 5. WORKSPACE POLLUTION CHECK
# ─────────────────────────────────────────────

# Workspace path already set by entry via increment-turn.sh
# Only compute if not set (e.g., new campaign bootstrap)
if [[ "$workspace" == "null" || -z "$workspace" ]]; then
  workspace="$campaign_dir/turns/turn-$new_turn"
fi
pollution_status="clean"

if [[ -d "$workspace" ]]; then
  pipeline_files=0
  for artifact in resolution.yaml fates.yaml scene-outline.yaml context.yaml intent.yaml action-lock.yaml; do
    [[ -f "$workspace/$artifact" ]] && pipeline_files=$((pipeline_files + 1))
  done

  if [[ $pipeline_files -gt 0 ]]; then
    suffix="a"
    while [[ -d "${workspace}${suffix}" ]]; do
      suffix=$(echo "$suffix" | tr 'a-y' 'b-z')
    done

    ARCHIVE_DIR="${workspace}${suffix}"
    mv "$workspace" "$ARCHIVE_DIR"
    pollution_status="archived:turn-${new_turn}${suffix}"
    warn "Archived polluted workspace → turn-${new_turn}${suffix} ($pipeline_files artifacts)"
  fi
fi

# ─────────────────────────────────────────────
# 6. CREATE WORKSPACE
# ─────────────────────────────────────────────

mkdir -p "$workspace"
vlog "Workspace: $workspace"

# Preserve player input files from archived workspace
if [[ -n "${ARCHIVE_DIR:-}" && -f "${ARCHIVE_DIR}/director-notes.yaml" ]]; then
  cp "${ARCHIVE_DIR}/director-notes.yaml" "${workspace}/director-notes.yaml"
  vlog "Preserved director-notes.yaml from ${ARCHIVE_DIR}"
fi

# ─────────────────────────────────────────────
# 6b. STAMP RAW PLAYER ACTION (tamper-proof)
# ─────────────────────────────────────────────
# When --stamp-action is provided, write the player's exact words into
# intent.yaml BEFORE any LLM touches the file. This prevents models
# from sanitizing, softening, or rewriting the player's input.
# The LLM appends decomposition fields later via yq — raw_input is sacred.

if [[ -n "$STAMP_ACTION" ]]; then
  intent_file="$workspace/intent.yaml"
  # Use yq with env() for safe escaping — handles quotes, em-dashes, special chars
  export _STAMP_RAW="$STAMP_ACTION"
  yq -n '.raw_input = strenv(_STAMP_RAW)' > "$intent_file"
  unset _STAMP_RAW
  vlog "Stamped raw_input to $intent_file (${#STAMP_ACTION} chars)"
  log "${GREEN}Player action stamped (tamper-proof)${RESET}"
fi

# ─────────────────────────────────────────────
# 7. LOAD PROTAGONIST ENTITY
# ─────────────────────────────────────────────

campaign_entity=""
game_entity=""
protagonist_file=""
entity_source=""

# Resolve file locations for both levels
if [[ "$pov_character" != "null" && -n "$pov_character" ]]; then
  [[ -f "$campaign_dir/entities/characters/${pov_character}.yaml" ]] && \
    campaign_entity="$campaign_dir/entities/characters/${pov_character}.yaml"
  [[ -f "$game_path/entities/characters/${pov_character}.yaml" ]] && \
    game_entity="$game_path/entities/characters/${pov_character}.yaml"
else
  campaign_entity=$(grep -rl "protagonist: true" "$campaign_dir/entities/characters/" 2>/dev/null | head -1) || true
  game_entity=$(grep -rl "protagonist: true" "$game_path/entities/characters/" 2>/dev/null | head -1) || true
fi

# Campaign takes precedence for evolved state
if [[ -n "$campaign_entity" && -f "$campaign_entity" ]]; then
  protagonist_file="$campaign_entity"
  entity_source="campaign"
elif [[ -n "$game_entity" && -f "$game_entity" ]]; then
  protagonist_file="$game_entity"
  entity_source="game"
fi

if [[ -z "$protagonist_file" ]]; then
  err "Protagonist entity not found"
  err "  pov_character=$pov_character"
  err "  campaign_dir=$campaign_dir/entities/characters/"
  err "  game_dir=$game_path/entities/characters/"
  exit 2
fi

vlog "Protagonist: $protagonist_file (source: $entity_source)"
[[ -n "$game_entity" && -f "$game_entity" ]] && vlog "Game-level entity: $game_entity"

# ─────────────────────────────────────────────
# 8. LOAD STATE.YAML
# ─────────────────────────────────────────────

scene_file="$campaign_dir/state.yaml"

# ─────────────────────────────────────────────
# 9. LOAD TIMELINE (last entry)
# ─────────────────────────────────────────────

timeline_file="$campaign_dir/timeline.yaml"

# ─────────────────────────────────────────────
# 10. RUN SNAPSHOT
# ─────────────────────────────────────────────

if [[ -x "$SCRIPT_DIR/snapshot-campaign.sh" ]]; then
  vlog "Running snapshot-campaign.sh"
  "$SCRIPT_DIR/snapshot-campaign.sh" >&2 || warn "Snapshot failed (non-fatal)"
fi

# ─────────────────────────────────────────────
# 11. VALIDATE SESSION.YAML (entry already set turn/workspace)
# ─────────────────────────────────────────────

# Entry agent already updated turn, workspace, and phase.
# Only update campaign_id if it changed (new campaign bootstrap).
if [[ "$campaign_status" == "just_created" ]]; then
  tmp_session=$(mktemp)
  cp "$SESSION" "$tmp_session"
  yq -i ".campaign_id = \"$campaign_id\"" "$tmp_session"
  mv "$tmp_session" "$SESSION"
  vlog "Session updated: campaign_id=$campaign_id"
else
  vlog "Session validated: turn=$new_turn workspace=$workspace"
fi

# ─────────────────────────────────────────────
# 11b. SYNC V2 SESSION.YAML
# ─────────────────────────────────────────────
# The v2 mesh config reads variables from its own session.yaml
# (workspace.variables.source). Keep it in sync so manifest
# variable resolution produces correct per-turn workspace paths.

V2_SESSION="$ROOT/.ai/tx/narrative-engine-v2/session.yaml"
if [[ -f "$V2_SESSION" ]]; then
  yq -i ".turn = $new_turn" "$V2_SESSION"
  yq -i ".workspace = \"$workspace\"" "$V2_SESSION"
  yq -i ".game_id = \"$game_id\"" "$V2_SESSION"
  yq -i ".campaign_id = \"$campaign_id\"" "$V2_SESSION"
  yq -i ".game_path = \"$game_path\"" "$V2_SESSION"
  yq -i ".campaign_path = \"$campaign_dir\"" "$V2_SESSION"
  vlog "V2 session synced: turn=$new_turn workspace=$workspace"
fi

# ─────────────────────────────────────────────
# 12. BUILD STATE BLOB (yq-assembled, stdout)
# ─────────────────────────────────────────────

BLOB=$(mktemp)

# --- Session block ---
yq -n "
  .session.game_id = \"$game_id\" |
  .session.campaign_id = \"$campaign_id\" |
  .session.turn = $new_turn |
  .session.game_path = \"$game_path\" |
  .session.workspace = \"$workspace\" |
  .session.pov_character = \"$pov_character\" |
  .status.campaign = \"$campaign_status\" |
  .status.pollution = \"$pollution_status\"
" > "$BLOB"

# --- Protagonist block ---
# Core fields from primary entity
protag_id=$(yq -r '.id // "unknown"' "$protagonist_file")

# Name can be string or object {first, surname}. Handle both.
name_type=$(yq -r '.name | type' "$protagonist_file" 2>/dev/null || echo "string")
if [[ "$name_type" == "!!map" ]]; then
  protag_name=$(yq -r '.name.first // "unknown"' "$protagonist_file")
else
  protag_name=$(yq -r '.name // "unknown"' "$protagonist_file")
fi

yq -i "
  .protagonist.id = \"$protag_id\" |
  .protagonist.name = \"$protag_name\" |
  .protagonist.entity_source = \"$entity_source\"
" "$BLOB"

# traits.starting — prefer protagonist_file, fall back to game_entity
starting_source="$protagonist_file"
has_starting=$(yq -r '.traits.starting | length // 0' "$protagonist_file" 2>/dev/null) || has_starting=0
if [[ "$has_starting" == "0" && -n "$game_entity" && -f "$game_entity" ]]; then
  starting_source="$game_entity"
fi

starting_keys=$(yq -r '(.traits.starting // {}) | keys | .[]' "$starting_source" 2>/dev/null) || true
if [[ -n "$starting_keys" ]]; then
  blob_starting="["
  first=true
  while IFS= read -r k; do
    $first && first=false || blob_starting+=", "
    blob_starting+="\"$k\""
  done <<< "$starting_keys"
  blob_starting+="]"
  yq -i ".protagonist.traits_starting = $blob_starting" "$BLOB"
else
  yq -i '.protagonist.traits_starting = []' "$BLOB"
fi

# traits.evolved + trait_pressures — from primary entity (use temp to avoid subshell)
evolved_tmp=$(mktemp)
yq '.traits.evolved // {}' "$protagonist_file" > "$evolved_tmp" 2>/dev/null || echo "{}" > "$evolved_tmp"
yq -i ".protagonist.traits_evolved = load(\"$evolved_tmp\")" "$BLOB"

# flat pressure map
yq 'with_entries(.value = .value.pressure // 0)' "$evolved_tmp" > "${evolved_tmp}.p"
yq -i ".protagonist.trait_pressures = load(\"${evolved_tmp}.p\")" "$BLOB"
rm -f "$evolved_tmp" "${evolved_tmp}.p"

# foundation — prefer protagonist_file, fall back to game_entity
ideology=$(yq -r '.foundation.ideology // ""' "$protagonist_file" 2>/dev/null) || ideology=""
func=$(yq -r '.foundation.function // ""' "$protagonist_file" 2>/dev/null) || func=""

if [[ -z "$ideology" && -n "$game_entity" && -f "$game_entity" ]]; then
  ideology=$(yq -r '.foundation.ideology // ""' "$game_entity" 2>/dev/null) || ideology=""
fi
if [[ -z "$func" && -n "$game_entity" && -f "$game_entity" ]]; then
  func=$(yq -r '.foundation.function // ""' "$game_entity" 2>/dev/null) || func=""
fi

yq -i "
  .protagonist.foundation.ideology = \"$ideology\" |
  .protagonist.foundation.function = \"$func\"
" "$BLOB"

# bonds — list of bond file IDs
bonds_dir=""
if [[ -d "$campaign_dir/entities/bonds" ]] && ls "$campaign_dir/entities/bonds/"*.yaml &>/dev/null; then
  bonds_dir="$campaign_dir/entities/bonds"
elif [[ -d "$game_path/entities/bonds" ]] && ls "$game_path/entities/bonds/"*.yaml &>/dev/null; then
  bonds_dir="$game_path/entities/bonds"
fi

if [[ -n "$bonds_dir" ]]; then
  bond_list="["
  first=true
  for bond_file in "$bonds_dir"/*.yaml; do
    bond_id=$(basename "$bond_file" .yaml)
    $first && first=false || bond_list+=", "
    bond_list+="\"$bond_id\""
  done
  bond_list+="]"
  yq -i ".protagonist.bonds = $bond_list" "$BLOB"
else
  yq -i '.protagonist.bonds = []' "$BLOB"
fi

# --- Scene block ---
if [[ -f "$scene_file" ]]; then
  yq -i "
    .scene.turn = $(yq -r '.turn // 0' "$scene_file") |
    .scene.location = \"$(yq -r '.location // "null"' "$scene_file")\"
  " "$BLOB"

  # Extract scene sub-blocks via temp files (avoids pipe-subshell issues with yq -i)
  scene_tmp=$(mktemp)

  # present array
  yq '.present // []' "$scene_file" > "$scene_tmp"
  yq -i ".scene.present = load(\"$scene_tmp\")" "$BLOB"

  # closing block (nested YAML)
  yq '.closing // null' "$scene_file" > "$scene_tmp"
  yq -i ".scene.closing = load(\"$scene_tmp\")" "$BLOB"

  # arc
  yq '.arc // {}' "$scene_file" > "$scene_tmp"
  yq -i ".scene.arc = load(\"$scene_tmp\")" "$BLOB"

  # suspended block (can be scalar or mapping — wrap for safe load)
  yq '{"v": (.suspended // null)}' "$scene_file" > "$scene_tmp"
  yq -i ".scene.suspended = load(\"$scene_tmp\").v" "$BLOB"

  # prose_anchor (literal block scalar — wrap for safe load)
  yq '{"v": (.prose_anchor // null)}' "$scene_file" > "$scene_tmp"
  yq -i ".scene.prose_anchor = load(\"$scene_tmp\").v" "$BLOB"

  rm -f "$scene_tmp"
else
  yq -i '
    .scene.turn = 0 |
    .scene.location = null |
    .scene.present = [] |
    .scene.closing = null |
    .scene.arc.pressure = 0 |
    .scene.arc.phase = "setup" |
    .scene.arc.momentum = null |
    .scene.suspended = null |
    .scene.prose_anchor = null
  ' "$BLOB"
fi

# --- Timeline block ---
if [[ -f "$timeline_file" ]]; then
  yq -i "
    .timeline.last_day = $(yq -r '.entries[-1].day // 0' "$timeline_file") |
    .timeline.last_period = \"$(yq -r '.entries[-1].period // "null"' "$timeline_file")\"
  " "$BLOB"
else
  yq -i '
    .timeline.last_day = 0 |
    .timeline.last_period = null
  ' "$BLOB"
fi

# ─────────────────────────────────────────────
# 13. WRITE CONTEXT.YAML (script-generated, not LLM)
# ─────────────────────────────────────────────
# context.yaml is 100% derivable from the blob. Writing it here ensures
# no LLM can sanitize the player_action field or alter scene state.
# The raw_input from intent.yaml is used as player_action — verbatim.

if [[ -n "$STAMP_ACTION" ]]; then
  context_file="$workspace/context.yaml"

  # Start with session fields
  export _CTX_ACTION="$STAMP_ACTION"
  export _CTX_POV="$pov_character"

  yq -n '
    .turn = '"$new_turn"' |
    .context_type = "action" |
    .player_action = strenv(_CTX_ACTION) |
    .pov_character = strenv(_CTX_POV)
  ' > "$context_file"

  # Actor block from blob protagonist
  protag_tmp=$(mktemp)
  yq '.protagonist' "$BLOB" > "$protag_tmp"
  yq -i '.actor = load("'"$protag_tmp"'")' "$context_file"
  rm -f "$protag_tmp"

  # Scene block from blob scene
  scene_tmp=$(mktemp)
  yq '{
    "location": .scene.location,
    "present": .scene.present,
    "pov_is": .session.pov_character
  }' "$BLOB" > "$scene_tmp"
  yq -i '.scene = load("'"$scene_tmp"'")' "$context_file"
  rm -f "$scene_tmp"

  # Closing state from blob scene
  closing_tmp=$(mktemp)
  yq '{
    "door": .scene.closing.door,
    "characters": .scene.closing.positions,
    "objects": .scene.closing.objects,
    "time": .scene.closing.time
  }' "$BLOB" > "$closing_tmp"
  yq -i '.closing_state = load("'"$closing_tmp"'")' "$context_file"
  rm -f "$closing_tmp"

  # Prose anchor
  anchor_tmp=$(mktemp)
  yq '{"v": .scene.prose_anchor}' "$BLOB" > "$anchor_tmp"
  yq -i '.closing_state.prose_anchor = load("'"$anchor_tmp"'").v' "$context_file"
  rm -f "$anchor_tmp"

  # Arc block from blob scene
  arc_tmp=$(mktemp)
  yq '.scene.arc // {}' "$BLOB" > "$arc_tmp"
  yq -i '.arc = load("'"$arc_tmp"'")' "$context_file"
  rm -f "$arc_tmp"

  # Suspended block
  suspended_tmp=$(mktemp)
  yq '{"v": .scene.suspended}' "$BLOB" > "$suspended_tmp"
  yq -i '.suspended = load("'"$suspended_tmp"'").v' "$context_file"
  rm -f "$suspended_tmp"

  vlog "context.yaml written to $context_file"
  log "${GREEN}context.yaml generated (script, not LLM)${RESET}"
fi

# Output clean YAML
cat "$BLOB"
rm -f "$BLOB"

log "${GREEN}State blob ready — turn $new_turn${RESET}"
