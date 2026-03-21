#!/usr/bin/env bash
# turn-write.sh - Validate JSON from stdin and write YAML turn artifacts
#
# Usage: turn-write.sh <workspace> <artifact> [--target=PATH]
#   Reads JSON from stdin, validates against schemas/turn/<artifact>.schema.jq,
#   then writes to <workspace>/<artifact>.yaml using the configured write mode.
#
# Write modes (configured in schemas/turn/modes.json):
#   overwrite - Replace file entirely (default)
#   append    - Append to a target array in existing YAML
#   patch     - Deep merge incoming JSON into existing YAML
#   delta     - Apply arithmetic deltas to specified fields
#
# Exit codes:
#   0 - Success
#   1 - Validation error
#   2 - Malformed JSON
#   3 - Unknown artifact (no schema)
#   4 - Write mode error

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LEVEL="turn"
SCHEMA_SUBDIR="turn"

# ─────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────

show_help() {
  cat >&2 <<'USAGE'
turn-write.sh — Validate JSON and write YAML turn artifacts

Usage:
  echo '<json>' | turn-write.sh <path> <artifact> [flags]

Arguments:
  path        Path to the turn workspace directory
  artifact    Schema name (auto-discovered from schemas/turn/)

Flags:
  --target=PATH   For append mode: jq path to target array (e.g., .used_factoids)
  --help          Show this help

Write Modes (from schemas/turn/modes.json):
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
  for f in "$SCRIPT_DIR/schemas/turn"/*.schema.jq; do
    [[ -f "$f" ]] || continue
    echo "  $(basename "$f" .schema.jq)" >&2
  done

  cat >&2 <<'EXAMPLES'

Examples:
  echo '{"turn":1,"branches":[],"seeds":[]}' | turn-write.sh ./workspace fates
  echo '{"violation":"..."}' | turn-write.sh ./workspace violations --target=.violations
  echo '{"scenes":[]}' | turn-write.sh ./workspace scene-script
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
SCHEMA_FILE="$SCHEMA_DIR/turn/${ARTIFACT}.schema.jq"

if [[ ! -f "$SCHEMA_FILE" ]]; then
  err_json "$ARTIFACT" 3 "[{\"type\":\"unknown_artifact\",\"artifact\":\"$ARTIFACT\"}]"
fi

resolve_write_mode "$ARTIFACT"
validate_input
OUTPUT_FILE="$WORKSPACE/${ARTIFACT}.yaml"
apply_write "$ARTIFACT"
