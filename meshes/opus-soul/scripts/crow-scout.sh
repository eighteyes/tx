#!/bin/bash
# Extract frontmatter descriptions for nodes in a path
# Usage: crow-scout.sh <path-json-array> <vault-dir>
# Example: crow-scout.sh '["distributed-soul","membrane-that-breathes","liminal-retina"]'

PATH_JSON="$1"
VAULT_DIR="${2:-.ai/know/opus-soul}"

CONCEPTS_DIR="$VAULT_DIR/concepts"
THREADS_DIR="$VAULT_DIR/threads"

# Parse JSON array into bash array
# Remove brackets and quotes, split on comma
NODES=$(echo "$PATH_JSON" | sed 's/\[//g' | sed 's/\]//g' | sed 's/"//g' | tr ',' '\n')

echo "# Path Scout Report"
echo ""

while IFS= read -r node; do
  [ -z "$node" ] && continue

  # Find the node file
  node_file=""
  if [ -f "$CONCEPTS_DIR/${node}.md" ]; then
    node_file="$CONCEPTS_DIR/${node}.md"
  elif [ -f "$THREADS_DIR/${node}.md" ]; then
    node_file="$THREADS_DIR/${node}.md"
  fi

  if [ -z "$node_file" ]; then
    echo "## \`[[$node]]\` (ORPHAN)"
    echo "**Status**: File does not exist"
    echo ""
    continue
  fi

  # Extract frontmatter fields
  description=$(grep "^description:" "$node_file" 2>/dev/null | sed 's/description:[[:space:]]*//' | head -1)
  maturity=$(grep "^maturity:" "$node_file" 2>/dev/null | sed 's/maturity:[[:space:]]*//' | head -1)
  resonance=$(grep "^resonance:" "$node_file" 2>/dev/null | sed 's/resonance:[[:space:]]*//' | tr -d '"' | head -1)

  echo "## \`[[$node]]\`"
  if [ -n "$description" ]; then
    echo "**Description**: $description"
  else
    echo "**Description**: (no description)"
  fi

  if [ -n "$maturity" ]; then
    echo "**Maturity**: $maturity"
  fi

  if [ -n "$resonance" ]; then
    echo "**Resonance**: $resonance"
  fi

  echo ""
done <<< "$NODES"
