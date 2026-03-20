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
  game-write.sh <workspace> <artifact> [--target=PATH]
  echo '{"voice":"literary"}' | game-write.sh ./ws author

Arguments:
  workspace   Game directory to write artifacts into
  artifact    Schema name, with optional entity slash addressing:
              character/heather  -> entities/characters/heather.yaml
              bond/kai_heath     -> entities/bonds/kai_heath.yaml
              author             -> author.yaml
              setting            -> setting.yaml
              arc                -> arc.yaml

Options:
  --target=PATH   YAML path for append mode
  --help          Show this help

Write Modes (from schemas/game/modes.json):
  overwrite   Replace file entirely (default for all game artifacts)

Exit Codes:
  0  Success
  1  Validation error
  2  Malformed JSON
  3  Unknown artifact (no schema)
  4  Write mode error
USAGE
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
