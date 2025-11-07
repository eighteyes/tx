#!/bin/bash
# test-host-notify.sh
# Simple test to verify host notification system works

echo "Testing notification system on host..."

if command -v osascript &> /dev/null; then
    echo "✓ Found osascript (macOS)"
    echo "  Sending test notification..."
    osascript -e 'display notification "If you see this, notifications work!" with title "TX Test"'
    echo ""
    echo "  Did you see a notification?"
    echo ""
    echo "  If not, you may need to grant permissions:"
    echo "  1. Run: osascript -e 'display notification \"Hello\" with title \"Hello\"'"
    echo "  2. Open System Preferences → Notifications & Focus"
    echo "  3. Find 'Script Editor' and enable 'Allow Notifications'"
    echo "  4. Run this test again"
elif command -v notify-send &> /dev/null; then
    echo "✓ Found notify-send (Linux)"
    echo "  Sending test notification..."
    notify-send "TX Test" "If you see this, notifications work!"
    echo "  Did you see a notification?"
else
    echo "✗ No notification system found"
    echo "  You might be inside Docker"
    echo "  Run this script on your HOST machine"
fi
