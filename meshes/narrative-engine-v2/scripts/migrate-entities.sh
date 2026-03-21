#!/usr/bin/env bash
set -euo pipefail

BASE="${1:?Usage: migrate-entities.sh <game_or_campaign_path>}"
ENTITIES_FILE="$BASE/entities.yaml"

[[ -f "$ENTITIES_FILE" ]] || { echo "No entities.yaml at $BASE — skipping" >&2; exit 0; }

mkdir -p "$BASE/entities/characters" "$BASE/entities/bonds"

# Extract characters
CHAR_IDS=$(yq -r '.characters | keys | .[]' "$ENTITIES_FILE" 2>/dev/null || true)
for id in $CHAR_IDS; do
  [[ -z "$id" ]] && continue
  TARGET="$BASE/entities/characters/$id.yaml"
  if [[ -f "$TARGET" ]]; then
    echo "SKIP: $TARGET already exists" >&2
    continue
  fi
  yq ".characters.$id" "$ENTITIES_FILE" | yq ".id = \"$id\" | .entity_type = \"character\"" > "$TARGET"
  echo "Created: $TARGET" >&2
done

# Extract dynamics/bonds
DYN_IDS=$(yq -r '.dynamics | keys | .[]' "$ENTITIES_FILE" 2>/dev/null || true)
for id in $DYN_IDS; do
  [[ -z "$id" ]] && continue
  TARGET="$BASE/entities/bonds/$id.yaml"
  if [[ -f "$TARGET" ]]; then
    echo "SKIP: $TARGET already exists" >&2
    continue
  fi
  yq ".dynamics.$id" "$ENTITIES_FILE" | yq ".bond_id = \"$id\" | .type = \"bond\"" > "$TARGET"
  echo "Created: $TARGET" >&2
done

echo "Migration complete. Review files, then remove $ENTITIES_FILE" >&2
