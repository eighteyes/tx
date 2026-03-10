#!/bin/bash
# Install tx CLI globally from GitHub
set -e
echo "Installing tx CLI..."
npm install -g eighteyes/tx
echo "tx installed successfully. Run 'tx --help' to verify."
