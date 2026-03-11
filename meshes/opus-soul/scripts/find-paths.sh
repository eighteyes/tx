#!/bin/bash
# Find all possible paths from current node (2-3 steps deep)
# Usage: find-paths.sh <current-node> <depth> <vault-dir>

CURRENT_NODE="$1"
DEPTH="${2:-3}"
VAULT_DIR="${3:-.ai/know/opus-soul}"

CONCEPTS_DIR="$VAULT_DIR/concepts"
THREADS_DIR="$VAULT_DIR/threads"

# Find the current node file
find_node_file() {
  local node="$1"
  if [ -f "$CONCEPTS_DIR/${node}.md" ]; then
    echo "$CONCEPTS_DIR/${node}.md"
  elif [ -f "$THREADS_DIR/${node}.md" ]; then
    echo "$THREADS_DIR/${node}.md"
  fi
}

# Extract all [[wiki-links]] from a file
extract_links() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return
  fi

  grep -oh '\[\[[^]]*\]\]' "$file" 2>/dev/null | \
    sed 's/\[\[\(.*\)\]\]/\1/' | \
    sed 's#^concepts/##' | sed 's#^threads/##' | sed 's#^sessions/##' | \
    sort -u
}

# Recursively build paths
declare -A visited_in_recursion

build_paths() {
  local current="$1"
  local depth="$2"
  local path="$3"

  # Stop if max depth reached
  if [ "$depth" -le 0 ]; then
    echo "$path"
    return
  fi

  # Find current node file
  local node_file=$(find_node_file "$current")
  if [ -z "$node_file" ]; then
    # Dead end - no file exists
    echo "$path"
    return
  fi

  # Get linked nodes
  local links=$(extract_links "$node_file")

  if [ -z "$links" ]; then
    # Dead end - no outgoing links
    echo "$path"
    return
  fi

  # Explore each link
  while IFS= read -r link; do
    # Skip if already in current path (avoid immediate loops)
    if echo "$path" | grep -q "\"$link\""; then
      continue
    fi

    # Build new path
    local new_path="$path"
    if [ -n "$new_path" ]; then
      new_path="$new_path,\"$link\""
    else
      new_path="\"$link\""
    fi

    # Recurse
    build_paths "$link" $((depth - 1)) "$new_path"
  done <<< "$links"
}

# Start building paths
echo "{"
echo "  \"seed\": \"$CURRENT_NODE\","
echo "  \"depth\": $DEPTH,"
echo "  \"paths\": ["

# Get initial links from current node
node_file=$(find_node_file "$CURRENT_NODE")
if [ -n "$node_file" ]; then
  links=$(extract_links "$node_file")

  first=true
  while IFS= read -r link; do
    [ -z "$link" ] && continue

    # Build paths starting from this link
    paths=$(build_paths "$link" $((DEPTH - 1)) "\"$CURRENT_NODE\",\"$link\"")

    while IFS= read -r path; do
      [ -z "$path" ] && continue

      if [ "$first" = true ]; then
        first=false
      else
        echo ","
      fi

      echo -n "    [$path]"
    done <<< "$paths"
  done <<< "$links"
fi

echo ""
echo "  ]"
echo "}"
