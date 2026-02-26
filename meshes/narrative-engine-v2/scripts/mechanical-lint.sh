#!/usr/bin/env bash
# mechanical-lint.sh — Consolidated mechanical linting for narrative-engine-v2
# Replaces: lint-forbidden-words, lint-ai-tells, lint-cadence, lint-dialogue,
#           lint-body-first, lint-litotes (mechanical detection only)
#
# Usage: mechanical-lint.sh <workspace> <author.yaml> <story-concordance.txt>
# Reads: prose-draft.md, concordance.txt, dialogue-pairs.txt from workspace
# Writes: appends to violations.yaml (already initialized by narrator)
# Exit: always 0

# Don't use set -e because grep returns 1 when no matches
set -uo pipefail

WORKSPACE="$1"
AUTHOR_YAML="$2"
STORY_CONCORDANCE="$3"

PROSE="${WORKSPACE}/prose-draft.md"
CONCORDANCE="${WORKSPACE}/concordance.txt"
VIOLATIONS="${WORKSPACE}/violations.yaml"

# Temp file to collect all violations as JSON array
TEMP_VIOLATIONS=$(mktemp)
echo "[]" > "$TEMP_VIOLATIONS"

# Helper: add violation to temp file
add_violation() {
  local type="$1"
  local classification="$2"
  local line="$3"
  local word="$4"
  local context="$5"
  local fix="$6"

  # Escape for JSON (handle special chars)
  context=$(printf '%s' "$context" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/ /g' | tr '\n' ' ' | cut -c1-200)
  fix=$(printf '%s' "$fix" | sed 's/\\/\\\\/g; s/"/\\"/g')
  word=$(printf '%s' "$word" | sed 's/\\/\\\\/g; s/"/\\"/g')

  local entry="{\"type\":\"${type}\",\"classification\":\"${classification}\",\"line\":${line},\"word\":\"${word}\",\"context\":\"${context}\",\"fix\":\"${fix}\"}"

  # Append to temp file using jq
  jq --argjson entry "$entry" '. += [$entry]' "$TEMP_VIOLATIONS" > "${TEMP_VIOLATIONS}.new" && \
    mv "${TEMP_VIOLATIONS}.new" "$TEMP_VIOLATIONS"
}

# ============================================================================
# SECTION 1: Forbidden Words
# ============================================================================

# Core forbidden words - using array and file-based approach
FORBIDDEN_WORDS="suddenly seemed somehow clearly obviously very really quite rather"

for word in $FORBIDDEN_WORDS; do
  matches=$(grep -inw "$word" "$PROSE" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    while IFS=: read -r linenum content; do
      [ -n "$linenum" ] && add_violation "forbidden-word" "MECHANICAL" "$linenum" "$word" "$content" "delete or replace '$word'"
    done <<< "$matches"
  fi
done

# Phrases to detect
FORBIDDEN_PHRASES="began to|started to|proceeded to|could feel|could see|couldn't help|found herself|found himself"

matches=$(grep -inE "$FORBIDDEN_PHRASES" "$PROSE" 2>/dev/null || true)
if [ -n "$matches" ]; then
  while IFS=: read -r linenum content; do
    [ -n "$linenum" ] && add_violation "forbidden-phrase" "MECHANICAL" "$linenum" "filter phrase" "$content" "replace with direct verb"
  done <<< "$matches"
fi

# Fourth-wall check (skip legitimate uses like "she turned", "heart beat")
matches=$(grep -in "\bturn\b" "$PROSE" 2>/dev/null || true)
if [ -n "$matches" ]; then
  while IFS=: read -r linenum content; do
    if echo "$content" | grep -iqE "(turn [0-9]|this turn|previous turn|back on turn|next turn)"; then
      add_violation "fourth-wall" "MECHANICAL" "$linenum" "turn" "$content" "delete metatext - rewrite as narrative time reference"
    fi
  done <<< "$matches"
fi

# Uppercase trait names (LOYAL, DESPERATE, etc.)
matches=$(grep -onE '\b[A-Z_]{4,}\b' "$PROSE" 2>/dev/null || true)
if [ -n "$matches" ]; then
  while IFS=: read -r linenum word; do
    # Skip common acronyms
    if ! echo "$word" | grep -qE "^(HTML|HTTP|JSON|YAML|TODO|NOTE|ISBN|NASA|NATO|AIDS|ADHD|OK|AM|PM)$"; then
      context=$(sed -n "${linenum}p" "$PROSE" 2>/dev/null || echo "")
      [ -n "$context" ] && add_violation "uppercase-trait" "MECHANICAL" "$linenum" "$word" "$context" "show trait as behavior - delete label"
    fi
  done <<< "$matches"
fi

# ============================================================================
# SECTION 2: AI Tells
# ============================================================================

# Combined AI tell words
AI_TELL_WORDS="amidst amongst whilst upon unto betwixt ere hence thus wherein whereby henceforth orbs visage countenance digits tresses locks maw appendages extremities testament beacon vessel tapestry symphony cascade labyrinth myriad plethora cacophony melancholy luminescence ethereal ephemeral embark delve navigate resonate evoke underscore pivotal beckoned loomed unfurled cascaded permeated reverberated emanated enveloped moreover furthermore nevertheless nonetheless hitherto aforementioned breathtaking stunning remarkable extraordinary exceptional unparalleled unprecedented pivotal crucial significant profound impactful meaningful transformative monumental"

for word in $AI_TELL_WORDS; do
  matches=$(grep -inw "$word" "$PROSE" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    while IFS=: read -r linenum content; do
      [ -n "$linenum" ] && add_violation "ai-tell-word" "MECHANICAL" "$linenum" "$word" "$content" "replace AI tell word"
    done <<< "$matches"
  fi
done

# AI tell phrases
AI_PHRASES="serves as a|acts as a|functions as a|stands as a|represents a|constitutes a|features a|offers a|boasts a|showcases a|demonstrates a|rich history|rich tapestry|rich heritage|rich tradition|rich culture|broader implications|broader context|broader significance|enduring legacy|lasting impact|indelible mark|stands the test of time|plays a significant role|plays a crucial role|plays a pivotal role|emphasizing the importance|highlighting the significance|underscoring the need|demonstrating the power|showcasing the potential"

matches=$(grep -inE "$AI_PHRASES" "$PROSE" 2>/dev/null || true)
if [ -n "$matches" ]; then
  while IFS=: read -r linenum content; do
    [ -n "$linenum" ] && add_violation "ai-tell-phrase" "MECHANICAL" "$linenum" "AI phrase" "$content" "rewrite AI tell phrase"
  done <<< "$matches"
fi

# Em-dash count (budget: 3)
EMDASH_COUNT=$(grep -o '\-\-\|—' "$PROSE" 2>/dev/null | wc -l | tr -d ' ' || echo 0)
if [ "$EMDASH_COUNT" -gt 3 ]; then
  add_violation "structural" "STRUCTURAL" "0" "em-dash overuse" "Found $EMDASH_COUNT em-dashes (budget: 3)" "reduce em-dash usage, convert to commas or restructure"
fi

# Lists of three (budget: 1)
THREE_LIST_COUNT=$(grep -cE '\b\w+,\s+\w+,\s+(and|or)\s+\w+\b' "$PROSE" 2>/dev/null || echo "0")
THREE_LIST_COUNT=$(echo "$THREE_LIST_COUNT" | tr -d '\n' | tr -d ' ')
if [ "${THREE_LIST_COUNT:-0}" -gt 1 ]; then
  add_violation "structural" "STRUCTURAL" "0" "list-of-three overuse" "Found $THREE_LIST_COUNT lists of three (budget: 1)" "vary rhythm: use two or four items"
fi

# ============================================================================
# SECTION 3: Cadence Analysis
# ============================================================================

# Count sentences by length category - simplified
CADENCE_RESULT=$(awk '
BEGIN { medium=0; total=0 }
{
  n = split($0, sentences, /[.!?]+/)
  for (i=1; i<=n; i++) {
    words = split(sentences[i], w, /[[:space:]]+/)
    if (words >= 12 && words <= 25) medium++
    if (words > 0) total++
  }
}
END {
  if (total > 0) {
    medium_pct = int((medium * 100) / total)
    print medium_pct
  } else {
    print 0
  }
}
' "$PROSE" 2>/dev/null || echo 0)

if [ "$CADENCE_RESULT" -gt 60 ]; then
  entry="{\"type\":\"cadence\",\"classification\":\"STRUCTURAL\",\"scope\":\"document\",\"issue\":\"${CADENCE_RESULT}% medium-length sentences (target: <60%)\",\"suggestion\":\"vary with short punches and fragments\"}"
  jq --argjson entry "$entry" '. += [$entry]' "$TEMP_VIOLATIONS" > "${TEMP_VIOLATIONS}.new" && \
    mv "${TEMP_VIOLATIONS}.new" "$TEMP_VIOLATIONS"
fi

# ============================================================================
# SECTION 4: Dialogue Tags
# ============================================================================

FORBIDDEN_TAGS="exclaimed declared announced uttered replied responded interjected queried inquired retorted countered mused observed noted breathed murmured hissed growled purred sneered"

for tag in $FORBIDDEN_TAGS; do
  matches=$(grep -inE "\"[^\"]*\"[^\"]*\b$tag\b" "$PROSE" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    while IFS=: read -r linenum content; do
      [ -n "$linenum" ] && add_violation "dialogue-tag" "MECHANICAL" "$linenum" "$tag" "$content" "use 'said' or delete tag, add beat"
    done <<< "$matches"
  fi
done

# Adverb on tag detection
matches=$(grep -inE '"[^"]*"[^"]*\b(said|asked)\s+\w+ly\b' "$PROSE" 2>/dev/null || true)
if [ -n "$matches" ]; then
  while IFS=: read -r linenum content; do
    adverb=$(echo "$content" | grep -oE '\b(said|asked)\s+\w+ly\b' | head -1 || echo "adverb")
    [ -n "$linenum" ] && add_violation "dialogue-adverb" "MECHANICAL" "$linenum" "$adverb" "$content" "delete adverb from dialogue tag"
  done <<< "$matches"
fi

# ============================================================================
# SECTION 5: Body-First (Scene Opening)
# ============================================================================

FIRST_LINE=$(grep -m1 -v '^\s*$' "$PROSE" 2>/dev/null || echo "")

# Check for thought markers
if echo "$FIRST_LINE" | grep -qiE '^\s*(She|He|They|I)\s+(knew|realized|understood|remembered|wondered|thought)'; then
  escaped_line=$(printf '%s' "$FIRST_LINE" | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-100)
  entry="{\"type\":\"body-first\",\"classification\":\"CREATIVE\",\"scene\":1,\"line\":1,\"issue\":\"opens with thought before physical grounding\",\"opening\":\"${escaped_line}\",\"suggestion\":\"ground in physical sensation THEN move to thought\"}"
  jq --argjson entry "$entry" '. += [$entry]' "$TEMP_VIOLATIONS" > "${TEMP_VIOLATIONS}.new" && \
    mv "${TEMP_VIOLATIONS}.new" "$TEMP_VIOLATIONS"
fi

# Check for emotion markers
if echo "$FIRST_LINE" | grep -qiE '^\s*(Fear|Dread|Anxiety|A sense of|A wave of)'; then
  escaped_line=$(printf '%s' "$FIRST_LINE" | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-100)
  entry="{\"type\":\"body-first\",\"classification\":\"CREATIVE\",\"scene\":1,\"line\":1,\"issue\":\"opens with emotion before physical grounding\",\"opening\":\"${escaped_line}\",\"suggestion\":\"ground the feeling in body/space\"}"
  jq --argjson entry "$entry" '. += [$entry]' "$TEMP_VIOLATIONS" > "${TEMP_VIOLATIONS}.new" && \
    mv "${TEMP_VIOLATIONS}.new" "$TEMP_VIOLATIONS"
fi

# ============================================================================
# SECTION 6: Litotes Detection
# ============================================================================

LITOTES_COUNT=0
LITOTES_LINES=""

# Count litotes patterns
count1=$(grep -cE '\bnot\s+\w+,\s*but\s+\w+' "$PROSE" 2>/dev/null | tr -d '\n' || echo "0")
count2=$(grep -cE '\bnot\s+\w+(--|—)\w+' "$PROSE" 2>/dev/null | tr -d '\n' || echo "0")
count3=$(grep -cE '\bnot\s+\w+,\s*not\s+\w+' "$PROSE" 2>/dev/null | tr -d '\n' || echo "0")
count4=$(grep -cE '\bnot\s+(without|unlike)\b' "$PROSE" 2>/dev/null | tr -d '\n' || echo "0")

LITOTES_COUNT=$((${count1:-0} + ${count2:-0} + ${count3:-0} + ${count4:-0}))

if [ "$LITOTES_COUNT" -gt 2 ]; then
  # Get line numbers
  LITOTES_LINES=$(grep -nE '\bnot\s+\w+,\s*but\s+\w+|\bnot\s+\w+(--|—)\w+|\bnot\s+\w+,\s*not\s+\w+|\bnot\s+(without|unlike)\b' "$PROSE" 2>/dev/null | cut -d: -f1 | tr '\n' ',' | sed 's/,$//' || echo "")
  entry="{\"type\":\"litotes\",\"classification\":\"CREATIVE\",\"count\":${LITOTES_COUNT},\"budget\":2,\"lines\":[${LITOTES_LINES}],\"fix\":\"rewrite negations as positive statements\"}"
  jq --argjson entry "$entry" '. += [$entry]' "$TEMP_VIOLATIONS" > "${TEMP_VIOLATIONS}.new" && \
    mv "${TEMP_VIOLATIONS}.new" "$TEMP_VIOLATIONS"
fi

# ============================================================================
# SECTION 7: Concordance Overuse
# ============================================================================

# Words appearing 5+ times in this turn (excluding short/common words)
if [ -f "$CONCORDANCE" ]; then
  overuse_words=$(awk '$1 >= 5 && length($2) >= 4 {
    word = tolower($2)
    if (word !~ /^(that|this|with|from|have|were|been|they|them|their|what|when|where|which|will|would|could|should|about|after|before|there|these|those|being|other|more|some|into|than|then|over|only|also|like|just|know|said|came|back|come|make|made|take|went|here|well|very|much|even|such|your|each|most|both|does|done|down|good|many|time|year|long|hand|hands|head|eyes|face|voice|room|door|something|nothing|didn|wasn|couldn|wouldn|hadn|haven)$/)
      print $1, $2
  }' "$CONCORDANCE" 2>/dev/null || true)

  if [ -n "$overuse_words" ]; then
    while read -r count word; do
      [ -z "$count" ] && continue
      lines=$(grep -inw "$word" "$PROSE" 2>/dev/null | cut -d: -f1 | tr '\n' ',' | sed 's/,$//' || echo "")
      entry="{\"type\":\"overuse\",\"classification\":\"MECHANICAL\",\"word\":\"${word}\",\"occurrences\":${count},\"lines\":[${lines}],\"fix\":\"vary or reduce repetition\"}"
      jq --argjson entry "$entry" '. += [$entry]' "$TEMP_VIOLATIONS" > "${TEMP_VIOLATIONS}.new" && \
        mv "${TEMP_VIOLATIONS}.new" "$TEMP_VIOLATIONS"
    done <<< "$overuse_words"
  fi
fi

# ============================================================================
# SECTION 8: Story-Level Crutch Detection
# ============================================================================

if [ -f "$STORY_CONCORDANCE" ] && [ -f "$CONCORDANCE" ]; then
  # Get top 50 words from story concordance
  TOP_STORY_WORDS=$(head -50 "$STORY_CONCORDANCE" | awk 'length($2) >= 4 {print tolower($2)}' | tr '\n' '|' | sed 's/|$//' || echo "")

  if [ -n "$TOP_STORY_WORDS" ]; then
    # Check if any appear 2+ times in current turn concordance
    crutch_words=$(awk -v pattern="^($TOP_STORY_WORDS)$" '$1 >= 2 && length($2) >= 4 && tolower($2) ~ pattern {
      print $1, tolower($2)
    }' "$CONCORDANCE" 2>/dev/null || true)

    if [ -n "$crutch_words" ]; then
      while read -r count word; do
        [ -z "$count" ] && continue
        story_count=$(grep -iw "$word" "$STORY_CONCORDANCE" 2>/dev/null | head -1 | awk '{print $1}' || echo 0)
        if [ -n "$story_count" ] && [ "$story_count" -gt 20 ]; then
          lines=$(grep -inw "$word" "$PROSE" 2>/dev/null | cut -d: -f1 | tr '\n' ',' | sed 's/,$//' || echo "")
          entry="{\"type\":\"story-crutch\",\"classification\":\"MECHANICAL\",\"word\":\"${word}\",\"turn_count\":${count},\"story_count\":${story_count},\"lines\":[${lines}],\"fix\":\"story-level overuse, find alternative\"}"
          jq --argjson entry "$entry" '. += [$entry]' "$TEMP_VIOLATIONS" > "${TEMP_VIOLATIONS}.new" && \
            mv "${TEMP_VIOLATIONS}.new" "$TEMP_VIOLATIONS"
        fi
      done <<< "$crutch_words"
    fi
  fi
fi

# ============================================================================
# MERGE VIOLATIONS INTO violations.yaml
# ============================================================================

if [ -s "$TEMP_VIOLATIONS" ]; then
  VIOLATION_COUNT=$(jq 'length' "$TEMP_VIOLATIONS" 2>/dev/null || echo 0)
  if [ "$VIOLATION_COUNT" -gt 0 ]; then
    # Merge using yq
    yq -i ".violations += $(cat "$TEMP_VIOLATIONS")" "$VIOLATIONS" 2>/dev/null || {
      echo "mechanical-lint.sh: Warning - failed to merge violations"
    }
    echo "mechanical-lint.sh: Added $VIOLATION_COUNT violations to violations.yaml"
  else
    echo "mechanical-lint.sh: No violations found"
  fi
else
  echo "mechanical-lint.sh: No violations found"
fi

# Cleanup
rm -f "$TEMP_VIOLATIONS" "${TEMP_VIOLATIONS}.new"

exit 0
