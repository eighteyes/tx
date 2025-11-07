
### System Notifications

TX includes cross-platform system notifications to alert you when your attention is needed:

**Automatic notifications:**
- When agents send `ask-human` messages to core
- Includes agent name and question preview
- Configurable priority levels

**Manual notifications:**
```bash
tx tool notify "Task Complete" "Analysis finished" "high"
tx tool notify "Quick update" "Build successful"
tx tool notify "Single message"  # Uses default title
```

**Priority levels:**
- `high` - With sound, high urgency (3 beeps in Docker)
- `medium` - With sound, normal urgency (2 beeps in Docker, default)
- `low` - Silent notification (1 beep in Docker)

**Docker/Container Support:**

When running in Docker (like with safe-claude), TX automatically uses fallback strategies:

1. **Terminal Bell** - Audible beeps (count based on priority)
2. **Visual Alert** - Colored terminal output with icons
3. **Notification File** - Writes to `.ai/tx/notifications.log` for host monitoring

You can monitor notifications from the host with the included helper script:

```bash
# From your host machine (ensure .ai/tx is mounted from container)
npm run notify

# Or directly
./scripts/watch-notifications.sh .ai/tx/notifications.log
```

Or manually with:
```bash
# Watch notification file (if using Docker volume mount)
tail -f .ai/tx/notifications.log | jq -r '"\(.timestamp) [\(.priority)] \(.title): \(.message)"'
```

The helper script automatically detects your platform (Linux/macOS) and sends native notifications.

**macOS Setup:** First time setup requires granting notification permissions:
```bash
# This will prompt macOS to add Script Editor to Notification settings
osascript -e 'display notification "Hello" with title "Hello"'

# Then: System Preferences → Notifications & Focus → Script Editor → Allow Notifications
```

**Configuration:**

Edit `config.json` in your project root to customize notification behavior:

```json
{
  "notifications": {
    "enabled": true,
    "quietHours": { "start": 22, "end": 8 },
    "minInterval": 5000,
    "askHuman": {
      "enabled": true,
      "priority": "high"
    }
  }
}
```

Options:
- `enabled` - Enable/disable all notifications
- `quietHours` - Set quiet hours (24-hour format, null to disable)
- `minInterval` - Minimum milliseconds between notifications (rate limiting)
- `askHuman.enabled` - Enable/disable automatic ask-human notifications
- `askHuman.priority` - Default priority for ask-human notifications
