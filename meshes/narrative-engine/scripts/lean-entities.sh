#!/bin/bash
# lean-entities.sh
# Convert character entities to lean format
# Removes redundant fields, keeps episodes and evolved traits

set -euo pipefail

CAMPAIGN_PATH="${1:-}"

if [[ -z "$CAMPAIGN_PATH" ]]; then
  echo "Usage: lean-entities.sh <campaign_path>"
  echo "Example: lean-entities.sh ./heathers-hope/campaigns/campaign-1"
  exit 1
fi

if [[ ! -d "$CAMPAIGN_PATH" ]]; then
  echo "Error: Campaign path not found: $CAMPAIGN_PATH"
  exit 1
fi

CHARS_DIR="$CAMPAIGN_PATH/entities/characters"
ARCHIVE_DIR="$CAMPAIGN_PATH/archive/entities"

# Create archive directory
mkdir -p "$ARCHIVE_DIR"

if [[ ! -d "$CHARS_DIR" ]]; then
  echo "No characters directory found at: $CHARS_DIR"
  exit 0
fi

# Process each character file
for char_file in "$CHARS_DIR"/*.yaml; do
  [[ -f "$char_file" ]] || continue

  FILENAME=$(basename "$char_file")
  echo "Processing: $FILENAME"

  # Backup original
  cp "$char_file" "$ARCHIVE_DIR/${FILENAME}.pre-lean"

  # Create temp file for yq filter
  FILTER_FILE=$(mktemp)
  cat > "$FILTER_FILE" << 'FILTER'
del(.current_state.trait_pressures) |
del(.current_state.bond_level) |
del(.internal_state) |
del(.emotional_baseline) |
del(.fears) |
del(.hopes) |
del(.internal_voices) |
.format_version = "lean-v1"
FILTER

  # Create temp file for output
  TEMP_FILE=$(mktemp)

  # Apply filter (works with both yq versions)
  if yq --version 2>&1 | grep -q "mikefarah"; then
    # Go version of yq
    yq eval "$(cat "$FILTER_FILE")" "$char_file" > "$TEMP_FILE"
  else
    # Python version of yq
    yq -y "$(cat "$FILTER_FILE")" "$char_file" > "$TEMP_FILE" 2>/dev/null || {
      # If yq fails, just copy and note it
      cp "$char_file" "$TEMP_FILE"
      echo "  → Note: yq filter skipped (complex file), manual review needed"
    }
  fi

  mv "$TEMP_FILE" "$char_file"
  rm -f "$FILTER_FILE"
  echo "  → Processed"
done

echo ""
echo "Lean conversion complete."
echo "Original files archived in: $ARCHIVE_DIR"
echo ""
echo "Fields targeted for removal:"
echo "  - current_state.trait_pressures (now in traits.evolved)"
echo "  - current_state.bond_* (now in entities/bonds/)"
echo "  - internal_state prose blobs"
echo "  - emotional_baseline, fears, hopes (redundant)"
echo ""
echo "Review character files and update bonds[] to reference bond IDs."
