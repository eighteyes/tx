#!/bin/bash
# generate-codemap.sh
# Generates a comprehensive code map for TypeScript/JavaScript codebases
#
# Usage: ./generate-codemap.sh [source_dir] [output_file]
# Default: ./generate-codemap.sh src .ai/code-map.md
#
# Responsibilities:
# - Analyze directory structure
# - Extract exported classes, interfaces, functions, types
# - Map module dependencies
# - Generate navigable markdown documentation

set -uo pipefail
# Note: not using -e because grep returns 1 on no match

SRC_DIR="${1:-src}"
OUTPUT="${2:-.ai/code-map.md}"
TEMP_DIR=$(mktemp -d)

trap "rm -rf $TEMP_DIR" EXIT

echo "Generating code map for: $SRC_DIR → $OUTPUT"

# ============================================================
# HELPER FUNCTIONS
# ============================================================

count_files() {
  find "$SRC_DIR" -name "*.ts" -o -name "*.tsx" | wc -l | tr -d ' '
}

get_directories() {
  find "$SRC_DIR" -type d | sort
}

# Extract exports using ripgrep (falls back to grep)
extract_exports() {
  local pattern="$1"
  local label="$2"

  if command -v rg &> /dev/null; then
    rg -o "$pattern" "$SRC_DIR" --no-filename 2>/dev/null | sort -u || true
  else
    grep -rhoE "$pattern" "$SRC_DIR" 2>/dev/null | sort -u || true
  fi
}

# ============================================================
# DATA COLLECTION
# ============================================================

echo "Collecting exports..."

# Classes
extract_exports 'export class [A-Z][a-zA-Z0-9_]*' 'classes' > "$TEMP_DIR/classes.txt"

# Interfaces
extract_exports 'export interface [A-Z][a-zA-Z0-9_]*' 'interfaces' > "$TEMP_DIR/interfaces.txt"

# Types
extract_exports 'export type [A-Z][a-zA-Z0-9_]*' 'types' > "$TEMP_DIR/types.txt"

# Functions
extract_exports 'export (async )?function [a-zA-Z][a-zA-Z0-9_]*' 'functions' > "$TEMP_DIR/functions.txt"

# Const exports
extract_exports 'export const [A-Z_][A-Z0-9_]*' 'constants' > "$TEMP_DIR/constants.txt"

# ============================================================
# ANALYSIS
# ============================================================

echo "Analyzing structure..."

TOTAL_FILES=$(count_files)
CLASS_COUNT=$(wc -l < "$TEMP_DIR/classes.txt" | tr -d ' ')
INTERFACE_COUNT=$(wc -l < "$TEMP_DIR/interfaces.txt" | tr -d ' ')
TYPE_COUNT=$(wc -l < "$TEMP_DIR/types.txt" | tr -d ' ')
FUNCTION_COUNT=$(wc -l < "$TEMP_DIR/functions.txt" | tr -d ' ')
CONST_COUNT=$(wc -l < "$TEMP_DIR/constants.txt" | tr -d ' ')

# ============================================================
# GENERATE OUTPUT
# ============================================================

echo "Writing code map..."

cat > "$OUTPUT" << 'HEADER'
# Code Map

> Auto-generated navigation guide for the codebase.
> Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

HEADER

# Fix the date
sed -i "s/\$(date -u +\"%Y-%m-%dT%H:%M:%SZ\")/$(date -u +"%Y-%m-%dT%H:%M:%SZ")/" "$OUTPUT"

cat >> "$OUTPUT" << EOF

## Statistics

| Metric | Count |
|--------|-------|
| TypeScript files | $TOTAL_FILES |
| Exported classes | $CLASS_COUNT |
| Exported interfaces | $INTERFACE_COUNT |
| Exported types | $TYPE_COUNT |
| Exported functions | $FUNCTION_COUNT |
| Exported constants | $CONST_COUNT |

---

## Directory Structure

\`\`\`
EOF

# Add directory tree
if command -v tree &> /dev/null; then
  tree -d -L 3 "$SRC_DIR" >> "$OUTPUT" 2>/dev/null || find "$SRC_DIR" -type d | head -50 >> "$OUTPUT"
else
  find "$SRC_DIR" -type d | head -50 >> "$OUTPUT"
fi

cat >> "$OUTPUT" << 'EOF'
```

---

## Module Index

EOF

# Generate module index by directory
for dir in $(find "$SRC_DIR" -type d -maxdepth 2 | sort); do
  if [ "$dir" = "$SRC_DIR" ]; then
    continue
  fi

  # Count files in this directory
  file_count=$(find "$dir" -maxdepth 1 -name "*.ts" -o -name "*.tsx" 2>/dev/null | wc -l | tr -d ' ')

  if [ "$file_count" -gt 0 ]; then
    rel_path="${dir#$SRC_DIR/}"
    echo "### \`$rel_path/\`" >> "$OUTPUT"
    echo "" >> "$OUTPUT"

    # List files with brief description from first comment
    for file in $(find "$dir" -maxdepth 1 \( -name "*.ts" -o -name "*.tsx" \) | sort); do
      filename=$(basename "$file")
      # Try to extract first line comment or description
      desc=$(head -20 "$file" 2>/dev/null | grep -E '^\s*\*\s+[A-Z]|^//\s+[A-Z]|description.*=' 2>/dev/null | head -1 | sed 's/.*\*\s*//;s/^\/\/\s*//;s/description.*=\s*["'"'"']\(.*\)["'"'"'].*/\1/' 2>/dev/null | head -c 80 || echo "")
      if [ -z "$desc" ]; then
        desc="-"
      fi
      echo "- \`$filename\` - $desc" >> "$OUTPUT"
    done
    echo "" >> "$OUTPUT"
  fi
done

cat >> "$OUTPUT" << 'EOF'
---

## Exported Classes

EOF

# Add classes grouped by file
if [ -s "$TEMP_DIR/classes.txt" ]; then
  while read -r class; do
    name=$(echo "$class" | sed 's/export class //')
    # Find which file it's in
    file=$(rg -l "export class $name" "$SRC_DIR" 2>/dev/null | head -1 || grep -rl "export class $name" "$SRC_DIR" 2>/dev/null | head -1)
    if [ -n "$file" ]; then
      rel_file="${file#$SRC_DIR/}"
      echo "- \`$name\` → \`$rel_file\`" >> "$OUTPUT"
    else
      echo "- \`$name\`" >> "$OUTPUT"
    fi
  done < "$TEMP_DIR/classes.txt"
else
  echo "_No exported classes found_" >> "$OUTPUT"
fi

cat >> "$OUTPUT" << 'EOF'

---

## Key Interfaces

EOF

# Add top interfaces (limit to 50)
if [ -s "$TEMP_DIR/interfaces.txt" ]; then
  head -50 "$TEMP_DIR/interfaces.txt" | while read -r iface; do
    name=$(echo "$iface" | sed 's/export interface //')
    echo "- \`$name\`" >> "$OUTPUT"
  done

  total=$(wc -l < "$TEMP_DIR/interfaces.txt" | tr -d ' ')
  if [ "$total" -gt 50 ]; then
    echo "" >> "$OUTPUT"
    echo "_...and $((total - 50)) more interfaces_" >> "$OUTPUT"
  fi
else
  echo "_No exported interfaces found_" >> "$OUTPUT"
fi

cat >> "$OUTPUT" << 'EOF'

---

## Exported Functions

EOF

# Add functions
if [ -s "$TEMP_DIR/functions.txt" ]; then
  while read -r func; do
    name=$(echo "$func" | sed 's/export \(async \)\?function //')
    echo "- \`$name()\`" >> "$OUTPUT"
  done < "$TEMP_DIR/functions.txt"
else
  echo "_No exported functions found_" >> "$OUTPUT"
fi

cat >> "$OUTPUT" << 'EOF'

---

## Entry Points

EOF

# Find main entry points
echo "### CLI Entry" >> "$OUTPUT"
if [ -f "$SRC_DIR/cli/main.ts" ]; then
  echo "- \`src/cli/main.ts\` - CLI entry point" >> "$OUTPUT"
elif [ -f "$SRC_DIR/index.ts" ]; then
  echo "- \`src/index.ts\` - Main entry point" >> "$OUTPUT"
fi

# Find package.json bin entries
if [ -f "package.json" ]; then
  echo "" >> "$OUTPUT"
  echo "### Package Binaries" >> "$OUTPUT"
  bins=$(grep -A5 '"bin"' package.json 2>/dev/null | grep -E '^\s+"[^"]+":' | sed 's/.*"\([^"]*\)":\s*"\([^"]*\)".*/- `\1` → `\2`/' || true)
  if [ -n "$bins" ]; then
    echo "$bins" >> "$OUTPUT"
  else
    echo "_No bin entries_" >> "$OUTPUT"
  fi
fi

cat >> "$OUTPUT" << 'EOF'

---

## Import Graph (Top Dependencies)

EOF

# Find most imported modules
echo "Most imported internal modules:" >> "$OUTPUT"
echo "" >> "$OUTPUT"

rg -o "from ['\"]\.\.?/[^'\"]+['\"]" "$SRC_DIR" 2>/dev/null | \
  sed "s/.*from ['\"]//;s/['\"]$//" | \
  sort | uniq -c | sort -rn | head -15 | \
  while read count path; do
    echo "- \`$path\` (${count}x)" >> "$OUTPUT"
  done || echo "_Could not analyze imports_" >> "$OUTPUT"

cat >> "$OUTPUT" << 'EOF'

---

_Generated by `.ai/scripts/generate-codemap.sh`_
EOF

echo "✅ Code map saved to: $OUTPUT"
echo "   Files: $TOTAL_FILES | Classes: $CLASS_COUNT | Interfaces: $INTERFACE_COUNT | Functions: $FUNCTION_COUNT"
