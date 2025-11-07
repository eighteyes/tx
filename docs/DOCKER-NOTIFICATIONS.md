# Docker Notifications Setup

When running TX in Docker (like with safe-claude), system notifications require a bridge between the container and your host OS.

## How It Works

1. **Inside Container**: TX writes notifications to `.ai/tx/notifications.log`
2. **On Host**: A watcher script monitors the log and sends native OS notifications

## Setup Steps

### 1. Verify Host Notifications Work

On your **HOST machine** (outside Docker), test your notification system:

```bash
# From host
./scripts/test-host-notify.sh
```

You should see a test notification. If not, install notification support:
- **macOS**: Already has `osascript` (built-in)
- **Linux**: `sudo apt install libnotify-bin` (for notify-send)

### 2. Mount the Notification Directory

When starting your Docker container, mount the `.ai/tx` directory:

```bash
# Example with safe-claude
docker run -v $(pwd)/.ai/tx:/workspace/.ai/tx ...

# Or if using docker-compose
volumes:
  - ./.ai/tx:/workspace/.ai/tx
```

### 3. Run the Watcher on Host

On your **HOST machine**, run the notification watcher:

```bash
# From project root on HOST (not in Docker)
npm run notify
```

Leave this running in a terminal. It will:
- Monitor the notification log file
- Send native OS notifications when agents need your attention
- Display terminal output with timestamps

### 4. Test End-to-End

**Inside Docker container:**
```bash
tx tool notify "Test from Docker" "This should appear on host" "high"
```

**On Host:**
You should see:
1. Terminal output in the watcher
2. Native OS notification popup

## Example Setup with safe-claude

**Terminal 1 (Host) - Start safe-claude with volume mount:**
```bash
# Assuming safe-claude mounts current directory
safe-claude
# Inside container
tx start
```

**Terminal 2 (Host) - Run notification watcher:**
```bash
cd /path/to/your/project
npm run notify
```

**Terminal 3 (Inside Docker):**
```bash
# Your work happens here
# When agents send ask-human, you'll get notified on host
```

## Troubleshooting

### "No notification system detected"

This means the watcher script is running inside Docker, not on host.

**Solution:** Exit Docker and run the watcher on your host machine.

### "Notification file not found"

The `.ai/tx` directory isn't mounted or accessible from host.

**Solution:**
1. Verify Docker volume mount includes `.ai/tx`
2. Check file exists: `ls .ai/tx/notifications.log`

### osascript works but notifications don't appear

macOS notification permissions may be blocking.

**Solution:**

First, trigger Script Editor to appear in System Preferences:
```bash
osascript -e 'display notification "Hello" with title "Hello"'
```

Then enable permissions:
1. Open System Preferences → Notifications & Focus (or Notifications)
2. Find **Script Editor** in the list
3. Enable "Allow Notifications"
4. Also check your **Terminal** app has notifications enabled

**Note:** macOS requires Script Editor to have permission to send notifications via osascript. Running the command above will make Script Editor appear in your notification settings so you can grant permission.

### Notifications work but are delayed

This is normal - the watcher polls the file with `tail -f`.

Typical delay: < 1 second

## Alternative: Terminal-Only Mode

If you don't want to run a host watcher, TX still provides:
- **Terminal bells** (audio beeps)
- **Colored visual alerts** (in container terminal)
- **Notification log** (review with `cat .ai/tx/notifications.log`)

These work without any host setup.

## Advanced: Autostart Watcher

### Using tmux (macOS/Linux)

```bash
# Create a tmux session for watcher
tmux new-session -d -s tx-notify './scripts/watch-notifications.sh .ai/tx/notifications.log'

# Reattach to see output
tmux attach -t tx-notify
```

### Using screen

```bash
screen -dmS tx-notify ./scripts/watch-notifications.sh .ai/tx/notifications.log
screen -r tx-notify  # Reattach
```

## Configuration

Edit `config.json` in the project root (inside the container) to control notification behavior:

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

Quiet hours are respected by the container (won't write to log during those hours).
