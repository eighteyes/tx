#!/usr/bin/env bash
# redo-turn.sh - Hard reset to redo a turn
# Archives current turn, restores campaign state from prior turn, resets session
# Usage: ./redo-turn.sh [turn-number]

set -euo pipefail

ROOT="${TX_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SESSION="$ROOT/.ai/tx/narrative-engine/session.yaml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo -e "${CYAN}=== REDO TURN ===${RESET}"

# Read session
if [[ ! -f "$SESSION" ]]; then
  echo -e "${RED}No session.yaml found${RESET}"
  exit 1
fi

game_id=$(yq -r '.game_id // "null"' "$SESSION")
campaign_id=$(yq -r '.campaign_id // "null"' "$SESSION")
game_path=$(yq -r '.game_path // "null"' "$SESSION")
current_turn=$(yq -r '.turn // 0' "$SESSION")

if [[ "$game_id" == "null" || "$game_path" == "null" ]]; then
  echo -e "${RED}No active game in session${RESET}"
  exit 1
fi

# Determine which turn to redo
if [[ $# -gt 0 ]]; then
  turn=$1
else
  turn=$current_turn
fi

echo -e "Game: ${GREEN}$game_id${RESET}"
echo -e "Campaign: ${GREEN}$campaign_id${RESET}"
echo -e "Redoing turn: ${YELLOW}$turn${RESET}"

campaign_dir="$game_path/campaigns/$campaign_id"
turn_dir="$campaign_dir/turns/turn-$turn"
prior_turn=$((turn - 1))
prior_dir="$campaign_dir/turns/turn-$prior_turn"

# Step 1: Archive current turn if it exists
if [[ -d "$turn_dir" ]]; then
  # Find next archive suffix (a, b, c, etc.)
  count=$(ls -d "${turn_dir}"[a-z] 2>/dev/null | wc -l)
  count=${count:-0}
  suffix=$(printf '%c' $((97 + count)))
  archive="${turn_dir}${suffix}"

  echo -e "${YELLOW}Archiving turn-$turn → turn-$turn$suffix${RESET}"

  # Save campaign snapshot before archiving
  mkdir -p "$turn_dir/campaign-snapshot"
  cp "$campaign_dir"/*.yaml "$turn_dir/campaign-snapshot/" 2>/dev/null || true

  mv "$turn_dir" "$archive"
  echo -e "${GREEN}✓ Archived to $archive${RESET}"
else
  echo -e "${CYAN}No turn-$turn directory to archive${RESET}"
fi

# Step 2: Restore campaign state from archived turn's snapshot
# (init-turn saves snapshot at START of turn, so it's in the turn we just archived)
if [[ -n "${archive:-}" && -d "$archive/campaign-snapshot" ]]; then
  echo -e "${YELLOW}Restoring campaign state from archived turn's snapshot${RESET}"
  cp "$archive/campaign-snapshot"/*.yaml "$campaign_dir/" 2>/dev/null || true
  echo -e "${GREEN}✓ Campaign state restored from $archive/campaign-snapshot/${RESET}"
elif [[ -d "$prior_dir/campaign-snapshot" ]]; then
  # Fallback: check prior turn (old behavior)
  echo -e "${YELLOW}Restoring campaign state from turn-$prior_turn snapshot${RESET}"
  cp "$prior_dir/campaign-snapshot"/*.yaml "$campaign_dir/" 2>/dev/null || true
  echo -e "${GREEN}✓ Campaign state restored${RESET}"
else
  echo -e "${YELLOW}No snapshot found, manually fixing state.yaml${RESET}"

  # Update state.yaml current_turn
  if [[ -f "$campaign_dir/state.yaml" ]]; then
    sed -i "s/^current_turn:.*/current_turn: $prior_turn/" "$campaign_dir/state.yaml"
    sed -i "s/^last_updated:.*/last_updated: $(date -u +%Y-%m-%dT%H:%M:%SZ)/" "$campaign_dir/state.yaml"
    echo -e "${GREEN}✓ state.yaml updated to turn $prior_turn${RESET}"
  fi
fi

# Step 3: Reset session
echo -e "${YELLOW}Resetting session to turn $prior_turn complete${RESET}"
cat > "$SESSION" << EOF
phase: complete
turn: $prior_turn
game_id: $game_id
campaign_id: $campaign_id
workspace: $prior_dir/
game_path: $game_path
entropy_pool: []
render_narrator: false
validate_oracle: false
compress_scribe: false
status: active
EOF
echo -e "${GREEN}✓ Session reset${RESET}"

echo ""
echo -e "${GREEN}=== REDO COMPLETE ===${RESET}"
echo -e "Turn $turn archived. State reset to turn $prior_turn."
echo -e "Ready to run turn $turn fresh."
