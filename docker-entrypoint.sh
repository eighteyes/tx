#!/bin/bash
set -e

# Docker entrypoint for tmux-riffic-v2
# Handles tmux initialization and session management in containerized environments

# Ensure TERM is set for tmux compatibility
export TERM="${TERM:-screen-256color}"

# Ensure app directory is writable by current user
APP_DIR="/app"
if [ -w "$APP_DIR" ]; then
  # Create .ai directory structure
  mkdir -p "$APP_DIR/.ai/tx/{logs,mesh}"
else
  echo "Warning: $APP_DIR is not writable, attempting to fix permissions..."
  sudo chown -R $(whoami):$(whoami) "$APP_DIR" 2>/dev/null || true
  mkdir -p "$APP_DIR/.ai/tx/{logs,mesh}"
fi

# Set up data directory if needed
if [ ! -d "/data" ]; then
  mkdir -p /data
fi

# Initialize .ai directory structure if it doesn't exist
if [ ! -d "/data/tx" ]; then
  echo "Initializing TX data directory structure..."
  mkdir -p /data/tx/mesh
  mkdir -p /data/tx/agents
fi

# Handle different commands
case "${1:-start}" in
  start)
    echo "Starting TX Watch..."
    echo "Mock Mode: ${MOCK_MODE:-false}"
    echo "Debug Mode: ${DEBUG:-false}"

    # Check if tmux is available
    if ! command -v tmux &> /dev/null; then
      echo "ERROR: tmux is not installed"
      exit 1
    fi

    # Start the TX system
    exec node tx.js start
    ;;

  bash|sh)
    echo "Starting interactive shell..."
    exec /bin/bash
    ;;

  *)
    # Pass through to tx.js
    exec node tx.js "$@"
    ;;
esac
