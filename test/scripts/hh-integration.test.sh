#!/usr/bin/env bash
# hh-integration.test.sh - Round-trip HH game data through write scripts
#
# For each YAML file in heathers-hope:
#   1. Convert to JSON via yq
#   2. Pipe through the appropriate write script
#   3. Compare output YAML against original (normalized)
#
# Non-overwrite modes (append/delta) only validate schema acceptance.
# Reports schema gaps (unexpected keys) without failing the whole suite.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
HH="/Users/god/projects/tx/tx-core/.ai/worktrees/terminal-by-default-messaging/.ai/games/heathers-hope"
SCRIPTS="$ROOT/meshes/narrative-engine-v2/scripts"
SCHEMA_DIR="$SCRIPTS/schemas"
PASS=0; FAIL=0; SKIP=0; GAPS=()

# ─────────────────────────────────────────────
# GET WRITE MODE for an artifact at a given level
# ─────────────────────────────────────────────

get_write_mode() {
  local level="$1" schema_type="$2"
  local modes_file="$SCHEMA_DIR/$level/modes.json"
  if [[ -f "$modes_file" ]]; then
    jq -r --arg a "$schema_type" '.[$a].mode // "overwrite"' < "$modes_file" 2>/dev/null || echo "overwrite"
  else
    echo "overwrite"
  fi
}

# ─────────────────────────────────────────────
# VALIDATE-ONLY TEST (for append/delta modes)
# ─────────────────────────────────────────────

validate_only() {
  local desc="$1" level="$2" schema_type="$3" original="$4"

  local json_input
  json_input=$(yq -o json "$original" 2>/dev/null)
  if [[ -z "$json_input" || "$json_input" == "null" || "$json_input" == "{}" ]]; then
    echo "  SKIP: $desc — empty file" >&2
    SKIP=$((SKIP + 1))
    return
  fi

  local schema_file="$SCHEMA_DIR/$level/$schema_type.schema.jq"
  local result
  result=$(echo "$json_input" | jq -L "$SCHEMA_DIR" -f "$schema_file" 2>/dev/null)

  if [[ "$result" == "true" ]]; then
    echo "  PASS: $desc (validate-only, mode=$(get_write_mode "$level" "$schema_type"))" >&2
    PASS=$((PASS + 1))
  else
    local gap_keys
    gap_keys=$(echo "$result" | jq -r '.errors[]? | select(.type=="unknown_key") | .key' 2>/dev/null | tr '\n' ', ' | sed 's/,$//')
    if [[ -n "$gap_keys" ]]; then
      GAPS+=("$desc: [$gap_keys]")
      echo "  SCHEMA GAP: $desc — rejected keys: $gap_keys" >&2
    else
      echo "  SCHEMA GAP: $desc — validation failed: $result" >&2
      GAPS+=("$desc: validation failed")
    fi
    SKIP=$((SKIP + 1))
  fi
}

# ─────────────────────────────────────────────
# ROUND-TRIP TEST (for overwrite/patch modes)
# ─────────────────────────────────────────────

round_trip() {
  local desc="$1" script="$2" original="$3" artifact="$4"
  local ws
  ws=$(mktemp -d)

  # For entity-addressed artifacts, create entity dirs
  mkdir -p "$ws/entities/characters" "$ws/entities/bonds" "$ws/entities/conditions" 2>/dev/null || true

  # Check if original file is empty or has no meaningful content
  local json_input
  json_input=$(yq -o json "$original" 2>/dev/null)
  if [[ -z "$json_input" || "$json_input" == "null" || "$json_input" == "{}" ]]; then
    echo "  SKIP: $desc — empty file" >&2
    SKIP=$((SKIP + 1))
    rm -rf "$ws"
    return
  fi

  # Convert YAML to JSON, pipe through write script
  local write_stderr
  write_stderr=$(mktemp)
  if ! echo "$json_input" | "$script" "$ws" "$artifact" 2>"$write_stderr"; then
    local errors
    errors=$(cat "$write_stderr")
    # Extract unknown_key errors for gap reporting
    local gap_keys
    gap_keys=$(echo "$errors" | grep -o '"key":"[^"]*"' | sed 's/"key":"//;s/"//' | tr '\n' ', ' | sed 's/,$//')
    if [[ -n "$gap_keys" ]]; then
      GAPS+=("$desc: [$gap_keys]")
      echo "  SCHEMA GAP: $desc — rejected keys: $gap_keys" >&2
    else
      echo "  SCHEMA GAP: $desc — write rejected: $errors" >&2
      GAPS+=("$desc: write rejected")
    fi
    SKIP=$((SKIP + 1))
    rm -rf "$ws" "$write_stderr"
    return
  fi
  rm -f "$write_stderr"

  # Resolve output path
  local output
  if [[ "$artifact" == */* ]]; then
    local type="${artifact%%/*}"
    local id="${artifact#*/}"
    case "$type" in
      character) output="$ws/entities/characters/$id.yaml" ;;
      bond) output="$ws/entities/bonds/$id.yaml" ;;
      condition) output="$ws/entities/conditions/$id.yaml" ;;
      *) output="$ws/$artifact.yaml" ;;
    esac
  else
    output="$ws/$artifact.yaml"
  fi

  if [[ ! -f "$output" ]]; then
    echo "  FAIL: $desc — no output file at $output" >&2
    FAIL=$((FAIL + 1))
    rm -rf "$ws"
    return
  fi

  # Normalize and compare
  local expected actual
  expected=$(yq -o json -P "$original" | jq -S . 2>/dev/null)
  actual=$(yq -o json -P "$output" | jq -S . 2>/dev/null)

  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: $desc" >&2
    PASS=$((PASS + 1))
  else
    echo "  DIFF: $desc — output differs from original" >&2
    diff <(echo "$expected") <(echo "$actual") >&2 | head -30
    FAIL=$((FAIL + 1))
  fi

  rm -rf "$ws"
}

# ─────────────────────────────────────────────
# DISPATCH: choose round_trip or validate_only
# ─────────────────────────────────────────────

test_artifact() {
  local desc="$1" level="$2" script="$3" original="$4" artifact="$5" schema_type="$6"
  local mode
  mode=$(get_write_mode "$level" "$schema_type")

  case "$mode" in
    overwrite|patch)
      round_trip "$desc" "$script" "$original" "$artifact"
      ;;
    append|delta)
      # Append/delta modes transform data — only validate schema acceptance
      validate_only "$desc" "$level" "$schema_type" "$original"
      ;;
    *)
      round_trip "$desc" "$script" "$original" "$artifact"
      ;;
  esac
}

# ─────────────────────────────────────────────
# GAME-LEVEL TESTS
# ─────────────────────────────────────────────

echo "=== Game-level artifacts ===" >&2
for yaml in "$HH"/*.yaml; do
  [[ -f "$yaml" ]] || continue
  artifact=$(basename "$yaml" .yaml)
  # Skip deprecated/monolithic files
  [[ "$artifact" == "protagonist" || "$artifact" == "entities" ]] && { SKIP=$((SKIP + 1)); continue; }
  # Skip if no schema
  [[ -f "$SCHEMA_DIR/game/$artifact.schema.jq" ]] || { echo "  SKIP: game/$artifact — no schema" >&2; SKIP=$((SKIP + 1)); continue; }
  test_artifact "game/$artifact" "game" "$SCRIPTS/game-write.sh" "$yaml" "$artifact" "$artifact"
done

# ─────────────────────────────────────────────
# GAME ENTITY TESTS
# ─────────────────────────────────────────────

echo "" >&2
echo "=== Game entity artifacts ===" >&2
for yaml in "$HH/entities/characters"/*.yaml; do
  [[ -f "$yaml" ]] || continue
  id=$(basename "$yaml" .yaml)
  test_artifact "game/character/$id" "game" "$SCRIPTS/game-write.sh" "$yaml" "character/$id" "character"
done

if [[ -d "$HH/entities/bonds" ]]; then
  for yaml in "$HH/entities/bonds"/*.yaml; do
    [[ -f "$yaml" ]] || continue
    id=$(basename "$yaml" .yaml)
    test_artifact "game/bond/$id" "game" "$SCRIPTS/game-write.sh" "$yaml" "bond/$id" "bond"
  done
fi

# ─────────────────────────────────────────────
# CAMPAIGN-LEVEL TESTS
# ─────────────────────────────────────────────

echo "" >&2
echo "=== Campaign-level artifacts ===" >&2
CAMPAIGN="$HH/campaigns/campaign-1"
for yaml in "$CAMPAIGN"/*.yaml; do
  [[ -f "$yaml" ]] || continue
  artifact=$(basename "$yaml" .yaml)
  # Skip monolithic entities file
  [[ "$artifact" == "entities" ]] && { SKIP=$((SKIP + 1)); continue; }
  # Skip if no schema
  [[ -f "$SCHEMA_DIR/campaign/$artifact.schema.jq" ]] || { echo "  SKIP: campaign/$artifact — no schema" >&2; SKIP=$((SKIP + 1)); continue; }
  test_artifact "campaign/$artifact" "campaign" "$SCRIPTS/campaign-write.sh" "$yaml" "$artifact" "$artifact"
done

# ─────────────────────────────────────────────
# TURN-LEVEL TESTS
# ─────────────────────────────────────────────

echo "" >&2
echo "=== Turn-level artifacts ===" >&2
for turn_dir in "$CAMPAIGN/turns"/turn-*/; do
  [[ -d "$turn_dir" ]] || continue
  TURN=$(basename "$turn_dir")

  # Only test direct YAML files (skip campaign-snapshot subdirs)
  for yaml in "$turn_dir"*.yaml; do
    [[ -f "$yaml" ]] || continue
    artifact=$(basename "$yaml" .yaml)
    # Skip aggregated violation variants (non-standard names)
    [[ "$artifact" == violations-* ]] && { SKIP=$((SKIP + 1)); continue; }
    # Skip if no schema
    [[ -f "$SCHEMA_DIR/turn/$artifact.schema.jq" ]] || { echo "  SKIP: $TURN/$artifact — no schema" >&2; SKIP=$((SKIP + 1)); continue; }
    test_artifact "$TURN/$artifact" "turn" "$SCRIPTS/turn-write.sh" "$yaml" "$artifact" "$artifact"
  done
done

# ─────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────

echo "" >&2
echo "==============================" >&2
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped" >&2
if [[ ${#GAPS[@]} -gt 0 ]]; then
  echo "" >&2
  echo "Schema gaps found:" >&2
  for gap in "${GAPS[@]}"; do
    echo "  - $gap" >&2
  done
fi
echo "==============================" >&2

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
