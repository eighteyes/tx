#!/usr/bin/env bash
# snapshot-campaign.sh - Save campaign state before turn execution
# Called by init-turn before any turn work begins
# Usage: ./snapshot-campaign.sh

set -euo pipefail

ROOT="${TX_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SESSION="$ROOT/.ai/tx/narrative-engine/session.yaml"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RESET='\033[0m'

# Read session
if [[ ! -f "$SESSION" ]]; then
  echo "No session.yaml found" >&2
  exit 1
fi

game_path=$(yq -r '.game_path // "null"' "$SESSION")
campaign_id=$(yq -r '.campaign_id // "null"' "$SESSION")
turn=$(yq -r '.turn // 0' "$SESSION")

if [[ "$game_path" == "null" || "$campaign_id" == "null" ]]; then
  echo "No active game in session" >&2
  exit 1
fi

campaign_dir="$game_path/campaigns/$campaign_id"
snapshot_dir="$campaign_dir/turns/turn-$turn/campaign-snapshot"

# Create snapshot directory
mkdir -p "$snapshot_dir"

# Copy all campaign yaml files
cp "$campaign_dir"/*.yaml "$snapshot_dir/" 2>/dev/null || true

echo -e "${GREEN}✓ Campaign snapshot saved to turn-$turn/campaign-snapshot/${RESET}"
