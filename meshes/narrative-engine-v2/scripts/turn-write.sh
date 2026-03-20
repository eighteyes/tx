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

# ─────────────────────────────────────────────
# COLORS (stderr only)
# ─────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# ─────────────────────────────────────────────
# CLEANUP
# ─────────────────────────────────────────────

TMPFILES=()
cleanup() { rm -f "${TMPFILES[@]}" 2>/dev/null || true; }
trap cleanup EXIT

mktmp() {
  local f
  f=$(mktemp)
  TMPFILES+=("$f")
  echo "$f"
}

# ─────────────────────────────────────────────
# ERROR HELPERS
# ─────────────────────────────────────────────

err_json() {
  local artifact="$1" code="$2"
  shift 2
  local errors="$*"
  echo "{\"ok\":false,\"artifact\":\"$artifact\",\"errors\":$errors}" >&2
  exit "$code"
}

# ─────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────

show_help() {
  cat >&2 <<'USAGE'
turn-write.sh — Validate JSON and write YAML turn artifacts

Usage:
  turn-write.sh <workspace> <artifact> [--target=PATH]
  echo '{"branches":[],"seeds":[]}' | turn-write.sh ./ws fates

Arguments:
  workspace   Directory to write the artifact YAML into
  artifact    Schema name (e.g. fates, violations, sim-progress)

Options:
  --target=PATH   YAML path for append mode (e.g. .violations)
  --help          Show this help

Write Modes (from schemas/turn/modes.json):
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
# PARSE ARGS
# ─────────────────────────────────────────────

TARGET=""
POSITIONAL=()

for arg in "$@"; do
  case "$arg" in
    --help|-h) show_help ;;
    --target=*) TARGET="${arg#--target=}" ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

if [[ ${#POSITIONAL[@]} -lt 2 ]]; then
  echo -e "${RED}Error: requires <workspace> <artifact> arguments${NC}" >&2
  echo "Run with --help for usage." >&2
  exit 1
fi

WORKSPACE="${POSITIONAL[0]}"
ARTIFACT="${POSITIONAL[1]}"

# ─────────────────────────────────────────────
# RESOLVE SCHEMA
# ─────────────────────────────────────────────

SCHEMA_DIR="$SCRIPT_DIR/schemas"
SCHEMA_FILE="$SCHEMA_DIR/turn/${ARTIFACT}.schema.jq"

if [[ ! -f "$SCHEMA_FILE" ]]; then
  err_json "$ARTIFACT" 3 "[{\"type\":\"unknown_artifact\",\"artifact\":\"$ARTIFACT\"}]"
fi

# ─────────────────────────────────────────────
# READ STDIN
# ─────────────────────────────────────────────

INPUT_FILE=$(mktmp)
cat > "$INPUT_FILE"

# Verify valid JSON
if ! jq empty < "$INPUT_FILE" 2>/dev/null; then
  err_json "$ARTIFACT" 2 "[{\"type\":\"malformed_json\",\"detail\":\"stdin is not valid JSON\"}]"
fi

# ─────────────────────────────────────────────
# VALIDATE
# ─────────────────────────────────────────────

VALIDATION_RESULT=$(mktmp)
if ! jq -L "$SCHEMA_DIR" -f "$SCHEMA_FILE" < "$INPUT_FILE" > "$VALIDATION_RESULT" 2>&1; then
  err_json "$ARTIFACT" 1 "[{\"type\":\"jq_error\",\"detail\":\"schema evaluation failed\"}]"
fi

# Check validation outcome
if ! jq -e '. == true' < "$VALIDATION_RESULT" > /dev/null 2>&1; then
  # Extract errors array from the validation result
  ERRORS=$(jq -c '.errors // []' < "$VALIDATION_RESULT" 2>/dev/null || echo '[]')
  err_json "$ARTIFACT" 1 "$ERRORS"
fi

# ─────────────────────────────────────────────
# RESOLVE WRITE MODE
# ─────────────────────────────────────────────

MODES_FILE="$SCHEMA_DIR/turn/modes.json"
MODE="overwrite"

if [[ -f "$MODES_FILE" ]]; then
  CONFIGURED_MODE=$(jq -r --arg a "$ARTIFACT" '.[$a].mode // "overwrite"' < "$MODES_FILE" 2>/dev/null || echo "overwrite")
  MODE="$CONFIGURED_MODE"
fi

# ─────────────────────────────────────────────
# WRITE
# ─────────────────────────────────────────────

mkdir -p "$WORKSPACE"
OUTPUT_FILE="$WORKSPACE/${ARTIFACT}.yaml"

case "$MODE" in
  overwrite)
    yq -P < "$INPUT_FILE" > "$OUTPUT_FILE"
    ;;

  append)
    # Determine target path
    if [[ -z "$TARGET" ]]; then
      # Read allowed_targets from modes.json, use first as default
      TARGET=$(jq -r --arg a "$ARTIFACT" '.[$a].allowed_targets[0] // ""' < "$MODES_FILE" 2>/dev/null || echo "")
    fi
    if [[ -z "$TARGET" ]]; then
      err_json "$ARTIFACT" 4 "[{\"type\":\"write_mode_error\",\"detail\":\"append mode requires --target or allowed_targets in modes.json\"}]"
    fi

    if [[ -f "$OUTPUT_FILE" ]]; then
      # Read incoming JSON array items and append each to the target array
      MERGED=$(mktmp)
      # Convert input JSON to YAML, then merge into existing file at target path
      yq eval-all "select(fi == 0) as \$base | select(fi == 1) as \$new | \$base | ${TARGET} += \$new${TARGET}" \
        "$OUTPUT_FILE" <(yq -P < "$INPUT_FILE") > "$MERGED"
      mv "$MERGED" "$OUTPUT_FILE"
    else
      # No existing file — just write
      yq -P < "$INPUT_FILE" > "$OUTPUT_FILE"
    fi
    ;;

  patch)
    if [[ -f "$OUTPUT_FILE" ]]; then
      MERGED=$(mktmp)
      # Deep merge: new values override existing
      yq eval-all 'select(fi == 0) * select(fi == 1)' \
        "$OUTPUT_FILE" <(yq -P < "$INPUT_FILE") > "$MERGED"
      mv "$MERGED" "$OUTPUT_FILE"
    else
      yq -P < "$INPUT_FILE" > "$OUTPUT_FILE"
    fi
    ;;

  delta)
    if [[ ! -f "$OUTPUT_FILE" ]]; then
      err_json "$ARTIFACT" 4 "[{\"type\":\"write_mode_error\",\"detail\":\"delta mode requires existing file\"}]"
    fi
    MERGED=$(mktmp)
    # For delta: add numeric values, merge non-numeric
    # This is a simplified implementation — full delta logic to be expanded
    yq eval-all 'select(fi == 0) * select(fi == 1)' \
      "$OUTPUT_FILE" <(yq -P < "$INPUT_FILE") > "$MERGED"
    mv "$MERGED" "$OUTPUT_FILE"
    ;;

  *)
    err_json "$ARTIFACT" 4 "[{\"type\":\"write_mode_error\",\"detail\":\"unknown mode: $MODE\"}]"
    ;;
esac

echo -e "${GREEN}ok${NC} ${ARTIFACT} → ${OUTPUT_FILE}" >&2
