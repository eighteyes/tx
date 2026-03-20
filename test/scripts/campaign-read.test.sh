#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
READ="$ROOT/meshes/narrative-engine-v2/scripts/campaign-read.sh"
CP="$SCRIPT_DIR/fixtures/campaign"
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

# Test 1: --list includes entities
R=$("$READ" "$CP" --list 2>/dev/null)
assert_json "list includes artifacts" "$R" '.artifacts | length >= 2'

# Test 2: character --list shows entity IDs
R=$("$READ" "$CP" character --list 2>/dev/null)
assert_json "character list" "$R" '.artifacts | any(. == "kaitlin")'

# Test 3: character/kaitlin --keys
R=$("$READ" "$CP" character/kaitlin --keys 2>/dev/null)
assert_json "kaitlin keys" "$R" '.keys | length > 0'

# Test 4: character/kaitlin episodes with --since
R=$("$READ" "$CP" character/kaitlin --section=episodes --since=3 2>/dev/null)
assert_json "episodes since turn 3" "$R" 'length == 2'

# Test 5: continuity --search
R=$("$READ" "$CP" continuity --search=coffee 2>/dev/null)
assert_json "search finds coffee" "$R" '.matches | length > 0'

# Test 6: --since + --before on factoids
R=$("$READ" "$CP" continuity --section=used_factoids --since=2 --before=5 2>/dev/null)
assert_json "factoids turn 2-4" "$R" 'length == 1'

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
