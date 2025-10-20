# Interactive Log Viewer

The TX system includes an interactive log viewer that lets you filter logs in real-time using keyboard shortcuts with **toggle-based filtering**.

## Usage

Start the interactive log viewer (now the default):

```bash
node bin/tx.js logs
```

## Keyboard Shortcuts

The viewer uses **toggle filters** - you can turn multiple filters on/off to combine them:

- **f** - Toggle file operations filter (watcher component)
- **i** - Toggle injections filter (tmux-injector component)
- **e** - Toggle events filter (event-bus component)
- **a** - Clear all filters (show all logs)
- **c** - Clear log files (useful for starting fresh)
- **q** - Quit: Exit the viewer
- **Ctrl+C** - Also exits the viewer

## Filter Modes

- **All mode** `[all]`: No filters active - shows everything
- **Filter mode** `[filtered]`: One or more filters active - shows only matching logs

You can combine filters! For example:
- Press `f` to see only file operations
- Press `i` to also see injections (now showing files + injections)
- Press `e` to also see events (now showing files + injections + events)
- Press `a` to clear all filters and see everything again

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

1. Start the viewer (interactive is now default):
   ```bash
   node bin/tx.js logs
   ```

2. Press `f` to toggle file operations filter on
3. Press `i` to also include injections (now showing files + injections)
4. Press `f` again to turn off files filter (now showing only injections)
5. Press `a` to clear all filters and see everything
6. Press `q` to exit

## Note

The interactive mode requires a TTY terminal. If you need non-interactive filtering, use the `-c` option instead:

```bash
node bin/tx.js logs -c watcher        # Files only
node bin/tx.js logs -c tmux-injector  # Injections only
node bin/tx.js logs -c event-bus      # Events only
```
