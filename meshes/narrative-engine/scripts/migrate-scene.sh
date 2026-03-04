#!/bin/bash
# migrate-scene.sh
# Migrate state.yaml + last-turn-closing.yaml → scene.yaml
# Creates scene.yaml from existing campaign state files

set -euo pipefail

CAMPAIGN_PATH="${1:-}"

if [[ -z "$CAMPAIGN_PATH" ]]; then
  echo "Usage: migrate-scene.sh <campaign_path>"
  echo "Example: migrate-scene.sh ./{game-id}/campaigns/campaign-1"
  exit 1
fi

if [[ ! -d "$CAMPAIGN_PATH" ]]; then
  echo "Error: Campaign path not found: $CAMPAIGN_PATH"
  exit 1
fi

STATE_FILE="$CAMPAIGN_PATH/state.yaml"
CLOSING_FILE="$CAMPAIGN_PATH/last-turn-closing.yaml"
SCENE_FILE="$CAMPAIGN_PATH/scene.yaml"
ARCHIVE_DIR="$CAMPAIGN_PATH/archive"

# Create archive directory
mkdir -p "$ARCHIVE_DIR"

# Check for source files
if [[ ! -f "$STATE_FILE" ]]; then
  echo "Warning: state.yaml not found, creating minimal scene.yaml"
fi

# Extract values using yq
TURN=$(yq -r '.current_turn // 0' "$STATE_FILE" 2>/dev/null || echo "0")
ARC_PRESSURE=$(yq -r '.arc_pressure // 0' "$STATE_FILE" 2>/dev/null || echo "0")
MOMENTUM=$(yq -r '.momentum // "stable"' "$STATE_FILE" 2>/dev/null || echo "stable")
LOCATION=$(yq -r '.location.current // "unknown"' "$STATE_FILE" 2>/dev/null || echo "unknown")
PHASE=$(yq -r '.phase.current // "rising"' "$STATE_FILE" 2>/dev/null || echo "rising")

# Extract closing state if available
if [[ -f "$CLOSING_FILE" ]]; then
  DOOR=$(yq -r '.literal.door // "unknown"' "$CLOSING_FILE" 2>/dev/null || echo "unknown")
  TIME=$(yq -r '.literal.time_of_day // "unknown"' "$CLOSING_FILE" 2>/dev/null || echo "unknown")
  PROSE_ANCHOR=$(yq -r '.prose_excerpt // ""' "$CLOSING_FILE" 2>/dev/null || echo "")
  SUSPENDED=$(yq -r '.internal.suspended_action // ""' "$CLOSING_FILE" 2>/dev/null || echo "")
else
  DOOR="unknown"
  TIME="unknown"
  PROSE_ANCHOR=""
  SUSPENDED=""
fi

# Write scene.yaml
cat > "$SCENE_FILE" << EOF
# scene.yaml - migrated from state.yaml + last-turn-closing.yaml
# Migration date: $(date -Iseconds)

turn: $TURN

arc:
  pressure: $ARC_PRESSURE
  phase: "$PHASE"
  momentum: "$MOMENTUM"

location: "$LOCATION"
present: []  # TODO: populate from entities
pov_character: protagonist

closing:
  door: "$DOOR"
  positions: {}  # TODO: populate from last-turn-closing.yaml
  objects: []
  time: "$TIME"

suspended:
  action: "$SUSPENDED"
  question: ""

prose_anchor: |
$(echo "$PROSE_ANCHOR" | sed 's/^/  /')
EOF

echo "Created: $SCENE_FILE"

# Archive old files
if [[ -f "$STATE_FILE" ]]; then
  mv "$STATE_FILE" "$ARCHIVE_DIR/state.yaml.pre-migration"
  echo "Archived: state.yaml → archive/"
fi

if [[ -f "$CLOSING_FILE" ]]; then
  mv "$CLOSING_FILE" "$ARCHIVE_DIR/last-turn-closing.yaml.pre-migration"
  echo "Archived: last-turn-closing.yaml → archive/"
fi

echo "Migration complete. Review $SCENE_FILE and populate TODO fields."
