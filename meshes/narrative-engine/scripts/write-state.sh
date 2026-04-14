#!/usr/bin/env bash
# write-state.sh — Unified writer for turn, campaign, and game artifacts
# Replaces turn-write.sh, campaign-write.sh, game-write.sh + write-common.sh
#
# Responsibilities:
#   - Auto-detect level from path structure
#   - Validate input JSON against manifest.yaml (shallow: keys + types)
#   - Enforce write modes (overwrite/append/patch/delta)
#   - Enforce state transition rules
#   - Entity addressing
#
# Usage: echo '<json>' | write-state.sh <path> <artifact> [--target=PATH]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/manifest.yaml"

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
# LEVEL DETECTION
# ─────────────────────────────────────────────

detect_level() {
  local path="$1"
  if [[ "$path" == */turns/turn-* ]]; then
    echo "turn"
  elif [[ "$path" == */campaigns/* ]]; then
    echo "campaign"
  else
    echo "game"
  fi
}

# ─────────────────────────────────────────────
# ENTITY ADDRESSING
# ─────────────────────────────────────────────

schema_name() {
  local artifact="$1"
  if [[ "$artifact" == */* ]]; then
    echo "${artifact%%/*}"
  else
    echo "$artifact"
  fi
}

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
# HELP
# ─────────────────────────────────────────────

show_help() {
  cat >&2 <<'USAGE'
write-state.sh — Write game data at any level (auto-detected from path)

Usage:
  echo '<json>' | write-state.sh <path> <artifact> [--target=PATH]

Arguments:
  path        Path to turn workspace, campaign dir, or game dir
  artifact    Artifact name (entity-scoped: character/{id})

Options:
  --target=PATH   Target path for append mode (e.g., --target=.violations)

Level Detection:
  */turns/turn-*  → turn level
  */campaigns/*   → campaign level
  (else)          → game level

Input:
  JSON on stdin. Validated against manifest.yaml (shallow: keys + types).

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
  echo -e "${RED}Error: requires <path> <artifact> arguments${NC}" >&2
  echo "Run with --help for usage." >&2
  exit 1
fi

WORKSPACE="${POSITIONAL[0]}"
ARTIFACT="${POSITIONAL[1]}"
LEVEL=$(detect_level "$WORKSPACE")
SCHEMA_TYPE=$(schema_name "$ARTIFACT")

# ─────────────────────────────────────────────
# READ MANIFEST CONFIG
# ─────────────────────────────────────────────

WRITE_MODE=$(yq -r ".${LEVEL}.\"${SCHEMA_TYPE}\".write_mode // \"overwrite\"" "$MANIFEST")

# ─────────────────────────────────────────────
# READ INPUT
# ─────────────────────────────────────────────

INPUT_FILE=$(mktmp)
cat > "$INPUT_FILE"

if ! jq empty < "$INPUT_FILE" 2>/dev/null; then
  err_json "$ARTIFACT" 2 "[{\"type\":\"malformed_json\",\"detail\":\"stdin is not valid JSON\"}]"
fi

# ─────────────────────────────────────────────
# VALIDATE AGAINST MANIFEST
# ─────────────────────────────────────────────

if [[ "$WRITE_MODE" != "append" ]]; then
  ALLOWED_KEYS=$(yq -o json ".${LEVEL}.\"${SCHEMA_TYPE}\".keys // {}" "$MANIFEST")
  REQUIRED_KEYS=$(yq -o json ".${LEVEL}.\"${SCHEMA_TYPE}\".required // {}" "$MANIFEST")

  # Only validate if manifest has an entry for this artifact
  if [[ "$ALLOWED_KEYS" != "{}" ]]; then
    VALIDATION=$(jq --argjson allowed "$ALLOWED_KEYS" --argjson required "$REQUIRED_KEYS" '
      . as $input |
      ($input | keys) as $actual |
      ($allowed | keys) as $allowed_keys |

      # Unknown keys
      ([$actual[] | select(. as $k | $allowed_keys | index($k) | not)]) as $rogue |

      # Missing required keys
      ([$required | to_entries[] | select(.key as $k | $input | has($k) | not)]) as $missing |

      # Type mismatches on required keys
      ([$required | to_entries[] |
        select(.key as $k | $input | has($k)) |
        select(
          (.value == "array" and ($input[.key] | type) != "array") or
          (.value == "object" and ($input[.key] | type) != "object") or
          (.value == "string" and ($input[.key] | type) != "string") or
          (.value == "number" and ($input[.key] | type) != "number")
        )
      ]) as $type_errs |

      (
        [$rogue[] | {type: "unknown_key", key: ., allowed: $allowed_keys}] +
        [$missing[] | {type: "missing_key", key: .key, expected_type: .value}] +
        [$type_errs[] | {type: "type_mismatch", key: .key, expected: .value, got: ($input[.key] | type)}]
      ) as $errors |

      if ($errors | length) > 0 then {ok: false, errors: $errors}
      else true end
    ' < "$INPUT_FILE")

    if ! echo "$VALIDATION" | jq -e '. == true' > /dev/null 2>&1; then
      ERRORS=$(echo "$VALIDATION" | jq -c '.errors // []')
      err_json "$ARTIFACT" 1 "$ERRORS"
    fi
  fi
fi

# ─────────────────────────────────────────────
# RESOLVE OUTPUT PATH
# ─────────────────────────────────────────────

resolve_entity_path "$WORKSPACE" "$ARTIFACT"
mkdir -p "$(dirname "$OUTPUT_FILE")"

# ─────────────────────────────────────────────
# TRANSITION VALIDATION
# ─────────────────────────────────────────────

validate_transition() {
  local transitions_field
  transitions_field=$(yq -r ".${LEVEL}.\"${SCHEMA_TYPE}\".transitions.field // \"\"" "$MANIFEST")
  [[ -z "$transitions_field" || "$transitions_field" == "null" ]] && return 0

  local new_value
  new_value=$(jq -r --arg f "$transitions_field" '.[$f] // empty' < "$INPUT_FILE")
  [[ -z "$new_value" ]] && return 0
  [[ ! -f "$OUTPUT_FILE" ]] && return 0

  local current_value
  current_value=$(yq -r ".${transitions_field} // \"\"" "$OUTPUT_FILE" 2>/dev/null)
  [[ -z "$current_value" || "$current_value" == "null" ]] && return 0
  [[ "$current_value" == "$new_value" ]] && return 0

  local allowed
  allowed=$(yq -r ".${LEVEL}.\"${SCHEMA_TYPE}\".transitions.rules.\"${current_value}\"[]" "$MANIFEST" 2>/dev/null)
  [[ -z "$allowed" ]] && err_json "$ARTIFACT" 4 "[{\"type\":\"invalid_transition\",\"field\":\"$transitions_field\",\"from\":\"$current_value\",\"to\":\"$new_value\",\"detail\":\"no transitions from '$current_value'\"}]"

  local found=false
  while IFS= read -r val; do
    [[ "$val" == "$new_value" ]] && { found=true; break; }
  done <<< "$allowed"

  [[ "$found" != "true" ]] && err_json "$ARTIFACT" 4 "[{\"type\":\"invalid_transition\",\"field\":\"$transitions_field\",\"from\":\"$current_value\",\"to\":\"$new_value\"}]"
}

# ─────────────────────────────────────────────
# WRITE MODES
# ─────────────────────────────────────────────

do_overwrite() {
  yq -P < "$INPUT_FILE" > "$OUTPUT_FILE"
}

do_append() {
  if [[ -z "$TARGET" ]]; then
    # Read first append_target from manifest
    TARGET=$(yq -r ".${LEVEL}.\"${SCHEMA_TYPE}\".append_target // \"\"" "$MANIFEST")
    # Handle array of targets — take first
    if [[ "$TARGET" == "["* ]]; then
      TARGET=$(yq -r ".${LEVEL}.\"${SCHEMA_TYPE}\".append_target[0]" "$MANIFEST")
    fi
  fi
  [[ -z "$TARGET" || "$TARGET" == "null" ]] && err_json "$ARTIFACT" 4 "[{\"type\":\"write_mode_error\",\"detail\":\"append requires --target or manifest append_target\"}]"

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
  validate_transition
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
  [[ ! -f "$OUTPUT_FILE" ]] && err_json "$ARTIFACT" 4 "[{\"type\":\"write_mode_error\",\"detail\":\"delta requires existing file\"}]"
  local merged
  merged=$(mktmp)
  yq eval-all 'select(fi == 0) * select(fi == 1)' \
    "$OUTPUT_FILE" <(yq -P < "$INPUT_FILE") > "$merged"
  mv "$merged" "$OUTPUT_FILE"
}

# ─────────────────────────────────────────────
# DISPATCH
# ─────────────────────────────────────────────

case "$WRITE_MODE" in
  overwrite) do_overwrite ;;
  append)    do_append ;;
  patch)     do_patch ;;
  delta)     do_delta ;;
  *)         err_json "$ARTIFACT" 4 "[{\"type\":\"write_mode_error\",\"detail\":\"unknown mode: $WRITE_MODE\"}]" ;;
esac

echo -e "${GREEN}ok${NC} ${ARTIFACT} -> ${OUTPUT_FILE}" >&2
