# Docker Setup for tmux-riffic-v2

This guide explains how to run tmux-riffic-v2 in Docker containers.

## The Problem You Were Having

When running in a Docker container, tmux requires special configuration:

1. **TTY allocation** - Docker must run with `-t` flag
2. **Interactive mode** - Docker must run with `-i` flag
3. **TERM environment** - Must be set to `screen-256color` or similar
4. **MOCK_MODE** - The production Dockerfile has this set to `true`, which bypasses tmux entirely

## Quick Start

### Option 1: Development Mode (Real tmux sessions)

For development with real tmux sessions:

```bash
# Start the dev container
docker-compose --profile dev up -d tx-dev

# Enter the container
docker exec -it tx-watch-dev bash

# Inside container, start TX
node tx.js start

# In another terminal, attach to tmux
docker exec -it tx-watch-dev bash
tmux attach -t core
```

### Option 2: Production Mode (Mock agents)

For production monitoring (no real tmux/Claude Code):

```bash
# Start production container
docker-compose up -d tx-watch

# Check logs
docker logs -f tx-watch-prod

# Access metrics
curl http://localhost:3001/health
```

## Manual Docker Commands

If you prefer not to use docker-compose:

### Development Build

```bash
# Build dev image
docker build -f Dockerfile.dev -t tmux-riffic-dev .

# Run with TTY and interactive mode (CRITICAL for tmux!)
docker run -it \
  -v $(pwd):/app \
  -v tx-dev-data:/data \
  -p 3002:3001 \
  -e MOCK_MODE=false \
  -e DEBUG=true \
  --name tx-dev \
  tmux-riffic-dev bash

# Inside container
node tx.js start

# From host, attach to tmux session
docker exec -it tx-dev tmux attach -t core
```

### Production Build

```bash
# Build prod image
docker build -t tmux-riffic-prod .

# Run in mock mode (no tmux required)
docker run -d \
  -v tx-data:/data \
  -p 3001:3001 \
  -e MOCK_MODE=true \
  --name tx-prod \
  tmux-riffic-prod
```

## Troubleshooting

### Issue: "tmux gets all messed up"

**Causes:**
1. Container not running with `-it` flags
2. `TERM` not set properly
3. `MOCK_MODE=true` (bypasses tmux entirely)

**Solutions:**
1. Always use `docker run -it` or set `tty: true` and `stdin_open: true` in docker-compose
2. Set `ENV TERM=screen-256color` in Dockerfile
3. Use `Dockerfile.dev` or set `MOCK_MODE=false`

### Issue: "No tmux server detected"

The container needs to keep running. Use one of:
- `command: bash -c "sleep infinity"` in docker-compose
- Run `docker exec -it` after container is up
- Use proper entrypoint script

### Issue: "tmux: open terminal failed: not a terminal"

This means TTY is not allocated. Fix:
```bash
# Add -it flags
docker exec -it tx-dev bash

# Or in docker-compose.yml
tty: true
stdin_open: true
```

## Architecture Notes

### Production (Dockerfile)
- Alpine-based (smaller)
- Mock mode enabled
- Non-root user
- Health checks
- Metrics on port 3001

### Development (Dockerfile.dev)
- Debian-based (better tmux support)
- Real tmux sessions
- Root user (easier debugging)
- Source mounted for live editing
- Debug mode enabled

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_MODE` | `false` (dev) / `true` (prod) | Use mock agents vs real Claude |
| `DEBUG` | `true` (dev) / `false` (prod) | Enable debug logging |
| `NODE_ENV` | `development` / `production` | Node environment |
| `METRICS_PORT` | `3001` | Health check and metrics port |
| `TERM` | `screen-256color` | Terminal type for tmux |

## Next Steps

1. Start with dev mode to test tmux functionality
2. Once working, switch to production mode for deployment
3. Consider adding Claude Code API keys via environment variables
4. Mount persistent volumes for mesh state

## Common Workflows

### Interactive Development

```bash
# Terminal 1: Start container
docker-compose --profile dev up tx-dev

# Terminal 2: Enter and start TX
docker exec -it tx-watch-dev bash
node tx.js start

# Terminal 3: Attach to core mesh
docker exec -it tx-watch-dev bash
tmux attach -t core
```

### Production Monitoring

```bash
# Start in background
docker-compose up -d tx-watch

# Watch logs
docker logs -f tx-watch-prod

# Check health
curl http://localhost:3001/health

# View metrics
curl http://localhost:3001/metrics
```
