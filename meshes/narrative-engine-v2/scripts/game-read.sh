#!/usr/bin/env bash
# game-read.sh - Browse, skim, and read YAML game artifacts
#
# Usage: game-read.sh <workspace> [artifact] [flags]
#
# Entity slash addressing:
#   character --list           List character IDs
#   character/heather --keys   Structure of heather's file
#   author --section=X         Section of a plain artifact
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

LEVEL="game"

# ─────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────

show_help() {
  cat >&2 <<'USAGE'
game-read.sh — Browse, skim, and read YAML game artifacts

Usage:
  game-read.sh <workspace> [artifact] [flags]
  game-read.sh ./gm --list
  game-read.sh ./gm character --list
  game-read.sh ./gm character/heather --keys
  game-read.sh ./gm author --section=voice

Entity Slash Addressing:
  character/heather    -> entities/characters/heather.yaml
  bond/kai_heath       -> entities/bonds/kai_heath.yaml
  character --list     -> list all character entity IDs

Browse (artifact optional):
  --list              List available artifacts (includes entities)
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
dispatch_read "$SCRIPT_DIR/schemas/game"
