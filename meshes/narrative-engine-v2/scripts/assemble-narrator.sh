#!/usr/bin/env bash
# assemble-narrator.sh — Pre-build narrator context into a single file
# Runs after oracle approves scene_script, before narrator starts
#
# Responsibilities:
#   - Read all workspace artifacts narrator needs
#   - Generate character briefs (via character-brief.sh)
#   - Extract author voice params
#   - Assemble into narrator-context.yaml
#
# Usage: assemble-narrator.sh <workspace> <game_path> <campaign_path>
# Output: {workspace}/narrator-context.yaml

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WORKSPACE="${1:?Usage: assemble-narrator.sh <workspace> <game_path> <campaign_path>}"
GAME_PATH="${2:?Usage: assemble-narrator.sh <workspace> <game_path> <campaign_path>}"
CAMPAIGN_PATH="${3:?Usage: assemble-narrator.sh <workspace> <game_path> <campaign_path>}"

OUTPUT="$WORKSPACE/narrator-context.yaml"

log() { echo -e "\033[2m[assemble-narrator]\033[0m $*" >&2; }

# Helper: embed a YAML file as a value under a key using yq (safe nesting)
embed_yaml() {
  local key="$1" file="$2" target="$3"
  if [[ -f "$file" ]]; then
    log "Embedding $key..."
    yq -n ".$key = load(\"$file\")" | yq eval-all 'select(fi == 0) * select(fi == 1)' "$target" - > "${target}.tmp"
    mv "${target}.tmp" "$target"
  fi
}

# ── Find scene_script ────────────────────────
SCENE_SCRIPT=""
for candidate in "$WORKSPACE/scene_script.yaml" "$WORKSPACE/scene-script.yaml"; do
  [[ -f "$candidate" ]] && SCENE_SCRIPT="$candidate" && break
done
if [[ -z "$SCENE_SCRIPT" ]]; then
  echo "ERROR: scene_script not found in workspace" >&2
  exit 1
fi

# ── Start output ─────────────────────────────
echo "# narrator-context.yaml — pre-assembled by assemble-narrator.sh" > "$OUTPUT"

# ── Scene Script ─────────────────────────────
embed_yaml "scene_script" "$SCENE_SCRIPT" "$OUTPUT"

# ── Player Context ───────────────────────────
embed_yaml "intent" "$WORKSPACE/intent.yaml" "$OUTPUT"
embed_yaml "context" "$WORKSPACE/context.yaml" "$OUTPUT"

# ── Director Notes (optional) ────────────────
embed_yaml "director_notes" "$WORKSPACE/director-notes.yaml" "$OUTPUT"

# ── Architect Outputs ────────────────────────
embed_yaml "dramaturg_notes" "$WORKSPACE/dramaturg-notes.yaml" "$OUTPUT"
embed_yaml "resolution" "$WORKSPACE/resolution.yaml" "$OUTPUT"
embed_yaml "threads" "$WORKSPACE/threads.yaml" "$OUTPUT"

# ── Collisions ───────────────────────────────
embed_yaml "collisions" "$WORKSPACE/collisions.yaml" "$OUTPUT"

# ── Character Briefs ─────────────────────────
log "Generating character briefs..."
PRESENT_CHARS=""
if [[ -f "$WORKSPACE/context.yaml" ]]; then
  PRESENT_CHARS=$(yq -r '.characters | keys | .[]' "$WORKSPACE/context.yaml" 2>/dev/null || echo "")
fi
if [[ -z "$PRESENT_CHARS" && -d "$CAMPAIGN_PATH/entities/characters" ]]; then
  for f in "$CAMPAIGN_PATH"/entities/characters/*.yaml; do
    [[ -f "$f" ]] && PRESENT_CHARS="$PRESENT_CHARS $(basename "$f" .yaml)"
  done
fi

# Generate briefs to temp files, then embed
BRIEF_TMP=$(mktemp)
echo "character_briefs:" > "$BRIEF_TMP"
for char_id in $PRESENT_CHARS; do
  log "  Brief: $char_id"
  CHAR_BRIEF_TMP=$(mktemp)
  "$SCRIPT_DIR/character-brief.sh" "$char_id" "$CAMPAIGN_PATH" > "$CHAR_BRIEF_TMP" 2>/dev/null || \
  "$SCRIPT_DIR/character-brief.sh" "$char_id" "$GAME_PATH" > "$CHAR_BRIEF_TMP" 2>/dev/null || \
  echo "error: brief generation failed" > "$CHAR_BRIEF_TMP"
  # Use yq to safely nest the brief
  yq -n ".\"$char_id\" = load(\"$CHAR_BRIEF_TMP\")" | sed 's/^/  /' >> "$BRIEF_TMP"
  rm -f "$CHAR_BRIEF_TMP"
done
yq eval-all 'select(fi == 0) * select(fi == 1)' "$OUTPUT" "$BRIEF_TMP" > "${OUTPUT}.tmp"
mv "${OUTPUT}.tmp" "$OUTPUT"
rm -f "$BRIEF_TMP"

# ── Author ───────────────────────────────────
embed_yaml "author" "$GAME_PATH/author.yaml" "$OUTPUT"

# ── Campaign State ───────────────────────────
embed_yaml "campaign_state" "$CAMPAIGN_PATH/state.yaml" "$OUTPUT"

# ── Timeline (tail — as string, not nested YAML) ──
if [[ -f "$CAMPAIGN_PATH/timeline.md" ]]; then
  log "Embedding timeline tail..."
  TIMELINE_TMP=$(mktemp)
  tail -30 "$CAMPAIGN_PATH/timeline.md" > "$TIMELINE_TMP"
  yq -n ".recent_timeline = load_str(\"$TIMELINE_TMP\")" | \
    yq eval-all 'select(fi == 0) * select(fi == 1)' "$OUTPUT" - > "${OUTPUT}.tmp"
  mv "${OUTPUT}.tmp" "$OUTPUT"
  rm -f "$TIMELINE_TMP"
fi

# ── Continuity (last_seen only) ──────────────
if [[ -f "$CAMPAIGN_PATH/continuity.yaml" ]]; then
  CONT_TMP=$(mktemp)
  yq '.last_seen // {}' "$CAMPAIGN_PATH/continuity.yaml" > "$CONT_TMP"
  yq -n ".continuity_last_seen = load(\"$CONT_TMP\")" | \
    yq eval-all 'select(fi == 0) * select(fi == 1)' "$OUTPUT" - > "${OUTPUT}.tmp"
  mv "${OUTPUT}.tmp" "$OUTPUT"
  rm -f "$CONT_TMP"
fi

# ── Story Concordance ────────────────────────
if [[ -f "$GAME_PATH/story-concordance.txt" ]]; then
  CONC_TMP=$(mktemp)
  tail -50 "$GAME_PATH/story-concordance.txt" > "$CONC_TMP"
  yq -n ".story_concordance = load_str(\"$CONC_TMP\")" | \
    yq eval-all 'select(fi == 0) * select(fi == 1)' "$OUTPUT" - > "${OUTPUT}.tmp"
  mv "${OUTPUT}.tmp" "$OUTPUT"
  rm -f "$CONC_TMP"
fi

log "Assembly complete: $OUTPUT"
echo "$OUTPUT"
