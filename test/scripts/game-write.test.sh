#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
WRITE="$ROOT/meshes/narrative-engine/scripts/game-write.sh"
PASS=0
FAIL=0

setup_game() {
  local gd
  gd=$(mktemp -d)
  mkdir -p "$gd/entities/characters" "$gd/entities/bonds"
  echo "$gd"
}

assert_exit() {
  local desc="$1" expected_code="$2" actual_code="$3"
  if [[ "$actual_code" -eq "$expected_code" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc — expected exit $expected_code, got $actual_code" >&2
    FAIL=$((FAIL + 1))
  fi
}

# Test 1: author.yaml overwrite (non-entity)
GD=$(setup_game)
echo '{"voice":"literary","pov":{"default":"close-third"},"tense":{"default":"present"}}' | "$WRITE" "$GD" author 2>/dev/null
assert_exit "author overwrite writes successfully" 0 $?
[[ -f "$GD/author.yaml" ]] && PASS=$((PASS + 1)) || { echo "FAIL: author.yaml should exist" >&2; FAIL=$((FAIL + 1)); }
VOICE=$(yq '.voice' "$GD/author.yaml")
[[ "$VOICE" == "literary" ]] && PASS=$((PASS + 1)) || { echo "FAIL: voice should be literary, got $VOICE" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$GD"

# Test 2: character/heather entity addressing
GD=$(setup_game)
echo '{"id":"heather","entity_type":"character","name":"Heather","traits":{"warmth":"high"},"voice":{"tone":"gentle"}}' | "$WRITE" "$GD" character/heather 2>/dev/null
assert_exit "character/heather writes successfully" 0 $?
[[ -f "$GD/entities/characters/heather.yaml" ]] && PASS=$((PASS + 1)) || { echo "FAIL: entities/characters/heather.yaml should exist" >&2; FAIL=$((FAIL + 1)); }
NAME=$(yq '.name' "$GD/entities/characters/heather.yaml")
[[ "$NAME" == "Heather" ]] && PASS=$((PASS + 1)) || { echo "FAIL: name should be Heather, got $NAME" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$GD"

# Test 3: Unknown artifact exits 3
GD=$(setup_game)
echo '{}' | "$WRITE" "$GD" nonexistent-artifact 2>/dev/null
assert_exit "unknown artifact exits 3" 3 $?
rm -rf "$GD"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
