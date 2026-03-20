#!/usr/bin/env bash
# campaign-write.sh - Validate JSON from stdin and write YAML campaign artifacts
#
# Usage: campaign-write.sh <workspace> <artifact> [--target=PATH]
#   Reads JSON from stdin, validates against schemas/campaign/<artifact>.schema.jq,
#   then writes to <workspace>/<artifact>.yaml using the configured write mode.
#
# Entity slash addressing:
#   character/kaitlin  -> schema: character.schema.jq, file: entities/characters/kaitlin.yaml
#   bond/kaitlin_heather -> schema: bond.schema.jq, file: entities/bonds/kaitlin_heather.yaml
#   condition/wounded  -> schema: condition.schema.jq, file: entities/conditions/wounded.yaml
#   continuity         -> schema: continuity.schema.jq, file: continuity.yaml
#
# Write modes (configured in schemas/campaign/modes.json):
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

LEVEL="campaign"
SCHEMA_SUBDIR="campaign"

# ─────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────

show_help() {
  cat >&2 <<'USAGE'
campaign-write.sh — Validate JSON and write YAML campaign artifacts

Usage:
  campaign-write.sh <workspace> <artifact> [--target=PATH]
  echo '{"id":"kaitlin","entity_type":"character","name":"Kaitlin"}' | campaign-write.sh ./ws character/kaitlin

Arguments:
  workspace   Campaign directory to write artifacts into
  artifact    Schema name, with optional entity slash addressing:
              character/kaitlin  -> entities/characters/kaitlin.yaml
              bond/kai_heath     -> entities/bonds/kai_heath.yaml
              state              -> state.yaml
              continuity         -> continuity.yaml

Options:
  --target=PATH   YAML path for append mode (e.g. .used_factoids)
  --help          Show this help

Write Modes (from schemas/campaign/modes.json):
  overwrite   Replace file entirely (default)
  append      Append to target array in existing YAML
  patch       Deep merge incoming JSON into existing YAML
  delta       Apply arithmetic deltas, merge non-delta fields

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

SCHEMA_FILE="$SCHEMA_DIR/campaign/${SCHEMA_TYPE}.schema.jq"

if [[ ! -f "$SCHEMA_FILE" ]]; then
  err_json "$ARTIFACT" 3 "[{\"type\":\"unknown_artifact\",\"artifact\":\"$ARTIFACT\"}]"
fi

resolve_write_mode "$SCHEMA_TYPE"
validate_input
apply_write "$SCHEMA_TYPE"
