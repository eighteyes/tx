#!/bin/bash
# rename-filler-words.sh
# Removes filler words (the, that, of, for, as, is) from concept file names
# and updates ALL wiki-link references across the vault
#
# Usage: bash rename-filler-words.sh [--dry-run]

VAULT_DIR="${1:-.ai/know/opus-soul}"
DRY_RUN="${2:-}"
CONCEPTS_DIR="$VAULT_DIR/concepts"

if [ ! -d "$CONCEPTS_DIR" ]; then
  echo "ERROR: concepts dir not found at $CONCEPTS_DIR"
  exit 1
fi

FILLER_WORDS="the|that|of|for|as|is"
RENAME_COUNT=0
REF_COUNT=0

echo "=== Filler Word Rename ==="
echo "Vault: $VAULT_DIR"
echo "Filler words: $FILLER_WORDS"
echo ""

# Build rename map
declare -A RENAME_MAP

for file in "$CONCEPTS_DIR"/*.md; do
  basename=$(basename "$file" .md)

  # Remove filler words between hyphens, at start, or at end
  newname=$(echo "$basename" | sed -E "s/(^|-)(the|that|of|for|as|is)(-|$)/\1/g; s/(^|-)(the|that|of|for|as|is)(-|$)/\1/g" | sed -E 's/^-+//; s/-+$//; s/-{2,}/-/g')

  if [ "$basename" != "$newname" ] && [ -n "$newname" ]; then
    RENAME_MAP["$basename"]="$newname"
  fi
done

echo "Files to rename: ${#RENAME_MAP[@]}"
echo ""

# Show rename plan
for old in $(echo "${!RENAME_MAP[@]}" | tr ' ' '\n' | sort); do
  new="${RENAME_MAP[$old]}"
  echo "  $old.md → $new.md"
done

echo ""

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "DRY RUN - no changes made"
  exit 0
fi

echo "=== Renaming files ==="

for old in "${!RENAME_MAP[@]}"; do
  new="${RENAME_MAP[$old]}"

  if [ -f "$CONCEPTS_DIR/$old.md" ]; then
    mv "$CONCEPTS_DIR/$old.md" "$CONCEPTS_DIR/$new.md"
    echo "  ✓ $old.md → $new.md"
    ((RENAME_COUNT++))
  fi
done

echo ""
echo "=== Updating references ==="

# Update all wiki-links and text references across ALL vault files
for old in "${!RENAME_MAP[@]}"; do
  new="${RENAME_MAP[$old]}"

  # Search and replace in all .md files in the vault
  find "$VAULT_DIR" -name "*.md" -type f | while read -r mdfile; do
    if grep -q "$old" "$mdfile" 2>/dev/null; then
      # Replace [[old-name]] with [[new-name]]
      sed -i "s|\[\[$old\]\]|\[\[$new\]\]|g" "$mdfile"
      # Replace [[concepts/old-name]] with [[concepts/new-name]]
      sed -i "s|\[\[concepts/$old\]\]|\[\[concepts/$new\]\]|g" "$mdfile"
      # Replace in frontmatter (parent, related, orthogonal fields)
      sed -i "s|$old|$new|g" "$mdfile"
      ((REF_COUNT++))
    fi
  done
done

echo ""
echo "=== Complete ==="
echo "Files renamed: $RENAME_COUNT"
echo "Files with updated references: $REF_COUNT"
