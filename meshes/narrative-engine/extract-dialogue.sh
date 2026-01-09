#!/bin/bash
# extract-dialogue.sh
# Extracts dialogue pairs from prose for editor coherence check
# Usage: extract-dialogue.sh <prose-draft.md> <output.txt>

set -e

INPUT="$1"
OUTPUT="$2"

if [[ -z "$INPUT" || -z "$OUTPUT" ]]; then
  echo "Usage: extract-dialogue.sh <prose-draft.md> <output.txt>" >&2
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  echo "Input file not found: $INPUT" >&2
  exit 1
fi

# Extract dialogue with surrounding context
# Output format:
#   [LINE N] "dialogue text"
#   [LINE M] "response text"
#   ---

awk '
BEGIN {
  exchange_num = 0
  prev_line = ""
  prev_linenum = 0
  in_prose = 0
}

# Skip frontmatter and rearmatter
/^---$/ {
  if (in_prose) in_prose = 0
  else in_prose = 1
  next
}

# Skip non-prose sections
/^\[VISUAL\]/ { in_prose = 0; next }
/^\[PROSE/ { in_prose = 1; next }

# Only process prose section
in_prose == 1 {
  # Find all quoted dialogue on this line
  line = $0
  linenum = NR

  # Match dialogue (handles multiple quotes per line)
  while (match(line, /"[^"]+"/)) {
    dialogue = substr(line, RSTART, RLENGTH)

    if (prev_line != "") {
      exchange_num++
      print "## Exchange " exchange_num
      print "[LINE " prev_linenum "] " prev_line
      print "[LINE " linenum "] " dialogue
      print ""
    }

    prev_line = dialogue
    prev_linenum = linenum
    line = substr(line, RSTART + RLENGTH)
  }
}

END {
  if (exchange_num == 0) {
    print "# No dialogue exchanges found"
  } else {
    print "# Total exchanges: " exchange_num
  }
}
' "$INPUT" > "$OUTPUT"

echo "Extracted dialogue to $OUTPUT"
