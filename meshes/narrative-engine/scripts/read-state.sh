#!/usr/bin/env bash
# read-state.sh — Unified reader for turn, campaign, and game artifacts
# Replaces turn-read.sh, campaign-read.sh, game-read.sh + read-common.sh
#
# Responsibilities:
#   - Auto-detect level (turn/campaign/game) from path structure
#   - Resolve entity addressing (character/{id} → entities/characters/{id}.yaml)
#   - Provide --list, --keys, --summary, --section, --search, --discover operations
#   - Time-range filtering on arrays

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
# LEVEL DETECTION
# ─────────────────────────────────────────────

detect_level() {
  local path="$1"
  if [[ "$path" == */turns/turn-* ]]; then
    echo "turn"
  elif [[ "$path" == */campaigns/* ]]; then
    echo "campaign"
  else
    echo "game"
  fi
}

# ─────────────────────────────────────────────
# ENTITY ADDRESSING (read side)
# ─────────────────────────────────────────────

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

  # Fallback: try alternate separator (hyphen↔underscore)
  if [[ ! -f "$READ_FILE" ]]; then
    local alt_artifact
    if [[ "$artifact" == *"_"* ]]; then
      alt_artifact="${artifact//_/-}"
    elif [[ "$artifact" == *"-"* ]]; then
      alt_artifact="${artifact//-/_}"
    else
      return
    fi

    if [[ "$alt_artifact" == */* ]]; then
      ENTITY_TYPE="${alt_artifact%%/*}"
      ENTITY_ID="${alt_artifact#*/}"
      local alt_file="$base/entities/${ENTITY_TYPE}s/${ENTITY_ID}.yaml"
    else
      local alt_file="$base/${alt_artifact}.yaml"
    fi

    if [[ -f "$alt_file" ]]; then
      READ_FILE="$alt_file"
    fi
  fi
}

# ─────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────

show_help() {
  cat >&2 <<'USAGE'
read-state.sh — Query game data at any level (auto-detected from path)

Usage:
  read-state.sh <path> [artifact] [flags]

Arguments:
  path        Path to turn workspace, campaign dir, or game dir
  artifact    Artifact name (optional for --list, --search)
              Entity-scoped: character/{id}, bond/{bond_id}

Browse (artifact optional):
  --list              List available artifacts and entity IDs
  --search="X"        Search text across artifacts

With artifact:
  --keys              Show top-level keys with types and counts
  --summary           Compressed view (key names + counts)
  --discover          Surface dynamic keys in freeform zones
  --section=X         Return specific section as JSON
  (no flags)          Return entire file as JSON

Filtering (on arrays):
  --since=N           Entries from turn N onward
  --before=N          Entries before turn N (exclusive)
  --index-on=FIELD    Field for turn filtering (default: "turn")

Level Detection:
  */turns/turn-*      → turn level
  */campaigns/*       → campaign level
  (else)              → game level

Output:
  JSON to stdout. Diagnostic messages to stderr.

USAGE
  exit 0
}

# ─────────────────────────────────────────────
# PARSE ARGS
# ─────────────────────────────────────────────

ACTION=""
SECTION=""
SEARCH_QUERY=""
SINCE=""
BEFORE=""
INDEX_ON="turn"
POSITIONAL=()

for arg in "$@"; do
  case "$arg" in
    --help|-h)        show_help ;;
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
  echo -e "${RED}Error: requires <path> argument${NC}" >&2
  echo "Run with --help for usage." >&2
  exit 1
fi

TARGET_PATH="${POSITIONAL[0]}"
ARTIFACT="${POSITIONAL[1]:-}"
LEVEL=$(detect_level "$TARGET_PATH")

# ─────────────────────────────────────────────
# LIST
# ─────────────────────────────────────────────

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
    local merged
    merged=$(jq -s 'add' "$results_file" <(echo "$matches") 2>/dev/null) || return 0
    echo "$merged" > "$results_file"
  }

  if [[ -n "$artifact" ]]; then
    resolve_entity_read_path "$dir" "$artifact"
    if [[ -f "$READ_FILE" ]]; then
      _search_file "$READ_FILE" "$artifact" "$query" "$results"
    fi
  else
    if compgen -G "$dir/*.yaml" > /dev/null 2>&1; then
      for f in "$dir"/*.yaml; do
        local name
        name=$(basename "$f" .yaml)
        _search_file "$f" "$name" "$query" "$results"
      done
    fi
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

# --list without artifact: list all artifacts
if [[ "$ACTION" == "list" && -z "$ARTIFACT" ]]; then
  do_list "$TARGET_PATH"
  exit 0
fi

# --list with entity type: list entity IDs
if [[ "$ACTION" == "list" && -n "$ARTIFACT" && "$ARTIFACT" != */* ]]; then
  if [[ -d "$TARGET_PATH/entities/${ARTIFACT}s" ]]; then
    do_list_entities "$TARGET_PATH" "$ARTIFACT"
    exit 0
  fi
fi

# --search without artifact: cross-artifact search
if [[ "$ACTION" == "search" && -z "$ARTIFACT" ]]; then
  do_search "$TARGET_PATH" "$SEARCH_QUERY"
  exit 0
fi

# Everything else requires an artifact
if [[ -z "$ARTIFACT" ]]; then
  echo -e "${RED}Error: artifact required for this operation${NC}" >&2
  exit 1
fi

# Resolve file path
resolve_entity_read_path "$TARGET_PATH" "$ARTIFACT"

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
    local_output=$(do_section "$READ_FILE" "$SECTION")
    if [[ -n "$SINCE" || -n "$BEFORE" ]]; then
      echo "$local_output" | apply_time_filter "$SINCE" "$BEFORE" "$INDEX_ON"
    else
      echo "$local_output"
    fi
    ;;
  search)
    do_search "$TARGET_PATH" "$SEARCH_QUERY" "$ARTIFACT"
    ;;
  "")
    local_output=$(do_full_read "$READ_FILE")
    if [[ -n "$SINCE" || -n "$BEFORE" ]]; then
      echo "$local_output" | apply_time_filter "$SINCE" "$BEFORE" "$INDEX_ON"
    else
      echo "$local_output"
    fi
    ;;
  *)
    echo -e "${RED}Error: unknown action '$ACTION'${NC}" >&2
    exit 1
    ;;
esac
