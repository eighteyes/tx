# Interactive Log Viewer

The TX system now includes an interactive log viewer that lets you filter logs in real-time using keyboard shortcuts.

## Usage

Start the interactive log viewer:

```bash
node bin/tx.js logs -i
# or
node bin/tx.js logs --interactive
```

## Keyboard Shortcuts

Once the interactive viewer is running, use these keys to filter the log display:

- **F** - File view: Shows only file operations (watcher component)
- **I** - Injection view: Shows only tmux injections (tmux-injector component)
- **E** - Event view: Shows only system events (event-bus component)
- **A** - All view: Shows all logs (no filter)
- **Q** - Quit: Exit the viewer
- **Ctrl+C** - Also exits the viewer

## Features

- **Real-time updates**: The viewer automatically refreshes when new logs arrive
- **Clear filtering**: Each view shows only the relevant component's logs
- **Color-coded display**: Different components have distinct colors for easy identification
- **Status header**: Shows the current filter and available keyboard shortcuts

## Options

You can combine the interactive mode with other options:

```bash
# Show last 100 lines in interactive mode
node bin/tx.js logs -i -n 100

# Show last 200 lines in interactive mode
node bin/tx.js logs -i --lines 200
```

## View Descriptions

### File View (F)
Shows file system operations tracked by the watcher:
- File additions to queues (inbox, next, active, outbox)
- File removals and movements
- Agent message routing

### Injection View (I)
Shows tmux session management:
- Session creation and termination
- Command injections into Claude sessions
- Configuration loading

### Event View (E)
Shows system-wide events:
- Event bus emissions
- Component lifecycle events
- Inter-component communication

### All View (A)
Shows everything including:
- Queue operations
- Directory initialization
- System manager activities
- All components listed above

## Examples

1. Start the viewer in interactive mode:
   ```bash
   node bin/tx.js logs -i
   ```

2. Press `F` to see only file operations
3. Press `I` to see only tmux injections
4. Press `E` to see only events
5. Press `A` to see all logs again
6. Press `Q` to exit

## Note

The interactive mode requires a TTY terminal. If you need non-interactive filtering, use the `-c` option instead:

```bash
node bin/tx.js logs -c watcher        # Files only
node bin/tx.js logs -c tmux-injector  # Injections only
node bin/tx.js logs -c event-bus      # Events only
```
