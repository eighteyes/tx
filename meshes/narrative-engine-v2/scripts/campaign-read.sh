#!/usr/bin/env bash
# campaign-read.sh - Browse, skim, and read YAML campaign artifacts
#
# Usage: campaign-read.sh <workspace> [artifact] [flags]
#
# Entity slash addressing:
#   character --list           List character IDs
#   character/kaitlin --keys   Structure of kaitlin's file
#   continuity --section=X     Section of a plain artifact
#
# Browse (artifact optional):
#   --list              List available artifacts (includes entities)
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

LEVEL="campaign"

# ─────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────

show_help() {
  cat >&2 <<'USAGE'
campaign-read.sh — Query campaign-level game data

Usage:
  campaign-read.sh <path> [artifact] [flags]

Arguments:
  path        Path to the campaign directory
  artifact    Artifact name (optional for --list, --search)
              Entity-scoped: character/kaitlin, bond/kaitlin_heather
              Entity type only: character --list (lists all character IDs)

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
  for f in "$SCRIPT_DIR/schemas/campaign"/*.schema.jq; do
    [[ -f "$f" ]] || continue
    echo "  $(basename "$f" .schema.jq)" >&2
  done

  cat >&2 <<'EXAMPLES'

Examples:
  campaign-read.sh ./campaign --list
  campaign-read.sh ./campaign character --list
  campaign-read.sh ./campaign character/kaitlin --keys
  campaign-read.sh ./campaign character/kaitlin --section=episodes --since=3
  campaign-read.sh ./campaign continuity --section=used_factoids --since=5 --before=10
  campaign-read.sh ./campaign --search="survival"
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
dispatch_read "$SCRIPT_DIR/schemas/campaign"
