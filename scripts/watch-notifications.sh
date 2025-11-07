#!/bin/bash
# watch-notifications.sh
# Monitor TX notifications from Docker container and send native notifications on host
#
# Usage:
#   ./watch-notifications.sh [path-to-notifications-log]
#
# Default path: .ai/tx/notifications.log
#
# Requirements:
#   - jq (JSON processor)
#   - notify-send (Linux) or osascript (macOS)

NOTIFICATION_FILE="${1:-.ai/tx/notifications.log}"

# Check if file exists
if [ ! -f "$NOTIFICATION_FILE" ]; then
  echo "Error: Notification file not found: $NOTIFICATION_FILE"
  echo "Usage: $0 [path-to-notifications-log]"
  exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed"
  echo "Install with: sudo apt install jq (Linux) or brew install jq (macOS)"
  exit 1
fi

# Detect platform and notification command
if command -v notify-send &> /dev/null; then
  NOTIFIER="notify-send"
  PLATFORM="linux"
elif command -v osascript &> /dev/null; then
  NOTIFIER="osascript"
  PLATFORM="macos"
else
  echo "Warning: No notification system detected (notify-send or osascript)"
  echo "Will only display notifications in terminal"
  NOTIFIER="echo"
  PLATFORM="none"
fi

echo "Monitoring TX notifications from: $NOTIFICATION_FILE"
echo "Platform: $PLATFORM | Notifier: $NOTIFIER"
echo "Press Ctrl+C to stop"
echo ""

# Function to send notification based on platform
send_notification() {
  local title="$1"
  local message="$2"
  local priority="$3"

  # Terminal output
  echo "[$(date '+%H:%M:%S')] [$priority] $title: $message"

  # Platform-specific notification
  case "$PLATFORM" in
    linux)
      urgency="normal"
      [ "$priority" = "high" ] && urgency="critical"
      notify-send -u "$urgency" "$title" "$message" 2>&1
      ;;
    macos)
      # Escape quotes for osascript
      local escaped_title="${title//\"/\\\"}"
      local escaped_message="${message//\"/\\\"}"
      osascript -e "display notification \"$escaped_message\" with title \"$escaped_title\"" 2>&1
      if [ $? -ne 0 ]; then
        echo "Warning: osascript failed for notification"
      fi
      ;;
    *)
      # No native notification available, terminal only
      ;;
  esac
}

# Watch the notification file
tail -f "$NOTIFICATION_FILE" | while read -r line; do
  # Parse JSON
  title=$(echo "$line" | jq -r '.title // "TX Notification"')
  message=$(echo "$line" | jq -r '.message // ""')
  priority=$(echo "$line" | jq -r '.priority // "medium"')
  timestamp=$(echo "$line" | jq -r '.timestamp // ""')

  # Send notification
  send_notification "$title" "$message" "$priority"
done
