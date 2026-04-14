#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCHEMA_DIR="$SCRIPT_DIR/../../meshes/narrative-engine/scripts/schemas"
FIXTURES="$SCRIPT_DIR/fixtures"
PASS=0
FAIL=0

assert_valid() {
  local desc="$1" schema="$2" input="$3"
  result=$(jq -L "$SCHEMA_DIR" -f "$schema" < "$input" 2>&1)
  if echo "$result" | jq -e '. == true' > /dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc" >&2
    echo "  Expected: true" >&2
    echo "  Got: $result" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_error() {
  local desc="$1" schema="$2" input="$3" error_type="$4"
  result=$(jq -L "$SCHEMA_DIR" -f "$schema" < "$input" 2>&1)
  if echo "$result" | jq -e ".ok == false and (.errors | any(.type == \"$error_type\"))" > /dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc" >&2
    echo "  Expected error type: $error_type" >&2
    echo "  Got: $result" >&2
    FAIL=$((FAIL + 1))
  fi
}

# Create test schema
TEST_SCHEMA="$FIXTURES/test-fates.schema.jq"
cat > "$TEST_SCHEMA" << 'EOF'
include "validate-common";
validate(
  {"branches": "array", "seeds": "array"};
  ["branches", "seeds", "trajectory_status", "world_state"];
  ["trajectory_status"]
)
EOF

assert_valid "valid fates JSON passes" "$TEST_SCHEMA" "$FIXTURES/valid-fates.json"
assert_error "rogue key rejected" "$TEST_SCHEMA" "$FIXTURES/invalid-fates-rogue-key.json" "unknown_key"
assert_error "missing required key rejected" "$TEST_SCHEMA" "$FIXTURES/invalid-fates-missing-key.json" "missing_key"
assert_error "wrong type rejected" "$TEST_SCHEMA" "$FIXTURES/invalid-fates-wrong-type.json" "type_mismatch"

rm -f "$TEST_SCHEMA"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
