#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
READ="$ROOT/meshes/narrative-engine-v2/scripts/game-read.sh"
GM="$SCRIPT_DIR/fixtures/game"
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

# Test 1: --list includes entities and top-level
R=$("$READ" "$GM" --list 2>/dev/null)
assert_json "list includes author" "$R" '.artifacts | any(. == "author")'
assert_json "list includes character/heather" "$R" '.artifacts | any(. == "character/heather")'

# Test 2: --keys on author
R=$("$READ" "$GM" author --keys 2>/dev/null)
assert_json "author keys" "$R" '.keys | any(.key == "voice")'

# Test 3: character --list
R=$("$READ" "$GM" character --list 2>/dev/null)
assert_json "character list has heather" "$R" '.artifacts | any(. == "heather")'

# Test 4: character/heather full read
R=$("$READ" "$GM" character/heather 2>/dev/null)
assert_json "heather full read" "$R" '.name == "Heather"'

# Test 5: --section on author
R=$("$READ" "$GM" author --section=influences 2>/dev/null)
assert_json "author influences" "$R" 'length == 2'

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
