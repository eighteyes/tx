#!/usr/bin/env bash
# increment-turn.sh
# Increments turn number and workspace path in session.yaml
# Run BEFORE spawning init-turn so manifest resolves to correct paths

set -euo pipefail

# Find session.yaml
SESSION_FILE="${TX_CWD:-.}/.ai/tx/narrative-engine/session.yaml"

if [[ ! -f "$SESSION_FILE" ]]; then
  echo "ERROR: session.yaml not found at $SESSION_FILE" >&2
  exit 1
fi

# Read current values
CURRENT_TURN=$(yq '.turn' "$SESSION_FILE")
GAME_PATH=$(yq '.game_path' "$SESSION_FILE")
CAMPAIGN_ID=$(yq '.campaign_id' "$SESSION_FILE")

if [[ -z "$CURRENT_TURN" || "$CURRENT_TURN" == "null" ]]; then
  echo "ERROR: No turn number in session.yaml" >&2
  exit 1
fi

# Increment turn (bash arithmetic, not LLM)
NEW_TURN=$((CURRENT_TURN + 1))

# Build new workspace path
NEW_WORKSPACE="${GAME_PATH}campaigns/${CAMPAIGN_ID}/turns/turn-${NEW_TURN}"

# Create the workspace directory
mkdir -p "$NEW_WORKSPACE"

# Update session.yaml
yq -i ".turn = $NEW_TURN" "$SESSION_FILE"
yq -i ".workspace = \"$NEW_WORKSPACE\"" "$SESSION_FILE"
yq -i ".phase = \"awaiting_prep\"" "$SESSION_FILE"

echo "Turn incremented: $CURRENT_TURN → $NEW_TURN"
echo "Workspace: $NEW_WORKSPACE"
