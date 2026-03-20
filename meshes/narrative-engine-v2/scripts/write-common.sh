#!/usr/bin/env bash
# write-common.sh - Shared logic for all write scripts (turn, campaign, game)
#
# Sourced by level-specific write scripts. Expects the following variables set before sourcing:
#   LEVEL        - "turn", "campaign", or "game"
#   SCHEMA_SUBDIR - subdirectory under schemas/ (usually same as LEVEL)
#
# Provides:
#   cleanup / mktmp          - temp file management
#   err_json                 - structured error output
#   parse_write_args          - argument parsing (workspace, artifact, --target, --help)
#   resolve_entity_path       - entity slash addressing (character/id -> entities/characters/id.yaml)
#   resolve_schema_name       - extract schema name from slash artifact
#   validate_input            - read stdin, check JSON valid, run schema validation
#   resolve_write_mode        - read modes.json
#   do_overwrite / do_append / do_patch / do_delta - write mode implementations
#   apply_write               - dispatch to correct write mode

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
# PARSE ARGS
# ─────────────────────────────────────────────

# Call: parse_write_args "$@"
# Sets: WORKSPACE, ARTIFACT, TARGET
parse_write_args() {
  TARGET=""
  POSITIONAL=()

  for arg in "$@"; do
    case "$arg" in
      --help|-h)
        if declare -f show_help > /dev/null 2>&1; then
          show_help
        else
          echo "Usage: ${LEVEL}-write.sh <workspace> <artifact> [--target=PATH]" >&2
          exit 0
        fi
        ;;
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
}

# ─────────────────────────────────────────────
# ENTITY ADDRESSING
# ─────────────────────────────────────────────

# resolve_schema_name: extract schema type from slash artifact
# e.g. "character/kaitlin" -> "character", "state" -> "state"
# Sets: SCHEMA_TYPE
resolve_schema_name() {
  local artifact="$1"
  if [[ "$artifact" == */* ]]; then
    SCHEMA_TYPE="${artifact%%/*}"
  else
    SCHEMA_TYPE="$artifact"
  fi
}

# resolve_entity_path: resolve artifact to output file path
# For entity addressing: character/kaitlin -> entities/characters/kaitlin.yaml
# For plain artifacts:   state -> state.yaml
# Sets: OUTPUT_FILE, ENTITY_ID
resolve_entity_path() {
  local workspace="$1" artifact="$2"
  ENTITY_ID=""
  if [[ "$artifact" == */* ]]; then
    local entity_type="${artifact%%/*}"
    ENTITY_ID="${artifact#*/}"
    OUTPUT_FILE="$workspace/entities/${entity_type}s/${ENTITY_ID}.yaml"
  else
    OUTPUT_FILE="$workspace/${artifact}.yaml"
  fi
}

# ─────────────────────────────────────────────
# VALIDATION
# ─────────────────────────────────────────────

# validate_input: read stdin, check JSON, run schema validation
# Expects: SCHEMA_DIR, SCHEMA_FILE, ARTIFACT, MODE set
# Sets: INPUT_FILE
validate_input() {
  INPUT_FILE=$(mktmp)
  cat > "$INPUT_FILE"

  # Verify valid JSON
  if ! jq empty < "$INPUT_FILE" 2>/dev/null; then
    err_json "$ARTIFACT" 2 "[{\"type\":\"malformed_json\",\"detail\":\"stdin is not valid JSON\"}]"
  fi

  # Skip validation for append mode — entries differ from document schema
  if [[ "$MODE" != "append" ]]; then
    local validation_result
    validation_result=$(mktmp)
    if ! jq -L "$SCHEMA_DIR" -f "$SCHEMA_FILE" < "$INPUT_FILE" > "$validation_result" 2>&1; then
      err_json "$ARTIFACT" 1 "[{\"type\":\"jq_error\",\"detail\":\"schema evaluation failed\"}]"
    fi

    # Check validation outcome
    if ! jq -e '. == true' < "$validation_result" > /dev/null 2>&1; then
      local errors
      errors=$(jq -c '.errors // []' < "$validation_result" 2>/dev/null || echo '[]')
      err_json "$ARTIFACT" 1 "$errors"
    fi
  fi
}

# ─────────────────────────────────────────────
# WRITE MODE RESOLUTION
# ─────────────────────────────────────────────

# resolve_write_mode: read modes.json for the artifact's write mode
# Sets: MODE, MODES_FILE
resolve_write_mode() {
  local schema_type="$1"
  MODES_FILE="$SCHEMA_DIR/${SCHEMA_SUBDIR}/modes.json"
  MODE="overwrite"

  if [[ -f "$MODES_FILE" ]]; then
    CONFIGURED_MODE=$(jq -r --arg a "$schema_type" '.[$a].mode // "overwrite"' < "$MODES_FILE" 2>/dev/null || echo "overwrite")
    MODE="$CONFIGURED_MODE"
  fi
}

# ─────────────────────────────────────────────
# WRITE MODE IMPLEMENTATIONS
# ─────────────────────────────────────────────

do_overwrite() {
  yq -P < "$INPUT_FILE" > "$OUTPUT_FILE"
}

do_append() {
  local schema_type="$1"
  # Determine target path
  if [[ -z "$TARGET" ]]; then
    TARGET=$(jq -r --arg a "$schema_type" '.[$a].allowed_targets[0] // ""' < "$MODES_FILE" 2>/dev/null || echo "")
  fi
  if [[ -z "$TARGET" ]]; then
    err_json "$ARTIFACT" 4 "[{\"type\":\"write_mode_error\",\"detail\":\"append mode requires --target or allowed_targets in modes.json\"}]"
  fi

  if [[ -f "$OUTPUT_FILE" ]]; then
    local merged
    merged=$(mktmp)
    yq eval-all "select(fi == 0) as \$base | select(fi == 1) as \$new | \$base | ${TARGET} += [\$new]" \
      "$OUTPUT_FILE" <(yq -P < "$INPUT_FILE") > "$merged"
    mv "$merged" "$OUTPUT_FILE"
  else
    jq --arg target "${TARGET#.}" '{($target): [.]}' < "$INPUT_FILE" | yq -P > "$OUTPUT_FILE"
  fi
}

do_patch() {
  if [[ -f "$OUTPUT_FILE" ]]; then
    local merged
    merged=$(mktmp)
    yq eval-all 'select(fi == 0) * select(fi == 1)' \
      "$OUTPUT_FILE" <(yq -P < "$INPUT_FILE") > "$merged"
    mv "$merged" "$OUTPUT_FILE"
  else
    yq -P < "$INPUT_FILE" > "$OUTPUT_FILE"
  fi
}

do_delta() {
  if [[ ! -f "$OUTPUT_FILE" ]]; then
    err_json "$ARTIFACT" 4 "[{\"type\":\"write_mode_error\",\"detail\":\"delta mode requires existing file\"}]"
  fi
  local merged
  merged=$(mktmp)
  yq eval-all 'select(fi == 0) * select(fi == 1)' \
    "$OUTPUT_FILE" <(yq -P < "$INPUT_FILE") > "$merged"
  mv "$merged" "$OUTPUT_FILE"
}

# ─────────────────────────────────────────────
# WRITE DISPATCH
# ─────────────────────────────────────────────

apply_write() {
  local schema_type="$1"
  # Ensure parent directories exist (entity addressing creates nested paths)
  mkdir -p "$(dirname "$OUTPUT_FILE")"

  case "$MODE" in
    overwrite) do_overwrite ;;
    append)    do_append "$schema_type" ;;
    patch)     do_patch ;;
    delta)     do_delta ;;
    *)         err_json "$ARTIFACT" 4 "[{\"type\":\"write_mode_error\",\"detail\":\"unknown mode: $MODE\"}]" ;;
  esac

  echo -e "${GREEN}ok${NC} ${ARTIFACT} -> ${OUTPUT_FILE}" >&2
}
