#!/usr/bin/env bash
# lint-engine-bleed.sh — detect engine terminology leaking into prose
# Extracts labels from entity/config YAML, checks if they appear in prose-draft.md
# Any match is a violation: engine concepts should never appear in published prose.
#
# Usage: lint-engine-bleed.sh <workspace> <game_path> <campaign_path>
# Output: appends to violations.yaml in workspace

set -euo pipefail

WORKSPACE="${1:?Usage: lint-engine-bleed.sh <workspace> <game_path> <campaign_path>}"
GAME_PATH="${2:?Missing game_path}"
CAMPAIGN_PATH="${3:?Missing campaign_path}"

PROSE="$WORKSPACE/prose-draft.md"
VIOLATIONS="$WORKSPACE/violations.yaml"

[[ -f "$PROSE" ]] || { echo "No prose-draft.md found"; exit 0; }

# Collect engine terms from entity files
TERMS_FILE=$(mktemp)
trap "rm -f $TERMS_FILE" EXIT

# 1. Trait names — only check for ALLCAPS usage in prose (engine labels)
# Common English words (warm, fluid, angry) are fine lowercase in prose.
# Only flag when used as ALLCAPS trait labels or as psychological descriptors.
TRAIT_FILE=$(mktemp)
for f in "$GAME_PATH"/entities/characters/*.yaml "$CAMPAIGN_PATH"/entities/characters/*.yaml; do
  [[ -f "$f" ]] || continue
  yq '.traits.starting // {} | keys | .[]' "$f" 2>/dev/null >> "$TRAIT_FILE" || true
  yq '.traits.evolved // {} | keys | .[]' "$f" 2>/dev/null >> "$TRAIT_FILE" || true
done

# 2. Seed names from arc.yaml
if [[ -f "$CAMPAIGN_PATH/arc.yaml" ]]; then
  yq '.seeds.planted[].id // empty' "$CAMPAIGN_PATH/arc.yaml" 2>/dev/null >> "$TERMS_FILE" || true
  yq '.seeds.dormant[].id // empty' "$CAMPAIGN_PATH/arc.yaml" 2>/dev/null >> "$TERMS_FILE" || true
  yq '.seeds.ready_to_activate[].id // empty' "$CAMPAIGN_PATH/arc.yaml" 2>/dev/null >> "$TERMS_FILE" || true
  yq '.seeds.bloomed[].id // empty' "$CAMPAIGN_PATH/arc.yaml" 2>/dev/null >> "$TERMS_FILE" || true
fi

# 3. Condition IDs from entity files
for f in "$GAME_PATH"/entities/characters/*.yaml "$CAMPAIGN_PATH"/entities/characters/*.yaml \
         "$GAME_PATH"/entities/bonds/*.yaml "$CAMPAIGN_PATH"/entities/bonds/*.yaml; do
  [[ -f "$f" ]] || continue
  yq '.conditions[].id // empty' "$f" 2>/dev/null >> "$TERMS_FILE" || true
done

# 4. Voice description labels (voice_card section keys that are engine shorthand)
# Extract specific known engine terms from voice_card fields
for f in "$GAME_PATH"/entities/characters/*.yaml; do
  [[ -f "$f" ]] || continue
  yq '.life.voice_card.tone_palette // {} | keys | .[]' "$f" 2>/dev/null >> "$TERMS_FILE" || true
done

# 5. Bond mechanic terms (static list — these are engine vocabulary)
cat >> "$TERMS_FILE" << 'STATIC'
frontier
normalized_act
normalized act
bond_impact
arc_pressure
arc pressure
action_weight
entropy_mode
beat_mode
player_outcome_table
trait_pressure
trait pressure
STATIC

# Deduplicate and filter (skip very short terms that would false-positive)
sort -u "$TERMS_FILE" | awk 'length >= 4' > "${TERMS_FILE}.clean"
mv "${TERMS_FILE}.clean" "$TERMS_FILE"

# Search prose for matches
FOUND=0
MATCHES=""

# First pass: trait names — ALLCAPS only (case-sensitive)
if [[ -f "$TRAIT_FILE" ]]; then
  while IFS= read -r trait; do
    [[ -z "$trait" ]] && continue
    # Only flag ALLCAPS usage in prose body (skip the rearmatter table at the end)
    PROSE_BODY=$(sed '/^---$/,$ d; /^|/d' "$PROSE")
    if echo "$PROSE_BODY" | grep -q "$trait" 2>/dev/null; then
      while IFS= read -r line; do
        MATCHES="${MATCHES}\n  - term: \"$trait\"\n    type: trait_label_in_prose\n    found_in: \"$(echo "$line" | head -c 120)\"\n    severity: CREATIVE"
        FOUND=$((FOUND + 1))
      done < <(echo "$PROSE_BODY" | grep -n "$trait" | head -3)
    fi
  done < "$TRAIT_FILE"
  rm -f "$TRAIT_FILE"
fi

# Second pass: non-trait engine terms (case-insensitive)
while IFS= read -r term; do
  [[ -z "$term" ]] && continue

  # Convert underscores/hyphens to spaces for prose matching
  prose_term=$(echo "$term" | tr '_-' '  ')

  for pattern in "$term" "$prose_term"; do
    if grep -qi "$pattern" "$PROSE" 2>/dev/null; then
      while IFS= read -r line; do
        MATCHES="${MATCHES}\n  - term: \"$term\"\n    type: engine_term_in_prose\n    found_in: \"$(echo "$line" | head -c 120)\"\n    severity: CREATIVE"
        FOUND=$((FOUND + 1))
      done < <(grep -in "$pattern" "$PROSE" | head -3)
    fi
  done
done < "$TERMS_FILE"

if [[ $FOUND -gt 0 ]]; then
  echo "engine-bleed: $FOUND violations found"

  # Append to violations.yaml
  cat >> "$VIOLATIONS" << EOF

# Engine terminology bleed (lint-engine-bleed.sh)
engine_bleed:
  count: $FOUND
  violations:
$(echo -e "$MATCHES")
EOF
else
  echo "engine-bleed: clean"
fi
