#!/bin/bash
# clean-orphans.sh
# Archive deprecated campaign files after migration
# Removes: entities.yaml, history.md, thread.md, character-memory.yaml

set -euo pipefail

CAMPAIGN_PATH="${1:-}"

if [[ -z "$CAMPAIGN_PATH" ]]; then
  echo "Usage: clean-orphans.sh <campaign_path>"
  echo "Example: clean-orphans.sh ./{game-id}/campaigns/campaign-1"
  exit 1
fi

if [[ ! -d "$CAMPAIGN_PATH" ]]; then
  echo "Error: Campaign path not found: $CAMPAIGN_PATH"
  exit 1
fi

ARCHIVE_DIR="$CAMPAIGN_PATH/archive"
mkdir -p "$ARCHIVE_DIR"

# Files to archive (deprecated but may contain useful history)
ARCHIVE_FILES=(
  "entities.yaml"
  "history.md"
  "thread.md"
  "character-memory.yaml"
  "violations.yaml"
)

echo "Archiving deprecated files from: $CAMPAIGN_PATH"
echo ""

for file in "${ARCHIVE_FILES[@]}"; do
  filepath="$CAMPAIGN_PATH/$file"
  if [[ -f "$filepath" ]]; then
    mv "$filepath" "$ARCHIVE_DIR/${file}.deprecated"
    echo "Archived: $file → archive/"
  else
    echo "Not found (skip): $file"
  fi
done

echo ""
echo "Cleanup complete."
echo "Archived files are in: $ARCHIVE_DIR"
echo ""
echo "These files are no longer used:"
echo "  - entities.yaml → relationships now in entities/bonds/"
echo "  - history.md → redundant with turn summaries"
echo "  - thread.md → redundant with arc.yaml"
echo "  - character-memory.yaml → redundant with entity episodes"
echo "  - violations.yaml → turn-level only (ephemeral)"
