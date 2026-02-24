# TX Server Reference

HTTP/WebSocket server for remote access to TX meshes, sessions, and messages.

## Starting the Server

```bash
tx server                          # Start with defaults
tx server --port 3000              # Custom port
TX_SERVE_MESHES=research tx server # Publish only specific meshes
```

## Environment Variables

### `TX_SERVE_MESHES`

Comma-separated allowlist of mesh names the server will publish. When set, only listed meshes are loaded, dispatched, and exposed via the API. Meshes not in the list are invisible — they won't appear in listings and direct access returns 404.

- **Default**: unset (all meshes published)
- **Format**: `mesh-name,mesh-name,...`
- **Scope**: Affects config loader (loadAll, loadOnDemand) and HTTP API (list, get)

```bash
# Publish only research meshes
TX_SERVE_MESHES=research,deep-research tx server

# Single mesh
TX_SERVE_MESHES=dev tx server

# Spaces are trimmed
TX_SERVE_MESHES="research, deep-research, dev" tx server
```

**What happens when set:**

| Layer | Behavior |
|-------|----------|
| Config Loader `loadAll()` | Skips loading configs for filtered meshes |
| Config Loader `loadOnDemand()` | Blocks JIT loading of filtered meshes |
| `GET /v1/meshes` | Only returns meshes in the allowlist |
| `GET /v1/meshes/:name` | Returns 404 for filtered meshes |
| Worker dispatch | Won't spawn workers for filtered meshes (config not loaded) |

Startup logs confirm the active filter:
```
[config-loader] TX_SERVE_MESHES filter active: research, deep-research
```

### `TX_SERVER_PORT`

Port for the HTTP/WebSocket server.

- **Default**: `4100`

### `TX_ROOT`

Root directory for global TX installation. Server looks for meshes in `$TX_ROOT/meshes/` as fallback when project meshes directory doesn't exist.

### `ANTHROPIC_API_KEY`

Required. API key for Claude SDK access. Workers cannot function without it.

## API Endpoints

### Meshes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/meshes` | List all published meshes |
| `GET` | `/v1/meshes/:name` | Get specific mesh config |
| `PUT` | `/v1/meshes/:name` | Update mesh config |
| `POST` | `/v1/meshes/:name/validate` | Validate config without saving |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/sessions` | List active sessions |
| `POST` | `/v1/sessions` | Create new session |
| `GET` | `/v1/sessions/:id` | Get session details |
| `DELETE` | `/v1/sessions/:id` | Terminate session |

### Messages

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/messages` | Send a message |
| `GET` | `/v1/messages` | List messages |

### WebSocket

Connect to `ws://host:port` for real-time message streaming.
