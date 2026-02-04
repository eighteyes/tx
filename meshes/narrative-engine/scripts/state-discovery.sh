#!/usr/bin/env bash
# state-discovery.sh - Infer workflow state from file presence, output dispatch instructions
# Replaces coordinator routing logic with deterministic file-state inference.
# Usage: ./state-discovery.sh [session-path] [--table] [--route] [--next] [--agent <name>]

set -euo pipefail

# SCRIPT_DIR: absolute path to this script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ROOT: project directory — $TX_PROJECT_ROOT > git root > cwd
ROOT="${TX_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
CONFIG="$SCRIPT_DIR/../config.yaml"
MODE="full" # full | table | route | next | agent
SESSION=".ai/tx/narrative-engine/session.yaml"
AGENT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --table) MODE="table"; shift ;;
    --route) MODE="route"; shift ;;
    --next)  MODE="next"; shift ;;
    --agent) MODE="agent"; AGENT="$2"; shift 2 ;;
    -*) shift ;;
    *) SESSION="$1"; shift ;;
  esac
done

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

has() { [[ -f "$workspace/$1" ]] ; }
mark() { [[ -f "$workspace/$1" ]] && printf "${GREEN}■${RESET}" || printf "${DIM}□${RESET}"; }

# ─────────────────────────────────────────────
# SESSION
# ─────────────────────────────────────────────

if [[ ! -f "$ROOT/$SESSION" ]]; then
  echo -e "${RED}No session at ${SESSION}${RESET}"
  exit 1
fi

game_id=$(yq -r '.game_id // .game // "null"' "$ROOT/$SESSION")
campaign_id=$(yq -r '.campaign_id // .campaign // "null"' "$ROOT/$SESSION")
turn=$(yq -r '.turn // 0' "$ROOT/$SESSION")
session_phase=$(yq -r '.phase // "unknown"' "$ROOT/$SESSION")
workspace=$(yq -r '.workspace // "null"' "$ROOT/$SESSION")

if [[ "$workspace" == "null" || -z "$workspace" ]]; then
  if [[ "$game_id" != "null" && "$campaign_id" != "null" ]]; then
    workspace="$ROOT/.ai/games/$game_id/campaigns/$campaign_id/turns/turn-$turn"
  else
    workspace="/nonexistent"
  fi
fi
[[ "$workspace" != /* ]] && workspace="$ROOT/$workspace"

# ─────────────────────────────────────────────
# LINTER MANIFEST
# ─────────────────────────────────────────────

LINTERS=(
  lint-forbidden-words
  lint-patterns
  lint-ai-tells
  lint-cadence
  lint-dialogue
  lint-litotes
  lint-metaphor
  lint-body-first
  lint-factoids
  lint-temporal
)
LINT_TOTAL=${#LINTERS[@]}

# Count completed lint files
lint_done=0
lint_missing=()
for linter in "${LINTERS[@]}"; do
  if has "${linter}.yaml"; then
    lint_done=$((lint_done + 1))
  else
    lint_missing+=("$linter")
  fi
done

# ─────────────────────────────────────────────
# STATE INFERENCE
# Evaluate from highest-completed state backward.
# Highest file present wins — handles out-of-order artifacts.
# ─────────────────────────────────────────────

if [[ ! -d "$workspace" ]]; then
  state="no-workspace"
  writer="-"
  reason="Workspace directory absent"
elif has summary.md; then
  state="complete"
  writer="scribe"
  reason="Turn complete — all artifacts present"
elif has prose.md; then
  state="render:approved"
  writer="editor"
  reason="prose.md present → scribe compresses"
elif has violations.yaml; then
  state="render:linted"
  writer="editor"
  reason="violations.yaml assembled → editor reviews"
elif [[ $lint_done -eq $LINT_TOTAL ]] && has prose-draft.md; then
  # All lint files present but not yet assembled
  state="render:lint-done"
  writer="-"
  reason="All $LINT_TOTAL lint files present → assemble violations.yaml"
elif [[ $lint_done -gt 0 ]] && has prose-draft.md; then
  state="render:linting"
  writer="-"
  reason="Linting in progress ($lint_done/$LINT_TOTAL complete)"
elif has prose-draft.md; then
  state="render:drafting"
  writer="narrator"
  reason="prose-draft.md present → dispatch linters"
elif has scene-outline.yaml; then
  state="prep:complete"
  writer="scene-crafter"
  reason="scene-outline.yaml present → oracle validates continuity"
elif has reactions.yaml; then
  state="prep:cast"
  writer="cast"
  reason="reactions.yaml present → scene-crafter next"
elif has resolution.yaml; then
  state="prep:system"
  writer="system"
  reason="resolution.yaml present → cast next"
elif has dramaturg-notes.yaml && has fates.yaml; then
  state="prep:fates"
  writer="fates"
  reason="fates.yaml present → system next"
elif has dramaturg-notes.yaml; then
  state="prep:dramaturg"
  writer="dramaturg"
  reason="dramaturg-notes.yaml present → fates next"
elif has context.yaml; then
  state="init"
  writer="init-turn"
  reason="context.yaml present → prep phase begins"
else
  state="pre-init"
  writer="-"
  reason="Empty workspace → init-turn creates context"
fi

# ─────────────────────────────────────────────
# STATE TABLE (static reference — all possible states)
# ─────────────────────────────────────────────

# Each row: state | key_file | written_by | what_happens_next
STATE_TABLE=(
  "pre-init|—|—|init-turn creates context.yaml"
  "init|context.yaml|init-turn|dramaturg analyzes story context"
  "prep:dramaturg|dramaturg-notes.yaml|dramaturg|fates generates world possibilities"
  "prep:fates|fates.yaml|fates|system resolves mechanics"
  "prep:system|resolution.yaml|system|cast generates reactions"
  "prep:cast|reactions.yaml|cast|scene-crafter builds outline"
  "prep:complete|scene-outline.yaml|scene-crafter|oracle validates continuity"
  "render:drafting|prose-draft.md|narrator|dispatch linters (parallel)"
  "render:linting|lint-*.yaml|linters|linting in progress"
  "render:lint-done|lint-*.yaml (all)|linters|assemble violations.yaml"
  "render:linted|violations.yaml|—|editor reviews violations"
  "render:approved|prose.md|editor|scribe compresses turn"
  "complete|summary.md|scribe|turn finished — no dispatch"
)

# ─────────────────────────────────────────────
# DISPATCH TABLE
# Maps current state → spawn instructions.
# Fields: spawn agents | parallel | message body
# ─────────────────────────────────────────────

dispatch_agents=""
dispatch_parallel="false"
dispatch_message=""
dispatch_context=""

case "$state" in
  no-workspace|pre-init)
    dispatch_agents="init-turn"
    dispatch_message="Initialize turn workspace and create context.yaml"
    ;;
  init)
    dispatch_agents="dramaturg"
    dispatch_message="Analyze story context for turn $turn"
    dispatch_context="context.yaml"
    ;;
  prep:dramaturg)
    dispatch_agents="fates"
    dispatch_message="Generate world event possibilities for turn $turn"
    dispatch_context="context.yaml,dramaturg-notes.yaml"
    ;;
  prep:fates)
    dispatch_agents="system"
    dispatch_message="Resolve mechanical outcomes for turn $turn"
    dispatch_context="context.yaml,dramaturg-notes.yaml,fates.yaml"
    ;;
  prep:system)
    dispatch_agents="cast"
    dispatch_message="Generate character reactions for turn $turn"
    dispatch_context="context.yaml,dramaturg-notes.yaml,resolution.yaml"
    ;;
  prep:cast)
    dispatch_agents="scene-crafter"
    dispatch_message="Design scene beats and outline for turn $turn"
    dispatch_context="context.yaml,dramaturg-notes.yaml,resolution.yaml,reactions.yaml"
    ;;
  prep:complete)
    dispatch_agents="oracle"
    dispatch_message="Validate scene outline continuity for turn $turn"
    dispatch_context="scene-outline.yaml"
    ;;
  render:drafting)
    # Fan-out: dispatch all linters in parallel
    dispatch_agents=$(IFS=,; echo "${LINTERS[*]}")
    dispatch_parallel="true"
    dispatch_message="Lint prose-draft.md"
    dispatch_context="prose-draft.md"
    ;;
  render:linting)
    # Partial lint: dispatch only missing linters
    dispatch_agents=$(IFS=,; echo "${lint_missing[*]}")
    dispatch_parallel="true"
    dispatch_message="Lint prose-draft.md"
    dispatch_context="prose-draft.md"
    ;;
  render:lint-done)
    # All lint files present — assemble and dispatch editor
    dispatch_agents="editor"
    dispatch_message="Review aggregated violations for turn $turn"
    dispatch_context="prose-draft.md,violations.yaml"
    ;;
  render:linted)
    dispatch_agents="editor"
    dispatch_message="Review aggregated violations for turn $turn"
    dispatch_context="prose-draft.md,violations.yaml"
    ;;
  render:approved)
    dispatch_agents="scribe"
    dispatch_message="Compress turn $turn and update campaign state"
    dispatch_context="prose.md"
    ;;
  complete)
    dispatch_agents=""
    dispatch_message="Turn $turn finished. No dispatch needed."
    ;;
esac

# ─────────────────────────────────────────────
# OUTPUT: --next (machine-readable dispatch instructions)
# ─────────────────────────────────────────────

if [[ "$MODE" == "next" ]]; then
  echo "state=$state"
  echo "turn=$turn"
  echo "workspace=$workspace"
  echo "spawn=$dispatch_agents"
  echo "parallel=$dispatch_parallel"
  echo "message=$dispatch_message"
  echo "context_files=$dispatch_context"
  echo "lint_progress=$lint_done/$LINT_TOTAL"

  # Assemble violations.yaml when lint is complete but not yet assembled
  if [[ "$state" == "render:lint-done" ]]; then
    echo "assemble=violations.yaml"
    assemble_sources=""
    for linter in "${LINTERS[@]}"; do
      [[ -n "$assemble_sources" ]] && assemble_sources+=","
      assemble_sources+="${linter}.yaml"
    done
    echo "assemble_from=$assemble_sources"
  fi

  exit 0
fi

# ─────────────────────────────────────────────
# OUTPUT: --route (compact key=value)
# ─────────────────────────────────────────────

if [[ "$MODE" == "route" ]]; then
  echo "state=$state"
  echo "session_phase=$session_phase"
  echo "spawn=$dispatch_agents"
  echo "parallel=$dispatch_parallel"
  echo "writer=$writer"
  echo "reason=$reason"
  echo "game=$game_id"
  echo "turn=$turn"
  exit 0
fi

# ─────────────────────────────────────────────
# OUTPUT: --agent <name>
# Answers: What should this agent do given current file state?
# ─────────────────────────────────────────────

if [[ "$MODE" == "agent" ]]; then
  # Check if this agent is in the dispatch list
  is_dispatched="false"
  IFS=',' read -ra dispatch_list <<< "$dispatch_agents"
  for a in "${dispatch_list[@]}"; do
    [[ "$a" == "$AGENT" ]] && is_dispatched="true"
  done

  # Find what this agent produces from STATE_TABLE
  agent_produces=""
  agent_state=""
  for row in "${STATE_TABLE[@]}"; do
    IFS='|' read -r s_state s_file s_writer _ <<< "$row"
    [[ "$s_writer" == "$AGENT" ]] && agent_produces="$s_file" && agent_state="$s_state"
  done

  echo "agent=$AGENT"
  echo "state=$state"
  echo "is_dispatched=$is_dispatched"

  if [[ "$is_dispatched" == "true" ]]; then
    echo "action=execute"
    echo "message=$dispatch_message"
    echo "context_files=$dispatch_context"
    [[ -n "$agent_produces" ]] && echo "produces=$agent_produces"
  else
    echo "action=none"
    echo "reason=State ($state) dispatches [$dispatch_agents], not $AGENT"
  fi
  exit 0
fi

# ─────────────────────────────────────────────
# OUTPUT: --table
# ─────────────────────────────────────────────

if [[ "$MODE" == "table" ]]; then
  printf "%-20s %-24s %-18s %s\n" \
    "STATE" "KEY_FILE" "WRITTEN_BY" "NEXT_ACTION"
  printf "%-20s %-24s %-18s %s\n" \
    "─────" "────────" "──────────" "───────────"

  for row in "${STATE_TABLE[@]}"; do
    IFS='|' read -r s_state s_file s_writer s_next <<< "$row"

    if [[ "$s_state" == "$state" ]]; then
      printf "${YELLOW}► %-18s${RESET} %-24s %-18s %s\n" \
        "$s_state" "$s_file" "$s_writer" "$s_next"
    else
      completed=false
      case "$s_file" in
        "—") ;;
        lint-\*.yaml*)
          [[ $lint_done -gt 0 ]] && completed=true ;;
        *)
          [[ -f "$workspace/$s_file" ]] && completed=true ;;
      esac

      if $completed; then
        printf "${GREEN}  %-18s${RESET} ${DIM}%-24s %-18s %s${RESET}\n" \
          "$s_state" "$s_file" "$s_writer" "$s_next"
      else
        printf "  %-18s %-24s %-18s %s\n" \
          "$s_state" "$s_file" "$s_writer" "$s_next"
      fi
    fi
  done

  echo ""
  echo -e "Current: ${GREEN}${state}${RESET}  →  Dispatch: ${BOLD}${dispatch_agents}${RESET}"
  echo -e "Reason:  ${DIM}${reason}${RESET}"
  [[ "$dispatch_parallel" == "true" ]] && echo -e "         ${CYAN}(parallel)${RESET}"
  exit 0
fi

# ─────────────────────────────────────────────
# OUTPUT: full (default dashboard)
# ─────────────────────────────────────────────

echo -e "${BOLD}Narrative Engine State${RESET}"
echo "─────────────────────"
echo -e "Game:     ${CYAN}${game_id}${RESET}"
echo -e "Campaign: ${campaign_id}"
echo -e "Turn:     ${turn}"
echo -e "Session:  ${YELLOW}${session_phase}${RESET}"
echo ""

# Game artifacts
if [[ "$game_id" != "null" ]]; then
  game_path=$(yq -r '.game_path // "null"' "$ROOT/$SESSION")
  [[ "$game_path" == "null" ]] && game_path="$ROOT/.ai/games/$game_id"

  echo -e "${BOLD}Game Artifacts${RESET} ${DIM}($game_path)${RESET}"
  for f in setting.yaml arc.yaml protagonist.yaml entities.yaml author.yaml; do
    echo -e "  $(mark "$f") $f"
  done
  echo ""
fi

# Pipeline state table
if [[ -d "$workspace" ]]; then
  echo -e "${BOLD}Turn $turn Pipeline${RESET} ${DIM}($workspace)${RESET}"
  echo ""

  printf "  ${DIM}%-3s %-20s %-24s %-18s${RESET}\n" "" "STATE" "FILE" "WRITER"
  printf "  ${DIM}%-3s %-20s %-24s %-18s${RESET}\n" "" "─────" "────" "──────"

  for row in "${STATE_TABLE[@]}"; do
    IFS='|' read -r s_state s_file s_writer s_next <<< "$row"

    if [[ "$s_state" == "$state" ]]; then
      printf "  ${YELLOW}►${RESET} ${YELLOW}%-20s${RESET} %-24s %-18s\n" \
        "$s_state" "$s_file" "$s_writer"
    else
      completed=false
      case "$s_file" in
        "—") ;;
        lint-\*.yaml*)
          [[ $lint_done -gt 0 ]] && completed=true ;;
        *)
          [[ -f "$workspace/$s_file" ]] && completed=true ;;
      esac

      if $completed; then
        printf "  ${GREEN}■${RESET} ${DIM}%-20s %-24s %-18s${RESET}\n" \
          "$s_state" "$s_file" "$s_writer"
      else
        printf "  □ %-20s %-24s %-18s\n" \
          "$s_state" "$s_file" "$s_writer"
      fi
    fi
  done
  echo ""

  # Lint detail (if in lint phase)
  if [[ "$state" == render:linting || "$state" == render:lint-done || "$state" == render:drafting ]]; then
    echo -e "${BOLD}Lint Progress${RESET} ($lint_done/$LINT_TOTAL)"
    for linter in "${LINTERS[@]}"; do
      if has "${linter}.yaml"; then
        printf "  ${GREEN}■${RESET} ${DIM}%s${RESET}\n" "$linter"
      else
        printf "  □ %s\n" "$linter"
      fi
    done
    echo ""
  fi
fi

# Dispatch decision
echo -e "${BOLD}State:${RESET}    ${GREEN}${state}${RESET}"
echo -e "${BOLD}Dispatch:${RESET} ${BOLD}${dispatch_agents}${RESET}"
[[ "$dispatch_parallel" == "true" ]] && echo -e "          ${CYAN}(parallel)${RESET}"
echo -e "${BOLD}Message:${RESET}  ${DIM}${dispatch_message}${RESET}"
echo -e "${BOLD}Reason:${RESET}   ${DIM}${reason}${RESET}"

# Drift detection
drift="no"
case "$session_phase" in
  init|game_creation|prologue|unknown) ;;
  awaiting_narrator)
    [[ -f "$workspace/prose.md" ]] && drift="yes" ;;
  awaiting_oracle|awaiting_scribe)
    [[ ! -f "$workspace/prose.md" ]] && drift="yes" ;;
  complete)
    [[ ! -f "$workspace/summary.md" ]] && drift="yes" ;;
esac

if [[ "$drift" == "yes" ]]; then
  echo ""
  echo -e "${RED}DRIFT: session.yaml says '${session_phase}' but files say '${state}'${RESET}"
  echo -e "${RED}  Files are truth. Session may be stale.${RESET}"
fi
