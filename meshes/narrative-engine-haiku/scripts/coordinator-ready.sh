#!/bin/bash
# coordinator-ready.sh
# Safety check before coordinator sends task-complete to core
# Exit 0 = ready, Exit 1 = not ready

SESSION="${TX_ROOT:-.}/.ai/tx/narrative-engine/session.yaml"

if [[ ! -f "$SESSION" ]]; then
  echo "BLOCKED: session.yaml not found"
  exit 1
fi

phase=$(yq -r '.phase // "unknown"' "$SESSION")
already_sent=$(yq -r '.task_complete_sent // false' "$SESSION")

# Already sent - don't double-send
if [[ "$already_sent" == "true" ]]; then
  echo "BLOCKED: task-complete already sent"
  exit 1
fi

# Check all consultations are resolved (asked implies responded)
check_consultations() {
  local agents=("narrator" "oracle" "editor" "scribe")
  for agent in "${agents[@]}"; do
    asked=$(yq -r ".consultations.${agent}.asked // false" "$SESSION")
    responded=$(yq -r ".consultations.${agent}.responded // false" "$SESSION")
    if [[ "$asked" == "true" && "$responded" != "true" ]]; then
      echo "BLOCKED: ${agent} asked but not responded"
      exit 1
    fi
  done
}

# Validate campaign directory and key files exist
# Supports two session formats:
#   paths.campaign (template format)
#   game_path + campaign_id (runtime format)
check_campaign() {
  local campaign_dir
  campaign_dir=$(yq -r '.paths.campaign // ""' "$SESSION")

  if [[ -z "$campaign_dir" || "$campaign_dir" == "null" ]]; then
    # Fall back to runtime fields: game_path + campaign_id
    local game_path campaign_id
    game_path=$(yq -r '.game_path // ""' "$SESSION")
    campaign_id=$(yq -r '.campaign_id // ""' "$SESSION")

    if [[ -z "$game_path" || "$game_path" == "null" ]]; then
      echo "BLOCKED: no game_path in session.yaml"
      exit 1
    fi
    if [[ -z "$campaign_id" || "$campaign_id" == "null" ]]; then
      echo "BLOCKED: no campaign_id in session.yaml"
      exit 1
    fi

    campaign_dir="${game_path}/campaigns/${campaign_id}"
  fi

  # Resolve: use as-is if absolute, else relative to TX_ROOT
  local full_path="$campaign_dir"
  if [[ "$campaign_dir" != /* ]]; then
    full_path="${TX_ROOT:-.}/${campaign_dir}"
  fi

  if [[ ! -d "$full_path" ]]; then
    echo "BLOCKED: campaign directory not found: ${full_path}"
    exit 1
  fi

  local required_files=("continuity.yaml" "entities.yaml" "arc.yaml" "state.yaml")
  for f in "${required_files[@]}"; do
    if [[ ! -f "${full_path}/${f}" ]]; then
      echo "BLOCKED: campaign file missing: ${f} in ${full_path}"
      exit 1
    fi
  done
}

# Game creation - must have narrator response
if [[ "$phase" == "game_creation" || "$phase" == "game_maker" ]]; then
  narrator_asked=$(yq -r '.consultations.narrator.asked // false' "$SESSION")
  narrator_responded=$(yq -r '.consultations.narrator.responded // false' "$SESSION")

  if [[ "$narrator_asked" == "true" && "$narrator_responded" != "true" ]]; then
    echo "BLOCKED: game creation awaiting narrator response"
    exit 1
  fi

  echo "READY: game creation complete"
  exit 0
fi

# Turn completion - all consultations must be resolved
case "$phase" in
  awaiting_scribe|complete)
    check_consultations
    check_campaign
    echo "READY: turn completion (phase: $phase)"
    exit 0
    ;;
  *)
    echo "BLOCKED: not ready for task-complete (phase: $phase)"
    exit 1
    ;;
esac
