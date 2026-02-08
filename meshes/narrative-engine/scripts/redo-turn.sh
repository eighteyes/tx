#!/usr/bin/env bash
# redo-turn.sh - Archive turn and reset session for redo
# Archives specified turn, resets session to prior turn
# Usage: ./redo-turn.sh <turn-number>

set -euo pipefail

ROOT="${TX_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SESSION="$ROOT/.ai/tx/narrative-engine/session.yaml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

# Require turn number
if [[ $# -lt 1 ]]; then
  echo -e "${RED}Usage: redo-turn.sh <turn-number>${RESET}"
  echo -e "Example: redo-turn.sh 22"
  exit 1
fi

turn=$1

echo -e "${CYAN}=== REDO TURN $turn ===${RESET}"

# Read session
if [[ ! -f "$SESSION" ]]; then
  echo -e "${RED}No session.yaml found${RESET}"
  exit 1
fi

game_id=$(yq -r '.game_id // "null"' "$SESSION")
campaign_id=$(yq -r '.campaign_id // "null"' "$SESSION")
game_path=$(yq -r '.game_path // "null"' "$SESSION")

if [[ "$game_id" == "null" || "$game_path" == "null" ]]; then
  echo -e "${RED}No active game in session${RESET}"
  exit 1
fi

echo -e "Game: ${GREEN}$game_id${RESET}"
echo -e "Campaign: ${GREEN}$campaign_id${RESET}"
echo -e "Redoing turn: ${YELLOW}$turn${RESET}"

campaign_dir="$game_path/campaigns/$campaign_id"
turn_dir="$campaign_dir/turns/turn-$turn"
prior_turn=$((turn - 1))
prior_dir="$campaign_dir/turns/turn-$prior_turn"

# Archive current turn if it exists
if [[ -d "$turn_dir" ]]; then
  # Find next available archive suffix (a, b, c, etc.)
  # Must check that target doesn't exist (handles polluted dirs like turn-221)
  for i in {0..25}; do
    suffix=$(printf '%c' $((97 + i)))
    archive="${turn_dir}${suffix}"
    if [[ ! -e "$archive" ]]; then
      break
    fi
  done

  if [[ -e "$archive" ]]; then
    echo -e "${RED}Error: All archive slots (a-z) exhausted for turn-$turn${RESET}"
    exit 1
  fi

  echo -e "${YELLOW}Archiving turn-$turn → turn-$turn$suffix${RESET}"
  mv "$turn_dir" "$archive"
  echo -e "${GREEN}✓ Archived to $archive${RESET}"
else
  echo -e "${CYAN}No turn-$turn directory to archive${RESET}"
fi

# Reset session to prior turn
echo -e "${YELLOW}Resetting session to turn $prior_turn complete${RESET}"
cat > "$SESSION" << EOF
phase: complete
turn: $prior_turn
game_id: $game_id
campaign_id: $campaign_id
workspace: $prior_dir/
game_path: $game_path
render_narrator: false
validate_oracle: false
compress_scribe: false
status: active
EOF
echo -e "${GREEN}✓ Session reset${RESET}"

echo ""
echo -e "${GREEN}=== REDO COMPLETE ===${RESET}"
echo -e "Turn $turn archived. Session reset to turn $prior_turn."
echo -e "Run init-turn to start turn $turn fresh."
