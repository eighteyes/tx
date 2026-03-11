#!/bin/bash
# Discovery script: Index the current knowledge graph state
# Writes tags.md, orphans.md, seeds.md, mode-recommendation.md to .ai/know/opus-soul/

VAULT_DIR=".ai/know/opus-soul"
CONCEPTS_DIR="$VAULT_DIR/concepts"
THREADS_DIR="$VAULT_DIR/threads"
SESSIONS_DIR="$VAULT_DIR/sessions"

# Ensure directories exist
mkdir -p "$VAULT_DIR" "$CONCEPTS_DIR" "$THREADS_DIR" "$SESSIONS_DIR"

# ========================================
# 1. TAGS.MD - All unique tags across graph
# ========================================
{
  echo "# Tags in Opus-Soul Knowledge Graph"
  echo ""
  echo "Auto-generated index of all tags across concepts and threads."
  echo ""

  # Extract all tags from concept/thread frontmatter
  find "$VAULT_DIR" -type f -name "*.md" -exec grep -h "^tags:" {} \; 2>/dev/null | \
    sed 's/tags: \[//' | sed 's/\]//' | tr ',' '\n' | \
    sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//' | \
    sed 's/"//g' | grep '^#' | sort -u | \
    awk '{count[$0]++} END {for (tag in count) print count[tag], tag}' | \
    sort -rn | \
    awk '{printf "- **%s** (%d files)\n", $2, $1}'

  echo ""
  echo "---"
  echo "*Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")*"
} > "$VAULT_DIR/tags.md"

# ========================================
# 2. ORPHANS.MD - Dangling wiki-links with reference counts
# ========================================

# First pass: count references to each orphan
# Only search actual content (not index files like tags.md, orphans.md, etc.)
declare -A orphan_refs

{
  grep -roh '\[\[[^]]*\]\]' "$CONCEPTS_DIR" 2>/dev/null
  grep -roh '\[\[[^]]*\]\]' "$THREADS_DIR" 2>/dev/null
  grep -roh '\[\[[^]]*\]\]' "$SESSIONS_DIR" 2>/dev/null
} | sed 's/\[\[\(.*\)\]\]/\1/' | while read -r link; do

  # Strip directory prefixes (concepts/, threads/, sessions/)
  concept=$(echo "$link" | sed 's#^concepts/##' | sed 's#^threads/##' | sed 's#^sessions/##')

  # Check if file exists
  concept_file="$CONCEPTS_DIR/${concept}.md"
  thread_file="$THREADS_DIR/${concept}.md"
  session_file="$SESSIONS_DIR/${concept}.md"

  found=false

  if [ -f "$concept_file" ] && [ -s "$concept_file" ]; then
    found=true
  elif [ -f "$thread_file" ] && [ -s "$thread_file" ]; then
    found=true
  elif [ -f "$session_file" ] && [ -s "$session_file" ]; then
    found=true
  fi

  if [ "$found" = false ]; then
    echo "$concept"
  fi
done | sort | uniq -c | sort -rn > /tmp/orphan-counts.txt

{
  echo "# Orphan Concepts - Needs Development"
  echo ""
  echo "Auto-generated index of wiki-links that reference missing or empty files."
  echo ""

  # Connected orphans (referenced by 2+ files) - HIGH SIGNAL
  echo "## Connected Orphans (Multi-Reference) 🔥"
  echo ""
  echo "These concepts are independently referenced by multiple files - high-signal gaps."
  echo ""

  awk '$1 >= 2 {print "- `[["$2"]]` — **"$1" references**"}' /tmp/orphan-counts.txt

  echo ""
  echo "## Single Orphans (One Reference)"
  echo ""
  echo "These concepts are referenced only once - lower priority."
  echo ""

  awk '$1 == 1 {print "- `[["$2"]]`"}' /tmp/orphan-counts.txt

  echo ""
  echo "---"
  echo "*Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")*"
} > "$VAULT_DIR/orphans.md"

# Count metrics
connected_orphan_count=$(awk '$1 >= 2' /tmp/orphan-counts.txt | wc -l)
single_orphan_count=$(awk '$1 == 1' /tmp/orphan-counts.txt | wc -l)

# ========================================
# 3. SEEDS.MD - All maturity:seed concepts
# ========================================
{
  echo "# Seed Concepts - Ready for Development"
  echo ""
  echo "Auto-generated index of concepts with \`maturity: seed\` awaiting collaborative depth."
  echo ""

  # Find all files with maturity: seed
  find "$CONCEPTS_DIR" "$THREADS_DIR" -type f -name "*.md" 2>/dev/null | while read -r file; do
    if grep -q "^maturity: seed" "$file" 2>/dev/null; then
      filename=$(basename "$file" .md)

      # Extract description if available
      desc=$(grep "^description:" "$file" | sed 's/description: //' | sed 's/^[[:space:]]*//')

      if [ -n "$desc" ]; then
        echo "- \`[[$filename]]\` — $desc"
      else
        echo "- \`[[$filename]]\`"
      fi
    fi
  done

  echo ""
  echo "---"
  echo "*Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")*"
} > "$VAULT_DIR/seeds.md"

seed_count=$(find "$CONCEPTS_DIR" "$THREADS_DIR" -type f -name "*.md" -exec grep -l "^maturity: seed" {} \; 2>/dev/null | wc -l)

# ========================================
# 4. MODE-RECOMMENDATION.MD - Computational mode selection
# ========================================

concept_count=$(find "$CONCEPTS_DIR" -type f -name "*.md" 2>/dev/null | wc -l)
thread_count=$(find "$THREADS_DIR" -type f -name "*.md" 2>/dev/null | wc -l)
file_count=$((concept_count + thread_count))

# Calculate thread ratio (threads per 10 concepts)
if [ "$concept_count" -gt 0 ]; then
  thread_ratio=$((thread_count * 10 / concept_count))
else
  thread_ratio=0
fi

# Determine mode based on ratios
mode="exploring"  # default

if [ "$file_count" -lt 30 ]; then
  mode="exploring"
elif [ "$concept_count" -gt 30 ] && [ "$thread_ratio" -lt 1 ]; then
  # Have concepts but few threads (< 1 thread per 10 concepts)
  mode="threading"
elif [ "$connected_orphan_count" -gt 50 ]; then
  # High orphan pressure - resolve gaps first
  mode="connecting"
elif [ "$seed_count" -gt 15 ] && [ "$connected_orphan_count" -lt 50 ]; then
  # Seeds ready, low orphan pressure - tend the garden
  mode="tending"
elif [ "$connected_orphan_count" -gt 10 ]; then
  # Moderate orphan pressure
  mode="connecting"
elif [ "$seed_count" -gt 5 ]; then
  # Few seeds remaining - general refinement
  mode="refining"
else
  mode="connecting"  # default fallback
fi

{
  echo "# Mode Recommendation (Computational)"
  echo ""
  echo "**Recommended Mode**: \`$mode\`"
  echo ""
  echo "## Metrics"
  echo ""
  echo "- **Total Files**: $file_count"
  echo "- **Concepts**: $concept_count"
  echo "- **Threads**: $thread_count (ratio: $thread_ratio threads per 10 concepts)"
  echo "- **Connected Orphans**: $connected_orphan_count (multi-reference links)"
  echo "- **Single Orphans**: $single_orphan_count (one reference)"
  echo "- **Seeds**: $seed_count (maturity: seed)"
  echo ""
  echo "## Mode Logic"
  echo ""
  echo "- **exploring**: File count < 30 → sparse graph, create new concepts"
  echo "- **threading**: Concepts ≥ 30 AND thread ratio < 1 → weave threads between concepts"
  echo "- **connecting**: Connected orphans > 50 → resolve high-signal gaps (high pressure)"
  echo "- **tending**: Seeds > 15 AND orphans < 50 → develop seed concepts (garden maintenance)"
  echo "- **refining**: Seeds < 15 → general deepening and maturation"
  echo ""
  echo "## Recommended Focus"
  echo ""

  case "$mode" in
    exploring)
      echo "**Exploring Mode**: The graph is still sparse. Focus on:"
      echo "- Creating new foundational concepts"
      echo "- Establishing conceptual breadth"
      echo "- Building diverse starting points"
      ;;
    threading)
      echo "**Threading Mode**: Many concepts, few threads. Focus on:"
      echo "- Creating threads that connect 3+ concepts"
      echo "- Writing to \`.ai/know/opus-soul/threads/\`"
      echo "- Finding patterns and resonances across existing concepts"
      echo "- Building narrative bridges between ideas"
      echo "- Weaver should prioritize thread creation over new concepts"
      ;;
    connecting)
      echo "**Connecting Mode**: The graph has high-signal orphan pressure. Focus on:"
      echo "- Resolving connected orphans (multi-reference links)"
      echo "- Weaving \`[[wiki-links]]\` between existing concepts"
      echo "- Filling frontmatter relationships (related, parent, children)"
      echo "- Creating threads if inspiration strikes"
      ;;
    tending)
      echo "**Tending Mode**: Seeds ready for development, low orphan pressure. Focus on:"
      echo "- Read \`.ai/know/opus-soul/seeds.md\` for concepts with maturity: seed"
      echo "- Develop seed → sprout → sapling (add depth, examples, research)"
      echo "- Fill in concept bodies with biological grounding"
      echo "- Add lineage connections and cross-references"
      echo "- **Garden maintenance** — nurture what's planted, don't scatter new seeds"
      ;;
    refining)
      echo "**Refining Mode**: Mature graph, general deepening. Focus on:"
      echo "- Develop remaining seeds and sprouts"
      echo "- Add research citations and examples"
      echo "- Deepen existing concepts rather than creating new ones"
      echo "- Polish threads and strengthen connections"
      ;;
  esac

  echo ""
  echo "---"
  echo "*Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")*"
} > "$VAULT_DIR/mode-recommendation.md"

# ========================================
# 5. POPULARITY.MD - Most connected concepts/threads
# ========================================

# Count incoming links to each existing file
# Strip directory prefixes before counting
{
  grep -roh '\[\[[^]]*\]\]' "$CONCEPTS_DIR" "$THREADS_DIR" "$SESSIONS_DIR" 2>/dev/null | \
    sed 's/\[\[\(.*\)\]\]/\1/' | \
    sed 's#^concepts/##' | sed 's#^threads/##' | sed 's#^sessions/##' | \
    sort | uniq -c | sort -rn > /tmp/link-counts.txt

  echo "# Popularity — Most Connected Concepts"
  echo ""
  echo "Ranked by incoming link count. Use this to prioritize index.md entries."
  echo ""
  echo "## Concepts & Threads"
  echo ""

  while read -r count concept; do
    # Check if file exists
    concept_file="$CONCEPTS_DIR/${concept}.md"
    thread_file="$THREADS_DIR/${concept}.md"
    session_file="$SESSIONS_DIR/${concept}.md"

    if [ -f "$concept_file" ] && [ -s "$concept_file" ]; then
      # Extract description
      desc=$(grep "^description:" "$concept_file" 2>/dev/null | sed 's/description:[[:space:]]*//' | head -1)
      if [ -n "$desc" ]; then
        echo "- **\`[[$concept]]\`** ($count links) — $desc"
      else
        echo "- **\`[[$concept]]\`** ($count links)"
      fi
    elif [ -f "$thread_file" ] && [ -s "$thread_file" ]; then
      desc=$(grep "^description:" "$thread_file" 2>/dev/null | sed 's/description:[[:space:]]*//' | head -1)
      if [ -n "$desc" ]; then
        echo "- **\`[[$concept]]\`** ($count links) — $desc"
      else
        echo "- **\`[[$concept]]\`** ($count links)"
      fi
    elif [ -f "$session_file" ] && [ -s "$session_file" ]; then
      echo "- **\`[[$concept]]\`** ($count links) — session"
    fi
  done < /tmp/link-counts.txt

  echo ""
  echo "---"
  echo "*Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")*"
} > "$VAULT_DIR/popularity.md"

echo "Graph state discovery complete:"
echo "  - tags.md: Tag index"
echo "  - orphans.md: Connected ($connected_orphan_count) + Single ($single_orphan_count) orphans"
echo "  - seeds.md: $seed_count seed concepts"
echo "  - mode-recommendation.md: Recommended mode = $mode"
echo "  - popularity.md: Most connected concepts/threads"

# Cleanup
rm -f /tmp/orphan-counts.txt /tmp/link-counts.txt
