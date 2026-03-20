#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
READ="$ROOT/meshes/narrative-engine-v2/scripts/turn-read.sh"
WS="$SCRIPT_DIR/fixtures/turn-workspace"
PASS=0; FAIL=0

assert_json() {
  local desc="$1" result="$2" check="$3"
  if echo "$result" | jq -e "$check" > /dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc" >&2
    echo "  Check: $check" >&2
    echo "  Got: $(echo "$result" | head -3)" >&2
    FAIL=$((FAIL + 1))
  fi
}

# Test 1: --list
R=$("$READ" "$WS" --list 2>/dev/null)
assert_json "list artifacts" "$R" '.artifacts | length >= 3'

# Test 2: --keys
R=$("$READ" "$WS" fates --keys 2>/dev/null)
assert_json "fates keys" "$R" '.keys | length > 0'

# Test 3: --section
R=$("$READ" "$WS" fates --section=branches 2>/dev/null)
assert_json "branches section is array" "$R" 'type == "array" and length == 2'

# Test 4: --search (cross-artifact)
R=$("$READ" "$WS" --search=survival 2>/dev/null)
assert_json "search finds survival" "$R" '.matches | length > 0'

# Test 5: --search (scoped)
R=$("$READ" "$WS" fates --search=alliance 2>/dev/null)
assert_json "scoped search finds alliance" "$R" '.matches | length > 0'

# Test 6: --discover
R=$("$READ" "$WS" fates --discover 2>/dev/null)
assert_json "discover freeform keys" "$R" '.freeform_keys | keys | length > 0'

# Test 7: --summary
R=$("$READ" "$WS" fates --summary 2>/dev/null)
assert_json "summary returns data" "$R" 'keys | length > 0'

# Test 8: Full file read (no flags)
R=$("$READ" "$WS" context 2>/dev/null)
assert_json "full file read" "$R" '.turn == 3'

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
