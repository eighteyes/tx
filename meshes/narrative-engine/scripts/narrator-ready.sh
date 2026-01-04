#!/bin/bash
# narrator-ready.sh
# Check if narrator can write final task-complete message
# Exit 0 = ready, Exit 1 = not ready

# Session file location (TX_ROOT is set by tx runtime)
SESSION="${TX_ROOT:-.}/.ai/tx/narrative-engine/session.yaml"

if [[ ! -f "$SESSION" ]]; then
  echo "BLOCKED: session.yaml not found"
  exit 1
fi

system_needed=$(yq -r '.consultations.system.needed // false' "$SESSION")
system_responded=$(yq -r '.consultations.system.responded // false' "$SESSION")
cast_needed=$(yq -r '.consultations.cast.needed // false' "$SESSION")
cast_responded=$(yq -r '.consultations.cast.responded // false' "$SESSION")
# ORACLE is ALWAYS required - ignore the "needed" field
oracle_responded=$(yq -r '.consultations.oracle.responded // false' "$SESSION")
oracle_approved=$(yq -r '.consultations.oracle.approved // false' "$SESSION")
already_sent=$(yq -r '.task_complete_sent // false' "$SESSION")
phase=$(yq -r '.phase // "unknown"' "$SESSION")

# Already done
if [[ "$already_sent" == "true" ]]; then
  echo "BLOCKED: task-complete already sent (phase: $phase)"
  exit 1
fi

# Awaiting SYSTEM
if [[ "$system_needed" == "true" && "$system_responded" != "true" ]]; then
  echo "BLOCKED: awaiting SYSTEM response (phase: $phase)"
  exit 1
fi

# Awaiting CAST
if [[ "$cast_needed" == "true" && "$cast_responded" != "true" ]]; then
  echo "BLOCKED: awaiting CAST response (phase: $phase)"
  exit 1
fi

# Awaiting ORACLE (always required)
if [[ "$oracle_responded" != "true" ]]; then
  echo "BLOCKED: awaiting ORACLE response (phase: $phase)"
  exit 1
fi

# ORACLE must approve (the continuity gate - always required)
if [[ "$oracle_approved" != "true" ]]; then
  echo "BLOCKED: ORACLE did not approve (continuity violations found)"
  exit 1
fi

echo "READY: all consultations complete, ORACLE approved (phase: $phase)"
exit 0
