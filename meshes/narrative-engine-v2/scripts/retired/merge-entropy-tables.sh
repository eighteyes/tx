#!/usr/bin/env bash
# merge-entropy-tables.sh — Assembles entropy_tables/ fragments into entropy-tables.yaml
#
# Usage: merge-entropy-tables.sh <workspace>
#
# Reads:
#   {workspace}/entropy_tables/header.yaml              — synthesis_context (written by architect)
#   {workspace}/entropy_tables/char-*.yaml              — per-character outcome tables (written by character Tasks)
#   {workspace}/entropy_tables/char-*-directions.yaml   — per-character direction tables (written by direction Tasks)
#   {workspace}/entropy_tables/world-*.yaml             — world event tables (written by world Tasks)
#   {workspace}/entropy_tables/texture.yaml             — ambient texture (written by texture Task)
#
# Writes:
#   {workspace}/entropy-tables.yaml            — merged final output

set -euo pipefail

WORKSPACE="${1:?Usage: merge-entropy-tables.sh <workspace>}"
TABLES_DIR="${WORKSPACE}/entropy_tables"
OUTPUT="${WORKSPACE}/entropy-tables.yaml"

if [ ! -d "$TABLES_DIR" ]; then
  echo "ERROR: entropy_tables/ directory not found at $TABLES_DIR" >&2
  exit 1
fi

# Start with header (synthesis context, turn number)
if [ -f "$TABLES_DIR/header.yaml" ]; then
  cat "$TABLES_DIR/header.yaml"
else
  echo "# WARNING: No header.yaml found — synthesis_context missing"
fi

echo ""
echo "character_tables:"

# Append each character outcome table (exclude direction tables)
for f in "$TABLES_DIR"/char-*.yaml; do
  [ -f "$f" ] || continue
  # Skip direction table files (char-*-directions.yaml)
  case "$f" in
    *-directions.yaml) continue ;;
    *-emergent-beat-*.yaml) continue ;;
  esac
  char_name=$(basename "$f" .yaml | sed 's/^char-//')
  echo "  ${char_name}:"
  # Indent the file contents by 4 spaces under the character key
  sed 's/^/    /' "$f"
  echo ""
done

echo "direction_tables:"

# Append each character direction table
has_directions=false
for f in "$TABLES_DIR"/char-*-directions.yaml; do
  [ -f "$f" ] || continue
  has_directions=true
  char_name=$(basename "$f" .yaml | sed 's/^char-//' | sed 's/-directions$//')
  echo "  ${char_name}:"
  # Indent the file contents by 4 spaces under the character key
  sed 's/^/    /' "$f"
  echo ""
done
if [ "$has_directions" = false ]; then
  echo "  # No direction tables generated (action_weight > 0.7 or no threads available)"
fi

echo "world_event_table:"

# Append each world event table
for f in "$TABLES_DIR"/world-*.yaml; do
  [ -f "$f" ] || continue
  # World files contain one or more events, already keyed
  sed 's/^/  /' "$f"
  echo ""
done

echo "ambient_texture:"

# Append texture
if [ -f "$TABLES_DIR/texture.yaml" ]; then
  sed 's/^/  /' "$TABLES_DIR/texture.yaml"
else
  echo "  # WARNING: No texture.yaml found"
fi
