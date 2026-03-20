#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TURN_WRITE="$SCRIPT_DIR/../../meshes/narrative-engine-v2/scripts/turn-write.sh"
FIXTURES="$SCRIPT_DIR/fixtures"
WRITE="$TURN_WRITE"
PASS=0
FAIL=0

# Temp workspace with cleanup
TMPWS=$(mktemp -d)
trap 'rm -rf "$TMPWS"' EXIT

setup_workspace() {
  local ws
  ws=$(mktemp -d)
  echo "$ws"
}

assert_exit() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" -eq "$expected" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc" >&2
    echo "  Expected exit: $expected, got: $actual" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_file_matches() {
  local desc="$1" actual_file="$2" expected_file="$3"
  if diff -q "$actual_file" "$expected_file" > /dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc" >&2
    echo "  Diff:" >&2
    diff "$expected_file" "$actual_file" >&2 || true
    FAIL=$((FAIL + 1))
  fi
}

assert_no_file() {
  local desc="$1" filepath="$2"
  if [[ ! -f "$filepath" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc" >&2
    echo "  File should not exist: $filepath" >&2
    FAIL=$((FAIL + 1))
  fi
}

# ─────────────────────────────────────────────
# Test 1: Valid JSON → correct YAML (overwrite)
# ─────────────────────────────────────────────

WS1="$TMPWS/test1"
bash "$TURN_WRITE" "$WS1" fates < "$FIXTURES/valid-fates.json" 2>/dev/null
assert_exit "valid fates writes successfully" 0 $?
assert_file_matches "written YAML matches expected" "$WS1/fates.yaml" "$FIXTURES/expected-fates.yaml"

# ─────────────────────────────────────────────
# Test 2: Rogue key → exit 1, no file written
# ─────────────────────────────────────────────

WS2="$TMPWS/test2"
stderr_out=$(bash "$TURN_WRITE" "$WS2" fates < "$FIXTURES/invalid-fates-rogue-key.json" 2>&1 >/dev/null)
EXIT_CODE=$?
assert_exit "rogue key exits 1" 1 "$EXIT_CODE"
assert_no_file "no file written on validation error" "$WS2/fates.yaml"

# Verify error JSON on stderr contains unknown_key
if echo "$stderr_out" | jq -e '.errors | any(.type == "unknown_key")' > /dev/null 2>&1; then
  PASS=$((PASS + 1))
else
  echo "FAIL: rogue key error JSON should contain unknown_key" >&2
  echo "  Got: $stderr_out" >&2
  FAIL=$((FAIL + 1))
fi

# ─────────────────────────────────────────────
# Test 3: Malformed JSON → exit 2
# ─────────────────────────────────────────────

WS3="$TMPWS/test3"
echo "not json at all {{{{" | bash "$TURN_WRITE" "$WS3" fates 2>/dev/null
assert_exit "malformed JSON exits 2" 2 $?

# ─────────────────────────────────────────────
# Test 4: Unknown artifact → exit 3
# ─────────────────────────────────────────────

WS4="$TMPWS/test4"
echo '{}' | bash "$TURN_WRITE" "$WS4" nonexistent-artifact 2>/dev/null
assert_exit "unknown artifact exits 3" 3 $?

# ─────────────────────────────────────────────
# Test 5: Append mode — adds entry to existing file
# ─────────────────────────────────────────────

WS=$(setup_workspace)
cp "$FIXTURES/existing-violations.yaml" "$WS/violations.yaml"
cat "$FIXTURES/violation-entry.json" | "$WRITE" "$WS" violations --target=.violations 2>/dev/null
assert_exit "append to existing file" 0 $?
COUNT=$(yq '.violations | length' "$WS/violations.yaml")
[[ "$COUNT" -eq 2 ]] && PASS=$((PASS + 1)) || { echo "FAIL: expected 2 violations, got $COUNT" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$WS"

# ─────────────────────────────────────────────
# Test 6: Append mode — creates file if not exists
# ─────────────────────────────────────────────

WS=$(setup_workspace)
cat "$FIXTURES/violation-entry.json" | "$WRITE" "$WS" violations --target=.violations 2>/dev/null
assert_exit "append creates new file" 0 $?
[[ -f "$WS/violations.yaml" ]] && PASS=$((PASS + 1)) || { echo "FAIL: violations.yaml should exist" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$WS"

# ─────────────────────────────────────────────
# Test 7: Patch mode — merges into existing
# ─────────────────────────────────────────────

WS=$(setup_workspace)
cat > "$WS/sim-progress.yaml" << 'SIMEOF'
beats_complete: 2
current_beat: beat_3
status: in_progress
SIMEOF
echo '{"beats_complete": 3, "current_beat": "beat_4"}' | "$WRITE" "$WS" sim-progress 2>/dev/null
assert_exit "patch merges into existing" 0 $?
BEATS=$(yq '.beats_complete' "$WS/sim-progress.yaml")
STATUS=$(yq '.status' "$WS/sim-progress.yaml")
[[ "$BEATS" -eq 3 && "$STATUS" == "in_progress" ]] && PASS=$((PASS + 1)) || { echo "FAIL: patch should merge, not overwrite — beats=$BEATS status=$STATUS" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$WS"

# ─────────────────────────────────────────────
# Results
# ─────────────────────────────────────────────

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
