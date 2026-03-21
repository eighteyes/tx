#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
WRITE="$ROOT/meshes/narrative-engine-v2/scripts/campaign-write.sh"
PASS=0; FAIL=0

assert_exit() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" -eq "$expected" ]]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc — expected exit $expected, got $actual" >&2
    FAIL=$((FAIL + 1))
  fi
}

# Test 1: Valid transition (planted → active) succeeds
CP=$(mktemp -d)
mkdir -p "$CP/entities/conditions"
cat > "$CP/trajectories.yaml" << 'EOF'
id: traj1
status: planted
desc: test trajectory
EOF
echo '{"id":"traj1","status":"active","turn":5}' | "$WRITE" "$CP" trajectories 2>/dev/null
assert_exit "valid transition planted→active" 0 $?
rm -rf "$CP"

# Test 2: Invalid transition (planted → fired) fails
CP=$(mktemp -d)
cat > "$CP/trajectories.yaml" << 'EOF'
id: traj1
status: planted
desc: test trajectory
EOF
echo '{"id":"traj1","status":"fired"}' | "$WRITE" "$CP" trajectories 2>/dev/null
assert_exit "invalid transition planted→fired exits 4" 4 $?
rm -rf "$CP"

# Test 3: No status change (patch without status field) succeeds
CP=$(mktemp -d)
cat > "$CP/trajectories.yaml" << 'EOF'
id: traj1
status: planted
desc: test trajectory
EOF
echo '{"id":"traj1","desc":"updated description"}' | "$WRITE" "$CP" trajectories 2>/dev/null
assert_exit "no status change succeeds" 0 $?
rm -rf "$CP"

# Test 4: New file (no existing status) succeeds
CP=$(mktemp -d)
echo '{"id":"traj1","status":"planted","desc":"new trajectory"}' | "$WRITE" "$CP" trajectories 2>/dev/null
assert_exit "new file with initial status" 0 $?
rm -rf "$CP"

# Test 5: Valid condition transition (set → active)
CP=$(mktemp -d)
mkdir -p "$CP/entities/conditions"
cat > "$CP/entities/conditions/wounded.yaml" << 'EOF'
id: wounded
entity_type: condition
status: set
severity: moderate
EOF
echo '{"id":"wounded","entity_type":"condition","status":"active"}' | "$WRITE" "$CP" condition/wounded 2>/dev/null
assert_exit "valid condition transition set→active" 0 $?
rm -rf "$CP"

# Test 6: Invalid condition transition (set → resolved)
CP=$(mktemp -d)
mkdir -p "$CP/entities/conditions"
cat > "$CP/entities/conditions/wounded.yaml" << 'EOF'
id: wounded
entity_type: condition
status: set
severity: moderate
EOF
echo '{"id":"wounded","entity_type":"condition","status":"resolved"}' | "$WRITE" "$CP" condition/wounded 2>/dev/null
assert_exit "invalid condition transition set→resolved exits 4" 4 $?
rm -rf "$CP"

# Test 7: Same status (no actual transition) succeeds
CP=$(mktemp -d)
cat > "$CP/trajectories.yaml" << 'EOF'
id: traj1
status: planted
desc: test trajectory
EOF
echo '{"id":"traj1","status":"planted","desc":"same status update"}' | "$WRITE" "$CP" trajectories 2>/dev/null
assert_exit "same status no-op succeeds" 0 $?
rm -rf "$CP"

# Test 8: Valid transition (active → expired)
CP=$(mktemp -d)
cat > "$CP/trajectories.yaml" << 'EOF'
id: traj1
status: active
desc: test trajectory
EOF
echo '{"id":"traj1","status":"expired"}' | "$WRITE" "$CP" trajectories 2>/dev/null
assert_exit "valid transition active→expired" 0 $?
rm -rf "$CP"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
