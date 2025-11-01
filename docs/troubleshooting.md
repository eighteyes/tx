# Troubleshooting TX

Common issues and their solutions.

---

## Table of Contents

1. [Installation Issues](#installation-issues)
2. [Spawn Issues](#spawn-issues)
3. [Message Issues](#message-issues)
4. [Tmux Issues](#tmux-issues)
5. [Performance Issues](#performance-issues)
6. [Getting Help](#getting-help)

---

## Installation Issues

### Issue: `tx: command not found`

**Cause:** TX not installed globally or not in PATH

**Solution:**
```bash
# Install globally
npm install -g tx-cli

# Verify installation
tx --version

# Check PATH
echo $PATH | grep npm
```

**Alternative:** Use npx
```bash
npx tx-cli start
```

---

### Issue: `tmux: command not found`

**Cause:** tmux not installed

**Solution:**
```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt-get install tmux

# Fedora/RHEL
sudo dnf install tmux

# Verify
tmux -V
```

---

### Issue: `claude: command not found`

**Cause:** AI CLI not installed

**Solution:**
```bash
# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Verify
claude --version

# Accept permissions
claude --dangerously-skip-permissions
```

---

## Spawn Issues

### Issue: "No such mesh: X"

**Cause:** Mesh name doesn't exist or typo

**Solution:**
```bash
# List available meshes
tx list

# Check exact spelling
tx spawn brain  # Correct
tx spawn Brian  # Wrong (case-sensitive)
```

---

### Issue: "Session already exists"

**Cause:** Previous session not cleaned up

**Solution:**
```bash
# Stop all TX sessions
tx stop

# Or manually kill session
tmux kill-session -t brain

# List active sessions
tmux ls
```

---

### Issue: "Agent validation failed"

**Cause:** Missing agent prompt or invalid configuration

**Solution:**
```bash
# Check agent prompt exists
ls meshes/agents/{mesh}/{agent}/prompt.md

# Validate mesh config
cat meshes/mesh-configs/{mesh}.json

# Check TX logs
tx logs error
```

---

### Issue: Mesh spawns but doesn't respond

**Cause:** AI CLI not starting correctly

**Solution:**
```bash
# Attach to mesh
tx attach {mesh}

# Check for errors
# Press Ctrl+B, D to detach

# Check logs
tx logs debug -f

# Verify AI CLI works standalone
claude --version
```

---

## Message Issues

### Issue: Messages not received

**Cause:** Invalid frontmatter, wrong routing, or inactive target

**Solution:**
```bash
# Check message format
cat .ai/tx/mesh/{mesh}/agents/{agent}/msgs/{message}.md

# Validate frontmatter (should be valid YAML)
# Common issues:
# - Missing required fields (to, from, type, status, msg-id, headline, timestamp)
# - Invalid YAML syntax (wrong indentation, missing colons)

# Check target mesh is running
tx status

# Check routing logs
tx logs debug | grep routing
```

---

### Issue: Orphaned messages (`*-orphan.md`)

**Cause:** Message sent to inactive mesh, cleaned up on next spawn

**Solution:**
- **This is normal behavior**
- Orphaned messages are renamed when target mesh spawns
- Safe to delete `*-orphan.md` files
- Or review and re-send if needed

```bash
# Find orphaned messages
find .ai/tx/mesh -name "*-orphan.md"

# Review before deleting
cat .ai/tx/mesh/{mesh}/agents/{agent}/msgs/*-orphan.md

# Delete if unnecessary
rm .ai/tx/mesh/{mesh}/agents/{agent}/msgs/*-orphan.md
```

---

### Issue: Routing loops

**Cause:** Agents keep sending messages back and forth

**Solution:**
```bash
# Check routing rules in mesh config
cat meshes/mesh-configs/{mesh}.json

# Ensure terminal states exist:
# - "complete" routes to core or completion_agent
# - No circular routes between agents

# Fix example:
# Bad:  agent-a -> agent-b -> agent-a (loop!)
# Good: agent-a -> agent-b -> core (terminal)
```

---

## Tmux Issues

### Issue: Can't detach from tmux

**Cause:** Using wrong key combination

**Solution:**
- **Correct:** `Ctrl+B`, then `D` (two separate key presses)
- **Wrong:** `Ctrl+D` (exits shell, stops mesh!)

**Steps:**
1. Press and hold `Ctrl+B`
2. Release both keys
3. Press `D`

---

### Issue: Tmux displays garbled text

**Cause:** Terminal size mismatch

**Solution:**
```bash
# Detach other clients
tmux detach-client -a

# Resize current session
# Press Ctrl+B, then type:
:resize-window -A

# Or kill and respawn
tx stop {mesh}
tx spawn {mesh}
```

---

### Issue: "tmux: protocol version mismatch"

**Cause:** Multiple tmux versions installed

**Solution:**
```bash
# Check tmux version
tmux -V

# Find all tmux binaries
which -a tmux

# Use specific version
/usr/local/bin/tmux -V

# Update PATH to prioritize correct version
export PATH=/usr/local/bin:$PATH
```

---

## Performance Issues

### Issue: Slow mesh spawning

**Cause:** Cold start, AI CLI initialization

**Solution:**
- **Expected behavior:** First spawn takes 5-10s
- **Subsequent spawns:** Faster due to caching
- **Persistent meshes** (core, brain) stay running

**Optimization:**
```bash
# Use persistent meshes when possible
# Spawn once, use many times

# Spawn in background for parallel work
tx spawn mesh-1 -d
tx spawn mesh-2 -d
tx spawn mesh-3 -d
```

---

### Issue: High CPU usage

**Cause:** File watcher scanning large directories

**Solution:**
```bash
# Check active watchers
tx status

# Stop unnecessary watchers
tx stop {watcher-mesh}

# Exclude large directories from watch (if customizing)
# Edit .gitignore or watcher config
```

---

### Issue: Disk space filling up

**Cause:** Log files growing unbounded

**Solution:**
```bash
# Check log sizes
du -sh .ai/tx/logs/*

# Truncate logs (careful!)
> .ai/tx/logs/debug.jsonl
> .ai/tx/logs/error.jsonl

# Or rotate logs
mv .ai/tx/logs/debug.jsonl .ai/tx/logs/debug.jsonl.old
touch .ai/tx/logs/debug.jsonl

# Clean old messages
find .ai/tx/mesh -name "*.md" -mtime +30 -delete
```

---

## Configuration Issues

### Issue: Search API not working

**Cause:** Missing or invalid API keys

**Solution:**
```bash
# Check .env file exists
ls -la .env

# Copy example if missing
cp .env.example .env

# Edit .env and add keys
nano .env

# Test specific source
tx tool search 'test query' -s github
```

---

### Issue: Wrong AI CLI used

**Cause:** TX_RUNTIME not set or incorrect

**Solution:**
```bash
# Check current runtime
echo $TX_RUNTIME

# Set runtime for session
export TX_RUNTIME=codex

# Or per-command
TX_RUNTIME=gemini tx start

# Make permanent (add to ~/.bashrc or ~/.zshrc)
echo 'export TX_RUNTIME=codex' >> ~/.bashrc
source ~/.bashrc
```

---

## Debugging Techniques

### 1. Check System Status
```bash
tx status
```

### 2. View Logs in Real-Time
```bash
tx logs debug -f
```

### 3. Attach to Mesh
```bash
tx attach {mesh}
# Observe agent behavior
# Ctrl+B, D to detach
```

### 4. Inspect Messages
```bash
# Recent messages
ls -lt .ai/tx/mesh/{mesh}/agents/{agent}/msgs/ | head

# Read specific message
cat .ai/tx/mesh/{mesh}/agents/{agent}/msgs/{message}.md
```

### 5. Validate Mesh Config
```bash
# Check JSON syntax
cat meshes/mesh-configs/{mesh}.json | jq .

# If jq not installed:
node -e "console.log(JSON.stringify(require('./meshes/mesh-configs/{mesh}.json'), null, 2))"
```

### 6. Test Tmux Manually
```bash
# Create test session
tmux new-session -d -s test

# Send command
tmux send-keys -t test "echo hello" Enter

# Check output
tmux capture-pane -t test -p

# Kill session
tmux kill-session -t test
```

---

## Common Error Messages

### "Error: ENOENT: no such file or directory"

**Cause:** Missing file or directory

**Solution:**
```bash
# Check what file is missing (error will specify)
# Common issues:
# - Mesh config not found
# - Agent prompt not found
# - .ai/tx/ directory not initialized

# Reinitialize if needed
tx repo-install --force
```

---

### "Error: Mesh config validation failed"

**Cause:** Invalid JSON or missing required fields

**Solution:**
```bash
# Validate JSON
cat meshes/mesh-configs/{mesh}.json | jq .

# Check required fields:
# - mesh
# - description
# - agents
# - entry_point
# - completion_agent

# Example valid config:
{
  "mesh": "my-mesh",
  "description": "What it does",
  "agents": ["worker"],
  "entry_point": "worker",
  "completion_agent": "worker"
}
```

---

### "Error: Routing validation failed"

**Cause:** Invalid routing rules

**Solution:**
```bash
# Check routing structure
cat meshes/mesh-configs/{mesh}.json | jq .routing

# Routing must follow:
{
  "routing": {
    "agent-name": {
      "status": {
        "target-agent": "message"
      }
    }
  }
}

# Valid statuses: complete, blocked, failed, ready-for-next-iteration
# Valid targets: any agent name in mesh or "core"
```

---

## Clean Slate / Reset

If all else fails, reset TX to clean state:

```bash
# 1. Stop all meshes
tx stop

# 2. Kill all tmux sessions
tmux kill-server

# 3. Remove runtime data (keeps configs)
rm -rf .ai/tx/mesh
rm -rf .ai/tx/logs
rm -rf .ai/tx/state

# 4. Reinitialize
tx start
```

**⚠️ Warning:** This deletes all messages and logs. Backup if needed.

---

## Still Having Issues?

### Collect Debug Information

```bash
# System info
node --version
tmux -V
claude --version
tx --version

# TX status
tx status

# Recent logs
tx logs error -n 100 > tx-error-log.txt
tx logs debug -n 100 > tx-debug-log.txt

# Active sessions
tmux ls > tx-sessions.txt

# Directory structure
tree .ai/tx -L 3 > tx-structure.txt
```

### Get Help

1. **Check documentation:**
   - [Getting Started](./getting-started.md)
   - [Commands Reference](./commands.md)
   - [Architecture](./architecture.md)

2. **Search existing issues:**
   - [GitHub Issues](https://github.com/your-repo/tx-cli/issues)

3. **Ask the community:**
   - [GitHub Discussions](https://github.com/your-repo/tx-cli/discussions)
   - [Discord](https://discord.gg/your-invite) (if available)

4. **Report a bug:**
   - [New Issue](https://github.com/your-repo/tx-cli/issues/new)
   - Include debug info from above
   - Describe steps to reproduce

---

## Preventive Maintenance

### Regular Cleanup

```bash
# Weekly: Clean old messages (30+ days)
find .ai/tx/mesh -name "*.md" -mtime +30 -delete

# Weekly: Rotate logs
./scripts/rotate-logs.sh  # If available

# Monthly: Check disk usage
du -sh .ai/tx/*
```

### Health Checks

```bash
# Add to crontab or run periodically
tx status
tx logs error -n 10
```

---

**Need Help?** [GitHub Issues](https://github.com/your-repo/issues) | [Discord](https://discord.gg/your-invite)
