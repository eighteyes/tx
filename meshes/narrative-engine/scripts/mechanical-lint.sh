#!/usr/bin/env bash
# mechanical-lint.sh — Consolidated mechanical linting for narrative-engine
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
AI_TELL_WORDS="amidst amongst whilst upon unto betwixt ere hence thus wherein whereby henceforth orbs visage countenance digits tresses locks maw appendages extremities testament beacon vessel tapestry symphony cascade labyrinth myriad plethora cacophony melancholy luminescence ethereal ephemeral embark delve navigate resonate evoke underscore pivotal beckoned loomed unfurled cascaded permeated reverberated emanated enveloped moreover furthermore nevertheless nonetheless hitherto aforementioned breathtaking stunning remarkable extraordinary exceptional unparalleled unprecedented pivotal crucial significant profound impactful meaningful transformative monumental architecture"

for word in $AI_TELL_WORDS; do
  matches=$(grep -inw "$word" "$PROSE" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    while IFS=: read -r linenum content; do
      [ -n "$linenum" ] && add_violation "ai-tell-word" "MECHANICAL" "$linenum" "$word" "$content" "replace AI tell word"
    done <<< "$matches"
  fi
done

# AI tell phrases
AI_PHRASES="serves as a|acts as a|functions as a|stands as a|represents a|constitutes a|features a|offers a|boasts a|showcases a|demonstrates a|rich history|rich tapestry|rich heritage|rich tradition|rich culture|broader implications|broader context|broader significance|enduring legacy|lasting impact|indelible mark|stands the test of time|plays a significant role|plays a crucial role|plays a pivotal role|emphasizing the importance|highlighting the significance|underscoring the need|demonstrating the power|showcasing the potential|load-bearing"

matches=$(grep -inE "$AI_PHRASES" "$PROSE" 2>/dev/null || true)
if [ -n "$matches" ]; then
  while IFS=: read -r linenum content; do
    [ -n "$linenum" ] && add_violation "ai-tell-phrase" "MECHANICAL" "$linenum" "AI phrase" "$content" "rewrite AI tell phrase"
  done <<< "$matches"
fi

# Em-dash count (budget: 3)
EMDASH_COUNT=$(grep -oE '--|—' "$PROSE" 2>/dev/null | wc -l | tr -d '[:space:]' || echo 0)
EMDASH_COUNT="${EMDASH_COUNT:-0}"
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
# NOTE: BSD awk (macOS) chokes on long inline regex alternations. Use a stopword
# file approach instead — write stopwords to temp, filter via awk array lookup.
# Generate fresh concordance from the prose being linted (don't trust pre-existing
# concordance.txt which may be stale from an earlier prose version).
FRESH_CONCORDANCE=$(mktemp)
tr '[:upper:]' '[:lower:]' < "$PROSE" | tr -cs '[:alpha:]' '\n' | sort | uniq -c | sort -rn > "$FRESH_CONCORDANCE" 2>/dev/null
CONCORDANCE="$FRESH_CONCORDANCE"
if [ -f "$CONCORDANCE" ]; then
  STOPWORDS_TMP=$(mktemp)
  cat > "$STOPWORDS_TMP" << 'STOPS'
that this with from have were been they them their what when where which will
would could should about after before there these those being other more some
into than then over only also like just know said came back come make made
take went here well very much even such your each most both does done down
good many time year long hand hands head eyes face voice room door
something nothing didn wasn couldn wouldn hadn haven
STOPS
  overuse_words=$(awk '
    NR==FNR { for(i=1;i<=NF;i++) stop[tolower($i)]=1; next }
    $1 >= 5 && length($2) >= 4 {
      w = tolower($2)
      if (!(w in stop)) print $1, $2
    }
  ' "$STOPWORDS_TMP" "$CONCORDANCE" 2>/dev/null || true)
  rm -f "$STOPWORDS_TMP"

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
  # Get top 50 words from story concordance — use file-based lookup (BSD awk safe)
  STORY_WORDS_TMP=$(mktemp)
  head -50 "$STORY_CONCORDANCE" | awk 'length($2) >= 4 {print tolower($2)}' > "$STORY_WORDS_TMP"

  if [ -s "$STORY_WORDS_TMP" ]; then
    # Check if any story-level top words appear 2+ times in current turn
    crutch_words=$(awk '
      NR==FNR { story[tolower($1)]=1; next }
      $1 >= 2 && length($2) >= 4 && tolower($2) in story {
        print $1, tolower($2)
      }
    ' "$STORY_WORDS_TMP" "$CONCORDANCE" 2>/dev/null || true)
    rm -f "$STORY_WORDS_TMP"

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
# SECTION 9: Meta-Leak Detection (Continuity Canary)
# Game-mechanical language in prose signals narrator pulling from wrong layer.
# Turn references = temporal omniscience. Trait names = entity YAML leaking.
# Each hit is a continuity violation flag — oracle should investigate POV.
# ============================================================================

# Turn references (Turn 86, turn 12, etc.)
turn_refs=$(grep -inE '\bTurn [0-9]+\b' "$PROSE" 2>/dev/null || true)
if [ -n "$turn_refs" ]; then
  while IFS=: read -r linenum content; do
    [ -n "$linenum" ] && add_violation "meta-leak" "CONTINUITY" "$linenum" "Turn [N]" "$content" "Game-mechanical time reference in prose. Characters have no turn awareness. Likely continuity violation — check POV and character knowledge."
  done <<< "$turn_refs"
fi

# Trait names in ALL CAPS (SMUG, INTELLIGENT, PROTECTIVE, DESPERATE, ANGRY, BOUNDARIED, FLUID, WARM)
trait_caps=$(grep -onE '\b(SMUG|INTELLIGENT|PROTECTIVE|DESPERATE|ANGRY|BOUNDARIED|FLUID|WARM)\b' "$PROSE" 2>/dev/null || true)
if [ -n "$trait_caps" ]; then
  while IFS=: read -r linenum word; do
    [ -n "$linenum" ] && add_violation "meta-leak" "CONTINUITY" "$linenum" "$word" "ALL-CAPS trait name in prose" "Trait label leaked from entity YAML. Render as behavior, not label."
  done <<< "$trait_caps"
fi

# Game-mechanical vocabulary that shouldn't appear in prose
META_WORDS="mechanical_note arc_pressure trait_pressure action_weight entropy_mode baseline decay_type"
for mword in $META_WORDS; do
  meta_matches=$(grep -in "$mword" "$PROSE" 2>/dev/null || true)
  if [ -n "$meta_matches" ]; then
    while IFS=: read -r linenum content; do
      [ -n "$linenum" ] && add_violation "meta-leak" "CONTINUITY" "$linenum" "$mword" "$content" "Game-mechanical term in prose. Narrator pulling from data layer."
    done <<< "$meta_matches"
  fi
done

# The word "mechanical" itself — game-data vocabulary
mech_matches=$(grep -inw "mechanical" "$PROSE" 2>/dev/null || true)
if [ -n "$mech_matches" ]; then
  while IFS=: read -r linenum content; do
    [ -n "$linenum" ] && add_violation "meta-leak" "CONTINUITY" "$linenum" "mechanical" "$content" "Game-data vocabulary in prose. Likely narrator parroting YAML field names."
  done <<< "$mech_matches"
fi

# ============================================================================
# SECTION: Motivation-Explanation / Moralizing Detection
# Catches narrator translating character subtext into thesis statements.
# ============================================================================

# Strip the rearmatter table (everything after final ---) for prose-only scanning
PROSE_BODY=$(sed '/^---$/,$ d' "$PROSE")

# Pattern 1: "The real answer/reason/truth" — narrator editorializing subtext
real_answer_matches=$(echo "$PROSE_BODY" | grep -inE '(the real (answer|reason|truth|meaning)|what (she|he|they) (really|actually) (felt|meant|wanted|needed|thought))' 2>/dev/null || true)
if [ -n "$real_answer_matches" ]; then
  while IFS=: read -r linenum content; do
    [ -n "$linenum" ] && add_violation "moralizing" "CREATIVE" "$linenum" "real-answer-pattern" "$content" "Narrator translating subtext into thesis. The body should show it, not the narrator explain it."
  done <<< "$real_answer_matches"
fi

# Pattern 2: "Something [adj] between them" — emotion label as narrative beat
something_matches=$(echo "$PROSE_BODY" | grep -inE 'something (tender|electric|fragile|delicate|unspoken|unnamed|raw|fierce|quiet|warm|careful|heavy|palpable|charged) between (them|the two|her|him)' 2>/dev/null || true)
if [ -n "$something_matches" ]; then
  while IFS=: read -r linenum content; do
    [ -n "$linenum" ] && add_violation "moralizing" "CREATIVE" "$linenum" "vague-emotion-label" "$content" "Emotion label wearing a scene costume. Name the physical sensation or cut."
  done <<< "$something_matches"
fi

# Pattern 3: "She recognized/realized/understood/saw clearly" — granted insight
insight_matches=$(echo "$PROSE_BODY" | grep -inE '(she|he) (recognized|realized|understood|saw clearly|became aware|acknowledged|grasped|comprehended)' 2>/dev/null || true)
if [ -n "$insight_matches" ]; then
  while IFS=: read -r linenum content; do
    [ -n "$linenum" ] && add_violation "moralizing" "CREATIVE" "$linenum" "granted-insight" "$content" "Narrator granting analytical insight. Show the behavior that reveals the insight instead."
  done <<< "$insight_matches"
fi

# Pattern 4: "Not because X but because Y" — motivation hierarchy explanation
not_because_matches=$(echo "$PROSE_BODY" | grep -inE 'not because .{5,60} but because' 2>/dev/null || true)
if [ -n "$not_because_matches" ]; then
  while IFS=: read -r linenum content; do
    [ -n "$linenum" ] && add_violation "moralizing" "CREATIVE" "$linenum" "motivation-hierarchy" "$content" "Narrator explaining the hierarchy of motivations. Let the action show which motivation won."
  done <<< "$not_because_matches"
fi

# Pattern 5: "Which meant" / "What it meant was" — narrator glossing
which_meant_matches=$(echo "$PROSE_BODY" | grep -inE '(which meant|what (it|this|that) meant|the (weight|significance|implication) of)' 2>/dev/null || true)
if [ -n "$which_meant_matches" ]; then
  while IFS=: read -r linenum content; do
    [ -n "$linenum" ] && add_violation "moralizing" "CREATIVE" "$linenum" "narrator-gloss" "$content" "Narrator explaining what the scene means. The scene means itself."
  done <<< "$which_meant_matches"
fi

# Pattern 6: Duplicate interiority — same analytical phrase repeated in italic internal voice
# Extract multi-word phrases (3+ words) from italic lines, flag any that appear 2+ times
ITALIC_PHRASES=$(mktemp)
echo "$PROSE_BODY" | grep -oE '\*[^*]{15,}?\*' | sed 's/^\*//;s/\*$//' | \
  tr '[:upper:]' '[:lower:]' | sort > "$ITALIC_PHRASES"
if [ -s "$ITALIC_PHRASES" ]; then
  # Extract 3-word ngrams from italic content, find repeats
  while IFS= read -r phrase; do
    echo "$phrase" | tr ' ' '\n' | paste - - - 2>/dev/null
  done < "$ITALIC_PHRASES" | sort | uniq -d | while IFS= read -r ngram; do
    [ -z "$ngram" ] && continue
    first_line=$(echo "$PROSE_BODY" | grep -inF "$ngram" 2>/dev/null | head -1 || true)
    linenum=$(echo "$first_line" | cut -d: -f1)
    [ -n "$linenum" ] && add_violation "moralizing" "CREATIVE" "$linenum" "duplicate-insight" "Repeated interiority phrase: ${ngram}" "Same analytical insight rendered multiple times. Trust the first rendering."
  done
fi
rm -f "$ITALIC_PHRASES"

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
rm -f "$TEMP_VIOLATIONS" "${TEMP_VIOLATIONS}.new" "$FRESH_CONCORDANCE"

exit 0
