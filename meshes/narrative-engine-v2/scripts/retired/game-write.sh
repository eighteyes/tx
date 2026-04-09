#!/usr/bin/env bash
# game-write.sh - Validate JSON from stdin and write YAML game artifacts
#
# Usage: game-write.sh <workspace> <artifact> [--target=PATH]
#   Reads JSON from stdin, validates against schemas/game/<artifact>.schema.jq,
#   then writes to <workspace>/<artifact>.yaml using the configured write mode.
#
# Entity slash addressing:
#   character/heather  -> schema: character.schema.jq, file: entities/characters/heather.yaml
#   bond/kai_heath     -> schema: bond.schema.jq, file: entities/bonds/kai_heath.yaml
#   author             -> schema: author.schema.jq, file: author.yaml
#
# Write modes (configured in schemas/game/modes.json):
#   overwrite - Replace file entirely (all game artifacts use overwrite)
#
# Exit codes:
#   0 - Success
#   1 - Validation error
#   2 - Malformed JSON
#   3 - Unknown artifact (no schema)
#   4 - Write mode error

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LEVEL="game"
SCHEMA_SUBDIR="game"

# ─────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────

show_help() {
  cat >&2 <<'USAGE'
game-write.sh — Validate JSON and write YAML game artifacts

Usage:
  echo '<json>' | game-write.sh <path> <artifact> [flags]

Arguments:
  path        Path to the game directory
  artifact    Schema name (auto-discovered from schemas/game/)
              Entity-scoped: character/heather, bond/kaitlin_heather

Flags:
  --target=PATH   For append mode: jq path to target array (e.g., .used_factoids)
  --help          Show this help

Write Modes (from schemas/game/modes.json):
  overwrite   Replace file entirely (default)
  append      Append to --target array in existing YAML
  patch       Deep merge incoming JSON into existing YAML
  delta       Apply arithmetic deltas, merge non-delta fields

Exit Codes:
  0  Success
  1  Validation error (unknown keys, missing keys, type mismatch)
  2  Malformed JSON (stdin not valid JSON)
  3  Unknown artifact (no schema found)
  4  Write mode error (invalid transition, missing target, no existing file for delta)

Errors:
  Structured JSON on stderr: {"ok":false, "artifact":"...", "errors":[...]}

USAGE

  echo "Available Artifacts:" >&2
  for f in "$SCRIPT_DIR/schemas/game"/*.schema.jq; do
    [[ -f "$f" ]] || continue
    echo "  $(basename "$f" .schema.jq)" >&2
  done

  cat >&2 <<'EXAMPLES'

Examples:
  echo '{"voice":"literary"}' | game-write.sh ./game author
  echo '{"id":"heather","name":"Heather"}' | game-write.sh ./game character/heather
  echo '{"trust":5}' | game-write.sh ./game bond/kaitlin_heather
EXAMPLES
  exit 0
}

# ─────────────────────────────────────────────
# SOURCE COMMON
# ─────────────────────────────────────────────

source "$SCRIPT_DIR/write-common.sh"

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

parse_write_args "$@"

SCHEMA_DIR="$SCRIPT_DIR/schemas"
resolve_schema_name "$ARTIFACT"
resolve_entity_path "$WORKSPACE" "$ARTIFACT"

SCHEMA_FILE="$SCHEMA_DIR/game/${SCHEMA_TYPE}.schema.jq"

if [[ ! -f "$SCHEMA_FILE" ]]; then
  err_json "$ARTIFACT" 3 "[{\"type\":\"unknown_artifact\",\"artifact\":\"$ARTIFACT\"}]"
fi

resolve_write_mode "$SCHEMA_TYPE"
validate_input
apply_write "$SCHEMA_TYPE"
