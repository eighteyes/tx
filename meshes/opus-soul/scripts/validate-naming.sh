#!/bin/bash
# validate-naming.sh
# Validates concept/thread file names have no filler words
# Filler words: the, that, of, for, as, is
#
# Usage: bash validate-naming.sh [vault-dir]
# Exit code: 0 = clean, 1 = violations found

VAULT_DIR="${1:-.ai/know/opus-soul}"
FILLER_REGEX='(^|-)(the|that|of|for|as|is)(-|\.md$)'
VIOLATIONS=0

echo "=== Naming Validation ==="
echo "Filler words banned: the, that, of, for, as, is"
echo ""

for dir in concepts threads; do
  DIR_PATH="$VAULT_DIR/$dir"
  [ ! -d "$DIR_PATH" ] && continue

  for file in "$DIR_PATH"/*.md; do
    [ ! -f "$file" ] && continue
    basename=$(basename "$file")

    if echo "$basename" | grep -qiE "$FILLER_REGEX"; then
      echo "  ✗ $dir/$basename"
      ((VIOLATIONS++))
    fi
  done
done

echo ""
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "FAIL: $VIOLATIONS files with filler words in name"
  echo "Run: bash meshes/opus-soul/scripts/rename-filler-words.sh $VAULT_DIR"
  exit 1
else
  echo "PASS: All file names clean"
  exit 0
fi
