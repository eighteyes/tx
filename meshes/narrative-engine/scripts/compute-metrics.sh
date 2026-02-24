#!/usr/bin/env bash
# compute-metrics.sh - Pure text processing quality metrics (no LLM)
# Computes readability and structural metrics from prose markdown.
# Responsibilities:
#   - Flesch-Kincaid readability score (vowel-cluster syllable approximation)
#   - Average sentence length + standard deviation
#   - Paragraph coherence (Jaccard overlap of content words between adjacent paragraphs)
#   - Dialogue ratio (words inside "quotes" vs total words)
#   - Output clean YAML to stdout

set -euo pipefail

# ─────────────────────────────────────────────
# USAGE
# ─────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
Usage: compute-metrics.sh <prose_file>
  prose_file    path to markdown prose file (e.g., prose-draft.md)
EOF
  exit 1
}

# ─────────────────────────────────────────────
# ARGS
# ─────────────────────────────────────────────

[[ $# -lt 1 ]] && usage

PROSE_FILE="$1"

if [[ ! -f "$PROSE_FILE" ]]; then
  echo "Error: prose file not found: $PROSE_FILE" >&2
  exit 1
fi

# ─────────────────────────────────────────────
# ALL COMPUTATION IN AWK (fast, no bc dependency)
# ─────────────────────────────────────────────

awk '
BEGIN {
  total_words = 0
  total_syllables = 0
  total_sentences = 0
  sent_idx = 0
  dialogue_words = 0
  para_idx = 0
  in_para = 0
  in_dialogue = 0

  # Stop words for coherence (min length 4 checked separately)
  split("the a an and or but in on at to for of is it was were be been being has had have do does did will would could should may might shall can this that these those he she they we you me my his her its our their them with from by as", sw_arr)
  for (i in sw_arr) stop_words[sw_arr[i]] = 1
}

# Skip markdown headers and horizontal rules
/^#/ { next }
/^---$/ { next }

# Track paragraphs (blank line = paragraph break)
/^[[:space:]]*$/ {
  if (in_para) {
    para_idx++
    in_para = 0
  }
  next
}

{
  in_para = 1

  # ── Dialogue extraction ──
  # Match text between straight double quotes
  line = $0
  while (match(line, /"[^"]*"/)) {
    quoted = substr(line, RSTART + 1, RLENGTH - 2)
    n = split(quoted, qwords, /[^a-zA-Z]+/)
    for (q = 1; q <= n; q++) {
      if (length(qwords[q]) > 0) dialogue_words++
    }
    line = substr(line, RSTART + RLENGTH)
  }

  # ── Word and sentence processing ──
  # Split line into words
  n = split($0, words, /[[:space:]]+/)
  current_sent_words = 0

  for (i = 1; i <= n; i++) {
    w = words[i]
    # Strip leading/trailing punctuation for word counting
    gsub(/^[^a-zA-Z]+/, "", w)
    gsub(/[^a-zA-Z]+$/, "", w)
    if (length(w) == 0) continue

    total_words++
    current_sent_words++

    # Syllable counting: count vowel clusters
    lw = tolower(w)
    syl = 0
    prev_vowel = 0
    for (c = 1; c <= length(lw); c++) {
      ch = substr(lw, c, 1)
      is_vowel = (ch ~ /[aeiouy]/)
      if (is_vowel && !prev_vowel) syl++
      prev_vowel = is_vowel
    }
    # Silent e adjustment
    if (syl > 1 && substr(lw, length(lw), 1) == "e") syl--
    if (syl < 1) syl = 1
    total_syllables += syl

    # Store word (lowercased, alpha only) for paragraph coherence
    para_word = tolower(w)
    if (length(para_word) >= 4 && !(para_word in stop_words)) {
      para_data[para_idx, para_word] = 1
      para_word_list[para_idx, ++para_word_count[para_idx]] = para_word
    }

    # Check for sentence ending in the original token
    orig = words[i]
    if (orig ~ /[.!?]["'\'']*$/ || orig ~ /[.!?]$/) {
      if (current_sent_words > 0) {
        sent_lengths[total_sentences] = current_sent_words
        total_sentences++
        current_sent_words = 0
      }
    }
  }

  # Store remaining words at end of line for sentence continuation
  pending_sent_words = current_sent_words
}

END {
  # Capture last sentence if it didnt end with punctuation
  if (pending_sent_words > 0) {
    sent_lengths[total_sentences] = pending_sent_words
    total_sentences++
  }

  # Capture last paragraph
  if (in_para) para_idx++
  total_paragraphs = para_idx

  # ── Average sentence length + stddev ──
  if (total_sentences == 0) {
    avg_sent = 0
    stddev = 0
  } else {
    avg_sent = total_words / total_sentences
    sum_sq = 0
    for (s = 0; s < total_sentences; s++) {
      diff = sent_lengths[s] - avg_sent
      sum_sq += diff * diff
    }
    variance = sum_sq / total_sentences
    stddev = sqrt(variance)
  }

  # ── Flesch-Kincaid ──
  if (total_sentences == 0 || total_words == 0) {
    fk = 0
  } else {
    fk = 206.835 - 1.015 * (total_words / total_sentences) - 84.6 * (total_syllables / total_words)
  }

  # ── Paragraph coherence (Jaccard) ──
  if (total_paragraphs <= 1) {
    coherence = 0
  } else {
    total_jaccard = 0
    comparisons = 0

    for (p = 0; p < total_paragraphs - 1; p++) {
      np = p + 1

      # Build unique word sets
      delete set_a
      delete set_b
      count_a = 0
      count_b = 0

      for (wi = 1; wi <= para_word_count[p]; wi++) {
        word = para_word_list[p, wi]
        if (!(word in set_a)) {
          set_a[word] = 1
          count_a++
        }
      }
      for (wi = 1; wi <= para_word_count[np]; wi++) {
        word = para_word_list[np, wi]
        if (!(word in set_b)) {
          set_b[word] = 1
          count_b++
        }
      }

      # Intersection
      intersection = 0
      for (word in set_a) {
        if (word in set_b) intersection++
      }

      # Union
      union_size = count_a + count_b - intersection

      if (union_size > 0) {
        total_jaccard += intersection / union_size
        comparisons++
      }
    }

    if (comparisons > 0) {
      coherence = total_jaccard / comparisons
    } else {
      coherence = 0
    }
  }

  # ── Dialogue ratio ──
  if (total_words > 0) {
    dialogue_ratio = dialogue_words * 100.0 / total_words
  } else {
    dialogue_ratio = 0
  }

  # ── Output YAML ──
  printf "metrics:\n"
  printf "  flesch_kincaid: %.1f\n", fk
  printf "  avg_sentence_length: %.1f\n", avg_sent
  printf "  sentence_length_stddev: %.1f\n", stddev
  printf "  paragraph_coherence: %.2f\n", coherence
  printf "  dialogue_ratio: %.1f\n", dialogue_ratio
  printf "  total_words: %d\n", total_words
  printf "  total_sentences: %d\n", total_sentences
  printf "  total_paragraphs: %d\n", total_paragraphs
}
' "$PROSE_FILE"
