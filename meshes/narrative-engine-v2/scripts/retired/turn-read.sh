#!/usr/bin/env bash
# turn-read.sh - Browse, skim, and read YAML turn artifacts
#
# Usage: turn-read.sh <workspace> [artifact] [flags]
#
# Browse (artifact optional):
#   --list              List available artifacts
#   --search="X"        Search across artifacts
#
# With artifact:
#   --keys              Top-level structure and counts
#   --summary           Compressed view
#   --discover          Surface dynamic keys in freeform zones
#   --section=X         Full content of one section
#   (no flags)          Full file as JSON
#
# Filtering:
#   --since=N           From turn N onward
#   --before=N          Before turn N
#   --index-on=FIELD    Field for turn filtering (default: turn)
#
# Exit codes:
#   0 - Success
#   1 - File not found or read error

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LEVEL="turn"

# ─────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────

show_help() {
  cat >&2 <<'USAGE'
turn-read.sh — Query turn-level game data

Usage:
  turn-read.sh <path> [artifact] [flags]

Arguments:
  path        Path to the turn workspace directory
  artifact    Artifact name (optional for --list, --search)

Browse (artifact optional):
  --list              List available artifacts and entity IDs
  --search="X"        Search text across artifacts (all if no artifact specified)

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

Output:
  JSON to stdout. Diagnostic messages to stderr.

USAGE

  echo "Available Artifacts:" >&2
  for f in "$SCRIPT_DIR/schemas/turn"/*.schema.jq; do
    [[ -f "$f" ]] || continue
    echo "  $(basename "$f" .schema.jq)" >&2
  done

  cat >&2 <<'EXAMPLES'

Examples:
  turn-read.sh ./workspace --list
  turn-read.sh ./workspace fates --keys
  turn-read.sh ./workspace fates --section=branches
  turn-read.sh ./workspace --search="survival"
  turn-read.sh ./workspace context --section=characters --since=3
EXAMPLES
  exit 0
}

# ─────────────────────────────────────────────
# SOURCE COMMON
# ─────────────────────────────────────────────

source "$SCRIPT_DIR/read-common.sh"

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

parse_read_args "$@"
dispatch_read "$SCRIPT_DIR/schemas/turn"
