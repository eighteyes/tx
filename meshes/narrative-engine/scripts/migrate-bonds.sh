#!/bin/bash
# migrate-bonds.sh
# Extract bonds from character entities into first-class bond entities
# Creates entities/bonds/{a_b}.yaml files

set -euo pipefail

CAMPAIGN_PATH="${1:-}"

if [[ -z "$CAMPAIGN_PATH" ]]; then
  echo "Usage: migrate-bonds.sh <campaign_path>"
  echo "Example: migrate-bonds.sh ./{game-id}/campaigns/campaign-1"
  exit 1
fi

if [[ ! -d "$CAMPAIGN_PATH" ]]; then
  echo "Error: Campaign path not found: $CAMPAIGN_PATH"
  exit 1
fi

ENTITIES_DIR="$CAMPAIGN_PATH/entities"
BONDS_DIR="$ENTITIES_DIR/bonds"
CHARS_DIR="$ENTITIES_DIR/characters"

# Create bonds directory
mkdir -p "$BONDS_DIR"

# Track processed bonds to avoid duplicates
declare -A PROCESSED_BONDS

# Function to get alphabetically ordered bond ID
get_bond_id() {
  local a="$1"
  local b="$2"
  if [[ "$a" < "$b" ]]; then
    echo "${a}_${b}"
  else
    echo "${b}_${a}"
  fi
}

# Process each character file
if [[ -d "$CHARS_DIR" ]]; then
  for char_file in "$CHARS_DIR"/*.yaml; do
    [[ -f "$char_file" ]] || continue

    CHAR_ID=$(yq -r '.id // ""' "$char_file" 2>/dev/null)
    [[ -z "$CHAR_ID" ]] && continue

    # Extract bonds array
    BONDS=$(yq -r '.bonds[]? | .entity // .target // empty' "$char_file" 2>/dev/null || true)

    for target in $BONDS; do
      [[ -z "$target" ]] && continue

      BOND_ID=$(get_bond_id "$CHAR_ID" "$target")

      # Skip if already processed
      [[ -n "${PROCESSED_BONDS[$BOND_ID]:-}" ]] && continue
      PROCESSED_BONDS[$BOND_ID]=1

      BOND_FILE="$BONDS_DIR/${BOND_ID}.yaml"

      # Extract bond data from character file
      BOND_LEVEL=$(yq -r ".bonds[]? | select(.entity == \"$target\" or .target == \"$target\") | .bond_level // .strength // 5" "$char_file" 2>/dev/null || echo "5")
      BOND_STATUS=$(yq -r ".bonds[]? | select(.entity == \"$target\" or .target == \"$target\") | .status // \"unknown\"" "$char_file" 2>/dev/null || echo "unknown")

      # Determine alphabetical order for participants
      if [[ "$CHAR_ID" < "$target" ]]; then
        PART_A="$CHAR_ID"
        PART_B="$target"
      else
        PART_A="$target"
        PART_B="$CHAR_ID"
      fi

      # Create bond entity
      cat > "$BOND_FILE" << EOF
# Bond entity: $BOND_ID
# Migrated from character entities
# Migration date: $(date -Iseconds)

id: $BOND_ID
entity_type: bond
participants: [$PART_A, $PART_B]
intensity: $BOND_LEVEL

traits:
  evolved: {}
  voices: {}

episodes:
  - turn: 0
    event: "Bond migrated from character entities"
    intensity_change: "initial → $BOND_LEVEL"
    note: "status was: $BOND_STATUS"
EOF

      echo "Created: $BOND_FILE"
    done
  done
fi

# Count results
BOND_COUNT=$(ls -1 "$BONDS_DIR"/*.yaml 2>/dev/null | wc -l || echo "0")
echo ""
echo "Migration complete. Created $BOND_COUNT bond entities in $BONDS_DIR"
echo ""
echo "Next steps:"
echo "1. Review bond files and add trait information"
echo "2. Update character files to reference bonds by ID only"
