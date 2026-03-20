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
turn-read.sh — Browse, skim, and read YAML turn artifacts

Usage:
  turn-read.sh <workspace> [artifact] [flags]
  turn-read.sh ./ws --list
  turn-read.sh ./ws fates --keys
  turn-read.sh ./ws fates --section=branches
  turn-read.sh ./ws fates --search=survival
  turn-read.sh ./ws fates --discover
  turn-read.sh ./ws context              (full file as JSON)

Browse (artifact optional):
  --list              List available artifacts
  --search="X"        Search across artifacts

With artifact:
  --keys              Top-level structure and counts
  --summary           Compressed view
  --discover          Surface dynamic keys in freeform zones
  --section=X         Full content of one section
  (no flags)          Full file as JSON

Filtering:
  --since=N           From turn N onward
  --before=N          Before turn N
  --index-on=FIELD    Field for turn filtering (default: turn)

Exit Codes:
  0  Success
  1  File not found or read error
USAGE
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
