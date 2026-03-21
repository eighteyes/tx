# YAML Script Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct YAML I/O in narrative-engine-v2 with six validated scripts (read/write at turn/campaign/game levels) that accept JSON, validate against jq schemas, and write YAML.

**Architecture:** Agents produce JSON piped to `*-write.sh` scripts. Scripts validate against `.schema.jq` files (fixed skeleton, freeform zones), apply write mode (overwrite/append/patch/delta), and output YAML via yq. Read scripts provide scoped JSON queries with browse/skim/read levels. Entity-scoped artifacts use slash addressing (`character/kaitlin`). No new dependencies — jq + yq only.

**Tech Stack:** Bash (set -euo pipefail), jq, yq, existing narrative-engine-v2 script patterns

**Spec:** `docs/superpowers/specs/2026-03-20-yaml-script-gateway-design.md`

**Canonical reference data:** `/Users/god/projects/tx/tx-narrative-engine/.ai/games/heathers-hope/`

---

## File Structure

```
meshes/narrative-engine-v2/scripts/
  schemas/
    validate-common.jq           shared validation logic (required/allowed/freeform/write-mode checks)
    turn/
      context.schema.jq           overwrite
      intent.schema.jq            overwrite
      action-lock.schema.jq       overwrite
      director-notes.schema.jq    overwrite
      collisions.schema.jq        overwrite
      fates.schema.jq             overwrite
      dramaturg-notes.schema.jq   overwrite
      entropy-tables.schema.jq    overwrite
      entropy-selection.schema.jq overwrite
      resolution.schema.jq        overwrite
      threads.schema.jq           overwrite
      pov-resolution.schema.jq    overwrite
      sim-plan.schema.jq          overwrite
      sim-progress.schema.jq      patch
      scene-outline.schema.jq     overwrite
      scene-script.schema.jq      overwrite
      violations.schema.jq        append
      visual.schema.jq            overwrite
      calibration-state.schema.jq patch
    campaign/
      arc.schema.jq               delta+append
      state.schema.jq             overwrite
      continuity.schema.jq        append (multi-target)
      trajectories.schema.jq      patch (with transitions)
      character.schema.jq         patch
      bond.schema.jq              patch
      condition.schema.jq         patch (with transitions)
    game/
      author.schema.jq            overwrite
      setting.schema.jq           overwrite
      arc.schema.jq               overwrite
      character.schema.jq         overwrite
      bond.schema.jq              overwrite
  turn-write.sh                   validate JSON + write YAML for turn artifacts
  turn-read.sh                    scoped JSON queries for turn data
  campaign-write.sh               validate JSON + write YAML for campaign artifacts
  campaign-read.sh                scoped JSON queries for campaign data
  game-write.sh                   validate JSON + write YAML for game artifacts
  game-read.sh                    scoped JSON queries for game data
test/
  scripts/
    validate-common.test.sh       validation logic tests (bash, artifact diffing)
    turn-write.test.sh            turn write integration tests
    campaign-write.test.sh        campaign write integration tests
    game-write.test.sh            game write integration tests
    turn-read.test.sh             turn read integration tests
    campaign-read.test.sh         campaign read integration tests
    game-read.test.sh             game read integration tests
    fixtures/                     HH-derived test YAML files
```

---

## Chunk 1: Foundation — validate-common.jq + Write Script Core

### Task 1: validate-common.jq — Shared validation logic

**Files:**
- Create: `meshes/narrative-engine-v2/scripts/schemas/validate-common.jq`
- Test: `test/scripts/validate-common.test.sh`

This is the foundation all schemas depend on. It reads schema declarations (required, allowed, freeform, write_mode, etc.) and validates a JSON blob against them.

- [ ] **Step 1: Create test fixtures directory with sample JSON**

```bash
mkdir -p test/scripts/fixtures
```

Create `test/scripts/fixtures/valid-fates.json`:
```json
{
  "branches": [{"id": "survival", "type": "trajectory"}],
  "trajectory_status": {"south_gate_escape": "active"},
  "seeds": [{"id": "seed1", "desc": "a seed"}]
}
```

Create `test/scripts/fixtures/invalid-fates-rogue-key.json`:
```json
{
  "branches": [],
  "trajectory_status": {},
  "seeds": [],
  "vibes": "chill"
}
```

Create `test/scripts/fixtures/invalid-fates-missing-key.json`:
```json
{
  "trajectory_status": {},
  "seeds": []
}
```

Create `test/scripts/fixtures/invalid-fates-wrong-type.json`:
```json
{
  "branches": "not an array",
  "trajectory_status": {},
  "seeds": []
}
```

- [ ] **Step 2: Write failing test for validate-common**

Create `test/scripts/validate-common.test.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCHEMA_DIR="$SCRIPT_DIR/../../meshes/narrative-engine-v2/scripts/schemas"
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

# --- Tests ---

# Need a minimal test schema that uses validate-common
TEST_SCHEMA="$FIXTURES/test-fates.schema.jq"
cat > "$TEST_SCHEMA" << 'EOF'
def required: {"branches": "array", "seeds": "array"};
def allowed: ["branches", "seeds", "trajectory_status", "world_state"];
def freeform: ["trajectory_status"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
EOF

assert_valid "valid fates JSON passes" "$TEST_SCHEMA" "$FIXTURES/valid-fates.json"
assert_error "rogue key rejected" "$TEST_SCHEMA" "$FIXTURES/invalid-fates-rogue-key.json" "unknown_key"
assert_error "missing required key rejected" "$TEST_SCHEMA" "$FIXTURES/invalid-fates-missing-key.json" "missing_key"
assert_error "wrong type rejected" "$TEST_SCHEMA" "$FIXTURES/invalid-fates-wrong-type.json" "type_mismatch"

# Cleanup
rm -f "$TEST_SCHEMA"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
```

Run: `bash test/scripts/validate-common.test.sh`
Expected: FAIL (validate-common.jq doesn't exist yet)

- [ ] **Step 3: Implement validate-common.jq**

Create `meshes/narrative-engine-v2/scripts/schemas/validate-common.jq`:
```jq
def validate:
  # Capture input
  . as $input |

  # Get schema declarations
  required as $required |
  allowed as $allowed |
  freeform as $freeform |

  # Check for unknown top-level keys
  ($input | keys) as $actual_keys |
  ([$actual_keys[] | select(. as $k | $allowed | index($k) | not)]) as $rogue |

  # Check for missing required keys
  ([$required | to_entries[] | select(.key as $k | $input | has($k) | not)]) as $missing |

  # Check types for present required keys
  ([$required | to_entries[] |
    select(.key as $k | $input | has($k)) |
    select(
      (.value == "array" and ($input[.key] | type) != "array") or
      (.value == "object" and ($input[.key] | type) != "object") or
      (.value == "string" and ($input[.key] | type) != "string") or
      (.value == "number" and ($input[.key] | type) != "number")
    )
  ]) as $type_errors |

  # Check freeform zones have correct container type (must be object)
  ([$freeform[] |
    select(. as $k | $input | has($k)) |
    select(. as $k | ($input[$k] | type) != "object")
  ]) as $freeform_errors |

  # Build error list
  (
    [$rogue[] | {type: "unknown_key", key: ., allowed: $allowed}] +
    [$missing[] | {type: "missing_key", key: .key, expected_type: .value}] +
    [$type_errors[] | {type: "type_mismatch", key: .key, expected: .value, got: ($input[.key] | type)}] +
    [$freeform_errors[] | {type: "freeform_type_error", key: ., expected: "object", got: ($input[.] | type)}]
  ) as $errors |

  if ($errors | length) > 0 then
    {ok: false, errors: $errors}
  else
    true
  end;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash test/scripts/validate-common.test.sh`
Expected: 4 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/schemas/validate-common.jq test/scripts/
git commit -m "feat(narrative): add validate-common.jq schema validation foundation"
```

---

### Task 2: turn-write.sh — Core write script with overwrite mode

**Files:**
- Create: `meshes/narrative-engine-v2/scripts/turn-write.sh`
- Test: `test/scripts/turn-write.test.sh`

Start with overwrite mode only. Other modes added incrementally.

- [ ] **Step 1: Create test fixtures — sample turn YAML for diffing**

Create `test/scripts/fixtures/expected-fates.yaml` (derived from HH):
```yaml
branches:
  - id: survival
    type: trajectory
trajectory_status:
  south_gate_escape: active
seeds:
  - id: seed1
    desc: a seed
```

- [ ] **Step 2: Write a minimal fates schema for testing**

Create `meshes/narrative-engine-v2/scripts/schemas/turn/fates.schema.jq`:
```jq
def required: {"branches": "array", "seeds": "array"};
def allowed: ["branches", "seeds", "trajectory_status", "world_state"];
def freeform: ["trajectory_status"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

- [ ] **Step 3: Write failing test for turn-write.sh**

Create `test/scripts/turn-write.test.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
WRITE="$ROOT/meshes/narrative-engine-v2/scripts/turn-write.sh"
FIXTURES="$SCRIPT_DIR/fixtures"
PASS=0
FAIL=0

setup_workspace() {
  local ws
  ws=$(mktemp -d)
  echo "$ws"
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

assert_file_matches() {
  local desc="$1" actual="$2" expected="$3"
  if diff -q "$actual" "$expected" > /dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc — file content mismatch" >&2
    diff "$expected" "$actual" >&2
    FAIL=$((FAIL + 1))
  fi
}

# Test 1: Valid JSON produces correct YAML
WS=$(setup_workspace)
cat "$FIXTURES/valid-fates.json" | "$WRITE" "$WS" fates 2>/dev/null
assert_exit "valid fates writes successfully" 0 $?
assert_file_matches "fates.yaml matches expected" "$WS/fates.yaml" "$FIXTURES/expected-fates.yaml"
rm -rf "$WS"

# Test 2: Invalid JSON (rogue key) exits 1
WS=$(setup_workspace)
cat "$FIXTURES/invalid-fates-rogue-key.json" | "$WRITE" "$WS" fates 2>/dev/null
assert_exit "rogue key exits 1" 1 $?
[[ ! -f "$WS/fates.yaml" ]] && PASS=$((PASS + 1)) || { echo "FAIL: fates.yaml should not exist on validation error" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$WS"

# Test 3: Malformed JSON exits 2
WS=$(setup_workspace)
echo "not json at all" | "$WRITE" "$WS" fates 2>/dev/null
assert_exit "malformed JSON exits 2" 2 $?
rm -rf "$WS"

# Test 4: Unknown artifact exits 3
WS=$(setup_workspace)
echo '{}' | "$WRITE" "$WS" nonexistent 2>/dev/null
assert_exit "unknown artifact exits 3" 3 $?
rm -rf "$WS"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
```

Run: `bash test/scripts/turn-write.test.sh`
Expected: FAIL (turn-write.sh doesn't exist)

- [ ] **Step 4: Implement turn-write.sh (overwrite mode)**

Create `meshes/narrative-engine-v2/scripts/turn-write.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCHEMA_DIR="$SCRIPT_DIR/schemas"

# --- Usage ---
if [[ "${1:-}" == "--help" || $# -lt 2 ]]; then
  cat >&2 << 'HELP'
Usage: echo '<json>' | turn-write.sh <workspace> <artifact>

Validates JSON from stdin against the artifact's schema and writes YAML.

Arguments:
  workspace    Path to the turn workspace directory
  artifact     Artifact name (e.g., fates, collisions, resolution)

Write mode is defined by the schema:
  overwrite    Replace entire file (default)
  append       Add entries to --target array
  patch        Merge into existing, validate transitions
  delta        Apply arithmetic to specified fields

Flags:
  --target=PATH   For append mode: jq path to target array (e.g., .violations)
  --help          Show this help

Exit codes:
  0  success
  1  validation error (schema)
  2  malformed JSON
  3  unknown artifact
  4  write mode error

Errors are structured JSON on stderr.
HELP
  exit 0
fi

WORKSPACE="$1"
ARTIFACT="$2"
TARGET=""

# Parse optional flags
shift 2
for arg in "$@"; do
  case "$arg" in
    --target=*) TARGET="${arg#--target=}" ;;
    *) echo "{\"ok\":false,\"errors\":[{\"type\":\"unknown_flag\",\"flag\":\"$arg\"}]}" >&2; exit 1 ;;
  esac
done

# Resolve schema
SCHEMA_FILE="$SCHEMA_DIR/turn/$ARTIFACT.schema.jq"
if [[ ! -f "$SCHEMA_FILE" ]]; then
  KNOWN=$(ls "$SCHEMA_DIR/turn/"*.schema.jq 2>/dev/null | sed 's|.*/||;s|\.schema\.jq||' | tr '\n' ',' | sed 's/,$//')
  echo "{\"ok\":false,\"artifact\":\"$ARTIFACT\",\"errors\":[{\"type\":\"unknown_artifact\",\"known\":\"$KNOWN\"}]}" >&2
  exit 3
fi

# Read JSON from stdin
TMP_JSON=$(mktemp)
TMP_YAML=$(mktemp)
trap 'rm -f "$TMP_JSON" "$TMP_YAML"' EXIT

cat > "$TMP_JSON"

# Validate JSON is parseable
if ! jq empty "$TMP_JSON" 2>/dev/null; then
  echo "{\"ok\":false,\"artifact\":\"$ARTIFACT\",\"errors\":[{\"type\":\"malformed_json\"}]}" >&2
  exit 2
fi

# Run schema validation
VALIDATION=$(jq -L "$SCHEMA_DIR" -f "$SCHEMA_FILE" < "$TMP_JSON" 2>&1)

# Check if validation passed (returns true) or failed (returns error object)
if echo "$VALIDATION" | jq -e '. == true' > /dev/null 2>&1; then
  # Detect write mode from schema
  WRITE_MODE=$(jq -n -L "$SCHEMA_DIR" 'include "turn/'"$ARTIFACT"'.schema"; write_mode' 2>/dev/null || echo "overwrite")

  case "$WRITE_MODE" in
    "overwrite"|'"overwrite"')
      yq -P < "$TMP_JSON" > "$TMP_YAML"
      mv "$TMP_YAML" "$WORKSPACE/$ARTIFACT.yaml"
      ;;
    "append"|'"append"')
      if [[ -z "$TARGET" ]]; then
        # Try to get default from schema
        DEFAULT_TARGET=$(jq -n -L "$SCHEMA_DIR" 'include "turn/'"$ARTIFACT"'.schema"; try allowed_targets[0] catch null' 2>/dev/null || echo "null")
        if [[ "$DEFAULT_TARGET" == "null" || -z "$DEFAULT_TARGET" ]]; then
          echo "{\"ok\":false,\"artifact\":\"$ARTIFACT\",\"errors\":[{\"type\":\"missing_target\",\"detail\":\"append mode requires --target\"}]}" >&2
          exit 4
        fi
        TARGET="$DEFAULT_TARGET"
      fi
      EXISTING="$WORKSPACE/$ARTIFACT.yaml"
      if [[ -f "$EXISTING" ]]; then
        # Read existing, append new entries to target path, write back
        yq -o json "$EXISTING" | jq --argjson new "$(cat "$TMP_JSON")" "$TARGET += (if (\$new | type) == \"array\" then \$new else [\$new] end)" | yq -P > "$TMP_YAML"
      else
        # Create new file with entries at target path
        jq "{\"$(echo "$TARGET" | sed 's/^\.//')\":  (if (. | type) == \"array\" then . else [.] end)}" < "$TMP_JSON" | yq -P > "$TMP_YAML"
      fi
      mv "$TMP_YAML" "$WORKSPACE/$ARTIFACT.yaml"
      ;;
    "patch"|'"patch"')
      EXISTING="$WORKSPACE/$ARTIFACT.yaml"
      if [[ -f "$EXISTING" ]]; then
        # Read existing as JSON, deep merge with incoming
        MERGED=$(yq -o json "$EXISTING" | jq --argjson patch "$(cat "$TMP_JSON")" '. * $patch')
        echo "$MERGED" | yq -P > "$TMP_YAML"
      else
        yq -P < "$TMP_JSON" > "$TMP_YAML"
      fi
      mv "$TMP_YAML" "$WORKSPACE/$ARTIFACT.yaml"
      ;;
    "delta"|'"delta"')
      EXISTING="$WORKSPACE/$ARTIFACT.yaml"
      if [[ ! -f "$EXISTING" ]]; then
        echo "{\"ok\":false,\"artifact\":\"$ARTIFACT\",\"errors\":[{\"type\":\"delta_no_existing\",\"detail\":\"delta mode requires existing file\"}]}" >&2
        exit 4
      fi
      # Read delta fields from schema
      DELTA_FIELDS=$(jq -n -L "$SCHEMA_DIR" 'include "turn/'"$ARTIFACT"'.schema"; delta_fields' 2>/dev/null || echo "[]")
      # Apply arithmetic: for each delta field, add incoming value to existing
      RESULT=$(yq -o json "$EXISTING")
      while IFS= read -r field; do
        [[ -z "$field" ]] && continue
        DELTA_VAL=$(jq -r ".$field // 0" "$TMP_JSON")
        RESULT=$(echo "$RESULT" | jq ".$field = (.$field + $DELTA_VAL)")
      done < <(echo "$DELTA_FIELDS" | jq -r '.[]')
      # Merge any non-delta fields directly
      NON_DELTA=$(jq --argjson df "$DELTA_FIELDS" 'to_entries | map(select(.key as $k | ($df | index($k)) | not)) | from_entries' "$TMP_JSON")
      RESULT=$(echo "$RESULT" | jq --argjson nd "$NON_DELTA" '. * $nd')
      echo "$RESULT" | yq -P > "$TMP_YAML"
      mv "$TMP_YAML" "$WORKSPACE/$ARTIFACT.yaml"
      ;;
    *)
      echo "{\"ok\":false,\"artifact\":\"$ARTIFACT\",\"errors\":[{\"type\":\"unknown_write_mode\",\"mode\":\"$WRITE_MODE\"}]}" >&2
      exit 4
      ;;
  esac
  exit 0
else
  # Validation failed — output error with artifact context
  echo "$VALIDATION" | jq --arg art "$ARTIFACT" '. + {artifact: $art}' >&2
  exit 1
fi
```

Make executable: `chmod +x meshes/narrative-engine-v2/scripts/turn-write.sh`

- [ ] **Step 5: Run tests to verify they pass**

Run: `bash test/scripts/turn-write.test.sh`
Expected: 5 passed, 0 failed

- [ ] **Step 6: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/turn-write.sh meshes/narrative-engine-v2/scripts/schemas/turn/fates.schema.jq test/scripts/
git commit -m "feat(narrative): add turn-write.sh with overwrite mode and fates schema"
```

---

### Task 3: Append, patch, and delta write mode tests

**Files:**
- Modify: `test/scripts/turn-write.test.sh`
- Create: `meshes/narrative-engine-v2/scripts/schemas/turn/violations.schema.jq`
- Test fixtures for each mode

- [ ] **Step 1: Create violations schema (append mode)**

Create `meshes/narrative-engine-v2/scripts/schemas/turn/violations.schema.jq`:
```jq
def required: {};
def allowed: ["type", "classification", "scope", "count", "budget", "lines", "recommendation", "fix"];
def freeform: [];
def write_mode: "append";
def allowed_targets: [".violations"];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

- [ ] **Step 2: Create test fixtures for append mode**

Create `test/scripts/fixtures/violation-entry.json`:
```json
{"type": "litotes", "classification": "CREATIVE", "scope": "scene_1", "count": 1}
```

Create `test/scripts/fixtures/existing-violations.yaml`:
```yaml
violations:
  - type: word_doubling
    classification: MECHANICAL
    scope: scene_1
    count: 2
```

- [ ] **Step 3: Add append mode tests to turn-write.test.sh**

Append to test file:
```bash
# Test 5: Append mode — adds entry to existing file
WS=$(setup_workspace)
cp "$FIXTURES/existing-violations.yaml" "$WS/violations.yaml"
cat "$FIXTURES/violation-entry.json" | "$WRITE" "$WS" violations --target=.violations 2>/dev/null
assert_exit "append to existing file" 0 $?
COUNT=$(yq '.violations | length' "$WS/violations.yaml")
[[ "$COUNT" -eq 2 ]] && PASS=$((PASS + 1)) || { echo "FAIL: expected 2 violations, got $COUNT" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$WS"

# Test 6: Append mode — creates file if not exists
WS=$(setup_workspace)
cat "$FIXTURES/violation-entry.json" | "$WRITE" "$WS" violations --target=.violations 2>/dev/null
assert_exit "append creates new file" 0 $?
[[ -f "$WS/violations.yaml" ]] && PASS=$((PASS + 1)) || { echo "FAIL: violations.yaml should exist" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$WS"
```

- [ ] **Step 4: Run tests**

Run: `bash test/scripts/turn-write.test.sh`
Expected: All pass

- [ ] **Step 5: Create sim-progress schema (patch mode) and add tests**

Create `meshes/narrative-engine-v2/scripts/schemas/turn/sim-progress.schema.jq`:
```jq
def required: {};
def allowed: ["beats_complete", "current_beat", "status", "notes"];
def freeform: ["notes"];
def write_mode: "patch";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

Add patch test:
```bash
# Test 7: Patch mode — merges into existing
WS=$(setup_workspace)
echo 'beats_complete: 2
current_beat: beat_3
status: in_progress' > "$WS/sim-progress.yaml"
echo '{"beats_complete": 3, "current_beat": "beat_4"}' | "$WRITE" "$WS" sim-progress 2>/dev/null
assert_exit "patch merges into existing" 0 $?
BEATS=$(yq '.beats_complete' "$WS/sim-progress.yaml")
STATUS=$(yq '.status' "$WS/sim-progress.yaml")
[[ "$BEATS" -eq 3 && "$STATUS" == "in_progress" ]] && PASS=$((PASS + 1)) || { echo "FAIL: patch should merge, not overwrite" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$WS"
```

- [ ] **Step 6: Run all tests, commit**

Run: `bash test/scripts/turn-write.test.sh`
Expected: All pass

```bash
git add meshes/narrative-engine-v2/scripts/schemas/turn/ test/scripts/
git commit -m "feat(narrative): add append and patch write modes with violations and sim-progress schemas"
```

---

## Chunk 2: campaign-write.sh + game-write.sh + Entity Addressing

### Task 4: campaign-write.sh with entity slash addressing

**Files:**
- Create: `meshes/narrative-engine-v2/scripts/campaign-write.sh`
- Create: `meshes/narrative-engine-v2/scripts/schemas/campaign/character.schema.jq`
- Create: `meshes/narrative-engine-v2/scripts/schemas/campaign/continuity.schema.jq`
- Create: `meshes/narrative-engine-v2/scripts/schemas/campaign/arc.schema.jq`
- Test: `test/scripts/campaign-write.test.sh`

campaign-write.sh is structurally identical to turn-write.sh but with:
1. Entity slash addressing (`character/kaitlin` → `entities/characters/kaitlin.yaml`)
2. Multi-target append (continuity with `--target`)
3. Delta+append combo (arc)

- [ ] **Step 1: Create campaign schemas derived from HH**

Create `meshes/narrative-engine-v2/scripts/schemas/campaign/character.schema.jq`:
```jq
def required: {"id": "string", "entity_type": "string", "name": "string"};
def allowed: ["id", "entity_type", "name", "traits", "layers", "episodes", "current_state", "protagonist", "role", "internal_state", "bonds"];
def freeform: ["traits", "current_state", "internal_state", "bonds"];
def write_mode: "patch";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

Create `meshes/narrative-engine-v2/scripts/schemas/campaign/continuity.schema.jq`:
```jq
def required: {};
def allowed: ["game", "campaign", "created", "version", "used_factoids", "encounters", "notes"];
def freeform: ["encounters"];
def write_mode: "append";
def allowed_targets: [".used_factoids", ".encounters", ".notes"];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

Create `meshes/narrative-engine-v2/scripts/schemas/campaign/arc.schema.jq`:
```jq
def required: {};
def allowed: ["game", "campaign", "last_updated", "arc_pressure", "arc_pressure_delta", "momentum", "phase", "dramatic_question", "central_tension", "questions", "seeds", "seed_history", "question_history", "turn_history", "trajectory", "next_turn_pressure_forecast"];
def freeform: ["turn_history", "trajectory"];
def write_mode: "delta";
def allowed_targets: [".seed_history", ".question_history"];
def patch_strategy: "deep_merge";
def delta_fields: ["arc_pressure"];
def valid_transitions: {};
include "validate-common";
validate
```

- [ ] **Step 2: Write failing tests for campaign-write.sh**

Create `test/scripts/campaign-write.test.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
WRITE="$ROOT/meshes/narrative-engine-v2/scripts/campaign-write.sh"
FIXTURES="$SCRIPT_DIR/fixtures"
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

# Test 1: Entity slash addressing — character/kaitlin writes to entities/characters/kaitlin.yaml
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
[[ "$LOCATION" == "cafe" && "$SHARP" == "high" ]] && PASS=$((PASS + 1)) || { echo "FAIL: patch should update location but keep traits" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$CP"

# Test 3: Continuity append with --target
CP=$(setup_campaign)
cat > "$CP/continuity.yaml" << 'EOF'
game: kaitlin
campaign: campaign-1
used_factoids:
  - factoid: "existing fact"
    turn: 0
EOF
echo '{"factoid":"new fact","turn":1,"source":"scribe"}' | "$WRITE" "$CP" continuity --target=.used_factoids 2>/dev/null
assert_exit "continuity append" 0 $?
COUNT=$(yq '.used_factoids | length' "$CP/continuity.yaml")
[[ "$COUNT" -eq 2 ]] && PASS=$((PASS + 1)) || { echo "FAIL: expected 2 factoids, got $COUNT" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$CP"

# Test 4: Arc delta mode
CP=$(setup_campaign)
cat > "$CP/arc.yaml" << 'EOF'
arc_pressure: 50
momentum: rising
phase:
  current: complication
EOF
echo '{"arc_pressure":-5,"momentum":"falling"}' | "$WRITE" "$CP" arc 2>/dev/null
assert_exit "arc delta" 0 $?
PRESSURE=$(yq '.arc_pressure' "$CP/arc.yaml")
MOMENTUM=$(yq '.momentum' "$CP/arc.yaml")
[[ "$PRESSURE" -eq 45 && "$MOMENTUM" == "falling" ]] && PASS=$((PASS + 1)) || { echo "FAIL: expected pressure 45 and momentum falling" >&2; FAIL=$((FAIL + 1)); }
rm -rf "$CP"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
```

Run: `bash test/scripts/campaign-write.test.sh`
Expected: FAIL (campaign-write.sh doesn't exist)

- [ ] **Step 3: Implement campaign-write.sh**

campaign-write.sh follows the same structure as turn-write.sh but with entity addressing logic. The key difference: when artifact contains `/`, split into type and ID, resolve schema from type, resolve file path from entity directory mapping.

Entity directory mapping:
```bash
resolve_entity_path() {
  local base="$1" artifact="$2"
  local type="${artifact%%/*}"
  local id="${artifact#*/}"
  case "$type" in
    character) echo "$base/entities/characters/$id.yaml" ;;
    bond)      echo "$base/entities/bonds/$id.yaml" ;;
    condition) echo "$base/entities/conditions/$id.yaml" ;;
    *)         echo "$base/$artifact.yaml" ;;
  esac
}
```

Copy the core logic from turn-write.sh, replacing:
- Schema dir: `schemas/campaign/`
- File path resolution: use `resolve_entity_path` when artifact contains `/`
- `--help` text updated for campaign context

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash test/scripts/campaign-write.test.sh`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/campaign-write.sh meshes/narrative-engine-v2/scripts/schemas/campaign/ test/scripts/campaign-write.test.sh
git commit -m "feat(narrative): add campaign-write.sh with entity slash addressing and delta/append modes"
```

---

### Task 5: game-write.sh

**Files:**
- Create: `meshes/narrative-engine-v2/scripts/game-write.sh`
- Create: `meshes/narrative-engine-v2/scripts/schemas/game/author.schema.jq`
- Create: `meshes/narrative-engine-v2/scripts/schemas/game/character.schema.jq`
- Test: `test/scripts/game-write.test.sh`

game-write.sh is the simplest — all game-level artifacts are overwrite mode. Same entity addressing as campaign-write.sh.

- [ ] **Step 1: Create game schemas derived from HH**

Create `meshes/narrative-engine-v2/scripts/schemas/game/author.schema.jq`:
```jq
def required: {"voice": "string"};
def allowed: ["voice", "pov", "tense", "cadence", "style", "somatic_emphasis", "during_spiral", "endings", "intellectual_engagement", "four_registers", "pacing", "balance", "devices", "diction", "punctuation", "formatting", "transformation_rule", "universal"];
def freeform: ["pov", "tense", "cadence", "style", "somatic_emphasis", "during_spiral", "endings", "intellectual_engagement", "four_registers", "pacing", "balance", "devices", "diction", "punctuation", "formatting", "universal"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

Create `meshes/narrative-engine-v2/scripts/schemas/game/character.schema.jq`:
```jq
def required: {"id": "string", "entity_type": "string", "name": "string"};
def allowed: ["id", "entity_type", "name", "traits", "layers", "episodes", "current_state", "protagonist", "voice", "surface_traits", "wants", "needs", "lie", "wound", "self_medication", "inner_weather", "at_best", "at_worst", "blind_spot", "opening_state", "physical_motif", "role"];
def freeform: ["traits", "voice", "current_state", "self_medication", "layers"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

- [ ] **Step 2: Write test, implement game-write.sh, verify**

game-write.sh is structurally identical to campaign-write.sh with schema dir `schemas/game/`. Write a minimal test verifying overwrite and entity addressing, then implement by adapting campaign-write.sh.

Test: `test/scripts/game-write.test.sh`

- [ ] **Step 3: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/game-write.sh meshes/narrative-engine-v2/scripts/schemas/game/ test/scripts/game-write.test.sh
git commit -m "feat(narrative): add game-write.sh with game-level schemas"
```

---

### Task 6: Extract shared write logic into write-common.sh

**Files:**
- Create: `meshes/narrative-engine-v2/scripts/write-common.sh`
- Modify: `meshes/narrative-engine-v2/scripts/turn-write.sh`
- Modify: `meshes/narrative-engine-v2/scripts/campaign-write.sh`
- Modify: `meshes/narrative-engine-v2/scripts/game-write.sh`

By this point, three write scripts share 90% of their logic. Extract shared code into `write-common.sh` that each script sources.

- [ ] **Step 1: Extract shared functions**

Create `meshes/narrative-engine-v2/scripts/write-common.sh`:
```bash
#!/usr/bin/env bash
# Shared write logic — sourced by turn-write.sh, campaign-write.sh, game-write.sh

validate_json() {
  local json_file="$1" schema_file="$2" schema_dir="$3"
  if ! jq empty "$json_file" 2>/dev/null; then
    echo "{\"ok\":false,\"errors\":[{\"type\":\"malformed_json\"}]}" >&2
    return 2
  fi
  jq -L "$schema_dir" -f "$schema_file" < "$json_file"
}

apply_overwrite() {
  local json_file="$1" output_file="$2"
  yq -P < "$json_file" > "$output_file"
}

apply_append() {
  local json_file="$1" output_file="$2" target="$3"
  if [[ -f "$output_file" ]]; then
    yq -o json "$output_file" | jq --argjson new "$(cat "$json_file")" \
      "$target += (if (\$new | type) == \"array\" then \$new else [\$new] end)" | yq -P > "${output_file}.tmp"
    mv "${output_file}.tmp" "$output_file"
  else
    local key="${target#.}"
    jq "{\"$key\": (if (. | type) == \"array\" then . else [.] end)}" < "$json_file" | yq -P > "$output_file"
  fi
}

apply_patch() {
  local json_file="$1" output_file="$2"
  if [[ -f "$output_file" ]]; then
    yq -o json "$output_file" | jq --argjson patch "$(cat "$json_file")" '. * $patch' | yq -P > "${output_file}.tmp"
    mv "${output_file}.tmp" "$output_file"
  else
    yq -P < "$json_file" > "$output_file"
  fi
}

apply_delta() {
  local json_file="$1" output_file="$2" delta_fields_json="$3"
  if [[ ! -f "$output_file" ]]; then
    echo "{\"ok\":false,\"errors\":[{\"type\":\"delta_no_existing\"}]}" >&2
    return 4
  fi
  local result
  result=$(yq -o json "$output_file")
  while IFS= read -r field; do
    [[ -z "$field" ]] && continue
    local delta_val
    delta_val=$(jq -r ".$field // 0" "$json_file")
    result=$(echo "$result" | jq ".$field = (.$field + $delta_val)")
  done < <(echo "$delta_fields_json" | jq -r '.[]')
  local non_delta
  non_delta=$(jq --argjson df "$delta_fields_json" 'to_entries | map(select(.key as $k | ($df | index($k)) | not)) | from_entries' "$json_file")
  echo "$result" | jq --argjson nd "$non_delta" '. * $nd' | yq -P > "${output_file}.tmp"
  mv "${output_file}.tmp" "$output_file"
}

resolve_entity_path() {
  local base="$1" artifact="$2"
  if [[ "$artifact" == */* ]]; then
    local type="${artifact%%/*}"
    local id="${artifact#*/}"
    case "$type" in
      character) echo "$base/entities/characters/$id.yaml" ;;
      bond)      echo "$base/entities/bonds/$id.yaml" ;;
      condition) echo "$base/entities/conditions/$id.yaml" ;;
      *)         echo "$base/entities/$type/$id.yaml" ;;
    esac
  else
    echo "$base/$artifact.yaml"
  fi
}

resolve_schema_name() {
  local artifact="$1"
  if [[ "$artifact" == */* ]]; then
    echo "${artifact%%/*}"
  else
    echo "$artifact"
  fi
}
```

- [ ] **Step 2: Refactor all three write scripts to source write-common.sh**

Each script shrinks to: parse args, set LEVEL, resolve paths, source write-common.sh, call shared functions.

- [ ] **Step 3: Run all existing tests to verify no regression**

```bash
bash test/scripts/validate-common.test.sh
bash test/scripts/turn-write.test.sh
bash test/scripts/campaign-write.test.sh
bash test/scripts/game-write.test.sh
```

Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/
git commit -m "refactor(narrative): extract shared write logic into write-common.sh"
```

---

## Chunk 3: Read Scripts

### Task 7: turn-read.sh — Browse, skim, and read modes

**Files:**
- Create: `meshes/narrative-engine-v2/scripts/turn-read.sh`
- Create: `meshes/narrative-engine-v2/scripts/read-common.sh`
- Test: `test/scripts/turn-read.test.sh`

- [ ] **Step 1: Create HH-derived test fixtures for turn reads**

Create `test/scripts/fixtures/turn-workspace/` with context.yaml, fates.yaml, resolution.yaml, violations.yaml populated from HH structures (simplified).

- [ ] **Step 2: Write failing tests for turn-read.sh**

Create `test/scripts/turn-read.test.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
READ="$ROOT/meshes/narrative-engine-v2/scripts/turn-read.sh"
FIXTURES="$SCRIPT_DIR/fixtures/turn-workspace"
PASS=0
FAIL=0

assert_json() {
  local desc="$1" result="$2" jq_check="$3"
  if echo "$result" | jq -e "$jq_check" > /dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc" >&2
    echo "  Check: $jq_check" >&2
    echo "  Got: $result" >&2
    FAIL=$((FAIL + 1))
  fi
}

# Test 1: --list shows available artifacts
RESULT=$("$READ" "$FIXTURES" --list 2>/dev/null)
assert_json "list artifacts" "$RESULT" '.artifacts | length > 0'

# Test 2: --keys shows top-level structure
RESULT=$("$READ" "$FIXTURES" fates --keys 2>/dev/null)
assert_json "fates keys" "$RESULT" '.keys | length > 0'

# Test 3: --section returns specific section
RESULT=$("$READ" "$FIXTURES" fates --section=branches 2>/dev/null)
assert_json "fates branches section" "$RESULT" 'type == "array"'

# Test 4: --search finds across artifacts
RESULT=$("$READ" "$FIXTURES" --search="survival" 2>/dev/null)
assert_json "search finds match" "$RESULT" '.matches | length > 0'

# Test 5: --summary returns compressed view
RESULT=$("$READ" "$FIXTURES" fates --summary 2>/dev/null)
assert_json "fates summary" "$RESULT" 'has("branches") or has("summary")'

# Test 6: --discover surfaces dynamic keys
RESULT=$("$READ" "$FIXTURES" fates --discover 2>/dev/null)
assert_json "fates discover" "$RESULT" 'has("freeform_keys")'

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
```

- [ ] **Step 3: Implement read-common.sh — shared read logic**

Create `meshes/narrative-engine-v2/scripts/read-common.sh` with functions:
- `do_list()` — list YAML files in directory, output as JSON array
- `do_keys()` — read YAML, output top-level keys with types and counts
- `do_section()` — extract one section, output as JSON
- `do_search()` — grep across YAML files, output matches with file/key/preview
- `do_summary()` — output key names with array lengths and object key counts
- `do_discover()` — for each freeform zone in schema, list the dynamic keys present
- `do_filter()` — apply `--since`/`--before`/`--index-on` filtering to arrays

```bash
do_list() {
  local dir="$1" level="$2"
  local files=()
  for f in "$dir"/*.yaml; do
    [[ -f "$f" ]] && files+=("$(basename "$f" .yaml)")
  done
  # Include entity directories
  for entity_dir in "$dir"/entities/*/; do
    [[ -d "$entity_dir" ]] || continue
    local type
    type=$(basename "$entity_dir")
    for ef in "$entity_dir"*.yaml; do
      [[ -f "$ef" ]] && files+=("$type/$(basename "$ef" .yaml)")
    done
  done
  printf '%s\n' "${files[@]}" | jq -R . | jq -s '{artifacts: .}'
}

do_keys() {
  local file="$1"
  yq -o json "$file" | jq '[keys[] as $k | {key: $k, type: (.[$k] | type), count: (if (.[$k] | type) == "array" then (.[$k] | length) elif (.[$k] | type) == "object" then (.[$k] | keys | length) else null end)}] | {keys: .}'
}

do_section() {
  local file="$1" section="$2"
  yq -o json ".$section" "$file"
}

do_search() {
  local dir="$1" query="$2" artifact="${3:-}"
  local results="[]"
  local files
  if [[ -n "$artifact" ]]; then
    files=("$dir/$artifact.yaml")
  else
    files=("$dir"/*.yaml)
  fi
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    local fname
    fname=$(basename "$f" .yaml)
    local matches
    matches=$(yq -o json "$f" | jq --arg q "$query" --arg fname "$fname" '
      [paths(strings) as $p | getpath($p) | select(test($q; "i")) |
       {file: $fname, key: ($p | join(".")), preview: .}] // []
    ' 2>/dev/null || echo "[]")
    results=$(echo "$results" | jq --argjson m "$matches" '. + $m')
  done
  echo "{\"matches\": $results}"
}

do_discover() {
  local file="$1" schema_dir="$2" level="$3" artifact="$4"
  local schema_file="$schema_dir/$level/$artifact.schema.jq"
  if [[ ! -f "$schema_file" ]]; then
    yq -o json "$file" | jq '{freeform_keys: (keys | map({(.): null}) | add // {})}'
    return
  fi
  local freeform
  freeform=$(jq -n -L "$schema_dir" "include \"$level/$artifact.schema\"; freeform" 2>/dev/null || echo "[]")
  local result="{}"
  while IFS= read -r zone; do
    [[ -z "$zone" ]] && continue
    local zone_keys
    zone_keys=$(yq -o json ".$zone" "$file" 2>/dev/null | jq 'if type == "object" then keys else [] end' 2>/dev/null || echo "[]")
    result=$(echo "$result" | jq --arg z "$zone" --argjson k "$zone_keys" '.[$z] = $k')
  done < <(echo "$freeform" | jq -r '.[]')
  echo "{\"freeform_keys\": $result}"
}

apply_time_filter() {
  local json="$1" since="${2:-}" before="${3:-}" index_on="${4:-turn}"
  local filter="."
  if [[ -n "$since" ]]; then
    filter="$filter | map(select(.$index_on >= $since))"
  fi
  if [[ -n "$before" ]]; then
    filter="$filter | map(select(.$index_on < $before))"
  fi
  echo "$json" | jq "$filter"
}
```

- [ ] **Step 4: Implement turn-read.sh**

Create `meshes/narrative-engine-v2/scripts/turn-read.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCHEMA_DIR="$SCRIPT_DIR/schemas"
source "$SCRIPT_DIR/read-common.sh"

if [[ "${1:-}" == "--help" || $# -lt 1 ]]; then
  cat >&2 << 'HELP'
Usage: turn-read.sh <workspace|turns_root> [artifact] [flags]

Query turn-level game data. Returns JSON to stdout.

Browse (artifact optional):
  --list              List available artifacts
  --search="X"        Search across artifacts

With artifact:
  --keys              Top-level structure and counts
  --summary           Compressed view
  --discover          Surface dynamic keys in freeform zones
  --section=X         Full content of one section

Filtering (on arrays):
  --since=N           Entries from turn N onward
  --before=N          Entries before turn N
  --index-on=FIELD    Field for turn filtering (default: turn)

Cross-turn search (pass turns root, not single workspace):
  turn-read.sh /path/to/turns --search="moth" --since=90 --before=100
HELP
  exit 0
fi

PATH_ARG="$1"
ARTIFACT=""
SECTION="" SEARCH="" SINCE="" BEFORE="" INDEX_ON="turn"
LIST=false KEYS=false SUMMARY=false DISCOVER=false

shift
for arg in "$@"; do
  case "$arg" in
    --list) LIST=true ;;
    --keys) KEYS=true ;;
    --summary) SUMMARY=true ;;
    --discover) DISCOVER=true ;;
    --section=*) SECTION="${arg#--section=}" ;;
    --search=*) SEARCH="${arg#--search=}" ;;
    --since=*) SINCE="${arg#--since=}" ;;
    --before=*) BEFORE="${arg#--before=}" ;;
    --index-on=*) INDEX_ON="${arg#--index-on=}" ;;
    *) ARTIFACT="$arg" ;;
  esac
done

SCHEMA_NAME=$(resolve_schema_name "${ARTIFACT:-}")

if $LIST; then
  do_list "$PATH_ARG" "turn"
elif [[ -n "$SEARCH" ]]; then
  do_search "$PATH_ARG" "$SEARCH" "$ARTIFACT"
elif $KEYS && [[ -n "$ARTIFACT" ]]; then
  do_keys "$PATH_ARG/$ARTIFACT.yaml"
elif $DISCOVER && [[ -n "$ARTIFACT" ]]; then
  do_discover "$PATH_ARG/$ARTIFACT.yaml" "$SCHEMA_DIR" "turn" "$SCHEMA_NAME"
elif $SUMMARY && [[ -n "$ARTIFACT" ]]; then
  do_keys "$PATH_ARG/$ARTIFACT.yaml"
elif [[ -n "$SECTION" && -n "$ARTIFACT" ]]; then
  RESULT=$(do_section "$PATH_ARG/$ARTIFACT.yaml" "$SECTION")
  if [[ -n "$SINCE" || -n "$BEFORE" ]]; then
    apply_time_filter "$RESULT" "$SINCE" "$BEFORE" "$INDEX_ON"
  else
    echo "$RESULT"
  fi
elif [[ -n "$ARTIFACT" ]]; then
  yq -o json "$PATH_ARG/$ARTIFACT.yaml"
else
  echo "{\"error\": \"specify an artifact or use --list/--search\"}" >&2
  exit 1
fi
```

Make executable: `chmod +x meshes/narrative-engine-v2/scripts/turn-read.sh`

- [ ] **Step 5: Run tests, verify pass**

Run: `bash test/scripts/turn-read.test.sh`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/turn-read.sh meshes/narrative-engine-v2/scripts/read-common.sh test/scripts/turn-read.test.sh test/scripts/fixtures/turn-workspace/
git commit -m "feat(narrative): add turn-read.sh with browse/skim/read modes"
```

---

### Task 8: campaign-read.sh with entity listing and time filtering

**Files:**
- Create: `meshes/narrative-engine-v2/scripts/campaign-read.sh`
- Test: `test/scripts/campaign-read.test.sh`

campaign-read.sh adds entity slash addressing to reads and time filtering on campaign arrays.

- [ ] **Step 1: Create test fixtures — campaign directory from HH**

Create `test/scripts/fixtures/campaign/` with state.yaml, continuity.yaml, arc.yaml, and `entities/characters/kaitlin.yaml` populated from HH (simplified).

- [ ] **Step 2: Write tests for campaign-read.sh**

Test cases:
```bash
# character --list → ["kaitlin", "heather"]
# character/kaitlin --keys → top-level structure
# character/kaitlin --section=episodes --since=5 → filtered episodes
# continuity --search="factoid text"
# arc --discover → freeform keys in turn_history, trajectory
# continuity --section=used_factoids --since=3 --before=8 → time slice
```

- [ ] **Step 3: Implement campaign-read.sh**

Same structure as turn-read.sh but with entity path resolution from read-common.sh. When artifact contains `/`, resolve to entity file. When artifact is entity type without ID, `--list` returns available entity IDs.

- [ ] **Step 4: Run tests, commit**

```bash
git add meshes/narrative-engine-v2/scripts/campaign-read.sh test/scripts/campaign-read.test.sh test/scripts/fixtures/campaign/
git commit -m "feat(narrative): add campaign-read.sh with entity and time filtering"
```

---

### Task 9: game-read.sh

**Files:**
- Create: `meshes/narrative-engine-v2/scripts/game-read.sh`
- Test: `test/scripts/game-read.test.sh`

Structurally identical to campaign-read.sh with schema dir `schemas/game/`.

- [ ] **Step 1: Write tests, implement, verify**

Minimal tests: `--list`, `--keys`, entity addressing, `--search`.

- [ ] **Step 2: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/game-read.sh test/scripts/game-read.test.sh
git commit -m "feat(narrative): add game-read.sh"
```

---

## Chunk 4: Remaining Schemas (HH-Derived)

### Task 10: Turn-level schemas — all 19 artifacts

**Files:**
- Create: All remaining `schemas/turn/*.schema.jq` files

Derive each schema from HH's actual YAML structures. For each artifact, define required/allowed/freeform based on the real top-level keys observed.

- [ ] **Step 1: Create schemas in batch — init-turn artifacts**

`context.schema.jq`:
```jq
def required: {"turn": "number"};
def allowed: ["turn", "context_type", "entropy_pool", "actor", "scene", "previous_turn", "player_action", "momentum"];
def freeform: ["actor", "scene", "previous_turn", "player_action", "momentum"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`intent.schema.jq`:
```jq
def required: {"turn": "number"};
def allowed: ["turn", "raw_input", "interpreted_action", "action_weight", "off_table", "choice_type", "description", "surface_rationalization", "subtext", "emotional_truth"];
def freeform: [];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`action-lock.schema.jq`:
```jq
def required: {"turn": "number"};
def allowed: ["turn", "locked_facts", "inviolable", "action"];
def freeform: [];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`director-notes.schema.jq`:
```jq
def required: {"turn": "number"};
def allowed: ["turn", "direction", "focus", "constraints", "creative_notes"];
def freeform: ["creative_notes"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

- [ ] **Step 2: Create schemas — architect artifacts**

`dramaturg-notes.schema.jq`:
```jq
def required: {"turn": "number"};
def allowed: ["turn", "context_type", "guidance", "prose_guidance"];
def freeform: ["guidance", "prose_guidance"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`entropy-tables.schema.jq`:
```jq
def required: {"turn": "number"};
def allowed: ["turn", "arc_pressure", "entropy_pool", "entropy_consumed", "actions", "floor_check", "mechanical_notes"];
def freeform: ["floor_check"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`entropy-selection.schema.jq`:
```jq
def required: {"turn": "number"};
def allowed: ["turn", "entropy_pool", "player_entropy", "world_entropy", "available_branches"];
def freeform: [];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`resolution.schema.jq`:
```jq
def required: {"turn": "number"};
def allowed: ["turn", "context_type", "outcome", "outcomes", "state_changes", "arc_update", "mechanical_notes", "turn_summary", "story_state_for_next_turn"];
def freeform: ["outcome", "state_changes", "arc_update"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`threads.schema.jq`, `pov-resolution.schema.jq`, `collisions.schema.jq` — same pattern, keys derived from mesh templates/config.

- [ ] **Step 3: Create schemas — simulator artifacts**

`scene-outline.schema.jq`:
```jq
def required: {};
def allowed: ["scene_structure", "decision_points", "continuity_notes", "prose_guidance"];
def freeform: ["scene_structure", "prose_guidance"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`scene-script.schema.jq`, `sim-plan.schema.jq`, `visual.schema.jq`, `calibration-state.schema.jq` — same pattern.

- [ ] **Step 4: Validate all schemas load without error**

```bash
for schema in meshes/narrative-engine-v2/scripts/schemas/turn/*.schema.jq; do
  echo '{}' | jq -L meshes/narrative-engine-v2/scripts/schemas -f "$schema" > /dev/null 2>&1 || echo "BROKEN: $schema"
done
```

- [ ] **Step 5: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/schemas/turn/
git commit -m "feat(narrative): add all turn-level jq schemas derived from HH"
```

---

### Task 11: Campaign and game-level schemas — remaining artifacts

**Files:**
- Create: Remaining `schemas/campaign/*.schema.jq` and `schemas/game/*.schema.jq`

- [ ] **Step 1: Campaign schemas**

`state.schema.jq`:
```jq
def required: {"current_turn": "number"};
def allowed: ["game", "campaign", "current_turn", "last_updated", "location", "momentum", "momentum_history", "arc_pressure", "arc_pressure_history", "phase", "turn_outcomes", "dramatic_questions", "next_turn_setup"];
def freeform: ["location", "phase", "turn_outcomes", "dramatic_questions", "next_turn_setup"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`trajectories.schema.jq`:
```jq
def required: {"id": "string"};
def allowed: ["id", "desc", "description", "status", "deadline", "source", "turn_planted", "turn_developed", "turn", "outcome", "trigger", "note", "negotiable", "intellectual_content"];
def freeform: [];
def write_mode: "patch";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {"planted": ["approaching","active"], "active": ["fired","expired"], "approaching": ["active","expired"]};
include "validate-common";
validate
```

`bond.schema.jq`:
```jq
def required: {"bond_id": "string"};
def allowed: ["bond_id", "type", "participants", "dimensions", "baseline", "established", "episodes", "nature", "conversation_texture", "intellectual_dynamic", "central_question"];
def freeform: ["dimensions", "baseline", "established"];
def write_mode: "patch";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`condition.schema.jq`:
```jq
def required: {"id": "string"};
def allowed: ["id", "entity_file", "turn", "type", "phase", "description", "effects"];
def freeform: ["effects"];
def write_mode: "patch";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {"set": ["active"], "active": ["resolved","chronic"], "chronic": ["resolved"]};
include "validate-common";
validate
```

- [ ] **Step 2: Game schemas — remaining**

`setting.schema.jq`:
```jq
def required: {};
def allowed: ["era", "location", "atmosphere", "truths", "constraints", "genre_modules", "tone_notes", "academic_world"];
def freeform: ["atmosphere", "academic_world"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`arc.schema.jq` (game-level):
```jq
def required: {};
def allowed: ["turn_last_updated", "arc_pressure", "arc_pressure_delta", "momentum", "phase_current", "phase_next_at", "dramatic_question", "meta_question", "central_tension", "mechanism", "mechanism_description", "what_they_risk", "intellectual_seeds", "seeds", "seed_history", "question_history", "forbidden_endings", "possible_endings", "ending_conditions", "epilogue_seeds", "holy_shit_turn", "possibility_space", "ambiguity"];
def freeform: ["central_tension", "what_they_risk", "ending_conditions"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

`bond.schema.jq` (game-level):
```jq
def required: {};
def allowed: ["bond_id", "type", "participants", "dimensions", "baseline", "established", "nature", "not", "conversation_texture", "intellectual_dynamic", "central_question"];
def freeform: ["dimensions", "baseline", "established"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

- [ ] **Step 3: Validate all schemas load, commit**

```bash
for level in turn campaign game; do
  for schema in meshes/narrative-engine-v2/scripts/schemas/$level/*.schema.jq; do
    echo '{}' | jq -L meshes/narrative-engine-v2/scripts/schemas -f "$schema" > /dev/null 2>&1 || echo "BROKEN: $schema"
  done
done
```

```bash
git add meshes/narrative-engine-v2/scripts/schemas/
git commit -m "feat(narrative): add all campaign and game-level jq schemas"
```

---

## Chunk 5: Integration Testing Against HH Data

### Task 12: Validate write scripts against real HH turn data

**Files:**
- Test: `test/scripts/hh-integration.test.sh`

Round-trip test: read HH YAML → convert to JSON → pipe through write script → diff output against original.

- [ ] **Step 1: Write integration test**

Create `test/scripts/hh-integration.test.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
HH_ROOT="/Users/god/projects/tx/tx-narrative-engine/.ai/games/heathers-hope"
TURN_WRITE="$ROOT/meshes/narrative-engine-v2/scripts/turn-write.sh"
CAMPAIGN_WRITE="$ROOT/meshes/narrative-engine-v2/scripts/campaign-write.sh"
GAME_WRITE="$ROOT/meshes/narrative-engine-v2/scripts/game-write.sh"
PASS=0
FAIL=0

round_trip() {
  local desc="$1" script="$2" original="$3" artifact="$4"
  local ws
  ws=$(mktemp -d)
  trap "rm -rf $ws" RETURN

  # Convert original YAML to JSON, pipe through write, diff
  yq -o json "$original" | "$script" "$ws" "$artifact" 2>/dev/null
  if [[ $? -ne 0 ]]; then
    echo "FAIL: $desc — write script rejected" >&2
    FAIL=$((FAIL + 1))
    return
  fi

  # Normalize both files (sort keys, consistent formatting)
  local expected actual
  expected=$(yq -o json -P "$original" | jq -S .)
  actual=$(yq -o json -P "$ws/$artifact.yaml" | jq -S .)

  if [[ "$expected" == "$actual" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc — output differs" >&2
    diff <(echo "$expected") <(echo "$actual") | head -20 >&2
    FAIL=$((FAIL + 1))
  fi
}

# Turn-level round trips
CAMPAIGN="$HH_ROOT/campaigns/campaign-1"
for turn_dir in "$CAMPAIGN/turns"/turn-*/; do
  TURN=$(basename "$turn_dir")
  for yaml in "$turn_dir"*.yaml; do
    [[ -f "$yaml" ]] || continue
    artifact=$(basename "$yaml" .yaml)
    round_trip "$TURN/$artifact" "$TURN_WRITE" "$yaml" "$artifact"
  done
done

# Game-level round trips
for yaml in "$HH_ROOT"/*.yaml; do
  [[ -f "$yaml" ]] || continue
  artifact=$(basename "$yaml" .yaml)
  round_trip "game/$artifact" "$GAME_WRITE" "$yaml" "$artifact"
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
```

- [ ] **Step 2: Run integration test, fix schema gaps**

Run: `bash test/scripts/hh-integration.test.sh`
Expected: Some failures where HH YAML has keys not in schemas. Fix by adding missing keys to `allowed` lists.

- [ ] **Step 3: Iterate until all round trips pass**

Each failure reveals a missing allowed key or wrong type assertion. Update the corresponding schema, re-run.

- [ ] **Step 4: Commit**

```bash
git add test/scripts/hh-integration.test.sh meshes/narrative-engine-v2/scripts/schemas/
git commit -m "test(narrative): add HH round-trip integration tests, fix schema gaps"
```

---

## Chunk 6: Data Migration

### Task 13: Arc schema restructure — per-turn keys to append-friendly arrays

**Files:**
- Create: `meshes/narrative-engine-v2/scripts/migrate-arc.sh`

Migrate `seeds_turn_X` / `questions_turn_X` dynamic keys into `seed_history` / `question_history` arrays.

- [ ] **Step 1: Write migration script**

```bash
#!/usr/bin/env bash
set -euo pipefail

ARC_FILE="${1:?Usage: migrate-arc.sh <arc.yaml>}"

# Extract seed_turn_X and questions_turn_X keys
yq -o json "$ARC_FILE" | jq '
  # Collect seed_turn_X entries
  [to_entries[] | select(.key | startswith("seeds_turn_")) |
   {turn: (.key | ltrimstr("seeds_turn_") | tonumber), data: .value}
  ] as $seed_hist |

  # Collect questions_turn_X entries
  [to_entries[] | select(.key | startswith("questions_turn_")) |
   {turn: (.key | ltrimstr("questions_turn_") | tonumber), questions: .value}
  ] as $question_hist |

  # Remove old keys, add new arrays
  with_entries(select(.key | (startswith("seeds_turn_") or startswith("questions_turn_")) | not)) |
  .seed_history = $seed_hist |
  .question_history = $question_hist
' | yq -P > "${ARC_FILE}.migrated"

mv "${ARC_FILE}.migrated" "$ARC_FILE"
echo "Migrated: $ARC_FILE" >&2
```

- [ ] **Step 2: Test against HH arc files**

```bash
# Dry run — copy and migrate
cp "$HH_ROOT/arc.yaml" /tmp/test-arc.yaml
bash meshes/narrative-engine-v2/scripts/migrate-arc.sh /tmp/test-arc.yaml
yq '.seed_history' /tmp/test-arc.yaml   # Should be array
yq '.question_history' /tmp/test-arc.yaml  # Should be array
yq '. | keys' /tmp/test-arc.yaml  # Should NOT contain seeds_turn_* or questions_turn_*
```

- [ ] **Step 3: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/migrate-arc.sh
git commit -m "feat(narrative): add arc schema migration script for append-friendly history"
```

---

### Task 14: Migrate monolithic entities.yaml to per-entity files

**Files:**
- Create: `meshes/narrative-engine-v2/scripts/migrate-entities.sh`

Split monolithic `entities.yaml` into per-entity files under `entities/characters/` and `entities/bonds/`.

- [ ] **Step 1: Write migration script**

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE="${1:?Usage: migrate-entities.sh <game_or_campaign_path>}"
ENTITIES_FILE="$BASE/entities.yaml"

[[ -f "$ENTITIES_FILE" ]] || { echo "No entities.yaml at $BASE" >&2; exit 0; }

mkdir -p "$BASE/entities/characters" "$BASE/entities/bonds"

# Extract characters
CHAR_IDS=$(yq -r '.characters | keys | .[]' "$ENTITIES_FILE" 2>/dev/null || true)
for id in $CHAR_IDS; do
  [[ -z "$id" ]] && continue
  TARGET="$BASE/entities/characters/$id.yaml"
  if [[ -f "$TARGET" ]]; then
    echo "SKIP: $TARGET already exists" >&2
    continue
  fi
  yq ".characters.$id" "$ENTITIES_FILE" | yq ".id = \"$id\" | .entity_type = \"character\"" > "$TARGET"
  echo "Created: $TARGET" >&2
done

# Extract dynamics/bonds
DYN_IDS=$(yq -r '.dynamics | keys | .[]' "$ENTITIES_FILE" 2>/dev/null || true)
for id in $DYN_IDS; do
  [[ -z "$id" ]] && continue
  TARGET="$BASE/entities/bonds/$id.yaml"
  if [[ -f "$TARGET" ]]; then
    echo "SKIP: $TARGET already exists" >&2
    continue
  fi
  yq ".dynamics.$id" "$ENTITIES_FILE" | yq ".bond_id = \"$id\" | .type = \"bond\"" > "$TARGET"
  echo "Created: $TARGET" >&2
done

echo "Migration complete. Review files, then remove $ENTITIES_FILE" >&2
```

- [ ] **Step 2: Test against HH data (dry run on copy)**

- [ ] **Step 3: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/migrate-entities.sh
git commit -m "feat(narrative): add entity migration script (monolithic → per-entity files)"
```

---

## Chunk 7: Transition Validation in Patch Mode

### Task 15: Add transition validation to validate-common.jq

**Files:**
- Modify: `meshes/narrative-engine-v2/scripts/schemas/validate-common.jq`
- Modify: `meshes/narrative-engine-v2/scripts/write-common.sh`
- Test: `test/scripts/transitions.test.sh`

- [ ] **Step 1: Write failing test for transition validation**

Create `test/scripts/transitions.test.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
WRITE="$ROOT/meshes/narrative-engine-v2/scripts/campaign-write.sh"
PASS=0
FAIL=0

# Test: Valid transition (planted → active) succeeds
CP=$(mktemp -d)
mkdir -p "$CP/entities/conditions"
cat > "$CP/trajectories.yaml" << 'EOF'
- id: traj1
  status: planted
  desc: test trajectory
EOF
echo '{"id":"traj1","status":"active","turn":5}' | "$WRITE" "$CP" trajectories 2>/dev/null
[[ $? -eq 0 ]] && PASS=$((PASS + 1)) || { echo "FAIL: valid transition should succeed" >&2; FAIL=$((FAIL + 1)); }

# Test: Invalid transition (planted → fired) fails with exit 4
CP2=$(mktemp -d)
cat > "$CP2/trajectories.yaml" << 'EOF'
- id: traj1
  status: planted
  desc: test trajectory
EOF
echo '{"id":"traj1","status":"fired"}' | "$WRITE" "$CP2" trajectories 2>/dev/null
[[ $? -eq 4 ]] && PASS=$((PASS + 1)) || { echo "FAIL: invalid transition should exit 4" >&2; FAIL=$((FAIL + 1)); }

rm -rf "$CP" "$CP2"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
```

- [ ] **Step 2: Implement transition checking in write-common.sh**

In `apply_patch()`, after merging:
1. Read `valid_transitions` from schema
2. If non-empty and the patch includes a `status` field, look up the current status from the existing file
3. Check if the transition is in the allowed set
4. If not, output error JSON and exit 4

- [ ] **Step 3: Run tests, commit**

```bash
bash test/scripts/transitions.test.sh
git add meshes/narrative-engine-v2/scripts/ test/scripts/transitions.test.sh
git commit -m "feat(narrative): add state transition validation to patch mode"
```

---

## Chunk 8: --help and Script Permissions

### Task 16: Comprehensive --help for all six scripts

**Files:**
- Modify: All six scripts

- [ ] **Step 1: Update --help output for each script**

Each script's `--help` must cover:
- Usage syntax with examples
- Available artifacts (discovered from schemas/)
- Available flags
- Write modes (for write scripts)
- Exit codes
- Error format

This is the canonical reference agents use at runtime. Be thorough.

- [ ] **Step 2: Make all scripts executable**

```bash
chmod +x meshes/narrative-engine-v2/scripts/{turn,campaign,game}-{read,write}.sh
chmod +x meshes/narrative-engine-v2/scripts/{read,write}-common.sh
```

- [ ] **Step 3: Commit**

```bash
git add meshes/narrative-engine-v2/scripts/
git commit -m "feat(narrative): add comprehensive --help to all gateway scripts"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | 1-3 | validate-common.jq + turn-write.sh with all 4 write modes |
| 2 | 4-6 | campaign-write.sh + game-write.sh + entity addressing + shared write-common.sh |
| 3 | 7-9 | All three read scripts with browse/skim/read/discover/search |
| 4 | 10-11 | All 30 schemas derived from HH data |
| 5 | 12 | Round-trip integration testing against real HH data |
| 6 | 13-14 | Data migration scripts (arc restructure, entity split) |
| 7 | 15 | State transition validation in patch mode |
| 8 | 16 | --help documentation for agent self-service |

**Not in this plan (separate follow-up work):**
- Agent prompt migration (Phase 2 of spec)
- Read script migration in agent prompts (Phase 3)
- campaign.sh retirement (Phase 4)
- Entropy script investigation
- Manifest file list cleanup
