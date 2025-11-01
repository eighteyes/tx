#!/bin/bash
# Docker container setup script
# Run this on container startup to ensure Python dependencies are installed

set -e

echo "🐳 Running Docker setup for tx-cli..."

# Check if know-cli is mounted
if [ -d "/workspace/know-cli/know" ]; then
  echo "📦 Setting up Python virtual environment for know-cli..."

  VENV_PATH="/workspace/know-cli/know/venv"
  REQUIREMENTS="/workspace/know-cli/know/requirements.txt"

  # Check if python3 is available
  if ! command -v python3 &> /dev/null; then
    echo "❌ python3 not found. Install with: apt-get install python3 python3-venv"
    exit 1
  fi

  # Create venv if it doesn't exist
  if [ ! -d "$VENV_PATH" ]; then
    echo "   Creating virtual environment at $VENV_PATH"
    if ! python3 -m venv "$VENV_PATH"; then
      echo "❌ Failed to create venv. Install python3-venv with: apt-get install python3-venv"
      exit 1
    fi
  else
    echo "   Virtual environment already exists"
  fi

  # Check what's in the venv
  echo "   Checking venv contents..."
  ls -la "$VENV_PATH/bin/" || echo "   Venv bin directory not found"

  # Use python -m pip instead of pip directly (more reliable)
  if [ -f "$REQUIREMENTS" ]; then
    echo "   Installing dependencies from requirements.txt"
    if ! "$VENV_PATH/bin/python" -m pip install --upgrade pip 2>/dev/null; then
      echo "   Installing pip first..."
      "$VENV_PATH/bin/python" -m ensurepip --upgrade
      "$VENV_PATH/bin/python" -m pip install --upgrade pip
    fi
    "$VENV_PATH/bin/python" -m pip install -r "$REQUIREMENTS"
    echo "✅ Python dependencies installed in venv"
  else
    echo "⚠️  requirements.txt not found at $REQUIREMENTS"
  fi
else
  echo "⚠️  know-cli not found at /workspace/know-cli"
fi

echo "✅ Docker setup complete"
