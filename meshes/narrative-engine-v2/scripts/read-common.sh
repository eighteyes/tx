#!/usr/bin/env bash
# read-common.sh - Shared logic for all read scripts (turn, campaign, game)
#
# Sourced by level-specific read scripts. Expects the following variables set before sourcing:
#   LEVEL        - "turn", "campaign", or "game"
#
# Provides:
#   parse_read_args           - argument parsing (workspace, artifact, flags)
#   resolve_entity_read_path  - entity slash addressing for reads
#   do_list                   - list available artifacts
#   do_keys                   - show top-level keys with types and counts
#   do_section                - return a specific section as JSON
#   do_search                 - search for text across YAML files
#   do_discover               - surface dynamic keys in freeform zones
#   do_summary                - compressed summary of key names with counts
#   apply_time_filter         - filter arrays by turn number

# ─────────────────────────────────────────────
# COLORS (stderr only)
# ─────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# ─────────────────────────────────────────────
# CLEANUP
# ─────────────────────────────────────────────

TMPFILES=()
cleanup() { rm -f "${TMPFILES[@]}" 2>/dev/null || true; }
trap cleanup EXIT

mktmp() {
  local f
  f=$(mktemp)
  TMPFILES+=("$f")
  echo "$f"
}

# ─────────────────────────────────────────────
# ERROR HELPERS
# ─────────────────────────────────────────────

err_json() {
  local artifact="$1" code="$2"
  shift 2
  local errors="$*"
  echo "{\"ok\":false,\"artifact\":\"$artifact\",\"errors\":$errors}" >&2
  exit "$code"
}

# ─────────────────────────────────────────────
# PARSE ARGS
# ─────────────────────────────────────────────

# Call: parse_read_args "$@"
# Sets: WORKSPACE, ARTIFACT, ACTION, SECTION, SEARCH_QUERY, SINCE, BEFORE, INDEX_ON
parse_read_args() {
  ACTION=""
  SECTION=""
  SEARCH_QUERY=""
  SINCE=""
  BEFORE=""
  INDEX_ON="turn"
  POSITIONAL=()

  for arg in "$@"; do
    case "$arg" in
      --help|-h)
        if declare -f show_help > /dev/null 2>&1; then
          show_help
        else
          echo "Usage: ${LEVEL}-read.sh <workspace> [artifact] [flags]" >&2
          exit 0
        fi
        ;;
      --list)           ACTION="list" ;;
      --keys)           ACTION="keys" ;;
      --summary)        ACTION="summary" ;;
      --discover)       ACTION="discover" ;;
      --section=*)      ACTION="section"; SECTION="${arg#--section=}" ;;
      --search=*)       ACTION="search"; SEARCH_QUERY="${arg#--search=}" ;;
      --since=*)        SINCE="${arg#--since=}" ;;
      --before=*)       BEFORE="${arg#--before=}" ;;
      --index-on=*)     INDEX_ON="${arg#--index-on=}" ;;
      *) POSITIONAL+=("$arg") ;;
    esac
  done

  if [[ ${#POSITIONAL[@]} -lt 1 ]]; then
    echo -e "${RED}Error: requires <workspace> argument${NC}" >&2
    echo "Run with --help for usage." >&2
    exit 1
  fi

  WORKSPACE="${POSITIONAL[0]}"
  ARTIFACT="${POSITIONAL[1]:-}"
}

# ─────────────────────────────────────────────
# ENTITY ADDRESSING (read side)
# ─────────────────────────────────────────────

# resolve_entity_read_path: resolve artifact to file path
# character/kaitlin -> entities/characters/kaitlin.yaml
# fates -> fates.yaml
# Sets: READ_FILE, ENTITY_TYPE, ENTITY_ID
# Includes fallback for underscore↔hyphen filename variations
resolve_entity_read_path() {
  local base="$1" artifact="$2"
  ENTITY_TYPE=""
  ENTITY_ID=""
  if [[ "$artifact" == */* ]]; then
    ENTITY_TYPE="${artifact%%/*}"
    ENTITY_ID="${artifact#*/}"
    READ_FILE="$base/entities/${ENTITY_TYPE}s/${ENTITY_ID}.yaml"
  else
    READ_FILE="$base/${artifact}.yaml"
  fi

  # Fallback: if file doesn't exist, try alternate separator (hyphen↔underscore)
  if [[ ! -f "$READ_FILE" ]]; then
    local alt_artifact
    if [[ "$artifact" == *"_"* ]]; then
      # Try replacing underscores with hyphens
      alt_artifact="${artifact//_/-}"
    elif [[ "$artifact" == *"-"* ]]; then
      # Try replacing hyphens with underscores
      alt_artifact="${artifact//-/_}"
    else
      # No separator to swap, return original
      return
    fi

    # Rebuild path with alternate separator
    if [[ "$alt_artifact" == */* ]]; then
      ENTITY_TYPE="${alt_artifact%%/*}"
      ENTITY_ID="${alt_artifact#*/}"
      local alt_file="$base/entities/${ENTITY_TYPE}s/${ENTITY_ID}.yaml"
    else
      local alt_file="$base/${alt_artifact}.yaml"
    fi

    # Use alternate file if it exists
    if [[ -f "$alt_file" ]]; then
      READ_FILE="$alt_file"
    fi
  fi
}

# ─────────────────────────────────────────────
# LIST
# ─────────────────────────────────────────────

# List available artifacts in a directory
# Returns JSON: {"artifacts": ["fates", "context", "character/kaitlin", ...]}
do_list() {
  local dir="$1"
  local artifacts=()

  # Top-level YAML files
  if compgen -G "$dir/*.yaml" > /dev/null 2>&1; then
    for f in "$dir"/*.yaml; do
      local name
      name=$(basename "$f" .yaml)
      artifacts+=("$name")
    done
  fi

  # Entity files in entities/*/
  if [[ -d "$dir/entities" ]]; then
    for entity_dir in "$dir"/entities/*/; do
      [[ -d "$entity_dir" ]] || continue
      local type_plural type_singular
      type_plural=$(basename "$entity_dir")
      # Remove trailing 's' for singular: characters -> character
      type_singular="${type_plural%s}"
      if compgen -G "$entity_dir*.yaml" > /dev/null 2>&1; then
        for f in "$entity_dir"*.yaml; do
          local id
          id=$(basename "$f" .yaml)
          artifacts+=("${type_singular}/${id}")
        done
      fi
    done
  fi

  printf '%s\n' "${artifacts[@]}" | jq -R . | jq -s '{artifacts: .}'
}

# List entity IDs within a type directory (for entity --list)
# e.g., do_list_entities $CP characters -> {"artifacts": ["kaitlin", "heather"]}
do_list_entities() {
  local dir="$1" entity_type="$2"
  local entity_dir="$dir/entities/${entity_type}s"
  local ids=()

  if [[ -d "$entity_dir" ]] && compgen -G "$entity_dir/*.yaml" > /dev/null 2>&1; then
    for f in "$entity_dir"/*.yaml; do
      ids+=("$(basename "$f" .yaml)")
    done
  fi

  printf '%s\n' "${ids[@]}" | jq -R . | jq -s '{artifacts: .}'
}

# ─────────────────────────────────────────────
# KEYS
# ─────────────────────────────────────────────

# Show top-level keys with types and counts
# Returns JSON: {"keys": [{"key":"branches","type":"array","count":3}, ...]}
do_keys() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    err_json "${ARTIFACT:-unknown}" 1 "[{\"type\":\"file_not_found\",\"detail\":\"$file\"}]"
  fi
  yq -o json '.' "$file" | jq '
    [to_entries[] | {
      key: .key,
      type: (.value | type),
      count: (
        if (.value | type) == "array" then (.value | length)
        elif (.value | type) == "object" then (.value | keys | length)
        else 1
        end
      )
    }] | {keys: .}
  '
}

# ─────────────────────────────────────────────
# SECTION
# ─────────────────────────────────────────────

# Return a specific section as JSON
do_section() {
  local file="$1" section="$2"
  if [[ ! -f "$file" ]]; then
    err_json "${ARTIFACT:-unknown}" 1 "[{\"type\":\"file_not_found\",\"detail\":\"$file\"}]"
  fi
  yq -o json ".$section" "$file"
}

# ─────────────────────────────────────────────
# SEARCH
# ─────────────────────────────────────────────

# Search for text across YAML files
# Returns JSON: {"matches": [{"file":"fates","key":"branches[0].id","preview":"survival"}, ...]}
do_search() {
  local dir="$1" query="$2" artifact="${3:-}"
  local results
  results=$(mktmp)
  echo '[]' > "$results"

  _search_file() {
    local filepath="$1" label="$2" query="$3" results_file="$4"
    local json
    json=$(yq -o json '.' "$filepath" 2>/dev/null) || return 0
    local matches
    matches=$(echo "$json" | jq --arg q "$query" --arg f "$label" '
      [path(.. | strings | select(test($q; "i"))) as $p |
        {file: $f, key: ($p | map(tostring) | join(".")), preview: (getpath($p) | tostring | .[:80])}
      ]
    ' 2>/dev/null) || return 0
    # Merge into results
    local merged
    merged=$(jq -s 'add' "$results_file" <(echo "$matches") 2>/dev/null) || return 0
    echo "$merged" > "$results_file"
  }

  if [[ -n "$artifact" ]]; then
    # Scoped search: single file
    local target_file
    resolve_entity_read_path "$dir" "$artifact"
    target_file="$READ_FILE"
    if [[ -f "$target_file" ]]; then
      _search_file "$target_file" "$artifact" "$query" "$results"
    fi
  else
    # Cross-artifact search
    if compgen -G "$dir/*.yaml" > /dev/null 2>&1; then
      for f in "$dir"/*.yaml; do
        local name
        name=$(basename "$f" .yaml)
        _search_file "$f" "$name" "$query" "$results"
      done
    fi
    # Also search entities
    if [[ -d "$dir/entities" ]]; then
      for entity_dir in "$dir"/entities/*/; do
        [[ -d "$entity_dir" ]] || continue
        local type_plural type_singular
        type_plural=$(basename "$entity_dir")
        type_singular="${type_plural%s}"
        if compgen -G "$entity_dir*.yaml" > /dev/null 2>&1; then
          for f in "$entity_dir"*.yaml; do
            local id
            id=$(basename "$f" .yaml)
            _search_file "$f" "${type_singular}/${id}" "$query" "$results"
          done
        fi
      done
    fi
  fi

  jq '{matches: .}' < "$results"
}

# ─────────────────────────────────────────────
# DISCOVER
# ─────────────────────────────────────────────

# Surface dynamic keys in freeform zones
# Returns JSON: {"freeform_keys": {"trajectory_status": ["south_gate_escape", "moth_trust"]}}
do_discover() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    err_json "${ARTIFACT:-unknown}" 1 "[{\"type\":\"file_not_found\",\"detail\":\"$file\"}]"
  fi
  yq -o json '.' "$file" | jq '
    {freeform_keys:
      [to_entries[] | select(.value | type == "object") |
        {key: .key, value: (.value | keys)}
      ] | from_entries
    }
  '
}

# ─────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────

# Compressed summary — key names with types and counts
do_summary() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    err_json "${ARTIFACT:-unknown}" 1 "[{\"type\":\"file_not_found\",\"detail\":\"$file\"}]"
  fi
  yq -o json '.' "$file" | jq '
    to_entries | map({
      key: .key,
      type: (.value | type),
      count: (
        if (.value | type) == "array" then (.value | length)
        elif (.value | type) == "object" then (.value | keys | length)
        else 1
        end
      )
    }) | from_entries
  '
}

# ─────────────────────────────────────────────
# TIME FILTER
# ─────────────────────────────────────────────

# Filter arrays by turn number
# Input: JSON array on stdin
# Output: filtered JSON array
apply_time_filter() {
  local since="${1:-}" before="${2:-}" index_on="${3:-turn}"
  local filter="."

  if [[ -n "$since" && -n "$before" ]]; then
    filter="[.[] | select(.${index_on} >= ${since} and .${index_on} < ${before})]"
  elif [[ -n "$since" ]]; then
    filter="[.[] | select(.${index_on} >= ${since})]"
  elif [[ -n "$before" ]]; then
    filter="[.[] | select(.${index_on} < ${before})]"
  fi

  jq "$filter"
}

# ─────────────────────────────────────────────
# FULL FILE READ
# ─────────────────────────────────────────────

do_full_read() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    err_json "${ARTIFACT:-unknown}" 1 "[{\"type\":\"file_not_found\",\"detail\":\"$file\"}]"
  fi
  yq -o json '.' "$file"
}

# ─────────────────────────────────────────────
# DISPATCH
# ─────────────────────────────────────────────

# Main read dispatch — called by level scripts after parse_read_args
# Expects: WORKSPACE, ARTIFACT, ACTION, SECTION, SEARCH_QUERY, SINCE, BEFORE, INDEX_ON
dispatch_read() {
  local schema_dir="${1:-}"

  # --list without artifact: list all artifacts
  if [[ "$ACTION" == "list" && -z "$ARTIFACT" ]]; then
    do_list "$WORKSPACE"
    return
  fi

  # --list with entity type (campaign/game): list entity IDs
  if [[ "$ACTION" == "list" && -n "$ARTIFACT" && "$ARTIFACT" != */* ]]; then
    # Check if this is an entity type (has entities/<type>s/ dir)
    if [[ -d "$WORKSPACE/entities/${ARTIFACT}s" ]]; then
      do_list_entities "$WORKSPACE" "$ARTIFACT"
      return
    fi
  fi

  # --search without artifact: cross-artifact search
  if [[ "$ACTION" == "search" && -z "$ARTIFACT" ]]; then
    do_search "$WORKSPACE" "$SEARCH_QUERY"
    return
  fi

  # Everything else requires an artifact
  if [[ -z "$ARTIFACT" ]]; then
    echo -e "${RED}Error: artifact required for this operation${NC}" >&2
    exit 1
  fi

  # Resolve file path
  resolve_entity_read_path "$WORKSPACE" "$ARTIFACT"

  case "$ACTION" in
    keys)
      do_keys "$READ_FILE"
      ;;
    summary)
      do_summary "$READ_FILE"
      ;;
    discover)
      do_discover "$READ_FILE"
      ;;
    section)
      local output
      output=$(do_section "$READ_FILE" "$SECTION")
      # Apply time filter if since/before set and output is an array
      if [[ -n "$SINCE" || -n "$BEFORE" ]]; then
        echo "$output" | apply_time_filter "$SINCE" "$BEFORE" "$INDEX_ON"
      else
        echo "$output"
      fi
      ;;
    search)
      do_search "$WORKSPACE" "$SEARCH_QUERY" "$ARTIFACT"
      ;;
    "")
      # No action: full file read
      local output
      output=$(do_full_read "$READ_FILE")
      if [[ -n "$SINCE" || -n "$BEFORE" ]]; then
        echo "$output" | apply_time_filter "$SINCE" "$BEFORE" "$INDEX_ON"
      else
        echo "$output"
      fi
      ;;
    *)
      echo -e "${RED}Error: unknown action '$ACTION'${NC}" >&2
      exit 1
      ;;
  esac
}
