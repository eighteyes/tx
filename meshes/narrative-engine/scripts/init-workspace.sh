#!/usr/bin/env bash
# init-workspace.sh - Deterministic workspace setup for init-turn
# Reads session, increments turn, creates workspace, loads state, outputs YAML blob to stdout.
# Responsibilities:
#   - Read session.yaml and derive paths
#   - Increment turn number
#   - Detect and archive polluted workspaces
#   - Bootstrap new campaigns (--new-campaign)
#   - Create workspace directory
#   - Load protagonist entity (campaign > game, with game-level fallback for starting traits/foundation)
#   - Load scene.yaml and timeline.yaml
#   - Run snapshot-campaign.sh
#   - Atomically update session.yaml
#   - Output state blob YAML to stdout

set -euo pipefail

# ─────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${TX_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SESSION="$ROOT/.ai/tx/narrative-engine/session.yaml"

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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --new-campaign)
      if [[ -n "${2:-}" && "${2:0:1}" != "-" ]]; then
        NEW_CAMPAIGN="$2"; shift 2
      else
        NEW_CAMPAIGN="auto"; shift
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
# 2. INCREMENT TURN
# ─────────────────────────────────────────────

new_turn=$((current_turn + 1))
vlog "Turn: $current_turn → $new_turn"

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

  cat > "$campaign_dir/scene.yaml" << 'SCENE_EOF'
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

workspace="$campaign_dir/turns/turn-$new_turn"
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

    mv "$workspace" "${workspace}${suffix}"
    pollution_status="archived:turn-${new_turn}${suffix}"
    warn "Archived polluted workspace → turn-${new_turn}${suffix} ($pipeline_files artifacts)"
  fi
fi

# ─────────────────────────────────────────────
# 6. CREATE WORKSPACE
# ─────────────────────────────────────────────

mkdir -p "$workspace"
vlog "Workspace: $workspace"

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
# 8. LOAD SCENE.YAML
# ─────────────────────────────────────────────

scene_file="$campaign_dir/scene.yaml"

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
# 11. UPDATE SESSION.YAML (atomic)
# ─────────────────────────────────────────────

tmp_session=$(mktemp)
cp "$SESSION" "$tmp_session"

yq -i "
  .turn = $new_turn |
  .campaign_id = \"$campaign_id\" |
  .workspace = \"$workspace\" |
  .phase = \"awaiting_prep\"
" "$tmp_session"

mv "$tmp_session" "$SESSION"
vlog "Session updated: turn=$new_turn phase=awaiting_prep"

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
protag_name=$(yq -r '.name // "unknown"' "$protagonist_file")

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

# Output clean YAML
cat "$BLOB"
rm -f "$BLOB"

log "${GREEN}State blob ready — turn $new_turn${RESET}"
