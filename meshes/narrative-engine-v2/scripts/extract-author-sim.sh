#!/usr/bin/env bash
# extract-author-sim.sh
# Extract simulator-relevant fields from author.yaml
# Reduces ~395 lines / ~6K tokens to ~60 lines / ~800 tokens

set -euo pipefail

AUTHOR_PATH="${1:?Usage: extract-author-sim.sh <path-to-author.yaml>}"

if [[ ! -f "$AUTHOR_PATH" ]]; then
  echo "ERROR: author.yaml not found at $AUTHOR_PATH" >&2
  exit 1
fi

# Log available keys for debugging
yq 'keys' "$AUTHOR_PATH" >&2

# Extract only simulator-relevant fields
yq '{
  pacing: .pacing,
  balance: {dialogue_description: .balance.dialogue_description},
  chaos_register: .chaos_register,
  interpretive_frames: .interpretive_frames
}' "$AUTHOR_PATH"
