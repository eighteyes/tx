#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
WRITE="$ROOT/meshes/narrative-engine-v2/scripts/campaign-write.sh"
PASS=0
FAIL=0

setup_campaign() {
  local cp
  cp=$(mktemp -d)
  mkdir -p "$cp/entities/characters" "$cp/entities/bonds"
  echo "$cp"
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

# Test 1: Entity slash addressing — character/kaitlin
CP=$(setup_campaign)
echo '{"id":"kaitlin","entity_type":"character","name":"Kaitlin","traits":{"sharp_wit":"high"}}' | "$WRITE" "$CP" character/kaitlin 2>/dev/null
assert_exit "character/kaitlin writes successfully" 0 $?
[[ -f "$CP/entities/characters/kaitlin.yaml" ]] && PASS=$((PASS + 1)) || { echo "FAIL: entities/characters/kaitlin.yaml should exist" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$CP"

# Test 2: Patch mode on existing entity
CP=$(setup_campaign)
cat > "$CP/entities/characters/kaitlin.yaml" << 'EOF'
id: kaitlin
entity_type: character
name: Kaitlin
traits:
  sharp_wit: high
  vulnerability: low
current_state:
  location: library
EOF
echo '{"id":"kaitlin","entity_type":"character","name":"Kaitlin","current_state":{"location":"cafe"}}' | "$WRITE" "$CP" character/kaitlin 2>/dev/null
assert_exit "patch character entity" 0 $?
LOCATION=$(yq '.current_state.location' "$CP/entities/characters/kaitlin.yaml")
SHARP=$(yq '.traits.sharp_wit' "$CP/entities/characters/kaitlin.yaml")
[[ "$LOCATION" == "cafe" && "$SHARP" == "high" ]] && PASS=$((PASS + 1)) || { echo "FAIL: patch should update location but keep traits — loc=$LOCATION sharp=$SHARP" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$CP"

# Test 3: Continuity append with --target
CP=$(setup_campaign)
cat > "$CP/continuity.yaml" << 'EOF'
game: kaitlin
campaign: campaign-1
used_factoids:
  - factoid: existing fact
    turn: 0
EOF
echo '{"factoid":"new fact","turn":1,"source":"scribe"}' | "$WRITE" "$CP" continuity --target=.used_factoids 2>/dev/null
assert_exit "continuity append" 0 $?
COUNT=$(yq '.used_factoids | length' "$CP/continuity.yaml")
[[ "$COUNT" -eq 2 ]] && PASS=$((PASS + 1)) || { echo "FAIL: expected 2 factoids, got $COUNT" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$CP"

# Test 4: Non-entity artifact (state) — overwrite
CP=$(setup_campaign)
echo '{"current_turn":5,"game":"test","campaign":"c1","momentum":"rising"}' | "$WRITE" "$CP" state 2>/dev/null
assert_exit "state overwrite" 0 $?
[[ -f "$CP/state.yaml" ]] && PASS=$((PASS + 1)) || { echo "FAIL: state.yaml should exist" >&2; FAIL=$((FAIL + 1)); }
TURN=$(yq '.current_turn' "$CP/state.yaml")
[[ "$TURN" -eq 5 ]] && PASS=$((PASS + 1)) || { echo "FAIL: current_turn should be 5, got $TURN" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$CP"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
