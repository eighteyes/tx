# Notify Capability

Send system notifications to alert the user when their attention is needed.

## When to Use

Use notify when you need to:
- Alert user about completed tasks
- Notify about important events or milestones
- Request user attention for critical issues
- Provide status updates on long-running operations

**Note:** Notifications are automatically sent when you use `ask-human` messages to core, so you typically don't need to manually notify for human-in-the-loop scenarios.

## Usage

```bash
tx tool notify "title" "message" [priority]
```

**Arguments:**
- `title` - Notification title (required)
- `message` - Notification message (optional, defaults to title)
- `priority` - Priority level: low, medium, high (optional, defaults to medium)

## Examples

### High Priority Notification
```bash
tx tool notify "Critical Error" "Database connection failed" "high"
```

### Medium Priority (Default)
```bash
tx tool notify "Task Complete" "Analysis finished successfully"
```

### Low Priority
```bash
tx tool notify "Info" "Background task completed" "low"
```

### Single Argument
```bash
tx tool notify "Quick status update"
```

## Priority Levels

- **high** - Plays sound, shows urgently (use for blocking issues)
- **medium** - Plays sound, normal display (default, use for important updates)
- **low** - Silent notification (use for informational updates)

## Automatic Notifications

The system automatically sends notifications when:
- Agents send `ask-human` messages to core
- The notification includes the agent name and question preview
- Priority is set to "high" by default for ask-human messages

## Configuration

Users can customize notification behavior in `config.json` (project root):

```json
{
  "notifications": {
    "enabled": true,
    "quietHours": { "start": 22, "end": 8 },
    "minInterval": 5000
  }
}
```

## Best Practices

1. **Don't spam** - Use notifications sparingly for important events only
2. **Choose appropriate priority** - Reserve high priority for truly critical issues
3. **Be concise** - Keep titles and messages brief and clear
4. **Use ask-human for questions** - Don't manually notify when asking questions, use ask-human instead
5. **Consider timing** - Respect quiet hours configuration

## Example Workflow

```markdown
After completing a long analysis:

tx tool notify "Analysis Complete" "Customer segmentation analysis finished. Results saved to reports/" "medium"
```

## Docker/Container Support

When running in Docker or containerized environments, TX automatically detects this and uses fallback strategies:

**Fallback mechanisms:**
1. **Terminal Bell** - Audible beeps (priority-based count)
2. **Visual Alert** - Colored console output with emoji icons
3. **Notification File** - Writes to `.ai/tx/notifications.log`

**Host monitoring script example:**

Create a simple host-side script to monitor the notification file and send native notifications:

```bash
#!/bin/bash
# File: watch-tx-notifications.sh
# Mount .ai/tx as volume and run this on host

tail -f /path/to/mounted/.ai/tx/notifications.log | while read line; do
  title=$(echo "$line" | jq -r '.title')
  message=$(echo "$line" | jq -r '.message')
  priority=$(echo "$line" | jq -r '.priority')

  # Linux
  urgency=$([ "$priority" = "high" ] && echo "critical" || echo "normal")
  notify-send -u "$urgency" "$title" "$message"

  # macOS alternative:
  # osascript -e "display notification \"$message\" with title \"$title\""
done
```

## Notes

- Notifications are cross-platform (Linux, macOS, Windows)
- Docker detection is automatic (checks for `/.dockerenv` and cgroup)
- Rate limiting prevents notification spam (configurable minimum interval)
- Quiet hours can be configured to prevent notifications during specific times
- Notifications gracefully degrade if system notifications are unavailable
